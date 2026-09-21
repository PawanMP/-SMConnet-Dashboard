// AES-256-GCM encryption for social tokens and API keys stored in the database.
const crypto = require("crypto");

const PREFIX = "v1";

function parseKey(raw) {
  const value = String(raw || "").trim();
  let key = null;
  if (/^[0-9a-fA-F]{64}$/.test(value)) key = Buffer.from(value, "hex");
  else if (value) key = Buffer.from(value, "base64");
  if (!key || key.length !== 32) throw new Error("Encryption key must decode to exactly 32 bytes.");
  return key;
}

let cachedKey = null;
let cachedRaw = null;
function key() {
  const raw = require("../config").security.encryptionKey;
  if (raw !== cachedRaw) {
    cachedKey = parseKey(raw);
    cachedRaw = raw;
  }
  return cachedKey;
}

function encrypt(plain) {
  if (plain === null || plain === undefined || plain === "") return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString("base64"), tag.toString("base64"), data.toString("base64")].join(":");
}

function decrypt(payload) {
  if (!payload) return null;
  const parts = String(payload).split(":");
  if (parts.length !== 4 || parts[0] !== PREFIX) throw new Error("Unrecognised encrypted payload.");
  const [, iv, tag, data] = parts;
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

// Shows only enough of a secret for the owner to recognise it.
function mask(value) {
  if (!value) return "";
  const s = String(value);
  return s.length <= 8 ? "••••" : `${s.slice(0, 4)}••••${s.slice(-4)}`;
}

module.exports = { encrypt, decrypt, parseKey, randomToken, sha256, mask };
