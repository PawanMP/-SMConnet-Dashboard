// MySQL driver (mysql2 connection pool) used in production.
const mysql = require("mysql2/promise");

function createMysqlDriver(cfg) {
  const base = {
    dateStrings: true,
    timezone: "Z",
    charset: "utf8mb4",
    decimalNumbers: true,
    supportBigNumbers: true,
    bigNumberStrings: false,
    connectionLimit: cfg.connectionLimit,
    waitForConnections: true,
    enableKeepAlive: true,
    multipleStatements: false,
  };
  if (cfg.ssl) base.ssl = { rejectUnauthorized: cfg.sslRejectUnauthorized, minVersion: "TLSv1.2" };

  const pool = cfg.url
    ? mysql.createPool({ uri: cfg.url, ...base })
    : mysql.createPool({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.database, ...base });

  // `query` (client-side escaping) is used instead of `execute` because
  // prepared statements reject numeric LIMIT/OFFSET placeholders.
  function wrap(conn) {
    return {
      dialect: "mysql",
      async all(sql, params = []) {
        const [rows] = await conn.query(sql, params);
        return rows;
      },
      async get(sql, params = []) {
        const [rows] = await conn.query(sql, params);
        return rows[0] || null;
      },
      async run(sql, params = []) {
        const [res] = await conn.query(sql, params);
        return { insertId: Number(res.insertId), affectedRows: Number(res.affectedRows) };
      },
      async exec(sql) {
        await conn.query(sql);
      },
    };
  }

  const api = wrap(pool);
  api.transaction = async (fn) => {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(wrap(conn));
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback().catch(() => {});
      throw err;
    } finally {
      conn.release();
    }
  };
  api.ping = async () => {
    await pool.query("SELECT 1");
  };
  api.close = () => pool.end();
  return api;
}

module.exports = { createMysqlDriver };
