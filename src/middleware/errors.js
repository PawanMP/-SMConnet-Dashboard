// Central error handling. Every API error leaves as
// { success: false, error: { code, message, details?, requestId } }.
const multer = require("multer");
const config = require("../config");
const logger = require("../lib/logger");
const { AppError, PlatformError } = require("../lib/errors");

function apiNotFound(req, _res, next) {
  next(new AppError(404, "NOT_FOUND", `No API endpoint for ${req.method} ${req.originalUrl.split("?")[0]}.`));
}

function normalize(err) {
  if (err instanceof AppError) return err;
  if (err instanceof PlatformError) {
    return new AppError(err.auth ? 409 : 502, err.code, err.message);
  }
  if (err instanceof multer.MulterError) {
    const message =
      err.code === "LIMIT_FILE_SIZE"
        ? "File is too large."
        : err.code === "LIMIT_UNEXPECTED_FILE"
          ? "Unexpected upload field. Send the file as 'file'."
          : err.message;
    return new AppError(err.code === "LIMIT_FILE_SIZE" ? 413 : 400, "UPLOAD_ERROR", message);
  }
  if (err && err.type === "entity.parse.failed") return new AppError(400, "INVALID_JSON", "Request body is not valid JSON.");
  if (err && err.type === "entity.too.large") return new AppError(413, "PAYLOAD_TOO_LARGE", "Request body is too large.");
  return null;
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, _next) {
  const known = normalize(err);
  const status = known ? known.status : 500;

  if (status >= 500) {
    logger.error("Unhandled error", { requestId: req.id, method: req.method, path: req.path, err });
  } else {
    logger.debug("Request failed", { requestId: req.id, path: req.path, status, code: known.code });
  }

  const body = {
    success: false,
    error: {
      code: known ? known.code : "INTERNAL_ERROR",
      // Unknown errors may contain internals (SQL, file paths, stack traces),
      // so production responses only carry a generic message.
      message: known ? known.message : config.isProd ? "Something went wrong on our side. Please try again." : err.message,
      requestId: req.id,
    },
  };
  if (known && known.details) body.error.details = known.details;

  if (res.headersSent) return;
  res.status(status).json(body);
}

module.exports = { apiNotFound, errorHandler };
