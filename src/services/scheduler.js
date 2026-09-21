// Publishes scheduled posts when they fall due. Schedules live in the database,
// so nothing is lost on restart; the first run after start-up catches up on
// anything that became due while the server was down.
//
// Runs on an in-process timer for long-lived servers, or via the cron
// endpoint (/api/cron/scheduler) on serverless hosts.
const config = require("../config");
const logger = require("../lib/logger");
const time = require("../lib/time");
const postsModel = require("../models/posts");
const appState = require("../models/appState");
const oauthStates = require("../models/oauthStates");
const publisher = require("./publisher");

let timer = null;
let running = false;
let lastRunAt = null;
let lastSummary = null;

// Targets left in "processing" by a crashed or restarted server. Whether the
// platform received the post is unknown, so they are marked failed (never
// auto-republished) and the user decides whether to retry.
async function recoverStale() {
  const stale = await postsModel.listStaleTargets(time.addMinutes(new Date(), -config.scheduler.staleLockMinutes));
  const posts = new Set();
  for (const t of stale) {
    await postsModel.completeTarget(t.id, {
      success: false,
      code: "INTERRUPTED",
      message: "Publishing was interrupted (the server restarted). Check the platform, then retry if the post is missing.",
    });
    posts.add(Number(t.post_id));
  }
  for (const id of posts) await publisher.refreshPostStatus(id);
  return stale.length;
}

// Posts that were due long ago (server offline for a day) are not published
// late, where they could be out of date; they are failed with an explanation.
async function expireMissed(due) {
  const maxHours = config.scheduler.maxLatenessHours;
  const cutoff = Date.now() - maxHours * 3600 * 1000;
  const fresh = [];
  const touched = new Set();
  for (const t of due) {
    if (time.toMs(t.scheduled_at) < cutoff && Number(t.attempts) === 0) {
      const claimed = await postsModel.claimTarget(t.id, ["scheduled"], "expire");
      if (claimed) {
        await postsModel.completeTarget(t.id, {
          success: false,
          code: "MISSED_SCHEDULE",
          message: `Missed its scheduled time by more than ${maxHours} hours (the server was offline). Use Retry to publish it now.`,
        });
        touched.add(Number(t.post_id));
      }
    } else {
      fresh.push(t);
    }
  }
  for (const id of touched) await publisher.refreshPostStatus(id);
  return fresh;
}

async function maintenance() {
  const done = {};
  if (await appState.due("maintenance.tokens", 60)) {
    done.tokens = await require("./tokens").checkExpiringAccounts();
    await oauthStates.purgeExpired();
  }
  if (await appState.due("maintenance.media", 360)) {
    done.mediaRemoved = await require("./media").cleanupUnused();
  }
  if (await appState.due("maintenance.metrics", 360)) {
    done.metrics = await require("./analytics").refreshRecentMetrics({ limit: 25 });
  }
  return done;
}

async function tick({ source = "timer", withMaintenance = true } = {}) {
  if (running) return { skipped: true, reason: "A scheduler run is already in progress." };
  running = true;
  const summary = { source, recovered: 0, due: 0, published: 0, failed: 0, retrying: 0, posts: 0 };
  try {
    summary.recovered = await recoverStale();
    const due = await expireMissed(await postsModel.listDueTargets(config.scheduler.batchSize));
    summary.due = due.length;

    const byPost = new Map();
    for (const t of due) {
      if (!byPost.has(t.post_id)) byPost.set(t.post_id, []);
      byPost.get(t.post_id).push(t);
    }
    for (const [postId, targets] of byPost) {
      const claimed = await publisher.claim(targets, ["scheduled"]);
      if (!claimed.length) continue; // another instance took them
      await publisher.refreshPostStatus(postId);
      const post = await postsModel.findById(postId);
      const { results } = await publisher.publishClaimed(post, claimed, "schedule");
      summary.posts++;
      for (const r of results) {
        if (r.success) summary.published++;
        else if (r.willRetry) summary.retrying++;
        else summary.failed++;
      }
    }
    if (withMaintenance) summary.maintenance = await maintenance();
    lastRunAt = new Date().toISOString();
    lastSummary = summary;
    await appState.set("scheduler.last_run", lastRunAt);
    if (summary.due || summary.recovered) logger.info("Scheduler run finished", summary);
    return summary;
  } catch (err) {
    logger.error("Scheduler run failed", { err });
    throw err;
  } finally {
    running = false;
  }
}

function start() {
  if (timer || !config.scheduler.enabled) return;
  const run = () => tick().catch(() => {});
  timer = setInterval(run, config.scheduler.intervalMs);
  if (timer.unref) timer.unref();
  setImmediate(run);
  logger.info(`Scheduler started (every ${Math.round(config.scheduler.intervalMs / 1000)}s)`);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

async function status() {
  return {
    mode: config.scheduler.enabled ? "interval" : "cron",
    intervalMs: config.scheduler.enabled ? config.scheduler.intervalMs : null,
    running,
    lastRunAt: lastRunAt || (await appState.get("scheduler.last_run")),
    lastSummary,
  };
}

module.exports = { tick, start, stop, status, recoverStale };
