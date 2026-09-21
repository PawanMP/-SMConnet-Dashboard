// Health check and the cron entry point for serverless scheduling.
const express = require("express");
const crypto = require("crypto");
const config = require("../config");
const db = require("../db");
const scheduler = require("../services/scheduler");
const { asyncHandler: h } = require("../middleware/requestContext");
const { AppError } = require("../lib/errors");

const router = express.Router();
const startedAt = Date.now();

router.get(
  "/health",
  h(async (_req, res) => {
    let database = "ok";
    try {
      await db.ready();
      await db.ping();
    } catch {
      database = "unavailable";
    }
    const healthy = database === "ok";
    res.status(healthy ? 200 : 503).json({
      success: healthy,
      status: healthy ? "ok" : "degraded",
      version: config.version,
      environment: config.env,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      time: new Date().toISOString(),
      checks: { database },
    });
  })
);

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Vercel Cron sends "Authorization: Bearer <CRON_SECRET>"; external cron
// services can send the same header.
async function runCron(req, res) {
  const secret = config.security.cronSecret;
  if (!secret) throw new AppError(503, "CRON_DISABLED", "Set CRON_SECRET to enable the scheduler endpoint.");
  const provided = (req.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!provided || !safeEqual(provided, secret)) throw new AppError(401, "UNAUTHORIZED", "Invalid cron secret.");
  const summary = await scheduler.tick({ source: "cron" });
  res.json({ success: true, summary });
}

router.get("/cron/scheduler", h(runCron));
router.post("/cron/scheduler", h(runCron));

module.exports = router;
