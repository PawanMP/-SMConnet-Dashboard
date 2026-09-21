// Helpers shared by the platform adapters.
const config = require("../../config");

function redirectUri(platform) {
  return `${config.appUrl}/api/oauth/${platform}/callback`;
}

// Platforms fetch media themselves, so the URL must be reachable from the internet.
function isPublicUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    const host = u.hostname;
    return !(
      host === "localhost" ||
      host.endsWith(".local") ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host === "[::1]"
    );
  } catch {
    return false;
  }
}

function joinText(text, hashtags, separator = "\n\n") {
  const a = String(text || "").trim();
  const b = String(hashtags || "").trim();
  if (a && b) return `${a}${separator}${b}`;
  return a || b;
}

// "travel, #food  summer" -> "#travel #food #summer" (deduplicated).
function normalizeHashtags(value) {
  const seen = new Set();
  const tags = [];
  for (const raw of String(value || "").split(/[\s,]+/)) {
    const word = raw.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
    if (!word || seen.has(word.toLowerCase())) continue;
    seen.add(word.toLowerCase());
    tags.push(`#${word}`);
  }
  return tags.join(" ");
}

function tagList(value) {
  return normalizeHashtags(value)
    .split(" ")
    .filter(Boolean)
    .map((t) => t.slice(1));
}

function firstLine(text, max = 100) {
  const line = String(text || "").split(/\r?\n/).find((l) => l.trim()) || "";
  return line.trim().slice(0, max);
}

function expiresAt(seconds) {
  const s = Number(seconds);
  return Number.isFinite(s) && s > 0 ? new Date(Date.now() + s * 1000) : null;
}

// Indirection so tests can skip real waiting while polling platform status.
const timing = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

// Polls `check` until it returns a non-undefined value or the budget runs out.
// Counting attempts (not wall time) keeps tests with a stubbed sleep finite.
async function poll(check, { intervalMs = 3000, timeoutMs = 60000 } = {}) {
  const attempts = Math.max(1, Math.ceil(timeoutMs / intervalMs));
  for (let i = 0; i < attempts; i++) {
    const result = await check();
    if (result !== undefined) return result;
    if (i < attempts - 1) await timing.sleep(intervalMs);
  }
  return undefined;
}

function qs(params) {
  return new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null)).toString();
}

module.exports = { redirectUri, isPublicUrl, joinText, normalizeHashtags, tagList, firstLine, expiresAt, timing, poll, qs };
