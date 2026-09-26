// YouTube via Google OAuth 2.0 and the YouTube Data API v3 (resumable uploads).
const config = require("../../config");
const http = require("../../lib/http");
const logger = require("../../lib/logger");
const { PlatformError, toPlatformError } = require("../../lib/errors");
const mediaService = require("../media");
const { redirectUri, expiresAt, qs } = require("./common");

const cfg = () => config.platforms.youtube;
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/youtube/v3";
const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];

async function call(fn) {
  try {
    return await fn();
  } catch (err) {
    throw toPlatformError("youtube", err);
  }
}

async function channel(accessToken) {
  const { data } = await call(() =>
    http.get(`${API}/channels`, { params: { part: "snippet,statistics", mine: true }, headers: { Authorization: `Bearer ${accessToken}` } })
  );
  const item = (data.items || [])[0];
  if (!item) throw new PlatformError("youtube", "YouTube: this Google account has no YouTube channel.", { code: "NO_CHANNEL" });
  const thumbs = item.snippet.thumbnails || {};
  return {
    externalId: item.id,
    name: item.snippet.title,
    username: item.snippet.customUrl || null,
    avatarUrl: (thumbs.default || thumbs.medium || {}).url || null,
    subscribers: item.statistics ? Number(item.statistics.subscriberCount) : null,
  };
}

// YouTube rejects "<" and ">" in titles and limits titles to 100 characters.
function cleanTitle(title) {
  return String(title || "").replace(/[<>]/g, "").trim().slice(0, 100);
}

function tagsWithinLimit(tags) {
  const out = [];
  let total = 0;
  for (const t of tags) {
    const cost = t.length + (t.includes(" ") ? 2 : 0) + (out.length ? 1 : 0);
    if (total + cost > 480) break;
    out.push(t);
    total += cost;
  }
  return out;
}

// Sets a custom thumbnail. Requires the channel to be phone-verified, so a
// failure here is logged and swallowed rather than failing the whole publish.
async function setThumbnail(accessToken, videoId, thumbnail) {
  try {
    const buffer = await mediaService.readBuffer(thumbnail);
    await call(() =>
      http.post(`https://www.googleapis.com/upload/youtube/v3/thumbnails/set?${qs({ videoId })}`, buffer, {
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": thumbnail.mime_type || "image/jpeg" },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 60000,
      })
    );
  } catch (err) {
    logger.warn("Failed to set YouTube thumbnail", { videoId, err: err.message || err });
  }
}

module.exports = {
  id: "youtube",
  label: "YouTube",
  resourceLabel: "Channel",
  capabilities: { text: false, image: false, video: true, requiresMedia: true, refresh: true },

  isConfigured: () => !!(cfg().clientId && cfg().clientSecret),

  getAuthUrl({ state }) {
    return `https://accounts.google.com/o/oauth2/v2/auth?${qs({
      client_id: cfg().clientId,
      redirect_uri: redirectUri("youtube"),
      response_type: "code",
      scope: SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    })}`;
  },

  async exchangeCode({ code }) {
    const { data } = await call(() =>
      http.post(
        TOKEN_URL,
        http.form({ code, client_id: cfg().clientId, client_secret: cfg().clientSecret, redirect_uri: redirectUri("youtube"), grant_type: "authorization_code" }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      )
    );
    const c = await channel(data.access_token);
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || null,
      expiresAt: expiresAt(data.expires_in),
      scopes: data.scope ? data.scope.split(" ") : SCOPES,
      ...c,
      metadata: { subscribers: c.subscribers },
    };
  },

  async connectWithToken({ accessToken, refreshToken }) {
    const c = await channel(accessToken);
    // Google access tokens live for an hour; with a refresh token we renew them.
    return {
      accessToken,
      refreshToken: refreshToken || null,
      expiresAt: refreshToken ? new Date(Date.now() + 50 * 60000) : null,
      ...c,
      metadata: { subscribers: c.subscribers },
    };
  },

  async refreshToken({ refreshToken }) {
    if (!refreshToken) throw new PlatformError("youtube", "YouTube: no refresh token stored. Reconnect the account.", { auth: true, code: "NO_REFRESH_TOKEN" });
    const { data } = await call(() =>
      http.post(TOKEN_URL, http.form({ client_id: cfg().clientId, client_secret: cfg().clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      })
    );
    return { accessToken: data.access_token, refreshToken: data.refresh_token || undefined, expiresAt: expiresAt(data.expires_in) };
  },

  async revoke({ accessToken, refreshToken }) {
    const token = refreshToken || accessToken;
    if (token) await http.post(`https://oauth2.googleapis.com/revoke?${qs({ token })}`, null, { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
  },

  fetchProfile: ({ accessToken }) => channel(accessToken),

  validate(content, media, meta, thumbnail) {
    const errors = [];
    if (!media || media.resource_type !== "video") errors.push("YouTube only accepts video uploads.");
    if (!cleanTitle(content.title)) errors.push("YouTube videos need a title.");
    if (content.description.length > 5000) errors.push("YouTube descriptions must be at most 5,000 characters.");
    if (thumbnail && thumbnail.resource_type !== "image") errors.push("The YouTube thumbnail must be an image.");
    return errors;
  },

  async publish({ tokens, content, media, thumbnail }) {
    const size = Number(media.size_bytes);
    const mime = media.mime_type || "video/mp4";
    const metadata = {
      snippet: { title: cleanTitle(content.title), description: content.description.slice(0, 5000), tags: tagsWithinLimit(content.tags), categoryId: "22" },
      status: { privacyStatus: cfg().privacyStatus, selfDeclaredMadeForKids: false },
    };
    const init = await call(() =>
      http.post("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", metadata, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Length": String(size),
          "X-Upload-Content-Type": mime,
        },
      })
    );
    const uploadUrl = init.headers && (init.headers.location || init.headers.Location);
    if (!uploadUrl) throw new PlatformError("youtube", "YouTube did not return an upload URL.", { retryable: true });

    const stream = await mediaService.openStream(media);
    const { data } = await call(() =>
      http.put(uploadUrl, stream, {
        headers: { "Content-Type": mime, "Content-Length": String(size) },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 900000,
      })
    );
    if (thumbnail) await setThumbnail(tokens.accessToken, data.id, thumbnail);
    return { platformPostId: data.id, url: `https://www.youtube.com/watch?v=${data.id}` };
  },

  async fetchMetrics({ tokens, target }) {
    const { data } = await call(() =>
      http.get(`${API}/videos`, { params: { part: "statistics", id: target.platform_post_id }, headers: { Authorization: `Bearer ${tokens.accessToken}` } })
    );
    const s = ((data.items || [])[0] || {}).statistics || {};
    return {
      views: s.viewCount !== undefined ? Number(s.viewCount) : null,
      likes: s.likeCount !== undefined ? Number(s.likeCount) : null,
      comments: s.commentCount !== undefined ? Number(s.commentCount) : null,
      shares: null,
      raw: s,
    };
  },
};
