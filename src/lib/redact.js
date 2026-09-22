// Strips anything token-shaped out of text before it is stored or logged.
// Platform error messages occasionally echo back credentials, and those
// messages end up in post_targets, publish_attempts and the activity log.

const PATTERNS = [
  // Known credential prefixes: Meta, Instagram, Google, Gemini, OpenAI, TikTok.
  /\b(?:EAA|IGQ|IGAA|ya29\.|AIza|sk-|rt-|act\.)[A-Za-z0-9._-]{8,}/g,
  // token=..., access_token=..., "refresh_token": "..."
  /((?:access|refresh|client|id)?[_-]?(?:token|secret|key)["']?\s*[:=]\s*["']?)[A-Za-z0-9._-]{8,}/gi,
  // Bearer <token>
  /(Bearer\s+)[A-Za-z0-9._-]{8,}/gi,
  // Any remaining unbroken 40+ character credential-looking run.
  /\b[A-Za-z0-9._-]{40,}\b/g,
];

function redact(text) {
  if (text === null || text === undefined) return text;
  let out = String(text);
  for (const pattern of PATTERNS) {
    // Patterns without a capture group get the match offset as the second
    // argument, so only keep it when it is really the captured prefix.
    out = out.replace(pattern, (match, prefix) => (typeof prefix === "string" ? `${prefix}[redacted]` : "[redacted]"));
  }
  return out;
}

module.exports = { redact };
