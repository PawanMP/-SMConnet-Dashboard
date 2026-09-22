// Per-user social account connections: status views, manual token connects,
// connection tests, Page/Board selection and disconnecting.
const accountsModel = require("../models/accounts");
const platforms = require("./platforms");
const tokens = require("./tokens");
const activity = require("./activity");
const logger = require("../lib/logger");
const time = require("../lib/time");
const { notFound, badRequest, PlatformError } = require("../lib/errors");
const { redact } = require("../lib/redact");

function statusOf(account, adapter) {
  if (!account) return "not_connected";
  if (account.status !== "connected") return account.status;
  const expiresMs = time.toMs(account.token_expires_at);
  const canRefresh = typeof adapter.refreshToken === "function" && !!account.refresh_token_enc;
  // Instagram Login tokens refresh with the access token itself.
  const canSelfRefresh = typeof adapter.canRefresh === "function" && adapter.canRefresh(account, accountsModel.metadata(account));
  if (expiresMs !== null && expiresMs <= Date.now() && !canRefresh && !canSelfRefresh) return "expired";
  return "connected";
}

function view(platform, account) {
  const adapter = platforms.get(platform);
  const meta = account ? accountsModel.metadata(account) : {};
  let resource = null;
  if (account && platform === "facebook") resource = { id: meta.selectedPageId || account.external_id, name: account.account_name, count: (meta.pages || []).length };
  if (account && platform === "pinterest") resource = { id: meta.selectedBoardId || null, name: meta.selectedBoardName || null, count: (meta.boards || []).length };
  return {
    platform,
    label: adapter.label,
    oauthConfigured: adapter.isConfigured(),
    capabilities: adapter.capabilities,
    resourceLabel: adapter.resourceLabel || null,
    status: statusOf(account, adapter),
    accountName: account ? account.account_name : null,
    username: account ? account.account_username : null,
    avatarUrl: account ? account.avatar_url : null,
    externalId: account ? account.external_id : null,
    tokenExpiresAt: account ? time.fromDb(account.token_expires_at) : null,
    autoRefresh: account
      ? typeof adapter.refreshToken === "function" && (typeof adapter.canRefresh === "function" ? adapter.canRefresh(account, meta) : !!account.refresh_token_enc)
      : false,
    connectedAt: account ? time.fromDb(account.connected_at) : null,
    lastCheckedAt: account ? time.fromDb(account.last_checked_at) : null,
    lastError: account && account.status !== "connected" ? account.last_error : null,
    resource,
  };
}

async function listForUser(userId) {
  const rows = await accountsModel.listByUser(userId);
  const byPlatform = Object.fromEntries(rows.map((r) => [r.platform, r]));
  return platforms.PLATFORMS.map((p) => view(p, byPlatform[p]));
}

async function requireAccount(userId, platform) {
  const account = await accountsModel.findByUserPlatform(userId, platform);
  if (!account) throw notFound(`${platforms.get(platform).label} is not connected.`);
  return account;
}

async function saveConnection(req, platform, data, method) {
  const account = await accountsModel.upsertConnection(req.user.id, platform, data);
  await activity.log(req, "account.connect", {
    entityType: "social_account",
    entityId: account.id,
    details: { platform, method, account: data.name || data.username || data.externalId },
  });
  return view(platform, account);
}

async function connectWithToken(req, platform, input) {
  const adapter = platforms.get(platform);
  if (typeof adapter.connectWithToken !== "function") throw badRequest(`${adapter.label} does not support token connections.`);
  const data = await adapter.connectWithToken(input);
  return saveConnection(req, platform, data, "token");
}

// Verifies the stored credentials against the platform and refreshes profile data.
async function test(req, platform) {
  const account = await requireAccount(req.user.id, platform);
  const adapter = platforms.get(platform);
  try {
    const t = await tokens.getValidTokens(account, { forceRefresh: account.status === "expired" && typeof adapter.refreshToken === "function" });
    const profile = await adapter.fetchProfile(t, account);
    const updated = await accountsModel.updateProfile(account.id, profile);
    await activity.log(req, "account.test", { entityType: "social_account", entityId: account.id, details: { platform, ok: true } });
    return { ok: true, account: view(platform, updated), profile };
  } catch (err) {
    if (err instanceof PlatformError && err.auth) await tokens.markExpired(await accountsModel.findById(account.id), err.message);
    await activity.log(req, "account.test", { entityType: "social_account", entityId: account.id, details: { platform, ok: false, error: redact(err.message) } });
    if (!(err instanceof PlatformError)) throw err;
    return { ok: false, error: redact(err.message), account: view(platform, await accountsModel.findById(account.id)) };
  }
}

async function disconnect(req, platform) {
  const account = await requireAccount(req.user.id, platform);
  const adapter = platforms.get(platform);
  if (typeof adapter.revoke === "function") {
    try {
      await adapter.revoke(accountsModel.tokens(account));
    } catch (err) {
      // Revocation is best effort; the stored tokens are deleted regardless.
      logger.warn("Token revocation failed", { platform, err: err.message });
    }
  }
  await accountsModel.remove(account.id);
  await activity.log(req, "account.disconnect", { entityType: "social_account", entityId: account.id, details: { platform, account: account.account_name } });
  return view(platform, null);
}

async function listResources(req, platform) {
  const adapter = platforms.get(platform);
  if (typeof adapter.listResources !== "function") throw badRequest(`${adapter.label} has no selectable ${adapter.resourceLabel || "resources"}.`);
  const account = await requireAccount(req.user.id, platform);
  const t = await tokens.getValidTokens(account);
  return adapter.listResources(t, account, accountsModel.metadata(account));
}

async function selectResource(req, platform, resourceId) {
  const adapter = platforms.get(platform);
  if (typeof adapter.selectResource !== "function") throw badRequest(`${adapter.label} has no selectable ${adapter.resourceLabel || "resources"}.`);
  const account = await requireAccount(req.user.id, platform);
  const t = await tokens.getValidTokens(account);
  const change = await adapter.selectResource(t, account, accountsModel.metadata(account), resourceId);
  const updated = await accountsModel.setMetadata(account.id, change.metadata, {
    externalId: change.externalId,
    name: change.name,
    avatarUrl: change.avatarUrl,
    accessToken: change.accessToken,
  });
  await activity.log(req, "account.select_resource", { entityType: "social_account", entityId: account.id, details: { platform, resourceId } });
  return view(platform, updated);
}

module.exports = { view, listForUser, connectWithToken, saveConnection, test, disconnect, listResources, selectResource };
