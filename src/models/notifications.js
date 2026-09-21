const db = require("../db");
const time = require("../lib/time");

function toPublic(n) {
  return {
    id: Number(n.id),
    type: n.type,
    title: n.title,
    message: n.message || "",
    link: n.link || null,
    isRead: !!Number(n.is_read),
    createdAt: time.fromDb(n.created_at),
    readAt: time.fromDb(n.read_at),
  };
}

async function create(userId, { type, title, message, link }) {
  const { insertId } = await db.run(
    "INSERT INTO notifications (user_id, type, title, message, link, is_read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
    [userId, type, String(title).slice(0, 255), message || null, link || null, time.now()]
  );
  return insertId;
}

async function list(userId, { unreadOnly, page = 1, pageSize = 20 }) {
  const clause = unreadOnly ? "WHERE user_id = ? AND is_read = 0" : "WHERE user_id = ?";
  const total = Number((await db.get(`SELECT COUNT(*) AS n FROM notifications ${clause}`, [userId])).n);
  const rows = await db.all(`SELECT * FROM notifications ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, [
    userId,
    pageSize,
    (page - 1) * pageSize,
  ]);
  return { items: rows.map(toPublic), total, page, pageSize };
}

async function unreadCount(userId) {
  return Number((await db.get("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0", [userId])).n);
}

async function markRead(userId, id) {
  const { affectedRows } = await db.run("UPDATE notifications SET is_read = 1, read_at = ? WHERE id = ? AND user_id = ?", [
    time.now(),
    id,
    userId,
  ]);
  return affectedRows;
}

const markAllRead = (userId) =>
  db.run("UPDATE notifications SET is_read = 1, read_at = ? WHERE user_id = ? AND is_read = 0", [time.now(), userId]);

async function remove(userId, id) {
  const { affectedRows } = await db.run("DELETE FROM notifications WHERE id = ? AND user_id = ?", [id, userId]);
  return affectedRows;
}

// Avoids repeating the same unread warning (e.g. "reconnect Facebook") every scheduler run.
async function hasUnread(userId, type, title) {
  const row = await db.get("SELECT id FROM notifications WHERE user_id = ? AND type = ? AND title = ? AND is_read = 0 LIMIT 1", [
    userId,
    type,
    title,
  ]);
  return !!row;
}

module.exports = { create, list, unreadCount, markRead, markAllRead, remove, hasUnread };
