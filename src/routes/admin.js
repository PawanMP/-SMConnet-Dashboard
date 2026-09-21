// Administrator-only functions: user management, system statistics, the
// system-wide activity log and maintenance jobs.
const express = require("express");
const users = require("../models/users");
const activityModel = require("../models/activity");
const accountsModel = require("../models/accounts");
const analytics = require("../services/analytics");
const scheduler = require("../services/scheduler");
const mediaService = require("../services/media");
const activity = require("../services/activity");
const db = require("../db");
const { hashPassword } = require("../lib/password");
const { asyncHandler: h } = require("../middleware/requestContext");
const { z, body, query, validate, schemas } = require("../lib/validate");
const { notFound, conflict } = require("../lib/errors");

const router = express.Router();
const idParam = (req) => validate(z.object({ id: schemas.id }), req.params).id;

async function assertNotLastAdmin(target, change) {
  const losesAdmin = target.role === "admin" && Number(target.is_active) && (change.role === "user" || change.isActive === false || change.delete);
  if (losesAdmin && (await users.countActiveAdmins()) <= 1) {
    throw conflict("There must always be at least one active administrator.");
  }
}

router.get(
  "/users",
  query(z.object({ ...schemas.pagination, q: z.string().trim().max(100).optional(), role: z.enum(["admin", "user"]).optional() })),
  h(async (req, res) => {
    res.json({ success: true, ...(await users.list(req.validQuery)) });
  })
);

router.post(
  "/users",
  body(z.object({ name: schemas.name, email: schemas.email, password: schemas.password, role: z.enum(["admin", "user"]).default("user") }).strict()),
  h(async (req, res) => {
    if (await users.findByEmail(req.body.email)) throw conflict("An account with this email already exists.");
    const user = await users.create({ ...req.body, passwordHash: await hashPassword(req.body.password) });
    await activity.log(req, "admin.user_create", { entityType: "user", entityId: user.id, details: { email: user.email, role: user.role } });
    res.status(201).json({ success: true, user: users.toPublic(user) });
  })
);

router.get(
  "/users/:id",
  h(async (req, res) => {
    const user = await users.findById(idParam(req));
    if (!user) throw notFound("User not found.");
    const stats = await db.get(
      "SELECT (SELECT COUNT(*) FROM posts WHERE user_id = ?) AS posts, (SELECT COUNT(*) FROM social_accounts WHERE user_id = ? AND status = 'connected') AS accounts",
      [user.id, user.id]
    );
    res.json({ success: true, user: users.toPublic(user), stats: { posts: Number(stats.posts), connectedAccounts: Number(stats.accounts) } });
  })
);

router.patch(
  "/users/:id",
  body(z.object({ role: z.enum(["admin", "user"]).optional(), isActive: z.boolean().optional(), name: schemas.name.optional() }).strict()),
  h(async (req, res) => {
    const target = await users.findById(idParam(req));
    if (!target) throw notFound("User not found.");
    await assertNotLastAdmin(target, req.body);
    let updated = await users.update(target.id, req.body);
    // Role or access changes take effect immediately on every device.
    if (req.body.role !== undefined || req.body.isActive === false) updated = await users.bumpTokenVersion(target.id);
    await activity.log(req, "admin.user_update", { entityType: "user", entityId: target.id, details: req.body });
    res.json({ success: true, user: users.toPublic(updated) });
  })
);

router.delete(
  "/users/:id",
  h(async (req, res) => {
    const target = await users.findById(idParam(req));
    if (!target) throw notFound("User not found.");
    if (Number(target.id) === req.user.id) throw conflict("Use Profile settings to delete your own account.");
    await assertNotLastAdmin(target, { delete: true });
    await users.remove(target.id);
    await activity.log(req, "admin.user_delete", { entityType: "user", entityId: target.id, details: { email: target.email } });
    res.json({ success: true });
  })
);

router.get(
  "/stats",
  query(z.object({ from: schemas.isoDate.optional(), to: schemas.isoDate.optional() })),
  h(async (req, res) => {
    const summary = await analytics.summary(null, req.validQuery);
    const userCounts = await db.get(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) AS admins, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active FROM users"
    );
    res.json({
      success: true,
      users: { total: Number(userCounts.total), admins: Number(userCounts.admins || 0), active: Number(userCounts.active || 0) },
      connectedAccounts: await accountsModel.countConnected(null),
      scheduler: await scheduler.status(),
      ...summary,
    });
  })
);

router.get(
  "/activity",
  query(
    z.object({
      ...schemas.pagination,
      userId: schemas.id.optional(),
      action: z.string().trim().max(60).regex(/^[a-z_.]*$/).optional(),
      from: schemas.isoDate.optional(),
      to: schemas.isoDate.optional(),
    })
  ),
  h(async (req, res) => {
    const q = req.validQuery;
    res.json({ success: true, ...(await activityModel.list({ userId: q.userId, action: q.action, dateFrom: q.from, dateTo: q.to, page: q.page, pageSize: q.pageSize })) });
  })
);

router.post(
  "/maintenance/scheduler",
  h(async (req, res) => {
    const summary = await scheduler.tick({ source: "admin" });
    await activity.log(req, "admin.scheduler_run", { details: summary });
    res.json({ success: true, summary });
  })
);

router.post(
  "/maintenance/media-cleanup",
  h(async (req, res) => {
    const removed = await mediaService.cleanupUnused();
    await activity.log(req, "admin.media_cleanup", { details: { removed } });
    res.json({ success: true, removed });
  })
);

module.exports = router;
