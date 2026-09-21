const db = require("../db");
const time = require("../lib/time");

function toPublic(a) {
  return {
    id: Number(a.id),
    userId: a.user_id !== null ? Number(a.user_id) : null,
    userEmail: a.user_email || undefined,
    action: a.action,
    entityType: a.entity_type || null,
    entityId: a.entity_id || null,
    details: db.json(a.details, {}),
    ip: a.ip || null,
    createdAt: time.fromDb(a.created_at),
  };
}

async function create({ userId, action, entityType, entityId, details, ip, userAgent }) {
  await db.run(
    "INSERT INTO activity_logs (user_id, action, entity_type, entity_id, details, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [
      userId || null,
      action,
      entityType || null,
      entityId !== undefined && entityId !== null ? String(entityId) : null,
      details ? JSON.stringify(details) : null,
      ip ? String(ip).slice(0, 64) : null,
      userAgent ? String(userAgent).slice(0, 255) : null,
      time.now(),
    ]
  );
}

async function list({ userId, action, dateFrom, dateTo, page = 1, pageSize = 30 }) {
  const where = [];
  const params = [];
  if (userId) {
    where.push("a.user_id = ?");
    params.push(userId);
  }
  if (action) {
    // "post" matches post.create, post.publish, ...
    where.push("(a.action = ? OR a.action LIKE ?)");
    params.push(action, `${action}.%`);
  }
  if (dateFrom) {
    where.push("a.created_at >= ?");
    params.push(time.toDb(dateFrom));
  }
  if (dateTo) {
    where.push("a.created_at <= ?");
    params.push(time.toDb(dateTo));
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = Number((await db.get(`SELECT COUNT(*) AS n FROM activity_logs a ${clause}`, params)).n);
  const rows = await db.all(
    `SELECT a.*, u.email AS user_email FROM activity_logs a LEFT JOIN users u ON u.id = a.user_id ${clause} ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize]
  );
  return { items: rows.map(toPublic), total, page, pageSize };
}

module.exports = { create, list };
