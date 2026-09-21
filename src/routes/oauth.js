// OAuth provider callbacks. These are browser redirects, so results are
// reported by redirecting back to the Accounts page rather than as JSON.
const express = require("express");
const oauth = require("../services/oauth");
const logger = require("../lib/logger");
const { PLATFORMS } = require("../lib/validate");

const router = express.Router();

router.get("/:platform/callback", async (req, res) => {
  const { platform } = req.params;
  if (!PLATFORMS.includes(platform)) return res.redirect("/accounts.html?error=" + encodeURIComponent("Unknown platform."));
  if (!req.user) {
    return res.redirect("/login.html?next=" + encodeURIComponent("/accounts.html") + "&error=" + encodeURIComponent("Please sign in, then connect the account again."));
  }
  try {
    await oauth.complete(req, platform, req.query);
    res.redirect(`/accounts.html?connected=${platform}`);
  } catch (err) {
    logger.warn("OAuth callback failed", { platform, userId: req.user.id, err: err.message });
    const message = err.expose || err.name === "PlatformError" ? err.message : "Could not complete the connection. Please try again.";
    res.redirect(`/accounts.html?platform=${platform}&error=${encodeURIComponent(message.slice(0, 300))}`);
  }
});

module.exports = router;
