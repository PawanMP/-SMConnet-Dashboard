const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const { signUp, connect, addMedia, db, H } = require("./helpers");
const { migrate, migrations, render } = require("../src/db/migrations");
const accountsModel = require("../src/models/accounts");

describe("database", () => {
  test("migrations are recorded and safe to run again", async () => {
    await db.ready();
    const driver = { dialect: db.dialect, all: db.all, run: db.run, exec: db.exec, get: db.get };
    await migrate(driver);
    const rows = await db.all("SELECT version FROM schema_migrations");
    assert.equal(rows.length, migrations.length);
  });

  test("schema renders for both MySQL and SQLite", () => {
    for (const m of migrations) {
      for (const s of m.statements) {
        const mysql = render(s, "mysql");
        const sqlite = render(s, "sqlite");
        assert.ok(!/\{\{/.test(mysql) && !/\{\{/.test(sqlite));
        if (/CREATE TABLE/.test(s)) {
          assert.match(mysql, /InnoDB/);
          assert.doesNotMatch(sqlite, /InnoDB|AUTO_INCREMENT/);
        }
      }
    }
  });

  test("social tokens are encrypted at rest", async () => {
    const { user } = await signUp();
    const account = await connect(user.id, "facebook", { accessToken: "EAAplain-secret-token" });
    const row = await db.get("SELECT access_token_enc FROM social_accounts WHERE id = ?", [account.id]);
    assert.ok(!row.access_token_enc.includes("EAAplain"));
    assert.equal(accountsModel.tokens(account).accessToken, "EAAplain-secret-token");
  });

  test("one account per platform per user", async () => {
    const { user } = await signUp();
    await connect(user.id, "tiktok", { name: "first" });
    await connect(user.id, "tiktok", { name: "second" });
    const rows = await db.all("SELECT * FROM social_accounts WHERE user_id = ? AND platform = 'tiktok'", [user.id]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].account_name, "second");
  });

  test("connections belong to the right user", async () => {
    const a = await signUp();
    const b = await signUp();
    await connect(a.user.id, "youtube", { name: "A channel" });
    const listA = await a.agent.get("/api/accounts");
    const listB = await b.agent.get("/api/accounts");
    assert.equal(listA.body.accounts.find((x) => x.platform === "youtube").status, "connected");
    assert.equal(listB.body.accounts.find((x) => x.platform === "youtube").status, "not_connected");
  });

  test("deleting a user cascades to their data but keeps the audit log", async () => {
    const { user, agent } = await signUp();
    await connect(user.id, "facebook");
    const media = await addMedia(user.id);
    await agent.post("/api/posts").set(H).send({ caption: "bye", mediaId: media.id });
    await db.run("DELETE FROM users WHERE id = ?", [user.id]);
    for (const table of ["posts", "social_accounts", "media", "notifications"]) {
      const row = await db.get(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`, [user.id]);
      assert.equal(Number(row.n), 0, table);
    }
    const orphaned = await db.get("SELECT COUNT(*) AS n FROM activity_logs WHERE user_id IS NULL AND action = 'auth.register'");
    assert.ok(Number(orphaned.n) >= 1);
  });

  test("deleting media keeps the post and clears the reference", async () => {
    const { user, agent } = await signUp();
    const media = await addMedia(user.id);
    const res = await agent.post("/api/posts").set(H).send({ caption: "with media", mediaId: media.id });
    await db.run("DELETE FROM media WHERE id = ?", [media.id]);
    const post = await db.get("SELECT media_id FROM posts WHERE id = ?", [res.body.post.id]);
    assert.equal(post.media_id, null);
  });
});
