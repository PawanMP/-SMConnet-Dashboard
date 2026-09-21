// Creates in-app notifications, honouring each user's notification settings.
const notifications = require("../models/notifications");
const settings = require("../models/settings");
const logger = require("../lib/logger");
const { PLATFORM_LABELS } = require("../lib/errors");

const label = (p) => PLATFORM_LABELS[p] || p;

async function safeCreate(userId, payload) {
  try {
    await notifications.create(userId, payload);
  } catch (err) {
    logger.warn("Failed to create notification", { err });
  }
}

// Summarises one publishing run for one post. `trigger` distinguishes a
// scheduled run (reported as "Scheduled post completed") from manual ones.
async function publishResult(post, results, trigger) {
  if (!results.length) return;
  const prefs = await settings.getRaw(post.user_id);
  const ok = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  const name = post.title || (post.caption ? post.caption.slice(0, 40) : `Post #${post.id}`);
  const link = `/post.html?id=${post.id}`;

  if (failed.length && Number(prefs.notify_on_failure)) {
    const detail = failed.map((r) => `${label(r.platform)}: ${r.error}`).join("\n");
    await safeCreate(post.user_id, {
      type: "publish_failed",
      title: ok.length
        ? `Partly published: "${name}" failed on ${failed.map((r) => label(r.platform)).join(", ")}`
        : `Publishing failed: "${name}"`,
      message: detail,
      link,
    });
  }
  if (!failed.length && ok.length && Number(prefs.notify_on_success)) {
    await safeCreate(post.user_id, {
      type: trigger === "schedule" ? "schedule_completed" : "publish_success",
      title:
        trigger === "schedule"
          ? `Scheduled post completed: "${name}"`
          : `Published: "${name}"`,
      message: `Published to ${ok.map((r) => label(r.platform)).join(", ")}.`,
      link,
    });
  }
}

// One unread warning per account problem, not one per scheduler run.
async function connectionProblem(account, reason) {
  const title = `Reconnect your ${label(account.platform)} account`;
  if (await notifications.hasUnread(account.user_id, "connection_problem", title)) return;
  await safeCreate(account.user_id, {
    type: "connection_problem",
    title,
    message: reason || "The access token has expired or was revoked. Reconnect to keep publishing.",
    link: `/accounts.html#${account.platform}`,
  });
}

module.exports = { publishResult, connectionProblem };
