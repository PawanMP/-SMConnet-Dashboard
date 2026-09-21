// Central configuration. Every environment variable the app reads is resolved
// here so the rest of the code never touches process.env directly.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT_DIR = path.resolve(__dirname, "..", "..");

function bool(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function list(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// In development we don't want people to hand-craft secrets before the first
// run, so missing secrets are generated once and persisted outside git.
function loadDevSecrets(dataDir) {
  const file = path.join(dataDir, ".dev-secrets.json");
  let secrets = {};
  try {
    secrets = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    secrets = {};
  }
  let changed = false;
  if (!secrets.jwtSecret) {
    secrets.jwtSecret = crypto.randomBytes(48).toString("base64");
    changed = true;
  }
  if (!secrets.encryptionKey) {
    secrets.encryptionKey = crypto.randomBytes(32).toString("base64");
    changed = true;
  }
  if (changed) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(secrets, null, 2), { mode: 0o600 });
    } catch {
      // Read-only filesystem: secrets stay in memory for this process only.
    }
  }
  return secrets;
}

function build(env = process.env) {
  const nodeEnv = env.NODE_ENV || "development";
  const isProd = nodeEnv === "production";
  const isTest = nodeEnv === "test";
  const isVercel = !!env.VERCEL;
  const port = int(env.PORT, 3000);
  const dataDir = path.resolve(ROOT_DIR, env.DATA_DIR || "data");

  let jwtSecret = env.JWT_SECRET || "";
  let encryptionKey = env.ENCRYPTION_KEY || "";
  if (!isProd && (!jwtSecret || !encryptionKey)) {
    const dev = isTest
      ? { jwtSecret: crypto.randomBytes(48).toString("base64"), encryptionKey: crypto.randomBytes(32).toString("base64") }
      : loadDevSecrets(dataDir);
    jwtSecret = jwtSecret || dev.jwtSecret;
    encryptionKey = encryptionKey || dev.encryptionKey;
  }

  const vercelHost = env.VERCEL_PROJECT_PRODUCTION_URL || env.VERCEL_URL;
  const appUrl = (env.APP_URL || (vercelHost ? `https://${vercelHost}` : `http://localhost:${port}`)).replace(/\/+$/, "");

  const hasMysql = !!(env.DATABASE_URL || env.DB_HOST);
  const dbClient = (env.DB_CLIENT || (hasMysql ? "mysql" : "sqlite")).toLowerCase();

  const cloudinaryFromUrl = (() => {
    if (!env.CLOUDINARY_URL) return {};
    try {
      const u = new URL(env.CLOUDINARY_URL);
      return { cloudName: u.hostname, apiKey: decodeURIComponent(u.username), apiSecret: decodeURIComponent(u.password) };
    } catch {
      return {};
    }
  })();

  const cloudinary = {
    cloudName: env.CLOUDINARY_CLOUD_NAME || cloudinaryFromUrl.cloudName || "",
    apiKey: env.CLOUDINARY_API_KEY || cloudinaryFromUrl.apiKey || "",
    apiSecret: env.CLOUDINARY_API_SECRET || cloudinaryFromUrl.apiSecret || "",
    folder: env.CLOUDINARY_FOLDER || "social-poster",
  };
  cloudinary.enabled = !!(cloudinary.cloudName && cloudinary.apiKey && cloudinary.apiSecret);

  return {
    env: nodeEnv,
    isProd,
    isTest,
    isDev: !isProd && !isTest,
    isVercel,
    port,
    appUrl,
    rootDir: ROOT_DIR,
    dataDir,
    version: require(path.join(ROOT_DIR, "package.json")).version,
    logLevel: env.LOG_LEVEL || (isTest ? "silent" : isProd ? "info" : "debug"),

    db: {
      client: dbClient,
      url: env.DATABASE_URL || "",
      host: env.DB_HOST || "",
      port: int(env.DB_PORT, 3306),
      user: env.DB_USER || "",
      password: env.DB_PASSWORD || "",
      database: env.DB_NAME || "",
      ssl: bool(env.DB_SSL, false),
      sslRejectUnauthorized: bool(env.DB_SSL_REJECT_UNAUTHORIZED, true),
      connectionLimit: int(env.DB_CONNECTION_LIMIT, isVercel ? 3 : 10),
      sqliteFile: env.SQLITE_FILE || (isTest ? ":memory:" : path.join(dataDir, "app.db")),
    },

    auth: {
      jwtSecret,
      jwtExpiresIn: env.JWT_EXPIRES_IN || "7d",
      cookieName: env.SESSION_COOKIE_NAME || "sp_session",
      cookieSecure: bool(env.COOKIE_SECURE, isProd),
      allowRegistration: bool(env.ALLOW_REGISTRATION, true),
      adminEmail: env.ADMIN_EMAIL || "",
      adminPassword: env.ADMIN_PASSWORD || "",
      adminName: env.ADMIN_NAME || "Administrator",
    },

    security: {
      encryptionKey,
      corsOrigins: list(env.CORS_ORIGINS),
      trustProxy: env.TRUST_PROXY ? env.TRUST_PROXY : isVercel ? "1" : "",
      rateLimitEnabled: bool(env.RATE_LIMIT_ENABLED, !isTest),
      cronSecret: env.CRON_SECRET || "",
    },

    media: {
      provider: cloudinary.enabled ? "cloudinary" : "local",
      maxImageBytes: int(env.MEDIA_MAX_IMAGE_MB, 10) * 1024 * 1024,
      maxVideoBytes: int(env.MEDIA_MAX_VIDEO_MB, 100) * 1024 * 1024,
      uploadDir: path.resolve(ROOT_DIR, env.UPLOAD_DIR || (isVercel ? "/tmp/uploads" : "uploads")),
      unusedMediaTtlHours: int(env.MEDIA_UNUSED_TTL_HOURS, 24),
    },
    cloudinary,

    scheduler: {
      // Serverless functions are frozen between requests, so the in-process
      // timer is off on Vercel; the cron endpoint drives the scheduler there.
      enabled: bool(env.SCHEDULER_ENABLED, !isVercel && !isTest),
      intervalMs: int(env.SCHEDULER_INTERVAL_MS, 30000),
      batchSize: int(env.SCHEDULER_BATCH_SIZE, 10),
      staleLockMinutes: int(env.SCHEDULER_STALE_LOCK_MINUTES, 15),
      autoRetryLimit: int(env.SCHEDULER_AUTO_RETRY_LIMIT, 2),
      autoRetryDelayMinutes: int(env.SCHEDULER_AUTO_RETRY_DELAY_MINUTES, 5),
      maxLatenessHours: int(env.SCHEDULER_MAX_LATENESS_HOURS, 24),
    },

    publishing: {
      maxAttempts: int(env.PUBLISH_MAX_ATTEMPTS, 5),
    },

    ai: {
      defaultProvider: (env.AI_DEFAULT_PROVIDER || (env.OPENAI_API_KEY ? "openai" : env.GEMINI_API_KEY ? "gemini" : "openai")).toLowerCase(),
      openaiApiKey: env.OPENAI_API_KEY || "",
      openaiModel: env.OPENAI_MODEL || "gpt-4o-mini",
      geminiApiKey: env.GEMINI_API_KEY || "",
      geminiModel: env.GEMINI_MODEL || "gemini-2.5-flash",
    },

    platforms: {
      facebook: {
        appId: env.FACEBOOK_APP_ID || "",
        appSecret: env.FACEBOOK_APP_SECRET || "",
        graphVersion: env.FACEBOOK_GRAPH_VERSION || "v21.0",
      },
      instagram: {
        appId: env.INSTAGRAM_APP_ID || "",
        appSecret: env.INSTAGRAM_APP_SECRET || "",
        graphVersion: env.INSTAGRAM_GRAPH_VERSION || "v21.0",
      },
      youtube: {
        clientId: env.GOOGLE_CLIENT_ID || "",
        clientSecret: env.GOOGLE_CLIENT_SECRET || "",
        privacyStatus: env.YOUTUBE_PRIVACY_STATUS || "public",
      },
      tiktok: {
        clientKey: env.TIKTOK_CLIENT_KEY || "",
        clientSecret: env.TIKTOK_CLIENT_SECRET || "",
        privacyLevel: env.TIKTOK_PRIVACY_LEVEL || "SELF_ONLY",
      },
      pinterest: {
        appId: env.PINTEREST_APP_ID || "",
        appSecret: env.PINTEREST_APP_SECRET || "",
        apiBase: env.PINTEREST_API_BASE || "https://api.pinterest.com",
      },
    },
  };
}

// Returns human-readable problems that must block a production start.
function validate(cfg) {
  const errors = [];
  if (cfg.isProd) {
    if (!cfg.auth.jwtSecret || cfg.auth.jwtSecret.length < 32) {
      errors.push("JWT_SECRET must be set to a random string of at least 32 characters.");
    }
    try {
      require("../lib/crypto").parseKey(cfg.security.encryptionKey);
    } catch {
      errors.push("ENCRYPTION_KEY must be a 32-byte key encoded as base64 or 64 hex characters.");
    }
    if (cfg.isVercel && cfg.db.client !== "mysql") {
      errors.push("A MySQL database (DATABASE_URL or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME) is required on Vercel.");
    }
  }
  if (!["mysql", "sqlite"].includes(cfg.db.client)) {
    errors.push(`DB_CLIENT must be "mysql" or "sqlite" (got "${cfg.db.client}").`);
  }
  return errors;
}

const config = build();
config.build = build;
config.validate = () => validate(config);

module.exports = config;
