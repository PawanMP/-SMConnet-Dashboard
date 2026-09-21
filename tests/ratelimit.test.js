// Rate limiting is off in the other suites; this file turns it on.
process.env.RATE_LIMIT_ENABLED = "true";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { H, agent } = require("./helpers");

test("sign-in attempts are rate limited", async () => {
  const statuses = [];
  for (let i = 0; i < 12; i++) {
    const res = await agent().post("/api/auth/login").set(H).send({ email: "nobody@example.com", password: "Wrong123" });
    statuses.push(res.status);
  }
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(401));
  assert.equal(statuses[10], 429);
  const last = await agent().post("/api/auth/login").set(H).send({ email: "nobody@example.com", password: "Wrong123" });
  assert.equal(last.body.error.code, "RATE_LIMITED");
});
