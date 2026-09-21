// Social media connections. Each user has at most one account per platform and
// every token is encrypted at rest.
const db = require("../db");
const time = require("../lib/time");
const { encrypt, decrypt } = require("../lib/crypto");

const findById = (id) => db.get("SELECT * FROM social_accounts WHERE id = ?", [id]);
const findByUserPlatform = (userId, platform) =>
  db.get("SELECT * FROM social_accounts WHERE user_id = ? AND platform = ?", [userId, platform]);
const listByUser = (userId) => db.all("SELECT * FROM social_accounts WHERE user_id = ? ORDER BY platform", [userId]);

function tokens(account) {
  return {
    accessToken: account.access_token_enc ? decrypt(account.access_token_enc) : null,
    refreshToken: account.refresh_token_enc ? decrypt(account.refresh_token_enc) : null,
  };
}

function metadata(account) {
  return db.json(account && account.metadata, {});
}

// Creates or replaces the connection for (user, platform) after OAuth or a
// manual token connect. `data` comes from a platform adapter.
async function upsertConnection(userId, platform, data) {
  const now = time.now();
  const values = {
    status: "connected",
    external_id: data.externalId || null,
    account_name: data.name || null,
    account_username: data.username || null,
    avatar_url: data.avatarUrl || null,
    access_token_enc: encrypt(data.accessToken),
    refresh_token_enc: encrypt(data.refreshToken),
    token_expires_at: time.toDb(data.expiresAt),
    refresh_expires_at: time.toDb(data.refreshExpiresAt),
    scopes: Array.isArray(data.scopes) ? data.scopes.join(",") : data.scopes || null,
    metadata: JSON.stringify(data.metadata || {}),
    last_error: null,
    last_checked_at: now,
    connected_at: now,
    updated_at: now,
  };
  const existing = await findByUserPlatform(userId, platform);
  const columns = Object.keys(values);
  if (existing) {
    await db.run(`UPDATE social_accounts SET ${columns.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`, [
      ...Object.values(values),
      existing.id,
    ]);
    return findById(existing.id);
  }
  const { insertId } = await db.run(
    `INSERT INTO social_accounts (user_id, platform, created_at, ${columns.join(", ")}) VALUES (?, ?, ?, ${columns.map(() => "?").join(", ")})`,
    [userId, platform, now, ...Object.values(values)]
  );
  return findById(insertId);
}

async function updateTokens(id, t) {
  const sets = ["status = 'connected'", "last_error = NULL", "last_checked_at = ?", "updated_at = ?"];
  const params = [time.now(), time.now()];
  if (t.accessToken) {
    sets.push("access_token_enc = ?");
    params.push(encrypt(t.accessToken));
  }
  if (t.refreshToken) {
    sets.push("refresh_token_enc = ?");
    params.push(encrypt(t.refreshToken));
  }
  if (t.expiresAt !== undefined) {
    sets.push("token_expires_at = ?");
    params.push(time.toDb(t.expiresAt));
  }
  if (t.refreshExpiresAt !== undefined) {
    sets.push("refresh_expires_at = ?");
    params.push(time.toDb(t.refreshExpiresAt));
  }
  params.push(id);
  await db.run(`UPDATE social_accounts SET ${sets.join(", ")} WHERE id = ?`, params);
  return findById(id);
}

async function updateProfile(id, profile) {
  await db.run(
    "UPDATE social_accounts SET account_name = COALESCE(?, account_name), account_username = COALESCE(?, account_username), avatar_url = COALESCE(?, avatar_url), external_id = COALESCE(?, external_id), status = 'connected', last_error = NULL, last_checked_at = ?, updated_at = ? WHERE id = ?",
    [profile.name || null, profile.username || null, profile.avatarUrl || null, profile.externalId || null, time.now(), time.now(), id]
  );
  return findById(id);
}

async function setStatus(id, status, lastError = null) {
  await db.run("UPDATE social_accounts SET status = ?, last_error = ?, last_checked_at = ?, updated_at = ? WHERE id = ?", [
    status,
    lastError,
    time.now(),
    time.now(),
    id,
  ]);
  return findById(id);
}

async function setMetadata(id, meta, extra = {}) {
  const sets = ["metadata = ?", "updated_at = ?"];
  const params = [JSON.stringify(meta || {}), time.now()];
  if (extra.externalId !== undefined) {
    sets.push("external_id = ?");
    params.push(extra.externalId);
  }
  if (extra.name !== undefined) {
    sets.push("account_name = ?");
    params.push(extra.name);
  }
  if (extra.avatarUrl !== undefined) {
    sets.push("avatar_url = ?");
    params.push(extra.avatarUrl);
  }
  if (extra.accessToken !== undefined) {
    sets.push("access_token_enc = ?");
    params.push(encrypt(extra.accessToken));
  }
  params.push(id);
  await db.run(`UPDATE social_accounts SET ${sets.join(", ")} WHERE id = ?`, params);
  return findById(id);
}

const remove = (id) => db.run("DELETE FROM social_accounts WHERE id = ?", [id]);

// Connected accounts whose access token expires before `before`.
const listExpiring = (before, limit = 50) =>
  db.all(
    "SELECT * FROM social_accounts WHERE status = 'connected' AND token_expires_at IS NOT NULL AND token_expires_at <= ? ORDER BY token_expires_at LIMIT ?",
    [time.toDb(before), limit]
  );

async function countConnected(userId) {
  const row = userId
    ? await db.get("SELECT COUNT(*) AS n FROM social_accounts WHERE user_id = ? AND status = 'connected'", [userId])
    : await db.get("SELECT COUNT(*) AS n FROM social_accounts WHERE status = 'connected'");
  return Number(row.n);
}

module.exports = {
  findById,
  findByUserPlatform,
  listByUser,
  tokens,
  metadata,
  upsertConnection,
  updateTokens,
  updateProfile,
  setStatus,
  setMetadata,
  remove,
  listExpiring,
  countConnected,
};
