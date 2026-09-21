// Publishing analytics (from our own records) and engagement analytics
// (fetched from each platform where its API allows).
const db = require("../db");
const time = require("../lib/time");
const logger = require("../lib/logger");
const postsModel = require("../models/posts");
const accountsModel = require("../models/accounts");
const metricsModel = require("../models/metrics");
const platforms = require("./platforms");
const tokens = require("./tokens");

function range({ from, to }) {
  const end = to ? new Date(to) : new Date();
  let start = from ? new Date(from) : new Date(end.getTime() - 29 * 86400000);
  if (end - start > 366 * 86400000) start = new Date(end.getTime() - 365 * 86400000);
  if (start > end) start = new Date(end);
  start.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(23, 59, 59, 999);
  return { start, end };
}

function scope(userId, alias = "t") {
  return userId ? { sql: ` AND ${alias}.user_id = ?`, params: [userId] } : { sql: "", params: [] };
}

async function summary(userId, filters = {}) {
  const { start, end } = range(filters);
  const s = scope(userId);

  const statusCounts = await postsModel.countByStatus(userId, { dateFrom: start, dateTo: end });
  const upcomingRow = await db.get(
    `SELECT COUNT(*) AS n FROM posts p WHERE p.status = 'scheduled'${userId ? " AND p.user_id = ?" : ""}`,
    userId ? [userId] : []
  );

  // Per-platform target outcomes in the period (by publish/attempt/schedule date).
  const dateExpr = "COALESCE(t.published_at, t.last_attempt_at, t.scheduled_at, t.created_at)";
  const platformRows = await db.all(
    `SELECT t.platform, t.status, COUNT(*) AS n FROM post_targets t
     WHERE ${dateExpr} >= ? AND ${dateExpr} <= ?${s.sql}
     GROUP BY t.platform, t.status`,
    [time.toDb(start), time.toDb(end), ...s.params]
  );
  const distribution = {};
  for (const p of platforms.PLATFORMS) distribution[p] = { platform: p, total: 0, success: 0, failed: 0, scheduled: 0, other: 0 };
  for (const r of platformRows) {
    const d = distribution[r.platform];
    if (!d) continue;
    const n = Number(r.n);
    d.total += n;
    if (r.status === "success") d.success += n;
    else if (r.status === "failed") d.failed += n;
    else if (r.status === "scheduled") d.scheduled += n;
    else d.other += n;
  }
  const dist = Object.values(distribution);
  const okTargets = dist.reduce((a, d) => a + d.success, 0);
  const failedTargets = dist.reduce((a, d) => a + d.failed, 0);

  // Daily publishing outcomes (UTC days).
  const dayExpr = "COALESCE(t.published_at, t.last_attempt_at)";
  const timelineRows = await db.all(
    `SELECT DATE(${dayExpr}) AS day, t.status, COUNT(*) AS n FROM post_targets t
     WHERE t.status IN ('success', 'failed') AND ${dayExpr} >= ? AND ${dayExpr} <= ?${s.sql}
     GROUP BY DATE(${dayExpr}), t.status`,
    [time.toDb(start), time.toDb(end), ...s.params]
  );
  const days = new Map();
  for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86400000)) {
    const key = d.toISOString().slice(0, 10);
    days.set(key, { date: key, success: 0, failed: 0 });
  }
  for (const r of timelineRows) {
    const key = String(r.day).slice(0, 10);
    const entry = days.get(key);
    if (entry) entry[r.status === "success" ? "success" : "failed"] += Number(r.n);
  }

  const nonDraft = Object.entries(statusCounts).filter(([k]) => k !== "draft").reduce((a, [, v]) => a + v, 0);
  const engagement = await metricsModel.totalsByPlatform(userId, { dateFrom: start, dateTo: end });
  const top = await metricsModel.topPosts(userId, 5);
  const titles = top.length
    ? await db.all(`SELECT id, title, caption FROM posts WHERE id IN (${top.map(() => "?").join(", ")})`, top.map((t) => t.postId))
    : [];
  const titleById = Object.fromEntries(titles.map((t) => [Number(t.id), t.title || (t.caption || "").split("\n")[0].slice(0, 80) || `Post #${t.id}`]));

  return {
    range: { from: start.toISOString(), to: end.toISOString() },
    totals: {
      posts: nonDraft,
      published: statusCounts.published || 0,
      partial: statusCounts.partial || 0,
      failed: statusCounts.failed || 0,
      scheduled: Number(upcomingRow.n),
      drafts: statusCounts.draft || 0,
      cancelled: statusCounts.cancelled || 0,
      connectedAccounts: await accountsModel.countConnected(userId),
      platformPublishes: okTargets,
      platformFailures: failedTargets,
      successRate: okTargets + failedTargets ? Math.round((okTargets / (okTargets + failedTargets)) * 1000) / 10 : null,
    },
    platforms: dist,
    timeline: [...days.values()],
    engagement: {
      byPlatform: engagement,
      totals: engagement.reduce(
        (a, e) => ({ views: a.views + e.views, likes: a.likes + e.likes, comments: a.comments + e.comments, shares: a.shares + e.shares, saves: a.saves + e.saves }),
        { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 }
      ),
      topPosts: top.map((t) => ({ ...t, title: titleById[t.postId] || `Post #${t.postId}` })),
    },
  };
}

// All-time totals for the dashboard, where no date range is chosen.
async function overview(userId) {
  const statusCounts = await postsModel.countByStatus(userId);
  const s = scope(userId);
  const targetRows = await db.all(`SELECT t.status, COUNT(*) AS n FROM post_targets t WHERE 1 = 1${s.sql} GROUP BY t.status`, s.params);
  const byStatus = Object.fromEntries(targetRows.map((r) => [r.status, Number(r.n)]));
  const ok = byStatus.success || 0;
  const failed = byStatus.failed || 0;
  const nonDraft = Object.entries(statusCounts).filter(([k]) => k !== "draft").reduce((a, [, v]) => a + v, 0);
  return {
    totals: {
      posts: nonDraft,
      published: statusCounts.published || 0,
      partial: statusCounts.partial || 0,
      failed: statusCounts.failed || 0,
      scheduled: statusCounts.scheduled || 0,
      drafts: statusCounts.draft || 0,
      cancelled: statusCounts.cancelled || 0,
      connectedAccounts: await accountsModel.countConnected(userId),
      platformPublishes: ok,
      platformFailures: failed,
      successRate: ok + failed ? Math.round((ok / (ok + failed)) * 1000) / 10 : null,
    },
  };
}

// Pulls fresh engagement numbers for recently published targets.
async function refreshMetrics(userId, { limit = 30, days = 90 } = {}) {
  const since = time.toDb(new Date(Date.now() - days * 86400000));
  const targets = await db.all(
    `SELECT * FROM post_targets WHERE status = 'success' AND platform_post_id IS NOT NULL AND published_at >= ?${userId ? " AND user_id = ?" : ""}
     ORDER BY published_at DESC LIMIT ?`,
    userId ? [since, userId, limit] : [since, limit]
  );
  const out = { updated: 0, unavailable: 0, failed: 0, errors: [] };
  const accountCache = new Map();
  for (const t of targets) {
    const key = `${t.user_id}:${t.platform}`;
    try {
      if (!accountCache.has(key)) accountCache.set(key, await accountsModel.findByUserPlatform(t.user_id, t.platform));
      const account = accountCache.get(key);
      const adapter = platforms.get(t.platform);
      if (!account || account.status !== "connected" || typeof adapter.fetchMetrics !== "function") {
        out.unavailable++;
        continue;
      }
      const m = await adapter.fetchMetrics({ account, tokens: await tokens.getValidTokens(account), target: t });
      if (!m) {
        out.unavailable++;
        continue;
      }
      await metricsModel.insert(t, m);
      out.updated++;
    } catch (err) {
      out.failed++;
      if (out.errors.length < 5) out.errors.push({ platform: t.platform, message: err.message });
      logger.debug("Metrics refresh failed", { targetId: t.id, err: err.message });
    }
  }
  return out;
}

const refreshRecentMetrics = (opts) => refreshMetrics(null, { days: 14, ...opts });

module.exports = { summary, overview, refreshMetrics, refreshRecentMetrics };
