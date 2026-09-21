// OAuth 2.0 authorization-code flow shared by every platform.
const oauthStates = require("../models/oauthStates");
const platforms = require("./platforms");
const accounts = require("./accounts");
const { randomToken } = require("../lib/crypto");
const { AppError, badRequest } = require("../lib/errors");

async function start(user, platform) {
  const adapter = platforms.get(platform);
  if (!adapter.isConfigured()) {
    throw new AppError(
      503,
      "OAUTH_NOT_CONFIGURED",
      `${adapter.label} sign-in is not set up on this server yet. An administrator must add the ${adapter.label} app credentials to the environment.`
    );
  }
  const state = randomToken(32);
  await oauthStates.create({ state, userId: user.id, platform });
  await oauthStates.purgeExpired().catch(() => {});
  return { url: adapter.getAuthUrl({ state }) };
}

// Validates the callback and stores the connection. The state must have been
// issued to the same signed-in user for the same platform, and only once.
async function complete(req, platform, { code, state, error, error_description: errorDescription }) {
  const adapter = platforms.get(platform);
  if (error) {
    throw badRequest(error === "access_denied" ? `${adapter.label} access was not granted.` : `${adapter.label}: ${errorDescription || error}`);
  }
  if (!code || !state) throw badRequest("The authorization response is missing required parameters.");
  const saved = await oauthStates.consume(state);
  if (!saved || saved.platform !== platform || Number(saved.user_id) !== req.user.id) {
    throw badRequest("This sign-in link has expired or was not started from your account. Please try connecting again.");
  }
  const data = await adapter.exchangeCode({ code, codeVerifier: saved.code_verifier });
  return accounts.saveConnection(req, platform, data, "oauth");
}

module.exports = { start, complete };
