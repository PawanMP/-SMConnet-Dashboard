// Per-user preferences (AI provider/model/key, tone, notification choices).
const db = require("../db");
const time = require("../lib/time");
const { encrypt, decrypt, mask } = require("../lib/crypto");

const DEFAULTS = {
  ai_provider: null,
  ai_model: null,
  ai_api_key_enc: null,
  default_tone: "friendly",
  allow_emojis: 0,
  notify_on_success: 1,
  notify_on_failure: 1,
};

async function getRaw(userId) {
  const row = await db.get("SELECT * FROM user_settings WHERE user_id = ?", [userId]);
  return { ...DEFAULTS, ...(row || {}), user_id: userId };
}

// The stored API key never leaves the server; clients only see a masked hint.
function toPublic(row) {
  let keyHint = "";
  if (row.ai_api_key_enc) {
    try {
      keyHint = mask(decrypt(row.ai_api_key_enc));
    } catch {
      keyHint = "(unreadable - please re-enter)";
    }
  }
  return {
    aiProvider: row.ai_provider,
    aiModel: row.ai_model,
    hasPersonalApiKey: !!row.ai_api_key_enc,
    apiKeyHint: keyHint,
    defaultTone: row.default_tone || "friendly",
    allowEmojis: !!Number(row.allow_emojis),
    notifyOnSuccess: !!Number(row.notify_on_success),
    notifyOnFailure: !!Number(row.notify_on_failure),
  };
}

async function get(userId) {
  return toPublic(await getRaw(userId));
}

async function update(userId, fields) {
  const current = await getRaw(userId);
  const next = { ...current };
  if (fields.aiProvider !== undefined) next.ai_provider = fields.aiProvider || null;
  if (fields.aiModel !== undefined) next.ai_model = fields.aiModel || null;
  if (fields.apiKey !== undefined) next.ai_api_key_enc = fields.apiKey ? encrypt(fields.apiKey) : null;
  if (fields.defaultTone !== undefined) next.default_tone = fields.defaultTone;
  if (fields.allowEmojis !== undefined) next.allow_emojis = fields.allowEmojis ? 1 : 0;
  if (fields.notifyOnSuccess !== undefined) next.notify_on_success = fields.notifyOnSuccess ? 1 : 0;
  if (fields.notifyOnFailure !== undefined) next.notify_on_failure = fields.notifyOnFailure ? 1 : 0;

  const values = [
    next.ai_provider,
    next.ai_model,
    next.ai_api_key_enc,
    next.default_tone,
    next.allow_emojis,
    next.notify_on_success,
    next.notify_on_failure,
    time.now(),
    userId,
  ];
  const exists = await db.get("SELECT user_id FROM user_settings WHERE user_id = ?", [userId]);
  if (exists) {
    await db.run(
      "UPDATE user_settings SET ai_provider = ?, ai_model = ?, ai_api_key_enc = ?, default_tone = ?, allow_emojis = ?, notify_on_success = ?, notify_on_failure = ?, updated_at = ? WHERE user_id = ?",
      values
    );
  } else {
    await db.run(
      "INSERT INTO user_settings (ai_provider, ai_model, ai_api_key_enc, default_tone, allow_emojis, notify_on_success, notify_on_failure, updated_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      values
    );
  }
  return get(userId);
}

module.exports = { get, getRaw, update, toPublic };
