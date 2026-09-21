// Assigns a request id and logs each API request with its duration.
const crypto = require("crypto");
const logger = require("../lib/logger");

function requestContext(req, res, next) {
  req.id = crypto.randomUUID();
  res.setHeader("X-Request-Id", req.id);
  const started = process.hrtime.bigint();
  res.on("finish", () => {
    if (!req.originalUrl.startsWith("/api")) return;
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const meta = { requestId: req.id, status: res.statusCode, ms: Math.round(ms), userId: req.user && req.user.id };
    const line = `${req.method} ${req.originalUrl.split("?")[0]}`;
    if (res.statusCode >= 500) logger.error(line, meta);
    else if (res.statusCode >= 400) logger.info(line, meta);
    else logger.debug(line, meta);
  });
  next();
}

// Wraps async route handlers so rejected promises reach the error handler.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { requestContext, asyncHandler };
