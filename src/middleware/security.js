// Secure headers, CORS and rate limiting.
const helmet = require("helmet");
const cors = require("cors");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const config = require("../config");
const { AppError } = require("../lib/errors");

function secureHeaders() {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:", "blob:", "https:"],
        "media-src": ["'self'", "blob:", "https:"],
        "connect-src": ["'self'", "https://api.cloudinary.com"],
        "font-src": ["'self'", "data:"],
        "object-src": ["'none'"],
        "frame-ancestors": ["'none'"],
        "form-action": ["'self'"],
        "base-uri": ["'self'"],
        "upgrade-insecure-requests": config.isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.isProd ? { maxAge: 15552000, includeSubDomains: true } : false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  });
}

// The UI is served from the same origin, so cross-origin access is off unless
// CORS_ORIGINS lists trusted origins explicitly.
function corsPolicy() {
  const allowed = new Set(config.security.corsOrigins);
  return cors({
    origin(origin, cb) {
      if (!origin || allowed.has(origin)) return cb(null, true);
      return cb(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    maxAge: 600,
  });
}

function limiter({ windowMs, limit, message, byUser = false }) {
  if (!config.security.rateLimitEnabled) return (_req, _res, next) => next();
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => (byUser && req.user ? `user:${req.user.id}` : ipKeyGenerator(req.ip || "unknown")),
    handler: (_req, _res, next) => next(new AppError(429, "RATE_LIMITED", message)),
  });
}

const limiters = {
  auth: () => limiter({ windowMs: 15 * 60 * 1000, limit: 10, message: "Too many sign-in attempts. Please wait 15 minutes and try again." }),
  api: () => limiter({ windowMs: 15 * 60 * 1000, limit: 1000, message: "Too many requests. Please slow down.", byUser: true }),
  ai: () => limiter({ windowMs: 60 * 1000, limit: 20, message: "AI request limit reached. Please wait a minute.", byUser: true }),
  publish: () => limiter({ windowMs: 60 * 1000, limit: 30, message: "Publishing limit reached. Please wait a minute.", byUser: true }),
  upload: () => limiter({ windowMs: 60 * 1000, limit: 30, message: "Upload limit reached. Please wait a minute.", byUser: true }),
};

module.exports = { secureHeaders, corsPolicy, limiters };
