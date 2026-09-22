const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { H, signUp, addMedia, stubHttp, httpError, resetStubs, db } = require("./helpers");
const config = require("../src/config");

describe("AI content generation", () => {
  beforeEach(() => resetStubs());

  test("is unavailable without an API key", async () => {
    const { agent } = await signUp();
    const res = await agent.post("/api/ai/generate").set(H).send({ platforms: ["facebook"], context: "coffee" });
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, "AI_NOT_CONFIGURED");
  });

  test("generates platform-specific content with the chosen tone and no emojis", async () => {
    const { agent } = await signUp();
    await agent.put("/api/profile/settings").set(H).send({ apiKey: "sk-test-key-123456", aiProvider: "openai" });
    const calls = stubHttp(() => ({
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                facebook: { caption: "Fresh coffee today \u2615\uFE0F come by!", hashtags: "coffee, morning" },
                youtube: { title: "Coffee Tour", description: "A tour.", hashtags: "#coffee #tour" },
              }),
            },
          },
        ],
      },
    }));
    const res = await agent.post("/api/ai/generate").set(H).send({ platforms: ["facebook", "youtube"], context: "coffee shop", tone: "professional" });
    assert.equal(res.status, 200);
    assert.equal(res.body.content.facebook.caption, "Fresh coffee today come by!");
    assert.equal(res.body.content.facebook.hashtags, "#coffee #morning");
    assert.equal(res.body.content.youtube.title, "Coffee Tour");
    assert.equal(res.body.tone, "professional");

    const sent = calls[0];
    assert.equal(sent.headers.Authorization, "Bearer sk-test-key-123456");
    assert.match(sent.data.messages[0].content, /professional tone/);
    assert.match(sent.data.messages[0].content, /Do not use any emojis/);
    assert.equal(sent.data.response_format.type, "json_object");
  });

  test("generates content via OpenRouter, auto-detected from the key prefix", async () => {
    const { agent } = await signUp();
    // No aiProvider given: an "sk-or-" key must be recognised as OpenRouter on its own.
    await agent.put("/api/profile/settings").set(H).send({ apiKey: "sk-or-v1-test-key-1234567890" });
    const calls = stubHttp((opts) => {
      assert.equal(opts.url, "https://openrouter.ai/api/v1/chat/completions");
      assert.equal(opts.headers.Authorization, "Bearer sk-or-v1-test-key-1234567890");
      assert.ok(opts.headers["HTTP-Referer"]);
      return { data: { choices: [{ message: { content: JSON.stringify({ facebook: { caption: "Cold brew launch", hashtags: "coffee" } }) } }] } };
    });
    const res = await agent.post("/api/ai/generate").set(H).send({ platforms: ["facebook"], context: "cold brew" });
    assert.equal(res.status, 200);
    assert.equal(res.body.provider, "openrouter");
    assert.equal(res.body.content.facebook.caption, "Cold brew launch");
    assert.equal(res.body.content.facebook.hashtags, "#coffee");
    assert.equal(calls.length, 1);
  });

  test("respects an explicit OpenRouter model name and reports an OpenRouter-side error", async () => {
    const { agent } = await signUp();
    await agent.put("/api/profile/settings").set(H).send({ apiKey: "sk-or-v1-test-key-1234567890", aiProvider: "openrouter", aiModel: "anthropic/claude-3.5-sonnet" });
    const calls = stubHttp(() => ({ data: { error: { code: 402, message: "Insufficient credits" } } }));
    const res = await agent.post("/api/ai/generate").set(H).send({ platforms: ["facebook"], context: "x" });
    assert.equal(res.status, 502);
    assert.equal(res.body.error.code, "AI_PROVIDER_ERROR");
    assert.match(res.body.error.message, /OpenRouter/);
    assert.equal(calls[0].data.model, "anthropic/claude-3.5-sonnet");
  });

  test("falls back to a configured server provider when the chosen one has no key", async () => {
    const { agent } = await signUp();
    const original = config.ai.openrouterApiKey;
    try {
      config.ai.openrouterApiKey = "sk-or-server-key-1234567890";
      // User asks for openai, but only the server's OpenRouter key exists.
      await agent.put("/api/profile/settings").set(H).send({ aiProvider: "openai" });
      stubHttp(() => ({ data: { choices: [{ message: { content: '{"facebook":{"caption":"x","hashtags":""}}' } }] } }));
      const res = await agent.post("/api/ai/generate").set(H).send({ platforms: ["facebook"], context: "x" });
      assert.equal(res.status, 200);
      assert.equal(res.body.provider, "openrouter");
    } finally {
      config.ai.openrouterApiKey = original;
    }
  });

  test("rewrites a single field", async () => {
    const { agent } = await signUp();
    await agent.put("/api/profile/settings").set(H).send({ apiKey: "sk-test-key-123456" });
    stubHttp(() => ({ data: { choices: [{ message: { content: '{"text":"Shorter caption"}' } }] } }));
    const res = await agent
      .post("/api/ai/rewrite")
      .set(H)
      .send({ platform: "instagram", field: "caption", mode: "shorten", currentText: "A very long caption indeed" });
    assert.equal(res.status, 200);
    assert.equal(res.body.text, "Shorter caption");
  });

  test("rejects fields that do not apply to a platform", async () => {
    const { agent } = await signUp();
    const res = await agent.post("/api/ai/rewrite").set(H).send({ platform: "facebook", field: "title", mode: "regenerate" });
    assert.equal(res.status, 422);
  });

  test("reports a rejected key clearly", async () => {
    const { agent } = await signUp();
    await agent.put("/api/profile/settings").set(H).send({ apiKey: "sk-bad-key-123456" });
    stubHttp(() => {
      throw httpError(401, { error: { message: "Incorrect API key provided" } });
    });
    const res = await agent.post("/api/ai/generate").set(H).send({ platforms: ["tiktok"] });
    assert.equal(res.status, 502);
    assert.equal(res.body.error.code, "AI_AUTH_FAILED");
    assert.doesNotMatch(JSON.stringify(res.body), /sk-bad-key/);
  });

  test("/api/ai/test verifies an OpenRouter key via its auth endpoint", async () => {
    const { agent } = await signUp();
    const calls = stubHttp((opts) => {
      assert.equal(opts.url, "https://openrouter.ai/api/v1/auth/key");
      assert.equal(opts.headers.Authorization, "Bearer sk-or-v1-entered-key-123456");
      return { data: { data: { label: "test" } } };
    });
    const res = await agent.post("/api/ai/test").set(H).send({ apiKey: "sk-or-v1-entered-key-123456" });
    assert.equal(res.status, 200);
    assert.equal(res.body.provider, "openrouter");
    assert.equal(calls.length, 1);
  });
});

describe("media uploads (local storage)", () => {
  const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"), Buffer.alloc(64)]);
  const tmp = path.join(os.tmpdir(), `sp-test-${process.pid}`);

  beforeEach(() => {
    fs.mkdirSync(tmp, { recursive: true });
    config.media.uploadDir = tmp;
  });

  test("accepts a real image and stores its URL", async () => {
    const { agent } = await signUp();
    const res = await agent.post("/api/media/upload").set(H).attach("file", PNG, "photo.png");
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.media.resourceType, "image");
    assert.equal(res.body.media.mimeType, "image/png");
    assert.match(res.body.media.url, /\/media\/[0-9a-f]{32}\.png$/);
    const file = res.body.media.url.split("/media/")[1];
    assert.ok(fs.existsSync(path.join(tmp, file)));
  });

  test("rejects files whose content is not an image or video", async () => {
    const { agent } = await signUp();
    const res = await agent.post("/api/media/upload").set(H).attach("file", Buffer.from("<?php echo 'hi'; ?> not an image at all"), "evil.png");
    assert.equal(res.status, 422);
  });

  test("enforces the size limit", async () => {
    const { agent } = await signUp();
    const original = config.media.maxImageBytes;
    config.media.maxImageBytes = 50;
    try {
      const res = await agent.post("/api/media/upload").set(H).attach("file", PNG, "big.png");
      assert.equal(res.status, 413);
    } finally {
      config.media.maxImageBytes = original;
    }
  });

  test("media a post still references cannot be deleted; unused media can", async () => {
    const { agent, user } = await signUp();
    const used = await addMedia(user.id);
    const post = await agent.post("/api/posts").set(H).send({ caption: "uses it", mediaId: used.id });
    assert.equal((await agent.delete(`/api/media/${used.id}`).set(H)).status, 409);

    // Published history keeps its media too, until the post itself is removed.
    await db.run("UPDATE posts SET status = 'published' WHERE id = ?", [post.body.post.id]);
    assert.equal((await agent.delete(`/api/media/${used.id}`).set(H)).status, 409);
    await agent.delete(`/api/posts/${post.body.post.id}`).set(H);
    assert.equal((await agent.delete(`/api/media/${used.id}`).set(H)).status, 200);

    const up = await agent.post("/api/media/upload").set(H).attach("file", PNG, "free.png");
    assert.equal((await agent.delete(`/api/media/${up.body.media.id}`).set(H)).status, 200);
  });

  test("users cannot attach someone else's media", async () => {
    const owner = await signUp();
    const other = await signUp();
    const media = await addMedia(owner.user.id);
    const res = await other.agent.post("/api/posts").set(H).send({ caption: "steal", mediaId: media.id });
    assert.equal(res.status, 422);
  });
});
