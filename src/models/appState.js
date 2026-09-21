// Tiny key/value table for process-independent bookkeeping (e.g. when the
// last maintenance job ran), shared by every server instance.
const db = require("../db");
const time = require("../lib/time");

async function get(name) {
  const row = await db.get("SELECT value FROM app_state WHERE name = ?", [name]);
  return row ? row.value : null;
}

async function set(name, value) {
  const { affectedRows } = await db.run("UPDATE app_state SET value = ?, updated_at = ? WHERE name = ?", [value, time.now(), name]);
  if (!affectedRows) {
    await db.run("INSERT INTO app_state (name, value, updated_at) VALUES (?, ?, ?)", [name, value, time.now()]);
  }
}

// Returns true (and records the run) when `name` has not run in `minutes`.
async function due(name, minutes) {
  const last = await get(name);
  if (last && Date.now() - Date.parse(last) < minutes * 60000) return false;
  await set(name, new Date().toISOString());
  return true;
}

module.exports = { get, set, due };
