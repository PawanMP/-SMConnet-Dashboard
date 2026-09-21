// Shared test setup. Each test file runs in its own process with a fresh
// in-memory SQLite database, so files never interfere with each other.
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = process.env.LOG_LEVEL || "silent";

// Optional: run the suite against MySQL/MariaDB instead of SQLite, e.g.
//   TEST_MYSQL_URL=mysql://root:pass@127.0.0.1:3306 npm test
// Each test file gets its own throwaway database.
if (process.env.TEST_MYSQL_URL) {
  const name = `sp_test_${process.pid}`;
  require("child_process").execFileSync(
    process.execPath,
    [
      "-e",
      `require("mysql2/promise").createConnection(process.env.TEST_MYSQL_URL).then(async (c) => {
        await c.query("DROP DATABASE IF EXISTS ${name}");
        await c.query("CREATE DATABASE ${name} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
        await c.end();
      })`,
    ],
    { env: process.env, cwd: require("path").join(__dirname, "..") }
  );
  process.env.DB_CLIENT = "mysql";
  process.env.DATABASE_URL = `${process.env.TEST_MYSQL_URL.replace(/\/+$/, "")}/${name}`;
}

const request = require("supertest");
const { createApp } = require("../src/app");
const db = require("../src/db");
const accountsModel = require("../src/models/accounts");
const mediaModel = require("../src/models/media");
const platforms = require("../src/services/platforms");
const http = require("../src/lib/http");
const { timing } = require("../src/services/platforms/common");

// Polling waits are skipped in tests.
timing.sleep = async () => {};
// Close the database when a file finishes so MySQL pools don't keep it alive.
require("node:test").after(() => db.close());
const originalRequest = http.request;

const H = { "X-Requested-With": "fetch" };
let app;
let counter = 0;

function getApp() {
  if (!app) app = createApp();
  return app;
}

function agent() {
  return request.agent(getApp());
}

async function signUp(overrides = {}) {
  counter++;
  const a = agent();
  const creds = { name: `User ${counter}`, email: `user${counter}@example.com`, password: "Passw0rd!x", ...overrides };
  const res = await a.post("/api/auth/register").set(H).send(creds);
  if (res.status !== 201) throw new Error(`sign-up failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent: a, user: res.body.user, token: res.body.token, creds };
}

function connect(userId, platform, extra = {}) {
  return accountsModel.upsertConnection(userId, platform, {
    accessToken: `${platform}-access-token`,
    refreshToken: `${platform}-refresh-token`,
    externalId: `${platform}-id`,
    name: `${platform} account`,
    username: `${platform}user`,
    metadata: platform === "pinterest" ? { selectedBoardId: "board-1", selectedBoardName: "Ideas", boards: [{ id: "board-1", name: "Ideas" }] } : {},
    ...extra,
  });
}

function addMedia(userId, type = "image") {
  return mediaModel.create(userId, {
    provider: "cloudinary",
    storageKey: `social-poster/u${userId}/file${++counter}`,
    url: `https://res.cloudinary.com/demo/${type}/upload/v1/file${counter}.${type === "video" ? "mp4" : "jpg"}`,
    resourceType: type,
    mimeType: type === "video" ? "video/mp4" : "image/jpeg",
    format: type === "video" ? "mp4" : "jpg",
    sizeBytes: 1024,
  });
}

// Replaces platform publishing with a scripted fake and records the calls.
function fakePublish(platform, behaviour) {
  const calls = [];
  platforms.override(platform, {
    publish: async (args) => {
      calls.push(args);
      const outcome = typeof behaviour === "function" ? behaviour(calls.length, args) : behaviour;
      if (outcome instanceof Error) throw outcome;
      return outcome || { platformPostId: `${platform}-post-${calls.length}`, url: `https://example.com/${platform}/${calls.length}` };
    },
  });
  return calls;
}

// Routes outbound HTTP to a handler: (options) => response | throws.
function stubHttp(handler) {
  const calls = [];
  http.request = async (options) => {
    calls.push(options);
    const res = await handler(options, calls.length);
    return { status: 200, headers: {}, ...res };
  };
  return calls;
}

function httpError(status, data) {
  const err = new Error(`Request failed with status code ${status}`);
  err.response = { status, data };
  return err;
}

function resetStubs() {
  platforms.reset();
  http.request = originalRequest;
}

module.exports = { H, agent, getApp, signUp, connect, addMedia, fakePublish, stubHttp, httpError, resetStubs, db };
