// Error types shared by routes, services and the central error handler.

class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}

const badRequest = (message, details) => new AppError(400, "BAD_REQUEST", message, details);
const validationError = (message, details) => new AppError(422, "VALIDATION_ERROR", message, details);
const unauthorized = (message = "Please sign in to continue.") => new AppError(401, "UNAUTHORIZED", message);
const forbidden = (message = "You do not have permission to do that.") => new AppError(403, "FORBIDDEN", message);
const notFound = (message = "Not found.") => new AppError(404, "NOT_FOUND", message);
const conflict = (message, details) => new AppError(409, "CONFLICT", message, details);
const serviceUnavailable = (message) => new AppError(503, "SERVICE_UNAVAILABLE", message);

// Raised by social platform adapters. `auth` marks token problems (the user
// must reconnect); `retryable` marks transient failures worth retrying.
class PlatformError extends Error {
  constructor(platform, message, { code = "PLATFORM_ERROR", status, auth = false, retryable = false, raw } = {}) {
    super(message);
    this.name = "PlatformError";
    this.platform = platform;
    this.code = code;
    this.status = status;
    this.auth = auth;
    this.retryable = retryable;
    this.raw = raw;
  }
}

const PLATFORM_LABELS = { facebook: "Facebook", instagram: "Instagram", youtube: "YouTube", tiktok: "TikTok", pinterest: "Pinterest" };

// Turns any error thrown while talking to a platform (axios errors included)
// into a PlatformError with a message a user can act on.
function toPlatformError(platform, err) {
  if (err instanceof PlatformError) return err;
  const label = PLATFORM_LABELS[platform] || platform;
  const res = err && err.response;
  const status = res && res.status;
  const data = (res && res.data) || {};

  let message =
    (data.error && (data.error.error_user_msg || data.error.message)) ||
    data.error_description ||
    (typeof data.error === "string" ? data.error : "") ||
    data.message ||
    (data.error && data.error.code && data.error.code !== "ok" ? `${data.error.code}` : "") ||
    (err && err.message) ||
    "Unknown error";
  if (typeof message !== "string") message = JSON.stringify(message);

  const fbCode = data.error && data.error.code;
  const authByCode = fbCode === 190 || fbCode === 102 || fbCode === 463 || fbCode === 467;
  const authByText = /invalid_grant|invalid[_ ]token|expired|access_token_invalid|unauthori[sz]ed|revoked/i.test(message);
  const auth = status === 401 || authByCode || (status === 400 && authByText) || (status === 403 && authByText);

  const network = err && ["ECONNRESET", "ETIMEDOUT", "ECONNABORTED", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED"].includes(err.code);
  const retryable = !auth && (network || status === 429 || (status >= 500 && status < 600));

  return new PlatformError(platform, `${label}: ${message}`, {
    code: auth ? "TOKEN_INVALID" : status === 429 ? "RATE_LIMITED" : network ? "NETWORK_ERROR" : "PLATFORM_ERROR",
    status,
    auth,
    retryable,
    raw: typeof data === "object" ? data : undefined,
  });
}

module.exports = {
  AppError,
  PlatformError,
  PLATFORM_LABELS,
  badRequest,
  validationError,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  serviceUnavailable,
  toPlatformError,
};
