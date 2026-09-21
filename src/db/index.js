// Database facade. Call `ready()` before the first query; it connects,
// migrates and seeds exactly once per process (important on serverless cold starts).
const config = require("../config");
const logger = require("../lib/logger");
const { migrate } = require("./migrations");

let driver = null;
let readyPromise = null;

function createDriver() {
  if (config.db.client === "mysql") {
    return require("./drivers/mysql").createMysqlDriver(config.db);
  }
  return require("./drivers/sqlite").createSqliteDriver(config.db);
}

function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      driver = createDriver();
      await migrate(driver, logger);
      await require("./seed").seed();
      logger.info(`Database ready (${driver.dialect})`);
      return driver;
    })().catch((err) => {
      readyPromise = null;
      throw err;
    });
  }
  return readyPromise;
}

function current() {
  if (!driver) throw new Error("Database used before ready() resolved.");
  return driver;
}

async function close() {
  if (driver) await driver.close();
  driver = null;
  readyPromise = null;
}

// Parses a JSON column that may be NULL or malformed.
function json(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

module.exports = {
  ready,
  close,
  json,
  get dialect() {
    return current().dialect;
  },
  all: (sql, params) => current().all(sql, params),
  get: (sql, params) => current().get(sql, params),
  run: (sql, params) => current().run(sql, params),
  exec: (sql) => current().exec(sql),
  transaction: (fn) => current().transaction(fn),
  ping: () => current().ping(),
};
