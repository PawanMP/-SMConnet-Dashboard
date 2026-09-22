const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { H, signUp, connect, addMedia, fakePublish, resetStubs, db } = require("./helpers");
const { PlatformError } = require("../src/lib/errors");

describe("multi-platform publishing", () => {
  beforeEach(() => resetStubs());

  test("publishes to every selected platform", async () => {
    const { user, agent } = await signUp();
    await connect(user.id, "facebook");
    await connect(user.id, "instagram");
    const media = await addMedia(user.id);
    const fb = fakePublish("facebook");
    const ig = fakePublish("instagram");

    const res = await agent
      .post("/api/posts")
      .set(H)
      .send({ caption: "Launch day", hashtags: "launch news", mediaId: media.id, platforms: ["facebook", "instagram"], action: "publish" });
    assert.equal(res.status, 201);
    assert.equal(res.body.post.status, "published");
    assert.equal(fb.length, 1);
    assert.equal(ig.length, 1);
    assert.equal(fb[0].content.text, "Launch day\n\n#launch #news");
    const targets = res.body.post.targets;
    assert.deepEqual(targets.map((t) => t.status), ["success", "success"]);
    assert.ok(targets.every((t) => t.platformPostId && t.publishedAt && t.attempts === 1));
  });

  test("uses platform-specific content when provided", async () => {
    const { user, agent } = await signUp();
    await connect(user.id, "facebook");
    const calls = fakePublish("facebook");
    await agent
      .post("/api/posts")
      .set(H)
      .send({ caption: "Shared", platforms: ["facebook"], platformContent: { facebook: { caption: "Facebook only" } }, action: "publish" });
    assert.equal(calls[0].content.text, "Facebook only");
  });

  test("records partial success when one platform fails", async () => {
    const { user, agent } = await signUp();
    await connect(user.id, "facebook");
    await connect(user.id, "instagram");
    const media = await addMedia(user.id);
    fakePublish("facebook");
    fakePublish("instagram", new PlatformError("instagram", "Instagram: media rejected", { code: "BAD_MEDIA" }));

    const res = await agent.post("/api/posts").set(H).send({ caption: "Hi", mediaId: media.id, platforms: ["facebook", "instagram"], action: "publish" });
    assert.equal(res.status, 201);
    assert.equal(res.body.post.status, "partial");
    const byPlatform = Object.fromEntries(res.body.post.targets.map((t) => [t.platform, t]));
    assert.equal(byPlatform.facebook.status, "success");
    assert.equal(byPlatform.instagram.status, "failed");
    assert.equal(byPlatform.instagram.errorMessage, "Instagram: media rejected");
    assert.equal(byPlatform.instagram.errorCode, "BAD_MEDIA");
    assert.equal(res.body.results.find((r) => r.platform === "instagram").success, false);

    const notes = await agent.get("/api/notifications");
    assert.ok(notes.body.items.some((n) => n.type === "publish_failed" && /Partly published/.test(n.title)));
  });

  test("retry republishes only failed platforms and counts attempts", async () => {
    const { user, agent } = await signUp();
    await connect(user.id, "facebook");
    await connect(user.id, "pinterest");
    const media = await addMedia(user.id);
    const fb = fakePublish("facebook");
    const pin = fakePublish("pinterest", (n) => (n === 1 ? new PlatformError("pinterest", "Pinterest: timeout", { retryable: true }) : undefined));

    const created = await agent.post("/api/posts").set(H).send({ caption: "Pin me", mediaId: media.id, platforms: ["facebook", "pinterest"], action: "publish" });
    const id = created.body.post.id;
    assert.equal(created.body.post.status, "partial");

    const retry = await agent.post(`/api/posts/${id}/retry`).set(H).send({});
    assert.equal(retry.status, 200);
    assert.equal(retry.body.post.status, "published");
    assert.equal(fb.length, 1, "Facebook was not republished");
    assert.equal(pin.length, 2);
    const pinTarget = retry.body.post.targets.find((t) => t.platform === "pinterest");
    assert.equal(pinTarget.attempts, 2);
    assert.equal(pinTarget.errorMessage, null);

    const attempts = retry.body.post.attempts.filter((a) => a.platform === "pinterest");
    assert.deepEqual(attempts.map((a) => a.status).sort(), ["failed", "success"]);
    assert.ok(attempts.some((a) => a.trigger === "retry"));

    const again = await agent.post(`/api/posts/${id}/retry`).set(H).send({});
    assert.equal(again.status, 409, "nothing left to retry");
  });

  test("stores the latest error and stops at the retry limit", async () => {
    const { user, agent } = await signUp();
    await connect(user.id, "facebook");
    fakePublish("facebook", (n) => new PlatformError("facebook", `Facebook: failure ${n}`));
    const created = await agent.post("/api/posts").set(H).send({ caption: "x", platforms: ["facebook"], action: "publish" });
    const id = created.body.post.id;
    assert.equal(created.body.post.status, "failed");
    for (let i = 2; i <= 5; i++) {
      const r = await agent.post(`/api/posts/${id}/retry`).set(H).send({});
      assert.equal(r.body.post.targets[0].errorMessage, `Facebook: failure ${i}`);
    }
    const limit = await agent.post(`/api/posts/${id}/retry`).set(H).send({});
    assert.equal(limit.status, 409);
    assert.equal(limit.body.error.code, "RETRY_LIMIT_REACHED");
  });

  test("never stores a token inside a failure message", async () => {
    const { user, agent } = await signUp();
    await connect(user.id, "facebook");
    const secret = "EAABwzLixnjYBO1ZAZCgHtq9ZBkZDsecret";
    fakePublish("facebook", new PlatformError("facebook", `Facebook: Error validating access token ${secret}`));
    const created = await agent.post("/api/posts").set(H).send({ caption: "x", platforms: ["facebook"], action: "publish" });

    const target = await db.get("SELECT error_message FROM post_targets WHERE post_id = ?", [created.body.post.id]);
    const attempt = await db.get("SELECT error_message FROM publish_attempts WHERE post_id = ?", [created.body.post.id]);
    const log = await db.get("SELECT details FROM activity_logs WHERE user_id = ? AND action = 'post.publish'", [user.id]);
    for (const stored of [target.error_message, attempt.error_message, log.details, JSON.stringify(created.body)]) {
      assert.ok(!String(stored).includes(secret), `token leaked: ${stored}`);
    }
    assert.match(target.error_message, /Error validating access token \[redacted\]/);
  });

  test("blocks publishing when accounts are missing or content does not fit", async () => {
    const { user, agent } = await signUp();
    await connect(user.id, "youtube");
    const image = await addMedia(user.id, "image");
    const res = await agent.post("/api/posts").set(H).send({ caption: "x", mediaId: image.id, platforms: ["youtube", "tiktok"], action: "publish" });
    assert.equal(res.status, 422);
    const messages = res.body.error.details.map((d) => d.message).join(" | ");
    assert.match(messages, /YouTube only accepts video/);
    assert.match(messages, /TikTok is not connected/);
    const count = await db.get("SELECT COUNT(*) AS n FROM posts WHERE user_id = ?", [user.id]);
    assert.equal(Number(count.n), 0, "nothing saved when validation fails");
  });

  test("marks the account expired when the platform rejects the token", async () => {
    const { user, agent } = await signUp();
    await connect(user.id, "facebook");
    fakePublish("facebook", new PlatformError("facebook", "Facebook: Session has expired", { auth: true, code: "TOKEN_INVALID" }));
    await agent.post("/api/posts").set(H).send({ caption: "x", platforms: ["facebook"], action: "publish" });
    const accounts = await agent.get("/api/accounts");
    assert.equal(accounts.body.accounts.find((a) => a.platform === "facebook").status, "expired");
    const notes = await agent.get("/api/notifications");
    assert.ok(notes.body.items.some((n) => n.type === "connection_problem"));
  });
});

describe("drafts", () => {
  beforeEach(() => resetStubs());

  test("save, edit, duplicate, publish and delete a draft", async () => {
    const { user, agent } = await signUp();
    await connect(user.id, "facebook");
    const calls = fakePublish("facebook");

    const created = await agent.post("/api/posts").set(H).send({ title: "Idea", caption: "First draft", platforms: ["facebook"] });
    assert.equal(created.status, 201);
    assert.equal(created.body.post.status, "draft");
    const id = created.body.post.id;

    const edited = await agent.put(`/api/posts/${id}`).set(H).send({ title: "Idea", caption: "Second draft", platforms: ["facebook"] });
    assert.equal(edited.body.post.caption, "Second draft");
    assert.equal(edited.body.post.status, "draft");

    const copy = await agent.post(`/api/posts/${id}/duplicate`).set(H);
    assert.equal(copy.status, 201);
    assert.equal(copy.body.post.status, "draft");
    assert.equal(copy.body.post.title, "Idea (copy)");
    assert.notEqual(copy.body.post.id, id);

    const published = await agent.post(`/api/posts/${id}/publish`).set(H).send({ action: "publish" });
    assert.equal(published.status, 200);
    assert.equal(published.body.post.status, "published");
    assert.equal(calls[0].content.text, "Second draft");

    const editPublished = await agent.put(`/api/posts/${id}`).set(H).send({ caption: "nope" });
    assert.equal(editPublished.status, 409, "published posts are read-only");

    assert.equal((await agent.delete(`/api/posts/${copy.body.post.id}`).set(H)).status, 200);
    assert.equal((await agent.get(`/api/posts/${copy.body.post.id}`)).status, 404);
  });

  test("an empty draft is rejected", async () => {
    const { agent } = await signUp();
    const res = await agent.post("/api/posts").set(H).send({ platforms: ["facebook"] });
    assert.equal(res.status, 422);
  });
});

describe("post history", () => {
  beforeEach(() => resetStubs());

  test("search, filter and paginate", async () => {
    const { user, agent } = await signUp();
    await connect(user.id, "facebook");
    fakePublish("facebook");
    for (let i = 1; i <= 7; i++) {
      await agent.post("/api/posts").set(H).send({ caption: `Summer sale ${i}`, platforms: ["facebook"], action: i % 2 ? "publish" : "draft" });
    }
    await agent.post("/api/posts").set(H).send({ caption: "Winter news", platforms: ["instagram"] });

    const page1 = await agent.get("/api/posts?pageSize=3&page=1");
    assert.equal(page1.body.total, 8);
    assert.equal(page1.body.items.length, 3);
    assert.equal(page1.body.totalPages, 3);

    const search = await agent.get("/api/posts?q=winter");
    assert.equal(search.body.total, 1);

    const published = await agent.get("/api/posts?status=published");
    assert.equal(published.body.total, 4);
    assert.ok(published.body.items.every((p) => p.targets.length === 1));

    const insta = await agent.get("/api/posts?platform=instagram");
    assert.equal(insta.body.total, 1);

    const future = await agent.get(`/api/posts?from=${encodeURIComponent(new Date(Date.now() + 86400000).toISOString())}`);
    assert.equal(future.body.total, 0);

    const bad = await agent.get("/api/posts?status=bogus");
    assert.equal(bad.status, 422);
  });

  test("analytics summarise outcomes", async () => {
    const { user, agent } = await signUp();
    await connect(user.id, "facebook");
    await connect(user.id, "tiktok");
    const video = await addMedia(user.id, "video");
    fakePublish("facebook");
    fakePublish("tiktok", new PlatformError("tiktok", "TikTok: nope"));
    await agent.post("/api/posts").set(H).send({ caption: "a", mediaId: video.id, platforms: ["facebook", "tiktok"], action: "publish" });
    await agent.post("/api/posts").set(H).send({ caption: "b", platforms: ["facebook"], action: "publish" });

    // The dashboard overview counts everything, with no date range.
    const overview = await agent.get("/api/analytics/overview");
    assert.equal(overview.status, 200);
    assert.equal(overview.body.totals.published, 1);
    assert.equal(overview.body.totals.partial, 1);
    assert.equal(overview.body.totals.platformPublishes, 2);
    assert.equal(overview.body.totals.platformFailures, 1);
    assert.equal(overview.body.totals.successRate, 66.7);
    assert.equal(overview.body.totals.connectedAccounts, 2);

    const res = await agent.get("/api/analytics/summary");
    assert.equal(res.status, 200);
    assert.equal(res.body.totals.posts, 2);
    assert.equal(res.body.totals.published, 1);
    assert.equal(res.body.totals.partial, 1);
    assert.equal(res.body.totals.connectedAccounts, 2);
    assert.equal(res.body.totals.platformPublishes, 2);
    assert.equal(res.body.totals.platformFailures, 1);
    assert.equal(res.body.totals.successRate, 66.7);
    const fb = res.body.platforms.find((p) => p.platform === "facebook");
    assert.equal(fb.success, 2);
    const today = new Date().toISOString().slice(0, 10);
    const day = res.body.timeline.find((d) => d.date === today);
    assert.deepEqual({ success: day.success, failed: day.failed }, { success: 2, failed: 1 });
  });
});
