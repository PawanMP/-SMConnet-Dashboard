// Access-token lifecycle: expiry checks, automatic refresh where the platform
// supports it, and flagging accounts that need the user to reconnect.
const accounts = require("../models/accounts");
const platforms = require("./platforms");
const notifier = require("./notifier");
const activity = require("./activity");
const logger = require("../lib/logger");
const time = require("../lib/time");
const { PlatformError, PLATFORM_LABELS } = require("../lib/errors");
const { redact } = require("../lib/redact");

const DEFAULT_REFRESH_WINDOW_MS = 5 * 60 * 1000;

// Marks the account as needing reconnection and tells the user once.
async function markExpired(account, reason) {
  const wasConnected = account.status === "connected";
  const safeReason = redact(reason);
  await accounts.setStatus(account.id, "expired", safeReason);
  if (wasConnected) {
    await notifier.connectionProblem(account, safeReason);
    await activity.log(account.user_id, "account.token_expired", { entityType: "social_account", entityId: account.id, details: { platform: account.platform, reason: safeReason } });
  }
}

function authError(account, message) {
  return new PlatformError(account.platform, message || `${PLATFORM_LABELS[account.platform]} session expired. Reconnect the account on the Accounts page.`, {
    code: "TOKEN_EXPIRED",
    auth: true,
  });
}

// Returns usable tokens, refreshing them first when they are about to expire.
async function getValidTokens(account, { forceRefresh = false } = {}) {
  let current;
  try {
    current = accounts.tokens(account);
  } catch {
    await markExpired(account, "Stored credentials could not be decrypted. Reconnect the account.");
    throw authError(account, "Stored credentials could not be decrypted. Reconnect the account.");
  }
  if (!current.accessToken) throw authError(account);
  if (account.status === "expired" && !forceRefresh) throw authError(account);

  const adapter = platforms.get(account.platform);
  const expiresMs = time.toMs(account.token_expires_at);
  const windowMs = adapter.refreshWindowMs || DEFAULT_REFRESH_WINDOW_MS;
  const expired = expiresMs !== null && expiresMs <= Date.now();
  const expiringSoon = expiresMs !== null && expiresMs - Date.now() < windowMs;

  if (!(forceRefresh || expiringSoon)) return current;

  if (typeof adapter.refreshToken === "function") {
    try {
      const refreshed = await adapter.refreshToken(current, account);
      await accounts.updateTokens(account.id, refreshed);
      logger.info("Refreshed access token", { platform: account.platform, accountId: account.id });
      return { accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken || current.refreshToken };
    } catch (err) {
      logger.warn("Token refresh failed", { platform: account.platform, accountId: account.id, err: err.message });
      if (expired || (err instanceof PlatformError && err.auth)) {
        await markExpired(account, err.message);
        throw authError(account, err.message);
      }
      return current; // still valid for now; try again later
    }
  }

  if (expired) {
    await markExpired(account, "The access token has expired.");
    throw authError(account);
  }
  return current;
}

// Periodic job: refresh tokens that will expire soon and flag dead ones.
async function checkExpiringAccounts() {
  const horizon = new Date(Date.now() + 8 * 24 * 3600 * 1000);
  const list = await accounts.listExpiring(horizon, 100);
  let refreshed = 0;
  let expired = 0;
  for (const account of list) {
    try {
      const before = account.token_expires_at;
      await getValidTokens(account);
      const after = await accounts.findById(account.id);
      if (after && after.token_expires_at !== before) refreshed++;
    } catch {
      expired++;
    }
  }
  return { checked: list.length, refreshed, expired };
}

// Called when a platform rejects a token mid-request.
async function handleAuthFailure(account, err) {
  if (account && err && err.auth) await markExpired(account, err.message);
}

module.exports = { getValidTokens, checkExpiringAccounts, handleAuthFailure, markExpired };
