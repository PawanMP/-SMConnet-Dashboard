// Facebook Pages via the Meta Graph API.
// Tokens: the stored access token is a Page access token (does not expire when
// derived from a long-lived user token). The long-lived *user* token is kept
// in the refresh-token slot so the list of Pages can be re-read when the user
// switches Page.
const FormData = require("form-data");
const config = require("../../config");
const http = require("../../lib/http");
const { PlatformError, toPlatformError } = require("../../lib/errors");
const mediaService = require("../media");
const { redirectUri, isPublicUrl, expiresAt, qs } = require("./common");

const cfg = () => config.platforms.facebook;
const graph = () => `https://graph.facebook.com/${cfg().graphVersion}`;
const SCOPES = ["pages_show_list", "pages_manage_posts", "pages_read_engagement", "business_management"];

async function call(fn) {
  try {
    return await fn();
  } catch (err) {
    throw toPlatformError("facebook", err);
  }
}

function pageSummary(p) {
  return { id: String(p.id), name: p.name, avatarUrl: (p.picture && p.picture.data && p.picture.data.url) || null };
}

async function listPages(userToken) {
  const { data } = await call(() =>
    http.get(`${graph()}/me/accounts`, { params: { fields: "id,name,access_token,picture{url}", limit: 100, access_token: userToken } })
  );
  return data.data || [];
}

function connectionFromPage(page, pages, userToken, userTokenExpiresAt) {
  return {
    accessToken: page.access_token,
    refreshToken: userToken || null,
    expiresAt: null,
    refreshExpiresAt: userTokenExpiresAt || null,
    externalId: String(page.id),
    name: page.name,
    avatarUrl: pageSummary(page).avatarUrl,
    metadata: { pages: pages.map(pageSummary), selectedPageId: String(page.id) },
  };
}

async function connectWithUserToken(userToken, userTokenExpiresAt, preferredPageId) {
  const pages = await listPages(userToken);
  if (!pages.length) {
    throw new PlatformError("facebook", "Facebook: no Pages found. You must manage at least one Facebook Page and grant access to it.", {
      code: "NO_PAGES",
    });
  }
  const page = pages.find((p) => String(p.id) === String(preferredPageId)) || pages[0];
  return connectionFromPage(page, pages, userToken, userTokenExpiresAt);
}

module.exports = {
  id: "facebook",
  label: "Facebook",
  resourceLabel: "Page",
  capabilities: { text: true, image: true, video: true, requiresMedia: false, refresh: false },

  isConfigured: () => !!(cfg().appId && cfg().appSecret),

  getAuthUrl({ state }) {
    return `https://www.facebook.com/${cfg().graphVersion}/dialog/oauth?${qs({
      client_id: cfg().appId,
      redirect_uri: redirectUri("facebook"),
      state,
      response_type: "code",
      scope: SCOPES.join(","),
    })}`;
  },

  async exchangeCode({ code }) {
    const short = await call(() =>
      http.get(`${graph()}/oauth/access_token`, {
        params: { client_id: cfg().appId, client_secret: cfg().appSecret, redirect_uri: redirectUri("facebook"), code },
      })
    );
    const long = await call(() =>
      http.get(`${graph()}/oauth/access_token`, {
        params: { grant_type: "fb_exchange_token", client_id: cfg().appId, client_secret: cfg().appSecret, fb_exchange_token: short.data.access_token },
      })
    );
    const result = await connectWithUserToken(long.data.access_token, expiresAt(long.data.expires_in));
    result.scopes = SCOPES;
    return result;
  },

  // Accepts either a user token (Pages are listed) or a Page token.
  async connectWithToken({ accessToken, externalId }) {
    try {
      return await connectWithUserToken(accessToken, null, externalId);
    } catch (err) {
      // An invalid token is final; any other failure means it may be a Page token.
      if (!(err instanceof PlatformError) || err.auth) throw err;
    }
    const { data } = await call(() => http.get(`${graph()}/me`, { params: { fields: "id,name,picture{url}", access_token: accessToken } }));
    if (externalId && String(data.id) !== String(externalId)) {
      throw new PlatformError("facebook", "Facebook: this token does not belong to the Page ID you entered.", { code: "PAGE_MISMATCH" });
    }
    return {
      accessToken,
      refreshToken: null,
      expiresAt: null,
      externalId: String(data.id),
      name: data.name,
      avatarUrl: pageSummary(data).avatarUrl,
      metadata: { pages: [pageSummary(data)], selectedPageId: String(data.id) },
    };
  },

  async fetchProfile({ accessToken }, account) {
    const { data } = await call(() =>
      http.get(`${graph()}/${account.external_id}`, { params: { fields: "id,name,picture{url},fan_count", access_token: accessToken } })
    );
    return { externalId: String(data.id), name: data.name, avatarUrl: pageSummary(data).avatarUrl, followers: data.fan_count ?? null };
  },

  async listResources({ refreshToken }, account, meta) {
    if (!refreshToken) return { items: meta.pages || [], selectedId: meta.selectedPageId || account.external_id };
    const pages = await listPages(refreshToken);
    return { items: pages.map(pageSummary), selectedId: meta.selectedPageId || account.external_id };
  },

  async selectResource({ refreshToken }, account, meta, pageId) {
    if (!refreshToken) {
      throw new PlatformError("facebook", "Facebook: reconnect with Facebook Login to switch Pages.", { code: "RECONNECT_REQUIRED" });
    }
    const pages = await listPages(refreshToken);
    const page = pages.find((p) => String(p.id) === String(pageId));
    if (!page) throw new PlatformError("facebook", "Facebook: that Page is not available to this account.", { code: "PAGE_NOT_FOUND" });
    return {
      accessToken: page.access_token,
      externalId: String(page.id),
      name: page.name,
      avatarUrl: pageSummary(page).avatarUrl,
      metadata: { ...meta, pages: pages.map(pageSummary), selectedPageId: String(page.id) },
    };
  },

  validate(content, media) {
    const errors = [];
    if (!content.text && !media) errors.push("Facebook posts need text or media.");
    if (content.text.length > 63206) errors.push("Facebook text must be at most 63,206 characters.");
    return errors;
  },

  async publish({ account, tokens, content, media }) {
    const pageId = account.external_id;
    const token = tokens.accessToken;
    const message = content.text;

    if (!media) {
      const { data } = await call(() =>
        http.post(`${graph()}/${pageId}/feed`, http.form({ message, link: content.link || undefined, access_token: token }), {
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        })
      );
      return { platformPostId: data.id, url: `https://www.facebook.com/${data.id}` };
    }

    const isVideo = media.resource_type === "video";
    const endpoint = `${graph()}/${pageId}/${isVideo ? "videos" : "photos"}`;
    let response;
    if (isPublicUrl(media.url)) {
      const fields = isVideo
        ? { file_url: media.url, description: message, title: content.title || undefined, access_token: token }
        : { url: media.url, caption: message, access_token: token };
      response = await call(() => http.post(endpoint, http.form(fields), { headers: { "Content-Type": "application/x-www-form-urlencoded" } }));
    } else {
      // Local development: stream the file itself.
      const form = new FormData();
      form.append("access_token", token);
      form.append(isVideo ? "description" : "caption", message);
      form.append("source", await mediaService.openStream(media), {
        filename: media.original_name || `upload.${media.format}`,
        contentType: media.mime_type,
        knownLength: Number(media.size_bytes) || undefined,
      });
      response = await call(() =>
        http.post(endpoint, form, { headers: form.getHeaders(), maxBodyLength: Infinity, maxContentLength: Infinity, timeout: 600000 })
      );
    }
    const data = response.data;
    if (isVideo) return { platformPostId: String(data.id), url: `https://www.facebook.com/${pageId}/videos/${data.id}` };
    const postId = data.post_id || data.id;
    return { platformPostId: String(postId), url: `https://www.facebook.com/${postId}` };
  },

  async fetchMetrics({ tokens, target }) {
    const id = target.platform_post_id;
    const { data } = await call(() =>
      http.get(`${graph()}/${id}`, {
        params: {
          fields: id.includes("_") ? "likes.summary(true).limit(0),comments.summary(true).limit(0),shares" : "likes.summary(true).limit(0),comments.summary(true).limit(0)",
          access_token: tokens.accessToken,
        },
      })
    );
    const metrics = {
      likes: data.likes && data.likes.summary ? data.likes.summary.total_count : null,
      comments: data.comments && data.comments.summary ? data.comments.summary.total_count : null,
      shares: data.shares ? data.shares.count : null,
      views: null,
      raw: data,
    };
    if (!id.includes("_")) {
      try {
        const insights = await http.get(`${graph()}/${id}/video_insights`, { params: { metric: "total_video_views", access_token: tokens.accessToken } });
        const entry = (insights.data.data || [])[0];
        metrics.views = entry && entry.values && entry.values[0] ? entry.values[0].value : null;
      } catch {
        // Video views need the read_insights permission; skip when unavailable.
      }
    }
    return metrics;
  },
};
