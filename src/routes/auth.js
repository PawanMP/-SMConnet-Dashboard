const express = require("express");
const config = require("../config");
const users = require("../models/users");
const activity = require("../services/activity");
const { hashPassword, verifyPassword, dummyVerify } = require("../lib/password");
const { asyncHandler: h } = require("../middleware/requestContext");
const { requireAuth, setSessionCookie, clearSessionCookie } = require("../middleware/auth");
const { limiters } = require("../middleware/security");
const { z, body, schemas } = require("../lib/validate");
const { AppError, forbidden, conflict } = require("../lib/errors");

const router = express.Router();
const authLimiter = limiters.auth();

const registerSchema = z.object({
  name: schemas.name,
  email: schemas.email,
  password: schemas.password,
});

const loginSchema = z.object({
  email: schemas.email,
  password: z.string({ required_error: "Password is required." }).min(1, "Password is required.").max(128),
});

// Public: lets the sign-in page know whether registration is open and whether
// the system still needs its first (admin) account.
router.get(
  "/config",
  h(async (_req, res) => {
    const total = await users.count();
    res.json({ success: true, allowRegistration: config.auth.allowRegistration || total === 0, needsSetup: total === 0 });
  })
);

router.post(
  "/register",
  authLimiter,
  body(registerSchema),
  h(async (req, res) => {
    const total = await users.count();
    if (!config.auth.allowRegistration && total > 0) throw forbidden("Registration is closed. Ask an administrator for an account.");
    if (await users.findByEmail(req.body.email)) throw conflict("An account with this email already exists.");

    const user = await users.create({
      email: req.body.email,
      name: req.body.name,
      passwordHash: await hashPassword(req.body.password),
      role: total === 0 ? "admin" : "user",
    });
    await users.touchLogin(user.id);
    const token = setSessionCookie(res, user);
    req.user = users.toPublic(user);
    await activity.log(req, "auth.register", { entityType: "user", entityId: user.id, details: { role: user.role } });
    res.status(201).json({ success: true, user: users.toPublic(user), token });
  })
);

router.post(
  "/login",
  authLimiter,
  body(loginSchema),
  h(async (req, res) => {
    const user = await users.findByEmail(req.body.email);
    const valid = user ? await verifyPassword(req.body.password, user.password_hash) : await dummyVerify(req.body.password);
    if (!user || !valid) {
      if (user) await activity.log(user.id, "auth.login_failed", { entityType: "user", entityId: user.id, details: { ip: req.ip } });
      throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
    }
    if (!Number(user.is_active)) throw forbidden("This account has been disabled. Contact an administrator.");

    await users.touchLogin(user.id);
    const token = setSessionCookie(res, user);
    req.user = users.toPublic(user);
    await activity.log(req, "auth.login", { entityType: "user", entityId: user.id });
    res.json({ success: true, user: users.toPublic(user), token });
  })
);

router.post(
  "/logout",
  h(async (req, res) => {
    if (req.user) await activity.log(req, "auth.logout", { entityType: "user", entityId: req.user.id });
    clearSessionCookie(res);
    res.json({ success: true });
  })
);

// Signs the user out on every device by invalidating all issued sessions.
router.post(
  "/logout-all",
  requireAuth,
  h(async (req, res) => {
    await users.bumpTokenVersion(req.user.id);
    await activity.log(req, "auth.logout_all", { entityType: "user", entityId: req.user.id });
    clearSessionCookie(res);
    res.json({ success: true });
  })
);

router.get("/me", requireAuth, (req, res) => {
  const { tokenVersion, ...user } = req.user;
  res.json({ success: true, user });
});

module.exports = router;
