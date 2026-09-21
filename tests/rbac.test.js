const { test, describe, before } = require("node:test");
const assert = require("node:assert/strict");
const { H, agent, signUp } = require("./helpers");

describe("role-based access control", () => {
  let admin;
  let member;
  before(async () => {
    admin = await signUp();
    member = await signUp();
  });

  test("regular users cannot reach admin functions", async () => {
    for (const [method, path] of [
      ["get", "/api/admin/users"],
      ["get", "/api/admin/stats"],
      ["get", "/api/admin/activity"],
      ["post", "/api/admin/maintenance/scheduler"],
    ]) {
      const res = await member.agent[method](path).set(H);
      assert.equal(res.status, 403, path);
      assert.equal(res.body.error.code, "FORBIDDEN");
    }
  });

  test("admins can list users and see system stats", async () => {
    const list = await admin.agent.get("/api/admin/users");
    assert.equal(list.status, 200);
    assert.ok(list.body.total >= 2);
    const stats = await admin.agent.get("/api/admin/stats");
    assert.equal(stats.status, 200);
    assert.ok(stats.body.users.total >= 2);
    assert.ok(stats.body.totals);
  });

  test("admins can create users", async () => {
    const res = await admin.agent.post("/api/admin/users").set(H).send({ name: "Made", email: "made@example.com", password: "Passw0rd1", role: "user" });
    assert.equal(res.status, 201);
    const login = await agent().post("/api/auth/login").set(H).send({ email: "made@example.com", password: "Passw0rd1" });
    assert.equal(login.status, 200);
  });

  test("promoting a user takes effect and revokes their old sessions", async () => {
    const target = await signUp();
    const res = await admin.agent.patch(`/api/admin/users/${target.user.id}`).set(H).send({ role: "admin" });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, "admin");
    assert.equal((await target.agent.get("/api/auth/me")).status, 401, "old session revoked after role change");
  });

  test("deactivating a user blocks them immediately", async () => {
    const target = await signUp();
    await admin.agent.patch(`/api/admin/users/${target.user.id}`).set(H).send({ isActive: false });
    assert.equal((await target.agent.get("/api/auth/me")).status, 401);
  });

  test("the last active admin cannot be demoted or deleted", async () => {
    // Demote every other admin first so `admin` is the last one.
    const list = await admin.agent.get("/api/admin/users?role=admin&pageSize=100");
    for (const u of list.body.items) {
      if (u.id !== admin.user.id) await admin.agent.patch(`/api/admin/users/${u.id}`).set(H).send({ role: "user" });
    }
    const demote = await admin.agent.patch(`/api/admin/users/${admin.user.id}`).set(H).send({ role: "user" });
    assert.equal(demote.status, 409);
    const self = await admin.agent.delete(`/api/admin/users/${admin.user.id}`).set(H);
    assert.equal(self.status, 409);
  });

  test("admins can delete other users", async () => {
    const target = await signUp();
    const res = await admin.agent.delete(`/api/admin/users/${target.user.id}`).set(H);
    assert.equal(res.status, 200);
    assert.equal((await admin.agent.get(`/api/admin/users/${target.user.id}`)).status, 404);
  });

  test("users only see their own posts", async () => {
    const created = await member.agent.post("/api/posts").set(H).send({ caption: "private" });
    const id = created.body.post.id;
    const other = await signUp();
    assert.equal((await other.agent.get(`/api/posts/${id}`)).status, 404);
    assert.equal((await other.agent.delete(`/api/posts/${id}`).set(H)).status, 404);
    const list = await other.agent.get("/api/posts");
    assert.equal(list.body.total, 0);
  });
});
