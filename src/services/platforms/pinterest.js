// Pinterest via API v5. Pins go to the board chosen on the Accounts page.
const FormData = require("form-data");
const config = require("../../config");
const http = require("../../lib/http");
const { PlatformError, toPlatformError } = require("../../lib/errors");
const mediaService = require("../media");
const { redirectUri, isPublicUrl, expiresAt, poll, qs } = require("./common");

const cfg = () => config.platforms.pinterest;
const api = () => `${cfg().apiBase}/v5`;
const SCOPES = ["boards:read", "boards:write", "pins:read", "pins:write", "user_accounts:read"];

async function call(fn) {
  try {
    return await fn();
  } catch (err) {
    throw toPlatformError("pinterest", err);
  }
}

const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const basic = () => `Basic ${Buffer.from(`${cfg().appId}:${cfg().appSecret}`).toString("base64")}`;

async function userAccount(accessToken) {
  const { data } = await call(() => http.get(`${api()}/user_account`, { headers: bearer(accessToken) }));
  return { externalId: data.username, name: data.business_name || data.username, username: data.username, avatarUrl: data.profile_image || null };
}

async function boards(accessToken) {
  const { data } = await call(() => http.get(`${api()}/boards`, { params: { page_size: 100 }, headers: bearer(accessToken) }));
  return (data.items || []).map((b) => ({ id: String(b.id), name: b.name }));
}

async function connection(tokens) {
  const [profile, list] = await Promise.all([userAccount(tokens.accessToken), boards(tokens.accessToken)]);
  return {
    ...tokens,
    ...profile,
    metadata: { boards: list, selectedBoardId: list[0] ? list[0].id : null, selectedBoardName: list[0] ? list[0].name : null },
  };
}

async function tokenRequest(fields) {
  const { data } = await call(() =>
    http.post(`${api()}/oauth/token`, http.form(fields), { headers: { Authorization: basic(), "Content-Type": "application/x-www-form-urlencoded" } })
  );
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: expiresAt(data.expires_in),
    refreshExpiresAt: expiresAt(data.refresh_token_expires_in),
    scopes: data.scope ? data.scope.split(/[ ,]/) : SCOPES,
  };
}

async function uploadVideo(token, media) {
  const reg = await call(() => http.post(`${api()}/media`, { media_type: "video" }, { headers: { ...bearer(token), "Content-Type": "application/json" } }));
  const { media_id: mediaId, upload_url: uploadUrl, upload_parameters: fields } = reg.data;

  const form = new FormData();
  for (const [k, v] of Object.entries(fields || {})) form.append(k, v);
  form.append("file", await mediaService.openStream(media), {
    filename: media.original_name || `video.${media.format}`,
    contentType: media.mime_type,
    knownLength: Number(media.size_bytes) || undefined,
  });
  await call(() => http.post(uploadUrl, form, { headers: form.getHeaders(), maxBodyLength: Infinity, maxContentLength: Infinity, timeout: 600000 }));

  const status = await poll(
    async () => {
      const { data } = await call(() => http.get(`${api()}/media/${mediaId}`, { headers: bearer(token) }));
      if (data.status === "succeeded") return "succeeded";
      if (data.status === "failed") return "failed";
      return undefined;
    },
    { intervalMs: 5000, timeoutMs: 180000 }
  );
  if (status === "failed") throw new PlatformError("pinterest", "Pinterest could not process the video.", { code: "MEDIA_PROCESSING_FAILED" });
  if (status !== "succeeded") throw new PlatformError("pinterest", "Pinterest is still processing the video. Retry in a few minutes.", { retryable: true, code: "PROCESSING_TIMEOUT" });
  return mediaId;
}

module.exports = {
  id: "pinterest",
  label: "Pinterest",
  resourceLabel: "Board",
  capabilities: { text: false, image: true, video: true, requiresMedia: true, refresh: true },

  isConfigured: () => !!(cfg().appId && cfg().appSecret),

  getAuthUrl({ state }) {
    return `https://www.pinterest.com/oauth/?${qs({
      client_id: cfg().appId,
      redirect_uri: redirectUri("pinterest"),
      response_type: "code",
      scope: SCOPES.join(","),
      state,
    })}`;
  },

  async exchangeCode({ code }) {
    const tokens = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri("pinterest") });
    return connection(tokens);
  },

  async connectWithToken({ accessToken, refreshToken }) {
    return connection({ accessToken, refreshToken: refreshToken || null, expiresAt: null });
  },

  async refreshToken({ refreshToken }) {
    if (!refreshToken) throw new PlatformError("pinterest", "Pinterest: no refresh token stored. Reconnect the account.", { auth: true, code: "NO_REFRESH_TOKEN" });
    const t = await tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
    return { accessToken: t.accessToken, refreshToken: t.refreshToken || undefined, expiresAt: t.expiresAt };
  },

  fetchProfile: ({ accessToken }) => userAccount(accessToken),

  async listResources({ accessToken }, account, meta) {
    return { items: await boards(accessToken), selectedId: meta.selectedBoardId || null };
  },

  async selectResource({ accessToken }, account, meta, boardId) {
    const list = await boards(accessToken);
    const board = list.find((b) => b.id === String(boardId));
    if (!board) throw new PlatformError("pinterest", "Pinterest: that board was not found.", { code: "BOARD_NOT_FOUND" });
    return { metadata: { ...meta, boards: list, selectedBoardId: board.id, selectedBoardName: board.name } };
  },

  validate(content, media, meta = {}) {
    const errors = [];
    if (!media) errors.push("Pinterest Pins need an image or video.");
    if (!meta.selectedBoardId) errors.push("Choose a Pinterest board on the Accounts page.");
    if (content.title.length > 100) errors.push("Pinterest titles must be at most 100 characters.");
    if (content.description.length > 800) errors.push("Pinterest descriptions must be at most 800 characters.");
    return errors;
  },

  async publish({ account, tokens, content, media, meta }) {
    const token = tokens.accessToken;
    let mediaSource;
    if (media.resource_type === "video") {
      const mediaId = await uploadVideo(token, media);
      const cover = mediaService.thumbnailUrl(media);
      mediaSource = cover && isPublicUrl(cover)
        ? { source_type: "video_id", media_id: mediaId, cover_image_url: cover }
        : { source_type: "video_id", media_id: mediaId, cover_image_key_frame_time: 1000 };
    } else {
      if (!isPublicUrl(media.url)) {
        throw new PlatformError("pinterest", "Pinterest: images must be hosted at a public HTTPS URL. Ask the administrator to configure Cloudinary.", {
          code: "MEDIA_NOT_PUBLIC",
        });
      }
      mediaSource = { source_type: "image_url", url: media.url };
    }
    const { data } = await call(() =>
      http.post(
        `${api()}/pins`,
        {
          board_id: meta.selectedBoardId,
          title: content.title.slice(0, 100) || undefined,
          description: content.description.slice(0, 800) || undefined,
          link: content.link || undefined,
          media_source: mediaSource,
        },
        { headers: { ...bearer(token), "Content-Type": "application/json" } }
      )
    );
    return { platformPostId: String(data.id), url: `https://www.pinterest.com/pin/${data.id}/` };
  },

  async fetchMetrics({ tokens, target }) {
    const { data } = await call(() =>
      http.get(`${api()}/pins/${target.platform_post_id}`, { params: { pin_metrics: true }, headers: bearer(tokens.accessToken) })
    );
    const m = (data.pin_metrics && (data.pin_metrics.lifetime_metrics || data.pin_metrics.all_time)) || {};
    return {
      views: m.impression ?? null,
      likes: m.reaction ?? null,
      comments: m.comment ?? null,
      saves: m.save ?? null,
      shares: null,
      raw: data.pin_metrics || {},
    };
  },
};
