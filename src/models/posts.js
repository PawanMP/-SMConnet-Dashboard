// Posts (drafts, scheduled and published content) and their per-platform
// targets, which carry each platform's own status, IDs, errors and retries.
const db = require("../db");
const time = require("../lib/time");

// ── Posts ─────────────────────────────────────────────────────────────────────

function toPublic(p, extras = {}) {
  if (!p) return null;
  return {
    id: Number(p.id),
    userId: Number(p.user_id),
    title: p.title || "",
    caption: p.caption || "",
    description: p.description || "",
    hashtags: p.hashtags || "",
    mediaId: p.media_id ? Number(p.media_id) : null,
    thumbnailMediaId: p.thumbnail_media_id ? Number(p.thumbnail_media_id) : null,
    status: p.status,
    tone: p.tone || null,
    platforms: db.json(p.platforms, []),
    platformContent: db.json(p.platform_content, {}),
    scheduledAt: time.fromDb(p.scheduled_at),
    publishedAt: time.fromDb(p.published_at),
    createdAt: time.fromDb(p.created_at),
    updatedAt: time.fromDb(p.updated_at),
    ...extras,
  };
}

const COLUMNS = {
  title: "title",
  caption: "caption",
  description: "description",
  hashtags: "hashtags",
  mediaId: "media_id",
  thumbnailMediaId: "thumbnail_media_id",
  status: "status",
  tone: "tone",
  platforms: "platforms",
  platformContent: "platform_content",
  scheduledAt: "scheduled_at",
  publishedAt: "published_at",
};

function columnValue(key, value) {
  if (key === "platforms" || key === "platformContent") return JSON.stringify(value || (key === "platforms" ? [] : {}));
  if (key === "scheduledAt" || key === "publishedAt") return time.toDb(value);
  if (value === undefined) return null;
  return value;
}

async function create(userId, data, conn = db) {
  const now = time.now();
  const keys = Object.keys(COLUMNS).filter((k) => data[k] !== undefined);
  const { insertId } = await conn.run(
    `INSERT INTO posts (user_id, created_at, updated_at${keys.map((k) => `, ${COLUMNS[k]}`).join("")}) VALUES (?, ?, ?${keys.map(() => ", ?").join("")})`,
    [userId, now, now, ...keys.map((k) => columnValue(k, data[k]))]
  );
  return conn.get("SELECT * FROM posts WHERE id = ?", [insertId]);
}

async function update(id, data, conn = db) {
  const keys = Object.keys(COLUMNS).filter((k) => data[k] !== undefined);
  if (keys.length) {
    await conn.run(`UPDATE posts SET ${keys.map((k) => `${COLUMNS[k]} = ?`).join(", ")}, updated_at = ? WHERE id = ?`, [
      ...keys.map((k) => columnValue(k, data[k])),
      time.now(),
      id,
    ]);
  }
  return conn.get("SELECT * FROM posts WHERE id = ?", [id]);
}

const findById = (id) => db.get("SELECT * FROM posts WHERE id = ?", [id]);
const findForUser = (id, userId) => db.get("SELECT * FROM posts WHERE id = ? AND user_id = ?", [id, userId]);
const remove = (id) => db.run("DELETE FROM posts WHERE id = ?", [id]);

const escapeLike = (s) => `%${String(s).replace(/[!%_]/g, "!$&")}%`;

// Search, filter and paginate posts. `dateFrom`/`dateTo` apply to the post's
// most relevant date: published, else scheduled, else created.
async function list({ userId, status, platform, q, dateFrom, dateTo, page = 1, pageSize = 20, sort = "newest" }) {
  const where = [];
  const params = [];
  if (userId) {
    where.push("p.user_id = ?");
    params.push(userId);
  }
  if (status && status.length) {
    where.push(`p.status IN (${status.map(() => "?").join(", ")})`);
    params.push(...status);
  }
  if (platform) {
    where.push("p.platforms LIKE ? ESCAPE '!'");
    params.push(escapeLike(`"${platform}"`));
  }
  if (q) {
    where.push("(p.title LIKE ? ESCAPE '!' OR p.caption LIKE ? ESCAPE '!' OR p.description LIKE ? ESCAPE '!' OR p.hashtags LIKE ? ESCAPE '!')");
    const like = escapeLike(q);
    params.push(like, like, like, like);
  }
  const dateExpr = "COALESCE(p.published_at, p.scheduled_at, p.created_at)";
  if (dateFrom) {
    where.push(`${dateExpr} >= ?`);
    params.push(time.toDb(dateFrom));
  }
  if (dateTo) {
    where.push(`${dateExpr} <= ?`);
    params.push(time.toDb(dateTo));
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const order =
    sort === "oldest"
      ? "p.created_at ASC, p.id ASC"
      : sort === "scheduled"
        ? "p.scheduled_at ASC, p.id ASC"
        : "p.created_at DESC, p.id DESC";
  const total = Number((await db.get(`SELECT COUNT(*) AS n FROM posts p ${clause}`, params)).n);
  const rows = await db.all(`SELECT p.* FROM posts p ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`, [
    ...params,
    pageSize,
    (page - 1) * pageSize,
  ]);
  return { rows, total, page, pageSize };
}

async function countByStatus(userId, { dateFrom, dateTo } = {}) {
  const where = [];
  const params = [];
  if (userId) {
    where.push("user_id = ?");
    params.push(userId);
  }
  if (dateFrom) {
    where.push("COALESCE(published_at, scheduled_at, created_at) >= ?");
    params.push(time.toDb(dateFrom));
  }
  if (dateTo) {
    where.push("COALESCE(published_at, scheduled_at, created_at) <= ?");
    params.push(time.toDb(dateTo));
  }
  const rows = await db.all(
    `SELECT status, COUNT(*) AS n FROM posts ${where.length ? `WHERE ${where.join(" AND ")}` : ""} GROUP BY status`,
    params
  );
  const out = {};
  for (const r of rows) out[r.status] = Number(r.n);
  return out;
}

// ── Targets ───────────────────────────────────────────────────────────────────

function targetToPublic(t) {
  return {
    id: Number(t.id),
    postId: Number(t.post_id),
    platform: t.platform,
    status: t.status,
    scheduledAt: time.fromDb(t.scheduled_at),
    platformPostId: t.platform_post_id || null,
    platformUrl: t.platform_url || null,
    errorMessage: t.error_message || null,
    errorCode: t.error_code || null,
    attempts: Number(t.attempts || 0),
    lastAttemptAt: time.fromDb(t.last_attempt_at),
    publishedAt: time.fromDb(t.published_at),
  };
}

async function createTargets(post, entries, conn = db) {
  const now = time.now();
  for (const e of entries) {
    await conn.run(
      "INSERT INTO post_targets (post_id, user_id, platform, social_account_id, status, scheduled_at, attempts, locked_at, lock_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)",
      [
        post.id,
        post.user_id,
        e.platform,
        e.accountId || null,
        e.status,
        time.toDb(e.scheduledAt),
        e.lockToken ? now : null,
        e.lockToken || null,
        now,
        now,
      ]
    );
  }
  return listTargets(post.id, conn);
}

const listTargets = (postId, conn = db) => conn.all("SELECT * FROM post_targets WHERE post_id = ? ORDER BY id", [postId]);
const findTarget = (id) => db.get("SELECT * FROM post_targets WHERE id = ?", [id]);
const deleteTargets = (postId, conn = db) => conn.run("DELETE FROM post_targets WHERE post_id = ?", [postId]);

async function listTargetsForPosts(postIds) {
  if (!postIds.length) return [];
  return db.all(`SELECT * FROM post_targets WHERE post_id IN (${postIds.map(() => "?").join(", ")}) ORDER BY id`, postIds);
}

// Atomically moves a target into "processing". Only one caller can win, which
// keeps overlapping scheduler runs and double clicks from publishing twice.
async function claimTarget(id, fromStatuses, lockToken) {
  const { affectedRows } = await db.run(
    `UPDATE post_targets SET status = 'processing', locked_at = ?, lock_token = ?, updated_at = ? WHERE id = ? AND status IN (${fromStatuses
      .map(() => "?")
      .join(", ")})`,
    [time.now(), lockToken, time.now(), id, ...fromStatuses]
  );
  return affectedRows === 1;
}

async function completeTarget(id, result) {
  const now = time.now();
  if (result.success) {
    await db.run(
      "UPDATE post_targets SET status = 'success', platform_post_id = ?, platform_url = ?, error_message = NULL, error_code = NULL, attempts = attempts + 1, last_attempt_at = ?, published_at = ?, locked_at = NULL, lock_token = NULL, updated_at = ? WHERE id = ?",
      [result.platformPostId || null, result.url || null, now, now, now, id]
    );
  } else {
    await db.run(
      "UPDATE post_targets SET status = ?, error_message = ?, error_code = ?, attempts = attempts + 1, last_attempt_at = ?, scheduled_at = COALESCE(?, scheduled_at), locked_at = NULL, lock_token = NULL, updated_at = ? WHERE id = ?",
      [result.nextStatus || "failed", result.message || "Unknown error", result.code || null, now, time.toDb(result.retryAt), now, id]
    );
  }
  return findTarget(id);
}

const listDueTargets = (limit) =>
  db.all("SELECT * FROM post_targets WHERE status = 'scheduled' AND scheduled_at <= ? ORDER BY scheduled_at, id LIMIT ?", [
    time.now(),
    limit,
  ]);

// Targets stuck in "processing" (the server stopped mid-publish).
const listStaleTargets = (olderThan) =>
  db.all("SELECT * FROM post_targets WHERE status = 'processing' AND locked_at < ?", [time.toDb(olderThan)]);

async function cancelScheduledTargets(postId) {
  const { affectedRows } = await db.run(
    "UPDATE post_targets SET status = 'cancelled', error_message = 'Cancelled by user.', updated_at = ? WHERE post_id = ? AND status IN ('scheduled', 'pending')",
    [time.now(), postId]
  );
  return affectedRows;
}

async function rescheduleTargets(postId, schedules) {
  let changed = 0;
  for (const [platform, at] of Object.entries(schedules)) {
    const { affectedRows } = await db.run(
      "UPDATE post_targets SET scheduled_at = ?, updated_at = ? WHERE post_id = ? AND platform = ? AND status = 'scheduled'",
      [time.toDb(at), time.now(), postId, platform]
    );
    changed += affectedRows;
  }
  return changed;
}

// ── Attempts ──────────────────────────────────────────────────────────────────

async function recordAttempt(target, { attemptNo, trigger, success, platformPostId, message, durationMs }) {
  await db.run(
    "INSERT INTO publish_attempts (target_id, post_id, user_id, platform, attempt_no, trigger_type, status, platform_post_id, error_message, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      target.id,
      target.post_id,
      target.user_id,
      target.platform,
      attemptNo,
      trigger,
      success ? "success" : "failed",
      platformPostId || null,
      success ? null : message || null,
      durationMs || null,
      time.now(),
    ]
  );
}

async function listAttempts(postId) {
  const rows = await db.all("SELECT * FROM publish_attempts WHERE post_id = ? ORDER BY created_at DESC, id DESC", [postId]);
  return rows.map((a) => ({
    id: Number(a.id),
    targetId: Number(a.target_id),
    platform: a.platform,
    attemptNo: Number(a.attempt_no),
    trigger: a.trigger_type,
    status: a.status,
    platformPostId: a.platform_post_id || null,
    errorMessage: a.error_message || null,
    durationMs: a.duration_ms !== null ? Number(a.duration_ms) : null,
    createdAt: time.fromDb(a.created_at),
  }));
}

module.exports = {
  toPublic,
  create,
  update,
  findById,
  findForUser,
  remove,
  list,
  countByStatus,
  targetToPublic,
  createTargets,
  listTargets,
  findTarget,
  deleteTargets,
  listTargetsForPosts,
  claimTarget,
  completeTarget,
  listDueTargets,
  listStaleTargets,
  cancelScheduledTargets,
  rescheduleTargets,
  recordAttempt,
  listAttempts,
};
