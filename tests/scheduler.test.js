const { test, describe, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { H, agent, signUp, connect, fakePublish, resetStubs, db } = require("./helpers");
const scheduler = require("../src/services/scheduler");
const config = require("../src/config");
const time = require("../src/lib/time");
const { PlatformError } = require("../src/lib/errors");

const inMinutes = (m) => new Date(Date.now() + m * 60000).toISOString();

// Moves a post's scheduled targets into the past so the scheduler picks them up.
async function makeDue(postId, minutesAgo = 1) {
  await db.run("UPDATE post_targets SET scheduled_at = ? WHERE post_id = ? AND status = 'scheduled'", [
    time.toDb(new Date(Date.now() - minutesAgo * 60000)),
    postId,
  ]);
}

async function schedulePost(agentInstance, body) {
  const res = await agentInstance.post("/api/posts").set(H).send({ action: "schedule", ...body });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.post;
}

describe("scheduling", () => {
  beforeEach(() => resetStubs());

  test("schedules per platform and publishes when due", async () => {
    const { user, agent: a } = await signUp();
    await connect(user.id, "facebook");
    await connect(user.id, "instagram");
    const calls = fakePublish("facebook");
    const post = await schedulePost(a, {
      caption: "Later",
      platforms: ["facebook"],
      schedules: { facebook: inMinutes(30) },
    });
    assert.equal(post.status, "scheduled");
    assert.equal(post.targets[0].status, "scheduled");

    await scheduler.tick({ withMaintenance: false });
    assert.equal(calls.length, 0, "not due yet");

    await makeDue(post.id);
    const summary = await scheduler.tick({ withMaintenance: false });
    assert.equal(summary.published, 1);
    const after = await a.get(`/api/posts/${post.id}`);
    assert.equal(after.body.post.status, "published");
    assert.equal(after.body.post.attempts[0].trigger, "schedule");

    const notes = await a.get("/api/notifications");
    assert.ok(notes.body.items.some((n) => n.type === "schedule_completed"));

    await scheduler.tick({ withMaintenance: false });
    assert.equal(calls.length, 1, "never published twice");
  });

  test("rejects schedule times in the past", async () => {
    const { user, agent: a } = await signUp();
    await connect(user.id, "facebook");
    const res = await a.post("/api/posts").set(H).send({ caption: "x", platforms: ["facebook"], action: "schedule", scheduledAt: inMinutes(-5) });
    assert.equal(res.status, 422);
    assert.match(res.body.error.message, /future/);
  });

  test("edit, reschedule and cancel", async () => {
    const { user, agent: a } = await signUp();
    await connect(user.id, "facebook");
    const calls = fakePublish("facebook");
    const post = await schedulePost(a, { caption: "v1", platforms: ["facebook"], scheduledAt: inMinutes(60) });

    const edited = await a.put(`/api/posts/${post.id}`).set(H).send({ caption: "v2", platforms: ["facebook"], action: "schedule", scheduledAt: inMinutes(90) });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.post.caption, "v2");
    assert.equal(edited.body.post.status, "scheduled");

    const newTime = inMinutes(120);
    const moved = await a.patch(`/api/posts/${post.id}/schedule`).set(H).send({ scheduledAt: newTime });
    assert.equal(moved.status, 200);
    assert.equal(Date.parse(moved.body.post.targets[0].scheduledAt), Math.floor(Date.parse(newTime) / 1000) * 1000);

    const cancelled = await a.post(`/api/posts/${post.id}/cancel`).set(H);
    assert.equal(cancelled.body.post.status, "cancelled");

    await makeDue(post.id);
    await scheduler.tick({ withMaintenance: false });
    assert.equal(calls.length, 0, "cancelled posts are never published");
  });

  test("run now publishes immediately", async () => {
    const { user, agent: a } = await signUp();
    await connect(user.id, "facebook");
    const calls = fakePublish("facebook");
    const post = await schedulePost(a, { caption: "now please", platforms: ["facebook"], scheduledAt: inMinutes(600) });
    const res = await a.post(`/api/posts/${post.id}/run-now`).set(H);
    assert.equal(res.status, 200);
    assert.equal(res.body.post.status, "published");
    assert.equal(calls.length, 1);
    assert.equal((await a.post(`/api/posts/${post.id}/run-now`).set(H)).status, 409);
  });

  test("retries transient failures automatically, then gives up", async () => {
    const { user, agent: a } = await signUp();
    await connect(user.id, "facebook");
    fakePublish("facebook", () => new PlatformError("facebook", "Facebook: service unavailable", { retryable: true }));
    const post = await schedulePost(a, { caption: "flaky", platforms: ["facebook"], scheduledAt: inMinutes(5) });

    for (let attempt = 1; attempt <= config.scheduler.autoRetryLimit; attempt++) {
      await makeDue(post.id);
      const summary = await scheduler.tick({ withMaintenance: false });
      assert.equal(summary.retrying, 1);
      const t = (await a.get(`/api/posts/${post.id}`)).body.post.targets[0];
      assert.equal(t.status, "scheduled");
      assert.equal(t.attempts, attempt);
      assert.match(t.errorMessage, /service unavailable/);
    }
    await makeDue(post.id);
    await scheduler.tick({ withMaintenance: false });
    const final = (await a.get(`/api/posts/${post.id}`)).body.post;
    assert.equal(final.status, "failed");
    assert.equal(final.targets[0].attempts, config.scheduler.autoRetryLimit + 1);
  });

  test("recovers after a restart: stuck targets fail safely, missed ones are not posted late", async () => {
    const { user, agent: a } = await signUp();
    await connect(user.id, "facebook");
    const calls = fakePublish("facebook");

    const stuck = await schedulePost(a, { caption: "stuck", platforms: ["facebook"], scheduledAt: inMinutes(10) });
    await db.run("UPDATE post_targets SET status = 'processing', locked_at = ? WHERE post_id = ?", [time.toDb(new Date(Date.now() - 60 * 60000)), stuck.id]);

    const missed = await schedulePost(a, { caption: "missed", platforms: ["facebook"], scheduledAt: inMinutes(10) });
    await makeDue(missed.id, (config.scheduler.maxLatenessHours + 1) * 60);

    const overdue = await schedulePost(a, { caption: "slightly late", platforms: ["facebook"], scheduledAt: inMinutes(10) });
    await makeDue(overdue.id, 30);

    const summary = await scheduler.tick({ withMaintenance: false });
    assert.equal(summary.recovered, 1);

    const stuckAfter = (await a.get(`/api/posts/${stuck.id}`)).body.post;
    assert.equal(stuckAfter.targets[0].status, "failed");
    assert.equal(stuckAfter.targets[0].errorCode, "INTERRUPTED");

    const missedAfter = (await a.get(`/api/posts/${missed.id}`)).body.post;
    assert.equal(missedAfter.targets[0].errorCode, "MISSED_SCHEDULE");

    const overdueAfter = (await a.get(`/api/posts/${overdue.id}`)).body.post;
    assert.equal(overdueAfter.status, "published", "catches up on recent schedules");
    assert.equal(calls.length, 1);
  });

  test("calendar lists scheduled posts in range", async () => {
    const { user, agent: a } = await signUp();
    await connect(user.id, "facebook");
    await connect(user.id, "pinterest");
    const at = inMinutes(24 * 60);
    await schedulePost(a, { caption: "Calendar item", platforms: ["facebook"], scheduledAt: at });
    const from = new Date(Date.now() - 86400000).toISOString();
    const to = new Date(Date.now() + 3 * 86400000).toISOString();
    const res = await a.get(`/api/posts/calendar?from=${from}&to=${to}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.events.length, 1);
    assert.equal(res.body.events[0].title, "Calendar item");
    assert.deepEqual(res.body.events[0].targets.map((t) => t.platform), ["facebook"]);
  });
});

describe("cron endpoint", () => {
  test("requires the cron secret", async () => {
    const original = config.security.cronSecret;
    try {
      config.security.cronSecret = "";
      assert.equal((await agent().get("/api/cron/scheduler")).status, 503);
      config.security.cronSecret = "s3cret-value";
      assert.equal((await agent().get("/api/cron/scheduler")).status, 401);
      assert.equal((await agent().get("/api/cron/scheduler").set("Authorization", "Bearer wrong")).status, 401);
      const ok = await agent().get("/api/cron/scheduler").set("Authorization", "Bearer s3cret-value");
      assert.equal(ok.status, 200);
      assert.equal(ok.body.summary.source, "cron");
    } finally {
      config.security.cronSecret = original;
    }
  });
});
