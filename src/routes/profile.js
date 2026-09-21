// The signed-in user's own profile, password and preferences.
const express = require("express");
const users = require("../models/users");
const settings = require("../models/settings");
const activity = require("../services/activity");
const { hashPassword, verifyPassword } = require("../lib/password");
const { asyncHandler: h } = require("../middleware/requestContext");
const { setSessionCookie, clearSessionCookie } = require("../middleware/auth");
const { z, body, schemas } = require("../lib/validate");
const { AppError, conflict } = require("../lib/errors");
const { TONES } = require("../services/ai");

const router = express.Router();

const timezone = z
  .string()
  .max(64)
  .refine(
    (tz) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    },
    { message: "Unknown time zone." }
  );

const profileSchema = z
  .object({
    name: schemas.name.optional(),
    email: schemas.email.optional(),
    timezone: timezone.nullable().optional(),
  })
  .strict();

const passwordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required."),
  newPassword: schemas.password,
});

const settingsSchema = z
  .object({
    aiProvider: z.enum(["openai", "gemini"]).nullable().optional(),
    aiModel: z.string().trim().max(100).regex(/^[\w.\-:/]*$/, "Model name contains invalid characters.").nullable().optional(),
    apiKey: z.string().trim().min(10, "API key looks too short.").max(300).optional(),
    clearApiKey: z.boolean().optional(),
    defaultTone: z.enum(TONES).optional(),
    allowEmojis: z.boolean().optional(),
    notifyOnSuccess: z.boolean().optional(),
    notifyOnFailure: z.boolean().optional(),
  })
  .strict();

const deleteSchema = z.object({ password: z.string().min(1, "Password is required to delete your account.") });

async function requirePassword(userId, password) {
  const user = await users.findById(userId);
  if (!(await verifyPassword(password, user.password_hash))) {
    throw new AppError(400, "INVALID_PASSWORD", "Current password is incorrect.");
  }
  return user;
}

router.get(
  "/",
  h(async (req, res) => {
    const user = users.toPublic(await users.findById(req.user.id));
    res.json({ success: true, user, settings: await settings.get(req.user.id) });
  })
);

router.put(
  "/",
  body(profileSchema),
  h(async (req, res) => {
    if (req.body.email && req.body.email !== req.user.email) {
      const other = await users.findByEmail(req.body.email);
      if (other && Number(other.id) !== req.user.id) throw conflict("Another account already uses this email.");
    }
    const updated = await users.update(req.user.id, req.body);
    await activity.log(req, "settings.profile_update", { entityType: "user", entityId: req.user.id, details: { fields: Object.keys(req.body) } });
    res.json({ success: true, user: users.toPublic(updated) });
  })
);

router.post(
  "/password",
  body(passwordSchema),
  h(async (req, res) => {
    await requirePassword(req.user.id, req.body.currentPassword);
    if (req.body.currentPassword === req.body.newPassword) {
      throw new AppError(400, "SAME_PASSWORD", "The new password must be different from the current one.");
    }
    await users.update(req.user.id, { passwordHash: await hashPassword(req.body.newPassword) });
    // Other devices are signed out; this one gets a fresh session.
    const user = await users.bumpTokenVersion(req.user.id);
    setSessionCookie(res, user);
    await activity.log(req, "settings.password_change", { entityType: "user", entityId: req.user.id });
    res.json({ success: true, message: "Password changed. Other sessions have been signed out." });
  })
);

router.get(
  "/settings",
  h(async (req, res) => {
    res.json({ success: true, settings: await settings.get(req.user.id) });
  })
);

router.put(
  "/settings",
  body(settingsSchema),
  h(async (req, res) => {
    const changes = { ...req.body };
    if (changes.clearApiKey) changes.apiKey = null;
    delete changes.clearApiKey;
    const updated = await settings.update(req.user.id, changes);
    await activity.log(req, "settings.update", {
      entityType: "settings",
      entityId: req.user.id,
      details: { fields: Object.keys(changes).map((k) => (k === "apiKey" ? (changes.apiKey ? "apiKey(set)" : "apiKey(cleared)") : k)) },
    });
    res.json({ success: true, settings: updated });
  })
);

router.delete(
  "/",
  body(deleteSchema),
  h(async (req, res) => {
    const user = await requirePassword(req.user.id, req.body.password);
    if (user.role === "admin" && (await users.countActiveAdmins()) <= 1) {
      throw conflict("You are the only administrator. Promote another user to admin before deleting your account.");
    }
    await activity.log(req, "auth.account_deleted", { entityType: "user", entityId: req.user.id, details: { email: user.email } });
    await users.remove(req.user.id);
    clearSessionCookie(res);
    res.json({ success: true });
  })
);

module.exports = router;
