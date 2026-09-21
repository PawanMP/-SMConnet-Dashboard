// Builds the Express application: security middleware, API routes, static
// frontend and the central error handler.
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const config = require("./config");
const db = require("./db");
const { requestContext } = require("./middleware/requestContext");
const { secureHeaders, corsPolicy, limiters } = require("./middleware/security");
const { authenticate, requireAuth, requireRole, csrfGuard } = require("./middleware/auth");
const { apiNotFound, errorHandler } = require("./middleware/errors");
const { AppError } = require("./lib/errors");
const insights = require("./routes/insights");

const PUBLIC_DIR = path.join(config.rootDir, "public");

// Old page URLs keep working after the redesign.
const LEGACY_PAGES = {
  "/facebook.html": "/accounts.html#facebook",
  "/instagram.html": "/accounts.html#instagram",
  "/youtube.html": "/accounts.html#youtube",
  "/tiktok.html": "/accounts.html#tiktok",
  "/pinterest.html": "/accounts.html#pinterest",
  "/scheduled-posts.html": "/calendar.html",
  "/account-settings.html": "/profile.html",
};

function trustProxySetting(value) {
  if (value === "" || value === undefined) return false;
  if (value === "true") return true;
  const n = Number(value);
  return Number.isFinite(n) ? n : value;
}

function createApp() {
  const app = express();
  app.disable("x-powered-by");
  // Node's querystring parser: no nested objects from query strings.
  app.set("query parser", "simple");
  app.set("trust proxy", trustProxySetting(config.security.trustProxy));

  app.use(requestContext);
  app.use(secureHeaders());

  const problems = config.validate();
  if (problems.length) {
    // Fail closed but visibly: every request explains which settings are missing.
    app.use((_req, res) => {
      res.status(503).json({
        success: false,
        error: { code: "MISCONFIGURED", message: "The server configuration is incomplete.", details: problems.map((message) => ({ message })) },
      });
    });
    return app;
  }

  for (const [from, to] of Object.entries(LEGACY_PAGES)) {
    app.get([from, from.replace(/\.html$/, "")], (_req, res) => res.redirect(301, to));
  }

  // ── API ──
  app.use("/api", corsPolicy());
  app.use("/api", express.json({ limit: "1mb" }));
  app.use("/api", express.urlencoded({ extended: false, limit: "100kb" }));
  app.use("/api", cookieParser());
  app.use("/api", async (_req, _res, next) => {
    try {
      await db.ready();
      next();
    } catch (err) {
      require("./lib/logger").error("Database initialisation failed", { err });
      next(new AppError(503, "DATABASE_UNAVAILABLE", "The database is unavailable. Please try again shortly."));
    }
  });
  app.use("/api", authenticate);
  app.use("/api", csrfGuard);
  app.use("/api", limiters.api());

  app.use("/api", require("./routes/system"));
  app.use("/api/auth", require("./routes/auth"));
  app.use("/api/oauth", require("./routes/oauth"));
  app.use("/api/profile", requireAuth, require("./routes/profile"));
  app.use("/api/accounts", requireAuth, require("./routes/accounts"));
  app.use("/api/media", requireAuth, require("./routes/media"));
  app.use("/api/posts", requireAuth, require("./routes/posts"));
  app.use("/api/ai", requireAuth, require("./routes/ai"));
  app.use("/api/analytics", requireAuth, insights.analyticsRouter);
  app.use("/api/notifications", requireAuth, insights.notificationsRouter);
  app.use("/api/activity", requireAuth, insights.activityRouter);
  app.use("/api/admin", requireRole("admin"), require("./routes/admin"));
  app.use("/api", apiNotFound);

  // ── Locally stored media (development without Cloudinary) ──
  // Public by design: social platforms download media from these URLs.
  // File names are 128-bit random values.
  app.use("/media", express.static(config.media.uploadDir, { index: false, dotfiles: "deny", maxAge: "7d", fallthrough: false }));

  // ── Frontend ──
  app.use(express.static(PUBLIC_DIR, { extensions: ["html"], maxAge: config.isProd ? "1h" : 0 }));
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next();
    res.status(404).sendFile(path.join(PUBLIC_DIR, "404.html"));
  });

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
