const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { H, agent, signUp } = require("./helpers");
const config = require("../src/config");
const postsModel = require("../src/models/posts");
const { toPlatformError, PlatformError } = require("../src/lib/errors");
const { httpError } = require("./helpers");

describe("central error handling", () => {
  test("unknown API routes return a JSON 404", async () => {
    const res = await agent().get("/api/does-not-exist");
    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error.code, "NOT_FOUND");
    assert.ok(res.body.error.requestId);
  });

  test("malformed JSON is a 400, not a crash", async () => {
    const res = await agent().post("/api/auth/login").set(H).set("Content-Type", "application/json").send("{bad json");
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "INVALID_JSON");
  });

  test("validation errors list every field", async () => {
    const { agent: a } = await signUp();
    const res = await a.post("/api/posts").set(H).send({ caption: 42, platforms: ["myspace"], action: "launch" });
    assert.equal(res.status, 422);
    const fields = res.body.error.details.map((d) => d.field);
    assert.ok(fields.includes("caption"));
    assert.ok(fields.some((f) => f.startsWith("platforms")));
    assert.ok(fields.includes("action"));
  });

  test("unexpected fields are rejected", async () => {
    const { agent: a } = await signUp();
    const res = await a.post("/api/posts").set(H).send({ caption: "x", userId: 999 });
    assert.equal(res.status, 422);
  });

  test("production responses hide internal error details", async () => {
    const { agent: a } = await signUp();
    const originalList = postsModel.list;
    const originalProd = config.isProd;
    postsModel.list = async () => {
      throw new Error("ER_NO_SUCH_TABLE: secret internal detail at /srv/app/db.js");
    };
    try {
      config.isProd = true;
      const prod = await a.get("/api/posts");
      assert.equal(prod.status, 500);
      assert.equal(prod.body.error.code, "INTERNAL_ERROR");
      assert.doesNotMatch(JSON.stringify(prod.body), /secret internal detail|db\.js|ER_NO_SUCH/);

      config.isProd = false;
      const dev = await a.get("/api/posts");
      assert.match(dev.body.error.message, /secret internal detail/, "development keeps the detail for debugging");
    } finally {
      postsModel.list = originalList;
      config.isProd = originalProd;
    }
  });

  test("secure headers are set", async () => {
    const res = await agent().get("/api/health");
    assert.match(res.headers["content-security-policy"], /default-src 'self'/);
    assert.match(res.headers["content-security-policy"], /script-src 'self'/);
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(res.headers["x-frame-options"], "SAMEORIGIN");
    assert.equal(res.headers["x-powered-by"], undefined);
  });

  test("CORS is closed to unknown origins", async () => {
    const res = await agent().get("/api/health").set("Origin", "https://evil.example");
    assert.equal(res.headers["access-control-allow-origin"], undefined);
  });
});

describe("social API error normalisation", () => {
  test("expired Meta tokens are auth errors", () => {
    const err = toPlatformError("facebook", httpError(400, { error: { message: "Error validating access token: Session has expired", code: 190 } }));
    assert.ok(err instanceof PlatformError);
    assert.equal(err.auth, true);
    assert.equal(err.code, "TOKEN_INVALID");
    assert.match(err.message, /^Facebook: Error validating access token/);
  });

  test("rate limits and server errors are retryable", () => {
    assert.equal(toPlatformError("youtube", httpError(429, { error: { message: "quota" } })).retryable, true);
    assert.equal(toPlatformError("tiktok", httpError(503, {})).retryable, true);
    const net = new Error("socket hang up");
    net.code = "ECONNRESET";
    assert.equal(toPlatformError("pinterest", net).code, "NETWORK_ERROR");
  });

  test("ordinary rejections are neither auth nor retryable", () => {
    const err = toPlatformError("instagram", httpError(400, { error: { message: "Invalid image aspect ratio" } }));
    assert.equal(err.auth, false);
    assert.equal(err.retryable, false);
    assert.equal(err.message, "Instagram: Invalid image aspect ratio");
  });
});
