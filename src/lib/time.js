// Timestamps are stored as UTC "YYYY-MM-DD HH:MM:SS" strings, a format both
// MySQL DATETIME and SQLite TEXT columns compare correctly. The API exposes ISO.

const DB_FORMAT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function toDb(value) {
  if (value === null || value === undefined || value === "") return null;
  // Values read back from the database are already UTC; parsing them with
  // new Date() would treat them as local time and shift them.
  if (typeof value === "string" && DB_FORMAT.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function now() {
  return toDb(new Date());
}

function fromDb(value) {
  if (!value) return null;
  const s = String(value);
  const date = /[zZ]$|[+-]\d\d:?\d\d$/.test(s) ? new Date(s) : new Date(s.replace(" ", "T") + "Z");
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toMs(value) {
  const iso = fromDb(value);
  return iso ? Date.parse(iso) : null;
}

function addMinutes(date, minutes) {
  return new Date((date instanceof Date ? date : new Date(date)).getTime() + minutes * 60000);
}

module.exports = { toDb, now, fromDb, toMs, addMinutes };
