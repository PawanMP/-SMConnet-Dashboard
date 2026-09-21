const { test, describe, beforeEach, before } = require("node:test");
const assert = require("node:assert/strict");
const { H, signUp, connect, addMedia, stubHttp, httpError, resetStubs, db } = require("./helpers");
const config = require("../src/config");
const time = require("../src/lib/time");
const accountsModel = require("../src/models/accounts");
const tokens = require("../src/services/tokens");
const platforms = require("../src/services/platforms");
const content = require("../src/services/content");

before(() => {
  config.platforms.facebook.appId = "fb-app";
  config.platforms.facebook.appSecret = "fb-secret";
  config.platforms.tiktok.clientKey = "tk-key";
  config.platforms.tiktok.clientSecret = "tk-secret";
  config.platforms.youtube.clientId = "yt-id";
  config.platforms.youtube.clientSecret = "yt-secret";
});

describe("OAuth", () => {
  beforeEach(() => resetStubs());

  test("connect returns the provider URL with a single-use state", async () => {
    const { agent } = await signUp();
    const res = await agent.post("/api/accounts/facebook/connect").set(H);
    assert.equal(res.status, 200);
    const url = new URL(res.body.url);
    assert.equal(url.hostname, "www.facebook.com");
    assert.equal(url.searchParams.get("client_id"), "fb-app");
    assert.equal(url.searchParams.get("redirect_uri"), `${config.appUrl}/api/oauth/facebook/callback`);
    assert.ok(url.searchParams.get("state").length >= 40);
    assert.ok(!res.body.url.includes("fb-secret"), "app secret never reaches the browser");
  });

  test("platforms without app credentials report a clear error", async () => {
    const { agent } = await signUp();
    const res = await agent.post("/api/accounts/pinterest/connect").set(H);
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, "OAUTH_NOT_CONFIGURED");
  });

  test("callback exchanges the code and stores encrypted tokens for that user", async () => {
    const { agent, user } = await signUp();
    const start = await agent.post("/api/accounts/facebook/connect").set(H);
    const state = new URL(start.body.url).searchParams.get("state");

    stubHttp((opts) => {
      if (opts.url.endsWith("/oauth/access_token") && opts.params.code) return { data: { access_token: "short-user-token" } };
      if (opts.url.endsWith("/oauth/access_token")) return { data: { access_token: "long-user-token", expires_in: 5184000 } };
      if (opts.url.endsWith("/me/accounts")) {
        return { data: { data: [{ id: "111", name: "My Page", access_token: "page-token", picture: { data: { url: "https://img/p.png" } } }] } };
      }
      throw new Error(`unexpected ${opts.url}`);
    });

    const cb = await agent.get(`/api/oauth/facebook/callback?code=abc&state=${state}`);
    assert.equal(cb.status, 302);
    assert.equal(cb.headers.location, "/accounts.html?connected=facebook");

    const account = await accountsModel.findByUserPlatform(user.id, "facebook");
    assert.equal(account.account_name, "My Page");
    assert.equal(account.external_id, "111");
    assert.equal(accountsModel.tokens(account).accessToken, "page-token");
    assert.ok(!account.access_token_enc.includes("page-token"));

    const list = await agent.get("/api/accounts");
    const fb = list.body.accounts.find((a) => a.platform === "facebook");
    assert.equal(fb.status, "connected");
    assert.equal(fb.accountName, "My Page");
    assert.ok(!JSON.stringify(list.body).includes("page-token"), "tokens never reach the frontend");

    const replay = await agent.get(`/api/oauth/facebook/callback?code=abc&state=${state}`);
    assert.match(replay.headers.location, /error=/, "state cannot be reused");
  });

  test("a state issued to another user is rejected", async () => {
    const alice = await signUp();
    const mallory = await signUp();
    const start = await alice.agent.post("/api/accounts/facebook/connect").set(H);
    const state = new URL(start.body.url).searchParams.get("state");
    const res = await mallory.agent.get(`/api/oauth/facebook/callback?code=abc&state=${state}`);
    assert.match(res.headers.location, /error=/);
    assert.equal(await accountsModel.findByUserPlatform(mallory.user.id, "facebook"), null);
  });

  test("denied consent is reported back to the accounts page", async () => {
    const { agent } = await signUp();
    const res = await agent.get("/api/oauth/tiktok/callback?error=access_denied");
    assert.match(decodeURIComponent(res.headers.location), /access was not granted/);
  });

  test("disconnect removes stored credentials", async () => {
    const { agent, user } = await signUp();
    await connect(user.id, "tiktok");
    stubHttp(() => ({ data: {} }));
    const res = await agent.delete("/api/accounts/tiktok").set(H);
    assert.equal(res.status, 200);
    assert.equal(res.body.account.status, "not_connected");
    assert.equal(await accountsModel.findByUserPlatform(user.id, "tiktok"), null);
    const log = await db.get("SELECT COUNT(*) AS n FROM activity_logs WHERE user_id = ? AND action = 'account.disconnect'", [user.id]);
    assert.equal(Number(log.n), 1);
  });
});

describe("token refresh", () => {
  beforeEach(() => resetStubs());

  test("refreshes a TikTok token that is about to expire", async () => {
    const { user } = await signUp();
    const account = await connect(user.id, "tiktok", { expiresAt: new Date(Date.now() + 60000) });
    const calls = stubHttp((opts) => {
      assert.match(opts.url, /oauth\/token/);
      assert.match(opts.data, /grant_type=refresh_token/);
      return { data: { access_token: "new-access", refresh_token: "new-refresh", expires_in: 86400, refresh_expires_in: 31536000 } };
    });
    const t = await tokens.getValidTokens(account);
    assert.equal(t.accessToken, "new-access");
    assert.equal(calls.length, 1);
    const stored = await accountsModel.findById(account.id);
    assert.equal(accountsModel.tokens(stored).refreshToken, "new-refresh");
    assert.ok(time.toMs(stored.token_expires_at) > Date.now() + 23 * 3600000);
  });

  test("does not refresh tokens that are still valid", async () => {
    const { user } = await signUp();
    const account = await connect(user.id, "youtube", { expiresAt: new Date(Date.now() + 3600000) });
    const calls = stubHttp(() => ({ data: {} }));
    const t = await tokens.getValidTokens(account);
    assert.equal(t.accessToken, "youtube-access-token");
    assert.equal(calls.length, 0);
  });

  test("marks the account expired and notifies when refresh is refused", async () => {
    const { user, agent } = await signUp();
    const account = await connect(user.id, "youtube", { expiresAt: new Date(Date.now() - 60000) });
    stubHttp(() => {
      throw httpError(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
    });
    await assert.rejects(tokens.getValidTokens(account), (err) => err.auth === true);
    const stored = await accountsModel.findById(account.id);
    assert.equal(stored.status, "expired");
    const list = await agent.get("/api/accounts");
    assert.equal(list.body.accounts.find((a) => a.platform === "youtube").status, "expired");
    const notes = await agent.get("/api/notifications");
    assert.equal(notes.body.items.filter((n) => n.type === "connection_problem").length, 1);
  });

  test("the periodic check refreshes expiring accounts", async () => {
    const { user } = await signUp();
    await connect(user.id, "tiktok", { expiresAt: new Date(Date.now() + 120000) });
    stubHttp(() => ({ data: { access_token: "fresh", refresh_token: "fresh-r", expires_in: 86400 } }));
    const result = await tokens.checkExpiringAccounts();
    assert.ok(result.refreshed >= 1);
  });
});

describe("platform adapters", () => {
  beforeEach(() => resetStubs());

  test("Facebook posts a photo by public URL", async () => {
    const { user } = await signUp();
    const account = await connect(user.id, "facebook", { externalId: "555" });
    const media = await addMedia(user.id, "image");
    const calls = stubHttp(() => ({ data: { id: "photo1", post_id: "555_999" } }));
    const post = { user_id: user.id, caption: "Hello", hashtags: "#a b", platform_content: "{}" };
    const res = await platforms.get("facebook").publish({
      account,
      tokens: { accessToken: "page-token" },
      content: content.resolve(post, "facebook"),
      media,
      meta: {},
    });
    assert.equal(res.platformPostId, "555_999");
    assert.match(calls[0].url, /graph\.facebook\.com\/v\d+\.\d+\/555\/photos$/);
    const body = new URLSearchParams(calls[0].data);
    assert.equal(body.get("url"), media.url);
    assert.equal(body.get("caption"), "Hello\n\n#a #b");
  });

  test("Instagram waits for the media container, then publishes", async () => {
    const { user } = await signUp();
    const account = await connect(user.id, "instagram", { externalId: "1789" });
    const media = await addMedia(user.id, "image");
    let polls = 0;
    const calls = stubHttp((opts) => {
      if (opts.url.endsWith("/1789/media")) return { data: { id: "container1" } };
      if (opts.url.endsWith("/container1")) return { data: { status_code: ++polls < 2 ? "IN_PROGRESS" : "FINISHED" } };
      if (opts.url.endsWith("/media_publish")) return { data: { id: "ig-media-1" } };
      if (opts.url.endsWith("/ig-media-1")) return { data: { permalink: "https://instagram.com/p/xyz" } };
      throw new Error(`unexpected ${opts.url}`);
    });
    const res = await platforms.get("instagram").publish({
      account,
      tokens: { accessToken: "ig-token" },
      content: content.resolve({ caption: "Pic", platform_content: "{}" }, "instagram"),
      media,
      meta: {},
    });
    assert.equal(res.platformPostId, "ig-media-1");
    assert.equal(res.url, "https://instagram.com/p/xyz");
    assert.equal(polls, 2);
    assert.equal(calls[0].params.image_url, media.url);
  });

  test("Instagram also works with a Facebook token (graph.facebook.com)", async () => {
    const { user, agent } = await signUp();
    const calls = stubHttp((opts) => {
      if (opts.url.includes("graph.facebook.com") && opts.url.endsWith("/17841400000")) return { data: { id: "17841400000", username: "shop", name: "Shop" } };
      if (opts.url.endsWith("/17841400000/media")) return { data: { id: "c1" } };
      if (opts.url.endsWith("/c1")) return { data: { status_code: "FINISHED" } };
      if (opts.url.endsWith("/media_publish")) return { data: { id: "m1" } };
      return { data: {} };
    });
    const res = await agent.post("/api/accounts/instagram/token").set(H).send({ accessToken: "EAAfacebook-token-123", externalId: "17841400000" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.account.username, "shop");
    assert.equal(res.body.account.autoRefresh, false, "Facebook tokens cannot be renewed by the server");
    assert.ok(calls.every((c) => c.url.includes("graph.facebook.com")));

    const account = await accountsModel.findByUserPlatform(user.id, "instagram");
    const media = await addMedia(user.id, "image");
    const out = await platforms.get("instagram").publish({
      account,
      tokens: accountsModel.tokens(account),
      content: content.resolve({ caption: "Hi", platform_content: "{}" }, "instagram"),
      media,
      meta: accountsModel.metadata(account),
    });
    assert.equal(out.platformPostId, "m1");
    assert.ok(calls.filter((c) => c.url.endsWith("/media")).every((c) => c.url.startsWith("https://graph.facebook.com/")));
  });

  test("YouTube uses the resumable upload protocol", async () => {
    const { user } = await signUp();
    const account = await connect(user.id, "youtube");
    const media = await addMedia(user.id, "video");
    const calls = stubHttp((opts) => {
      if (opts.method === "get") return { data: require("stream").Readable.from([Buffer.from("video-bytes")]) };
      if (opts.method === "post") return { headers: { location: "https://upload.example/session1" }, data: {} };
      if (opts.method === "put") return { data: { id: "vid123" } };
      throw new Error("unexpected");
    });
    const res = await platforms.get("youtube").publish({
      account,
      tokens: { accessToken: "ya29" },
      content: content.resolve({ title: "My <Video>", caption: "desc", hashtags: "one two", platform_content: "{}" }, "youtube"),
      media,
      meta: {},
    });
    assert.equal(res.platformPostId, "vid123");
    assert.equal(res.url, "https://www.youtube.com/watch?v=vid123");
    const init = calls.find((c) => c.method === "post");
    assert.match(init.url, /uploadType=resumable/);
    assert.equal(init.data.snippet.title, "My Video");
    assert.deepEqual(init.data.snippet.tags, ["one", "two"]);
    assert.equal(calls.find((c) => c.method === "put").url, "https://upload.example/session1");
  });

  test("Pinterest requires a board and media", () => {
    const pin = platforms.get("pinterest");
    const errors = pin.validate({ title: "t", description: "d", text: "d" }, null, {});
    assert.ok(errors.some((e) => /board/.test(e)));
    assert.ok(errors.some((e) => /image or video/.test(e)));
  });

  test("hashtags are normalised", () => {
    const c = content.resolve({ caption: "Hi", hashtags: "summer, #Sale  summer #deal!", platform_content: "{}" }, "instagram");
    assert.equal(c.hashtags, "#summer #Sale #deal");
  });
});
