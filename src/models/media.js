const db = require("../db");
const time = require("../lib/time");

function toPublic(m) {
  if (!m) return null;
  return {
    id: Number(m.id),
    url: m.url,
    thumbnailUrl: thumbnailUrl(m),
    resourceType: m.resource_type,
    mimeType: m.mime_type,
    format: m.format,
    sizeBytes: Number(m.size_bytes || 0),
    width: m.width !== null && m.width !== undefined ? Number(m.width) : null,
    height: m.height !== null && m.height !== undefined ? Number(m.height) : null,
    duration: m.duration !== null && m.duration !== undefined ? Number(m.duration) : null,
    originalName: m.original_name,
    provider: m.provider,
    createdAt: time.fromDb(m.created_at),
  };
}

// Cloudinary can render a still frame for videos; local videos have no thumbnail.
function thumbnailUrl(m) {
  if (m.provider === "cloudinary" && m.url.includes("/upload/")) {
    if (m.resource_type === "video") {
      return m.url.replace("/upload/", "/upload/so_1,w_480,c_limit/").replace(/\.[a-z0-9]+$/i, ".jpg");
    }
    return m.url.replace("/upload/", "/upload/w_480,c_limit/");
  }
  return m.resource_type === "image" ? m.url : null;
}

async function create(userId, m) {
  const { insertId } = await db.run(
    "INSERT INTO media (user_id, provider, storage_key, url, resource_type, mime_type, format, size_bytes, width, height, duration, original_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      userId,
      m.provider,
      m.storageKey,
      m.url,
      m.resourceType,
      m.mimeType || null,
      m.format || null,
      m.sizeBytes || 0,
      m.width || null,
      m.height || null,
      m.duration || null,
      m.originalName ? String(m.originalName).slice(0, 255) : null,
      time.now(),
    ]
  );
  return findById(insertId);
}

const findById = (id) => db.get("SELECT * FROM media WHERE id = ?", [id]);
const findForUser = (id, userId) => db.get("SELECT * FROM media WHERE id = ? AND user_id = ?", [id, userId]);

async function list(userId, { page = 1, pageSize = 24, type } = {}) {
  const params = [userId];
  let clause = "WHERE user_id = ?";
  if (type) {
    clause += " AND resource_type = ?";
    params.push(type);
  }
  const total = Number((await db.get(`SELECT COUNT(*) AS n FROM media ${clause}`, params)).n);
  const rows = await db.all(`SELECT * FROM media ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, [
    ...params,
    pageSize,
    (page - 1) * pageSize,
  ]);
  return { items: rows.map(toPublic), total, page, pageSize };
}

// Any post that references this media, including published history. Deleting
// the file would leave those posts without their media record.
async function activeReferences(mediaId) {
  const row = await db.get("SELECT COUNT(*) AS n FROM posts WHERE media_id = ?", [mediaId]);
  return Number(row.n);
}

// Media no post references, older than the cutoff: safe to delete.
const listUnused = (olderThan, limit = 100) =>
  db.all(
    "SELECT m.* FROM media m WHERE m.created_at < ? AND NOT EXISTS (SELECT 1 FROM posts p WHERE p.media_id = m.id) ORDER BY m.created_at LIMIT ?",
    [time.toDb(olderThan), limit]
  );

const remove = (id) => db.run("DELETE FROM media WHERE id = ?", [id]);

module.exports = { toPublic, create, findById, findForUser, list, activeReferences, listUnused, remove };
