// SQLite driver (Node's built-in node:sqlite) used for local development and
// tests, so the app runs without a MySQL server.
const fs = require("fs");
const path = require("path");

// node:sqlite still emits an ExperimentalWarning on load; it is expected here.
const originalEmitWarning = process.emitWarning;
process.emitWarning = function emitWarning(warning, ...args) {
  const text = typeof warning === "string" ? warning : warning && warning.message;
  if (text && text.includes("SQLite is an experimental feature")) return;
  return originalEmitWarning.call(process, warning, ...args);
};
// Required indirectly (not as a string literal) so build-time bundlers/tracers
// don't try to statically resolve this Node builtin, which some serverless
// build environments fail on even though it resolves fine at runtime.
const { DatabaseSync } = require("node" + ":sqlite");
process.emitWarning = originalEmitWarning;

function normalize(params = []) {
  return params.map((v) => {
    if (v === undefined) return null;
    if (typeof v === "boolean") return v ? 1 : 0;
    if (v instanceof Date) return v.toISOString().slice(0, 19).replace("T", " ");
    return v;
  });
}

function createSqliteDriver({ sqliteFile }) {
  if (sqliteFile !== ":memory:") fs.mkdirSync(path.dirname(sqliteFile), { recursive: true });
  const db = new DatabaseSync(sqliteFile);
  db.exec("PRAGMA foreign_keys = ON;");
  if (sqliteFile !== ":memory:") {
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA busy_timeout = 5000;");
  }

  // One connection is shared, so transactions are serialised with a queue.
  let queue = Promise.resolve();

  const api = {
    dialect: "sqlite",
    async all(sql, params) {
      return db.prepare(sql).all(...normalize(params));
    },
    async get(sql, params) {
      return db.prepare(sql).get(...normalize(params)) || null;
    },
    async run(sql, params) {
      const r = db.prepare(sql).run(...normalize(params));
      return { insertId: Number(r.lastInsertRowid), affectedRows: Number(r.changes) };
    },
    async exec(sql) {
      db.exec(sql);
    },
    transaction(fn) {
      const task = queue.then(async () => {
        db.exec("BEGIN");
        try {
          const result = await fn(api);
          db.exec("COMMIT");
          return result;
        } catch (err) {
          db.exec("ROLLBACK");
          throw err;
        }
      });
      queue = task.catch(() => {});
      return task;
    },
    async ping() {
      db.prepare("SELECT 1").get();
    },
    async close() {
      db.close();
    },
  };
  return api;
}

module.exports = { createSqliteDriver };
