// Instagram professional accounts. Two API flavours are supported: Instagram API with Instagram Login (graph.instagram.com): used by the OAuth "Connect" button. Long-lived tokens last 60 days and are refreshed automatically before they expire. Instagram API with Facebook Login (graph.facebook.com): for accounts connected with a Facebook Page/user token ("EAA...") plus the Instagram business account ID. These tokens cannot be refreshed by the server. Both expose the same /media, /media_publish and insights endpoints.
const config = require("../../config");
const http = require("../../lib/http");
const { PlatformError, toPlatformError } = require("../../lib/errors");
const mediaService = require("../media");
const accountsModel = require("../../models/accounts");
const { redirectUri, isPublicUrl, expiresAt, poll, qs } = require("./common");

const cfg = () => config.platforms.instagram;
const IG_HOST = () => `https://graph.instagram.com/${cfg().graphVersion}`;
const FB_HOST = () => `https://graph.facebook.com/${config.platforms.facebook.graphVersion}`;
const SCOPES = ["instagram_business_basic", "instagram_business_content_publish"];
const PROFILE_FIELDS = "id,username,name,profile_picture_url,followers_count,media_count";

const isFacebookToken = (token) => /^EAA/.test(String(token || ""));
const hostFor = (meta, token) => (meta && meta.apiHost === "facebook") || isFacebookToken(token) ? FB_HOST() : IG_HOST();

async function call(fn) {
  try {
    return await fn();
  } catch (err) {
    throw toPlatformError("instagram", err);
  }
}

function shapeProfile(data, fallbackId) {
  return {
    externalId: String(data.user_id || data.id || fallbackId),
    name: data.name || data.username,
    username: data.username,
    avatarUrl: data.profile_picture_url || null,
    followers: data.followers_count ?? null,
  };
}

async function instagramLoginProfile(accessToken) {
  const { data } = await call(() => http.get(`${IG_HOST()}/me`, { params: { fields: `user_id,${PROFILE_FIELDS}`, access_token: accessToken } }));
  return shapeProfile(data);
}

async function facebookLoginProfile(accessToken, igId) {
  const { data } = await call(() => http.get(`${FB_HOST()}/${igId}`, { params: { fields: PROFILE_FIELDS, access_token: accessToken } }));
  return shapeProfile(data, igId);
}

// With a Facebook token and no ID, find the Instagram account linked to a Page.
async function discoverLinkedAccount(accessToken) {
  const { data } = await call(() =>
    http.get(`${FB_HOST()}/me/accounts`, { params: { fields: "name,instagram_business_account", limit: 100, access_token: accessToken } })
  );
  const page = (data.data || []).find((p) => p.instagram_business_account);
  if (!page) {
    throw new PlatformError("instagram", "Instagram: no Instagram business account is linked to your Facebook Pages. Enter the Instagram account ID.", {
      code: "NO_LINKED_ACCOUNT",
    });
  }
  return page.instagram_business_account.id;
}

module.exports = {
  id: "instagram",
  label: "Instagram",
  capabilities: { text: false, image: true, video: true, requiresMedia: true, refresh: true },
  // Refresh a week before expiry (the API refuses tokens younger than 24h).
  refreshWindowMs: 7 * 24 * 3600 * 1000,

  isConfigured: () => !!(cfg().appId && cfg().appSecret),

  // Only Instagram Login tokens can be refreshed server-side.
  canRefresh: (account, meta) => (meta || {}).apiHost !== "facebook",

  getAuthUrl({ state }) {
    return `https://www.instagram.com/oauth/authorize?${qs({
      client_id: cfg().appId,
      redirect_uri: redirectUri("instagram"),
      response_type: "code",
      scope: SCOPES.join(","),
      state,
    })}`;
  },

  async exchangeCode({ code }) {
    const short = await call(() =>
      http.post(
        "https://api.instagram.com/oauth/access_token",
        http.form({ client_id: cfg().appId, client_secret: cfg().appSecret, grant_type: "authorization_code", redirect_uri: redirectUri("instagram"), code }),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      )
    );
    const shortBody = Array.isArray(short.data.data) ? short.data.data[0] : short.data;
    const long = await call(() =>
      http.get("https://graph.instagram.com/access_token", {
        params: { grant_type: "ig_exchange_token", client_secret: cfg().appSecret, access_token: shortBody.access_token },
      })
    );
    const p = await instagramLoginProfile(long.data.access_token);
    return {
      accessToken: long.data.access_token,
      refreshToken: null,
      expiresAt: expiresAt(long.data.expires_in),
      scopes: SCOPES,
      ...p,
      metadata: { apiHost: "instagram", followers: p.followers },
    };
  },

  async connectWithToken({ accessToken, externalId }) {
    if (isFacebookToken(accessToken)) {
      const igId = externalId || (await discoverLinkedAccount(accessToken));
      const p = await facebookLoginProfile(accessToken, igId);
      return { accessToken, refreshToken: null, expiresAt: null, ...p, metadata: { apiHost: "facebook", followers: p.followers } };
    }
    const p = await instagramLoginProfile(accessToken);
    return { accessToken, refreshToken: null, expiresAt: null, ...p, metadata: { apiHost: "instagram", followers: p.followers } };
  },

  async refreshToken({ accessToken }, account) {
    const meta = account ? accountsModel.metadata(account) : {};
    if (meta.apiHost === "facebook" || isFacebookToken(accessToken)) {
      throw new PlatformError("instagram", "Instagram: Facebook-issued tokens cannot be renewed automatically. Reconnect the account.", { code: "NO_REFRESH" });
    }
    const { data } = await call(() =>
      http.get("https://graph.instagram.com/refresh_access_token", { params: { grant_type: "ig_refresh_token", access_token: accessToken } })
    );
    return { accessToken: data.access_token, expiresAt: expiresAt(data.expires_in) };
  },

  fetchProfile({ accessToken }, account) {
    const meta = accountsModel.metadata(account);
    return hostFor(meta, accessToken) === FB_HOST() ? facebookLoginProfile(accessToken, account.external_id) : instagramLoginProfile(accessToken);
  },

  validate(content, media) {
    const errors = [];
    if (!media) errors.push("Instagram posts need a photo or video.");
    if (content.text.length > 2200) errors.push("Instagram captions must be at most 2,200 characters.");
    if ((content.text.match(/#[\p{L}\p{N}_]+/gu) || []).length > 30) errors.push("Instagram allows at most 30 hashtags.");
    return errors;
  },

  async publish({ account, tokens, content, media, meta }) {
    if (!isPublicUrl(media.url)) {
      throw new PlatformError("instagram", "Instagram: media must be hosted at a public HTTPS URL. Ask the administrator to configure Cloudinary.", {
        code: "MEDIA_NOT_PUBLIC",
      });
    }
    const graph = hostFor(meta, tokens.accessToken);
    const igId = account.external_id;
    const token = tokens.accessToken;
    const isVideo = media.resource_type === "video";
    const params = isVideo
      ? { media_type: "REELS", video_url: mediaService.deliveryUrl(media, media.format === "mov" ? "mov" : "mp4"), caption: content.text, access_token: token }
      : { image_url: mediaService.deliveryUrl(media, "jpg"), caption: content.text, access_token: token };

    const container = await call(() => http.post(`${graph}/${igId}/media`, null, { params }));
    const creationId = container.data.id;

    // Instagram downloads and processes the media before it can be published.
    const status = await poll(
      async () => {
        const { data } = await call(() => http.get(`${graph}/${creationId}`, { params: { fields: "status_code,status", access_token: token } }));
        if (data.status_code === "FINISHED") return "FINISHED";
        if (data.status_code === "ERROR" || data.status_code === "EXPIRED") return `ERROR: ${data.status || data.status_code}`;
        return undefined;
      },
      { intervalMs: isVideo ? 5000 : 2000, timeoutMs: isVideo ? 240000 : 30000 }
    );
    if (status === undefined) {
      throw new PlatformError("instagram", "Instagram is still processing the media. Retry in a few minutes.", { code: "PROCESSING_TIMEOUT", retryable: true });
    }
    if (status !== "FINISHED") {
      throw new PlatformError("instagram", `Instagram could not process the media (${status}).`, { code: "MEDIA_PROCESSING_FAILED" });
    }

    const published = await call(() => http.post(`${graph}/${igId}/media_publish`, null, { params: { creation_id: creationId, access_token: token } }));
    const mediaId = String(published.data.id);
    let url = null;
    try {
      const { data } = await http.get(`${graph}/${mediaId}`, { params: { fields: "permalink", access_token: token } });
      url = data.permalink || null;
    } catch {
      // The permalink is a convenience; publishing already succeeded.
    }
    return { platformPostId: mediaId, url };
  },

  async fetchMetrics({ account, tokens, target }) {
    const graph = hostFor(accountsModel.metadata(account), tokens.accessToken);
    const id = target.platform_post_id;
    const { data } = await call(() => http.get(`${graph}/${id}`, { params: { fields: "like_count,comments_count", access_token: tokens.accessToken } }));
    const metrics = { likes: data.like_count ?? null, comments: data.comments_count ?? null, views: null, shares: null, saves: null, raw: data };
    try {
      const insights = await http.get(`${graph}/${id}/insights`, { params: { metric: "views,shares,saved", access_token: tokens.accessToken } });
      for (const entry of insights.data.data || []) {
        const value = entry.values && entry.values[0] ? entry.values[0].value : entry.total_value && entry.total_value.value;
        if (entry.name === "views") metrics.views = value;
        if (entry.name === "shares") metrics.shares = value;
        if (entry.name === "saved") metrics.saves = value;
      }
    } catch {
      // Insights need an extra permission; likes and comments still apply.
    }
    return metrics;
  },
};
