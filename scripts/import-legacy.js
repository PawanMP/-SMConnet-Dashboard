// One-time import of the old single-user config.json into a user account.
//   node scripts/import-legacy.js you@example.com [path/to/config.json]
//
// Social tokens are encrypted and attached to that user; the OpenAI key
// becomes the user's personal AI key. Nothing is sent to the platforms, so
// open Connected accounts afterwards and use "Test connection" on each one.
// After importing, delete config.json and rotate every token it contained.
require("dotenv").config({ quiet: true });
const fs = require("fs");
const path = require("path");
const db = require("../src/db");
const users = require("../src/models/users");
const accounts = require("../src/models/accounts");
const settings = require("../src/models/settings");

(async () => {
  const [email, file = path.join(__dirname, "..", "config.json")] = process.argv.slice(2);
  if (!email) {
    console.error("Usage: node scripts/import-legacy.js <user-email> [config.json]");
    process.exit(1);
  }
  const legacy = JSON.parse(fs.readFileSync(file, "utf8"));
  await db.ready();
  const user = await users.findByEmail(email);
  if (!user) throw new Error(`No user with email ${email}. Register first, then import.`);

  const imported = [];
  const add = async (platform, data) => {
    await accounts.upsertConnection(user.id, platform, { name: `Imported ${platform} account`, ...data });
    imported.push(platform);
  };

  if (legacy.pageId && legacy.accessToken) {
    await add("facebook", { externalId: legacy.pageId, accessToken: legacy.accessToken, metadata: { selectedPageId: legacy.pageId, pages: [] } });
  }
  if (legacy.igAccountId && legacy.igAccessToken) {
    const apiHost = /^EAA/.test(legacy.igAccessToken) ? "facebook" : "instagram";
    await add("instagram", { externalId: legacy.igAccountId, accessToken: legacy.igAccessToken, metadata: { apiHost } });
  }
  if (legacy.ytAccessToken) {
    // Old YouTube tokens were short-lived access tokens without a refresh
    // token; import them as expired so the UI asks for a proper reconnect.
    await add("youtube", { externalId: legacy.ytChannelId || null, accessToken: legacy.ytAccessToken, expiresAt: new Date(Date.now() - 1000) });
  }
  if (legacy.tkAccessToken) await add("tiktok", { accessToken: legacy.tkAccessToken });
  if (legacy.pinAccessToken) {
    await add("pinterest", { accessToken: legacy.pinAccessToken, metadata: legacy.pinBoardId ? { selectedBoardId: legacy.pinBoardId, selectedBoardName: legacy.pinBoardId } : {} });
  }
  if (legacy.openaiApiKey) {
    await settings.update(user.id, { apiKey: legacy.openaiApiKey, aiModel: legacy.openaiModel || null });
    imported.push("AI key");
  }

  await db.close();
  console.log(`Imported for ${email}: ${imported.join(", ") || "nothing"}.`);
  console.log("Next: open Connected accounts and choose Test connection for each platform.");
  console.log("Then delete config.json and rotate the tokens it contained (it was committed to git).");
})().catch((err) => {
  console.error("Import failed:", err.message);
  process.exit(1);
});
