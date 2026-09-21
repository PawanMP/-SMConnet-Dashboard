const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { H, signUp, addMedia, stubHttp, httpError, resetStubs } = require("./helpers");
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

  test("media used by a draft cannot be deleted; unused media can", async () => {
    const { agent, user } = await signUp();
    const used = await addMedia(user.id);
    await agent.post("/api/posts").set(H).send({ caption: "uses it", mediaId: used.id });
    assert.equal((await agent.delete(`/api/media/${used.id}`).set(H)).status, 409);

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
