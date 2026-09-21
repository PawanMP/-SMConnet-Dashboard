// Timestamps must survive a database round trip unchanged in any server time zone.
process.env.TZ = "Asia/Colombo";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { H, signUp, connect, fakePublish, db } = require("./helpers");
const time = require("../src/lib/time");

test("toDb/fromDb round-trip without shifting", () => {
  const iso = "2026-09-19T14:30:00.000Z";
  const stored = time.toDb(iso);
  assert.equal(stored, "2026-09-19 14:30:00");
  assert.equal(time.toDb(stored), stored, "already-stored values pass through unchanged");
  assert.equal(time.fromDb(stored), iso);
  assert.equal(time.toDb(new Date(iso)), stored);
});

test("post-level scheduled and published times match their platforms", async () => {
  const { user, agent } = await signUp();
  await connect(user.id, "facebook");
  fakePublish("facebook");
  const at = new Date(Date.now() + 3 * 3600000);
  at.setUTCSeconds(0, 0);
  const scheduled = await agent.post("/api/posts").set(H).send({ caption: "tz", platforms: ["facebook"], action: "schedule", scheduledAt: at.toISOString() });
  assert.equal(scheduled.body.post.scheduledAt, at.toISOString());
  assert.equal(scheduled.body.post.targets[0].scheduledAt, at.toISOString());

  const published = await agent.post("/api/posts").set(H).send({ caption: "tz2", platforms: ["facebook"], action: "publish" });
  const post = published.body.post;
  assert.equal(post.publishedAt, post.targets[0].publishedAt);
  const row = await db.get("SELECT published_at FROM posts WHERE id = ?", [post.id]);
  assert.ok(Math.abs(time.toMs(row.published_at) - Date.now()) < 60000, "stored as current UTC time");
});
