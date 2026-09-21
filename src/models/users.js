const db = require("../db");
const time = require("../lib/time");

function toPublic(u) {
  if (!u) return null;
  return {
    id: Number(u.id),
    email: u.email,
    name: u.name,
    role: u.role,
    isActive: !!Number(u.is_active),
    timezone: u.timezone || null,
    lastLoginAt: time.fromDb(u.last_login_at),
    createdAt: time.fromDb(u.created_at),
  };
}

const findById = (id) => db.get("SELECT * FROM users WHERE id = ?", [id]);
const findByEmail = (email) => db.get("SELECT * FROM users WHERE email = ?", [String(email).toLowerCase()]);

async function create({ email, name, passwordHash, role = "user" }) {
  const now = time.now();
  const { insertId } = await db.run(
    "INSERT INTO users (email, name, password_hash, role, is_active, token_version, created_at, updated_at) VALUES (?, ?, ?, ?, 1, 0, ?, ?)",
    [String(email).toLowerCase(), name, passwordHash, role, now, now]
  );
  return findById(insertId);
}

const UPDATABLE = { name: "name", email: "email", role: "role", isActive: "is_active", timezone: "timezone", passwordHash: "password_hash" };

async function update(id, fields) {
  const sets = [];
  const params = [];
  for (const [key, column] of Object.entries(UPDATABLE)) {
    if (fields[key] !== undefined) {
      sets.push(`${column} = ?`);
      params.push(key === "email" ? String(fields[key]).toLowerCase() : fields[key]);
    }
  }
  if (!sets.length) return findById(id);
  sets.push("updated_at = ?");
  params.push(time.now(), id);
  await db.run(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, params);
  return findById(id);
}

// Invalidates every session issued before now (logout everywhere, password change).
async function bumpTokenVersion(id) {
  await db.run("UPDATE users SET token_version = token_version + 1, updated_at = ? WHERE id = ?", [time.now(), id]);
  return findById(id);
}

const touchLogin = (id) => db.run("UPDATE users SET last_login_at = ? WHERE id = ?", [time.now(), id]);

async function count() {
  const row = await db.get("SELECT COUNT(*) AS n FROM users");
  return Number(row.n);
}

async function countActiveAdmins() {
  const row = await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1");
  return Number(row.n);
}

async function list({ q, role, page = 1, pageSize = 20 }) {
  const where = [];
  const params = [];
  if (q) {
    where.push("(email LIKE ? ESCAPE '!' OR name LIKE ? ESCAPE '!')");
    const like = `%${String(q).replace(/[!%_]/g, "!$&")}%`;
    params.push(like, like);
  }
  if (role) {
    where.push("role = ?");
    params.push(role);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = Number((await db.get(`SELECT COUNT(*) AS n FROM users ${clause}`, params)).n);
  const rows = await db.all(`SELECT * FROM users ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`, [
    ...params,
    pageSize,
    (page - 1) * pageSize,
  ]);
  return { items: rows.map(toPublic), total, page, pageSize };
}

const remove = (id) => db.run("DELETE FROM users WHERE id = ?", [id]);

module.exports = { toPublic, findById, findByEmail, create, update, bumpTokenVersion, touchLogin, count, countActiveAdmins, list, remove };
