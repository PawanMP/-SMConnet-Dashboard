// Short-lived, single-use OAuth `state` values bound to the user who started
// the flow. Stored in the database so they survive serverless instance hops.
const db = require("../db");
const time = require("../lib/time");

const TTL_MINUTES = 10;

async function create({ state, userId, platform, codeVerifier }) {
  await db.run("INSERT INTO oauth_states (state, user_id, platform, code_verifier, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)", [
    state,
    userId,
    platform,
    codeVerifier || null,
    time.now(),
    time.toDb(time.addMinutes(new Date(), TTL_MINUTES)),
  ]);
}

// Returns the state row and deletes it; expired or unknown states return null.
async function consume(state) {
  if (!state) return null;
  const row = await db.get("SELECT * FROM oauth_states WHERE state = ?", [state]);
  if (!row) return null;
  // Only the request that actually deletes the row may use it.
  const { affectedRows } = await db.run("DELETE FROM oauth_states WHERE state = ?", [state]);
  if (affectedRows !== 1) return null;
  if (time.toMs(row.expires_at) < Date.now()) return null;
  return row;
}

const purgeExpired = () => db.run("DELETE FROM oauth_states WHERE expires_at < ?", [time.now()]);

module.exports = { create, consume, purgeExpired, TTL_MINUTES };
