// Social account connections for the signed-in user.
const express = require("express");
const accounts = require("../services/accounts");
const oauth = require("../services/oauth");
const { asyncHandler: h } = require("../middleware/requestContext");
const { z, body, validate, schemas } = require("../lib/validate");

const router = express.Router();

const platformParam = (req) => validate(z.object({ platform: schemas.platform }), req.params).platform;

const tokenSchema = z.object({
  accessToken: z.string().trim().min(10, "Access token looks too short.").max(4096),
  refreshToken: z.string().trim().max(4096).optional(),
  externalId: z.string().trim().max(191).optional(),
});

router.get(
  "/",
  h(async (req, res) => {
    res.json({ success: true, accounts: await accounts.listForUser(req.user.id) });
  })
);

// Starts OAuth: returns the provider URL the browser should navigate to.
router.post(
  "/:platform/connect",
  h(async (req, res) => {
    res.json({ success: true, ...(await oauth.start(req.user, platformParam(req))) });
  })
);

// Advanced: connect with an access token created in the platform's developer tools.
router.post(
  "/:platform/token",
  body(tokenSchema),
  h(async (req, res) => {
    const account = await accounts.connectWithToken(req, platformParam(req), req.body);
    res.json({ success: true, account });
  })
);

router.post(
  "/:platform/test",
  h(async (req, res) => {
    const result = await accounts.test(req, platformParam(req));
    res.json({ success: result.ok, ...result });
  })
);

router.get(
  "/:platform/resources",
  h(async (req, res) => {
    res.json({ success: true, ...(await accounts.listResources(req, platformParam(req))) });
  })
);

router.put(
  "/:platform/resources",
  body(z.object({ id: z.string().trim().min(1).max(191) })),
  h(async (req, res) => {
    res.json({ success: true, account: await accounts.selectResource(req, platformParam(req), req.body.id) });
  })
);

router.delete(
  "/:platform",
  h(async (req, res) => {
    res.json({ success: true, account: await accounts.disconnect(req, platformParam(req)) });
  })
);

module.exports = router;
