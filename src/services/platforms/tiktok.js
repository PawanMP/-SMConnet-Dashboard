// TikTok via Login Kit and the Content Posting API (direct post, file upload). Access tokens last 24 hours and are refreshed with the 365-day refresh token.
const config = require("../../config");
const http = require("../../lib/http");
const { PlatformError, toPlatformError } = require("../../lib/errors");
const mediaService = require("../media");
const { redirectUri, expiresAt, poll, qs } = require("./common");

const cfg = () => config.platforms.tiktok;
const API = "https://open.tiktokapis.com/v2";
const SCOPES = ["user.info.basic", "video.publish", "video.upload", "video.list"];
const SINGLE_CHUNK_MAX = 64 * 1024 * 1024;
const CHUNK_SIZE = 10 * 1024 * 1024;

async function call(fn) {
  let res;
  try {
    res = await fn();
  } catch (err) {
    throw toPlatformError("tiktok", err);
  }
  // TikTok reports some failures inside  response. not as an HTTP error.
  const e = res.data && res.data.error;
  if (e && typeof e === "object" && e.code && e.code !== "ok") {
    const auth = /access_token|token_invalid|scope_not_authorized/i.test(e.code);
    throw new PlatformError("tiktok", `TikTok: ${e.message || e.code}`, { code: auth ? "TOKEN_INVALID" : e.code, auth, raw: res.data });
  }
  if (res.data && typeof res.data.error === "string" && res.data.error) {
    throw new PlatformError("tiktok", `TikTok: ${res.data.error_description || res.data.error}`, {
      code: res.data.error,
      auth: /invalid_grant|invalid_token/i.test(res.data.error),
    });
  }
  return res;
}

const bearer = (token) => ({ Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" });

async function userInfo(accessToken) {
  const { data } = await call(() =>
    http.get(`${API}/user/info/`, { params: { fields: "open_id,union_id,avatar_url,display_name,username" }, headers: bearer(accessToken) })
  );
  const u = (data.data && data.data.user) || {};
  return { externalId: u.open_id, name: u.display_name || u.username || "TikTok user", username: u.username || null, avatarUrl: u.avatar_url || null };
}

function tokenResult(data) {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: expiresAt(data.expires_in),
    refreshExpiresAt: expiresAt(data.refresh_expires_in),
    scopes: data.scope ? data.scope.split(",") : SCOPES,
  };
}

module.exports = {
  id: "tiktok",
  label: "TikTok",
  capabilities: { text: false, image: false, video: true, requiresMedia: true, refresh: true },

  isConfigured: () => !!(cfg().clientKey && cfg().clientSecret),

  getAuthUrl({ state }) {
    return `https://www.tiktok.com/v2/auth/authorize/?${qs({
      client_key: cfg().clientKey,
      scope: SCOPES.join(","),
      response_type: "code",
      redirect_uri: redirectUri("tiktok"),
      state,
    })}`;
  },

  async exchangeCode({ code }) {
    const { data } = await call(() =>
      http.post(
        `${API}/oauth/token/`,
        http.form({ client_key: cfg().clientKey, client_secret: cfg().clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri("tiktok") }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      )
    );
    const tokens = tokenResult(data);
    return { ...tokens, ...(await userInfo(tokens.accessToken)), metadata: {} };
  },

  async connectWithToken({ accessToken, refreshToken }) {
    const info = await userInfo(accessToken);
    return { accessToken, refreshToken: refreshToken || null, expiresAt: refreshToken ? new Date(Date.now() + 23 * 3600000) : null, ...info, metadata: {} };
  },

  async refreshToken({ refreshToken }) {
    if (!refreshToken) throw new PlatformError("tiktok", "TikTok: no refresh token stored. Reconnect the account.", { auth: true, code: "NO_REFRESH_TOKEN" });
    const { data } = await call(() =>
      http.post(
        `${API}/oauth/token/`,
        http.form({ client_key: cfg().clientKey, client_secret: cfg().clientSecret, grant_type: "refresh_token", refresh_token: refreshToken }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      )
    );
    return tokenResult(data);
  },

  async revoke({ accessToken }) {
    if (!accessToken) return;
    await http.post(`${API}/oauth/revoke/`, http.form({ client_key: cfg().clientKey, client_secret: cfg().clientSecret, token: accessToken }), {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  },

  fetchProfile: ({ accessToken }) => userInfo(accessToken),

  validate(content, media) {
    const errors = [];
    if (!media || media.resource_type !== "video") errors.push("TikTok only accepts video uploads.");
    if (content.text.length > 2200) errors.push("TikTok captions must be at most 2,200 characters.");
    return errors;
  },

  async publish({ account, tokens, content, media }) {
    const headers = bearer(tokens.accessToken);

    // Unaudited TikTok apps may only post privately; use what the creator allows.
    const creator = await call(() => http.post(`${API}/post/publish/creator_info/query/`, {}, { headers }));
    const options = (creator.data.data && creator.data.data.privacy_level_options) || [];
    const privacy = options.includes(cfg().privacyLevel) ? cfg().privacyLevel : options[0] || "SELF_ONLY";

    const buffer = await mediaService.readBuffer(media);
    const size = buffer.length;
    const chunkSize = size <= SINGLE_CHUNK_MAX ? size : CHUNK_SIZE;
    const chunkCount = size <= SINGLE_CHUNK_MAX ? 1 : Math.floor(size / CHUNK_SIZE);

    const init = await call(() =>
      http.post(
        `${API}/post/publish/video/init/`,
        {
          post_info: { title: content.text.slice(0, 2200), privacy_level: privacy, disable_comment: false, disable_duet: false, disable_stitch: false, video_cover_timestamp_ms: 1000 },
          source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: chunkSize, total_chunk_count: chunkCount },
        },
        { headers }
      )
    );
    const { publish_id: publishId, upload_url: uploadUrl } = init.data.data;

    for (let i = 0; i < chunkCount; i++) {
      const start = i * chunkSize;
      // The final chunk absorbs the remainder.
      const end = i === chunkCount - 1 ? size - 1 : start + chunkSize - 1;
      await call(() =>
        http.put(uploadUrl, buffer.subarray(start, end + 1), {
          headers: { "Content-Type": media.mime_type || "video/mp4", "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${size}` },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          timeout: 600000,
        })
      );
    }

    const result = await poll(
      async () => {
        const { data } = await call(() => http.post(`${API}/post/publish/status/fetch/`, { publish_id: publishId }, { headers }));
        const s = data.data || {};
        if (s.status === "FAILED") return { failed: s.fail_reason || "unknown reason" };
        if (s.status === "PUBLISH_COMPLETE") return { videoId: (s.publicaly_available_post_id || [])[0] || null };
        return undefined;
      },
      { intervalMs: 5000, timeoutMs: 60000 }
    );
    if (result && result.failed) throw new PlatformError("tiktok", `TikTok rejected the video: ${result.failed}.`, { code: "PUBLISH_FAILED" });

    const videoId = result && result.videoId ? String(result.videoId) : null;
    const username = account.account_username;
    return {
      // Still processing after the wait: TikTok finishes in the background.
      platformPostId: videoId || publishId,
      url: videoId && username ? `https://www.tiktok.com/@${username}/video/${videoId}` : null,
    };
  },

  async fetchMetrics({ tokens, target }) {
    if (!/^\d+$/.test(String(target.platform_post_id))) return null;
    const { data } = await call(() =>
      http.post(
        `${API}/video/query/`,
        { filters: { video_ids: [String(target.platform_post_id)] } },
        { params: { fields: "id,view_count,like_count,comment_count,share_count" }, headers: bearer(tokens.accessToken) }
      )
    );
    const v = ((data.data && data.data.videos) || [])[0];
    if (!v) return null;
    return { views: v.view_count ?? null, likes: v.like_count ?? null, comments: v.comment_count ?? null, shares: v.share_count ?? null, raw: v };
  },
};
