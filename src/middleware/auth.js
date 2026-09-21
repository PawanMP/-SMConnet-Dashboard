// Session authentication. The browser app uses an httpOnly cookie; API
// clients may send the same JWT as "Authorization: Bearer <token>".
const config = require("../config");
const users = require("../models/users");
const { verifySession, signSession, sessionMaxAgeMs } = require("../lib/jwt");
const { unauthorized, forbidden } = require("../lib/errors");

function cookieOptions() {
  return {
    httpOnly: true,
    secure: config.auth.cookieSecure,
    // Lax still sends the cookie on the top-level redirect back from an OAuth
    // provider while blocking it on cross-site POSTs.
    sameSite: "lax",
    path: "/",
  };
}

function setSessionCookie(res, user) {
  const token = signSession(user);
  res.cookie(config.auth.cookieName, token, { ...cookieOptions(), maxAge: sessionMaxAgeMs() });
  return token;
}

function clearSessionCookie(res) {
  res.clearCookie(config.auth.cookieName, cookieOptions());
}

function readToken(req) {
  const header = req.get("authorization") || "";
  if (/^Bearer\s+/i.test(header)) return { token: header.replace(/^Bearer\s+/i, "").trim(), method: "bearer" };
  const cookie = req.cookies && req.cookies[config.auth.cookieName];
  if (cookie) return { token: cookie, method: "cookie" };
  return { token: null, method: null };
}

// Populates req.user when a valid session exists; never rejects by itself.
async function authenticate(req, res, next) {
  const { token, method } = readToken(req);
  if (!token) return next();
  try {
    const payload = verifySession(token);
    const user = await users.findById(Number(payload.sub));
    if (!user || !Number(user.is_active) || Number(user.token_version) !== Number(payload.tv)) {
      throw new Error("Session revoked");
    }
    req.user = { ...users.toPublic(user), tokenVersion: Number(user.token_version) };
    req.authMethod = method;
  } catch {
    if (method === "cookie") clearSessionCookie(res);
  }
  next();
}

function requireAuth(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden("This area is only available to administrators."));
    next();
  };
}

// CSRF defence for cookie sessions: state-changing requests must carry a
// custom header, which cross-site HTML forms cannot set.
function csrfGuard(req, _res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.authMethod !== "cookie") return next();
  if (!req.get("x-requested-with")) {
    return next(forbidden("Missing X-Requested-With header."));
  }
  next();
}

module.exports = { authenticate, requireAuth, requireRole, csrfGuard, setSessionCookie, clearSessionCookie };
