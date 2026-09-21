// Records user actions for the activity log. Logging must never break the
// request that triggered it, so failures are swallowed and reported.
const activity = require("../models/activity");
const logger = require("../lib/logger");

async function log(reqOrUserId, action, { entityType, entityId, details } = {}) {
  const req = typeof reqOrUserId === "object" && reqOrUserId !== null ? reqOrUserId : null;
  const userId = req ? req.user && req.user.id : reqOrUserId;
  try {
    await activity.create({
      userId,
      action,
      entityType,
      entityId,
      details,
      ip: req ? req.ip : null,
      userAgent: req ? req.get("user-agent") : null,
    });
  } catch (err) {
    logger.warn("Failed to write activity log", { action, err });
  }
}

module.exports = { log };
