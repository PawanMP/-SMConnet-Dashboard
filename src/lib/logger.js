// Minimal structured logger: JSON lines in production, readable lines locally.
const config = require("../config");

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function threshold() {
  return LEVELS[config.logLevel] ?? LEVELS.info;
}

// Never let credentials reach the logs, even when a caller passes a raw object.
const SENSITIVE = /token|secret|password|authorization|api[_-]?key|cookie/i;

function scrub(value, depth = 0) {
  if (value === null || typeof value !== "object" || depth > 4) return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, code: value.code, stack: config.isProd ? undefined : value.stack };
  }
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE.test(k) ? "[redacted]" : scrub(v, depth + 1);
  }
  return out;
}

function write(level, message, meta) {
  if (LEVELS[level] < threshold()) return;
  const time = new Date().toISOString();
  const clean = meta ? scrub(meta) : undefined;
  const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
  if (config.isProd) {
    stream.write(JSON.stringify({ time, level, message, ...(clean || {}) }) + "\n");
  } else {
    const extra = clean && Object.keys(clean).length ? " " + JSON.stringify(clean) : "";
    stream.write(`${time} ${level.toUpperCase().padEnd(5)} ${message}${extra}\n`);
  }
}

module.exports = {
  debug: (msg, meta) => write("debug", msg, meta),
  info: (msg, meta) => write("info", msg, meta),
  warn: (msg, meta) => write("warn", msg, meta),
  error: (msg, meta) => write("error", msg, meta),
  scrub,
};
