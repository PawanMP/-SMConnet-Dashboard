const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { H, agent, signUp, db } = require("./helpers");
const { hashPassword, verifyPassword } = require("../src/lib/password");

describe("password hashing", () => {
  test("hashes with scrypt and verifies only the right password", async () => {
    const hash = await hashPassword("Secret123");
    assert.match(hash, /^scrypt\$16384\$8\$1\$/);
    assert.ok(!hash.includes("Secret123"));
    assert.equal(await verifyPassword("Secret123", hash), true);
    assert.equal(await verifyPassword("secret123", hash), false);
    assert.notEqual(await hashPassword("Secret123"), hash, "salts differ");
  });
});

describe("registration", () => {
  test("first user becomes admin, later users are regular users", async () => {
    const first = await signUp();
    assert.equal(first.user.role, "admin");
    const second = await signUp();
    assert.equal(second.user.role, "user");
  });

  test("stores a password hash, never the password", async () => {
    const { user, creds } = await signUp();
    const row = await db.get("SELECT password_hash FROM users WHERE id = ?", [user.id]);
    assert.ok(row.password_hash.startsWith("scrypt$"));
    assert.ok(!row.password_hash.includes(creds.password));
  });

  test("rejects duplicate emails (case-insensitive)", async () => {
    const { creds } = await signUp();
    const res = await agent().post("/api/auth/register").set(H).send({ ...creds, email: creds.email.toUpperCase() });
    assert.equal(res.status, 409);
    assert.equal(res.body.success, false);
  });

  test("validates the email and a minimum password length of 8", async () => {
    const res = await agent().post("/api/auth/register").set(H).send({ name: "X", email: "not-an-email", password: "short" });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, "VALIDATION_ERROR");
    const fields = res.body.error.details.map((d) => d.field);
    assert.ok(fields.includes("email"));
    assert.ok(fields.includes("password"));
    assert.match(res.body.error.details.find((d) => d.field === "password").message, /at least 8 characters/);

    // Any 8+ character password is accepted; complexity is the user's choice.
    const simple = await agent().post("/api/auth/register").set(H).send({ name: "X", email: "simple@example.com", password: "mypassword" });
    assert.equal(simple.status, 201);
    const login = await agent().post("/api/auth/login").set(H).send({ email: "simple@example.com", password: "mypassword" });
    assert.equal(login.status, 200);
  });
});

describe("login and logout", () => {
  test("logs in with correct credentials and sets an httpOnly cookie", async () => {
    const { creds } = await signUp();
    const a = agent();
    const res = await a.post("/api/auth/login").set(H).send({ email: creds.email, password: creds.password });
    assert.equal(res.status, 200);
    const cookie = res.headers["set-cookie"].join(";");
    assert.match(cookie, /sp_session=/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    const me = await a.get("/api/auth/me");
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, creds.email);
  });

  test("rejects a wrong password with a generic message", async () => {
    const { creds } = await signUp();
    const wrong = await agent().post("/api/auth/login").set(H).send({ email: creds.email, password: "Wrong123!" });
    const unknown = await agent().post("/api/auth/login").set(H).send({ email: "nobody@example.com", password: "Wrong123!" });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.body.error.message, unknown.body.error.message);
  });

  test("records login activity", async () => {
    const { user, creds } = await signUp();
    await agent().post("/api/auth/login").set(H).send({ email: creds.email, password: creds.password });
    const row = await db.get("SELECT COUNT(*) AS n FROM activity_logs WHERE user_id = ? AND action = 'auth.login'", [user.id]);
    assert.equal(Number(row.n), 1);
  });

  test("logout clears the session", async () => {
    const { agent: a } = await signUp();
    assert.equal((await a.get("/api/auth/me")).status, 200);
    await a.post("/api/auth/logout").set(H);
    assert.equal((await a.get("/api/auth/me")).status, 401);
  });

  test("logout-all revokes sessions on other devices", async () => {
    const { agent: a, creds } = await signUp();
    const other = agent();
    await other.post("/api/auth/login").set(H).send({ email: creds.email, password: creds.password });
    assert.equal((await other.get("/api/auth/me")).status, 200);
    await a.post("/api/auth/logout-all").set(H);
    assert.equal((await other.get("/api/auth/me")).status, 401);
  });

  test("disabled accounts cannot sign in", async () => {
    const { user, creds } = await signUp();
    await db.run("UPDATE users SET is_active = 0 WHERE id = ?", [user.id]);
    const res = await agent().post("/api/auth/login").set(H).send({ email: creds.email, password: creds.password });
    assert.equal(res.status, 403);
  });
});

describe("protected routes", () => {
  test("API routes require authentication", async () => {
    for (const path of ["/api/posts", "/api/accounts", "/api/profile", "/api/analytics/summary", "/api/notifications", "/api/activity"]) {
      const res = await agent().get(path);
      assert.equal(res.status, 401, path);
      assert.equal(res.body.error.code, "UNAUTHORIZED");
    }
  });

  test("bearer tokens work for API clients", async () => {
    const { token } = await signUp();
    const res = await agent().get("/api/auth/me").set("Authorization", `Bearer ${token}`);
    assert.equal(res.status, 200);
  });

  test("tampered tokens are rejected", async () => {
    const { token } = await signUp();
    const res = await agent().get("/api/auth/me").set("Authorization", `Bearer ${token.slice(0, -2)}xx`);
    assert.equal(res.status, 401);
  });

  test("cookie sessions need the CSRF header for state-changing requests", async () => {
    const { agent: a } = await signUp();
    const blocked = await a.post("/api/posts").send({ caption: "hello" });
    assert.equal(blocked.status, 403);
    const allowed = await a.post("/api/posts").set(H).send({ caption: "hello" });
    assert.equal(allowed.status, 201);
  });
});

describe("profile management", () => {
  test("views and edits the profile", async () => {
    const { agent: a } = await signUp();
    const res = await a.put("/api/profile").set(H).send({ name: "New Name", timezone: "Asia/Colombo" });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.name, "New Name");
    const view = await a.get("/api/profile");
    assert.equal(view.body.user.timezone, "Asia/Colombo");
    assert.ok(view.body.settings);
  });

  test("rejects an unknown time zone and a taken email", async () => {
    const other = await signUp();
    const { agent: a } = await signUp();
    assert.equal((await a.put("/api/profile").set(H).send({ timezone: "Mars/Base" })).status, 422);
    assert.equal((await a.put("/api/profile").set(H).send({ email: other.creds.email })).status, 409);
  });

  test("changing the password requires the current one and signs out other sessions", async () => {
    const { agent: a, creds } = await signUp();
    const other = agent();
    await other.post("/api/auth/login").set(H).send({ email: creds.email, password: creds.password });

    const bad = await a.post("/api/profile/password").set(H).send({ currentPassword: "Nope1234", newPassword: "NewPassw0rd" });
    assert.equal(bad.status, 400);

    const ok = await a.post("/api/profile/password").set(H).send({ currentPassword: creds.password, newPassword: "NewPassw0rd" });
    assert.equal(ok.status, 200);
    assert.equal((await a.get("/api/auth/me")).status, 200, "current device keeps a fresh session");
    assert.equal((await other.get("/api/auth/me")).status, 401, "other device signed out");

    const relogin = await agent().post("/api/auth/login").set(H).send({ email: creds.email, password: "NewPassw0rd" });
    assert.equal(relogin.status, 200);
  });

  test("AI key is stored encrypted and never returned", async () => {
    const { agent: a, user } = await signUp();
    const res = await a.put("/api/profile/settings").set(H).send({ apiKey: "sk-test-1234567890abcdef", aiProvider: "openai" });
    assert.equal(res.status, 200);
    assert.equal(res.body.settings.hasPersonalApiKey, true);
    assert.ok(!JSON.stringify(res.body).includes("sk-test-1234567890abcdef"));
    const row = await db.get("SELECT ai_api_key_enc FROM user_settings WHERE user_id = ?", [user.id]);
    assert.ok(row.ai_api_key_enc.startsWith("v1:"));
    assert.ok(!row.ai_api_key_enc.includes("sk-test"));
  });
});
