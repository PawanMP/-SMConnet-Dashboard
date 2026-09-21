// Engagement snapshots fetched from platform APIs. Each refresh inserts a new
// row; analytics read the latest snapshot per target.
const db = require("../db");
const time = require("../lib/time");

const num = (v) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

async function insert(target, m) {
  await db.run(
    "INSERT INTO post_metrics (target_id, post_id, user_id, platform, views, likes, comments, shares, saves, raw, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      target.id,
      target.post_id,
      target.user_id,
      target.platform,
      num(m.views),
      num(m.likes),
      num(m.comments),
      num(m.shares),
      num(m.saves),
      m.raw ? JSON.stringify(m.raw).slice(0, 60000) : null,
      time.now(),
    ]
  );
}

function toPublic(r) {
  return {
    targetId: Number(r.target_id),
    postId: Number(r.post_id),
    platform: r.platform,
    views: num(r.views),
    likes: num(r.likes),
    comments: num(r.comments),
    shares: num(r.shares),
    saves: num(r.saves),
    fetchedAt: time.fromDb(r.fetched_at),
  };
}

const LATEST_JOIN = `
  FROM post_metrics m
  INNER JOIN (
    SELECT target_id, MAX(id) AS max_id FROM post_metrics GROUP BY target_id
  ) latest ON latest.max_id = m.id`;

async function latestForPost(postId) {
  const rows = await db.all(`SELECT m.* ${LATEST_JOIN} WHERE m.post_id = ?`, [postId]);
  return rows.map(toPublic);
}

// Sums the latest snapshot of every target, grouped by platform.
async function totalsByPlatform(userId, { dateFrom, dateTo } = {}) {
  const where = [];
  const params = [];
  if (userId) {
    where.push("m.user_id = ?");
    params.push(userId);
  }
  if (dateFrom || dateTo) {
    where.push("EXISTS (SELECT 1 FROM post_targets t WHERE t.id = m.target_id AND t.published_at >= ? AND t.published_at <= ?)");
    params.push(time.toDb(dateFrom || "1970-01-01"), time.toDb(dateTo || "2999-12-31"));
  }
  const rows = await db.all(
    `SELECT m.platform, COUNT(*) AS tracked, SUM(m.views) AS views, SUM(m.likes) AS likes, SUM(m.comments) AS comments, SUM(m.shares) AS shares, SUM(m.saves) AS saves
     ${LATEST_JOIN} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} GROUP BY m.platform`,
    params
  );
  return rows.map((r) => ({
    platform: r.platform,
    tracked: Number(r.tracked),
    views: num(r.views) || 0,
    likes: num(r.likes) || 0,
    comments: num(r.comments) || 0,
    shares: num(r.shares) || 0,
    saves: num(r.saves) || 0,
  }));
}

// Posts ranked by likes + comments + shares of their latest snapshots.
async function topPosts(userId, limit = 5) {
  const rows = await db.all(
    `SELECT m.post_id, SUM(COALESCE(m.views, 0)) AS views, SUM(COALESCE(m.likes, 0)) AS likes, SUM(COALESCE(m.comments, 0)) AS comments, SUM(COALESCE(m.shares, 0)) AS shares
     ${LATEST_JOIN} ${userId ? "WHERE m.user_id = ?" : ""}
     GROUP BY m.post_id
     ORDER BY (SUM(COALESCE(m.likes, 0)) + SUM(COALESCE(m.comments, 0)) + SUM(COALESCE(m.shares, 0))) DESC, SUM(COALESCE(m.views, 0)) DESC
     LIMIT ?`,
    userId ? [userId, limit] : [limit]
  );
  return rows.map((r) => ({
    postId: Number(r.post_id),
    views: num(r.views) || 0,
    likes: num(r.likes) || 0,
    comments: num(r.comments) || 0,
    shares: num(r.shares) || 0,
  }));
}

module.exports = { insert, latestForPost, totalsByPlatform, topPosts, toPublic };
