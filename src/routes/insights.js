// Analytics, notifications and the activity log for the signed-in user.
const express = require("express");
const analytics = require("../services/analytics");
const notifications = require("../models/notifications");
const activityModel = require("../models/activity");
const activity = require("../services/activity");
const { asyncHandler: h } = require("../middleware/requestContext");
const { limiters } = require("../middleware/security");
const { z, query, validate, schemas } = require("../lib/validate");
const { notFound } = require("../lib/errors");

const analyticsRouter = express.Router();
const notificationsRouter = express.Router();
const activityRouter = express.Router();

const rangeSchema = z.object({ from: schemas.isoDate.optional(), to: schemas.isoDate.optional() });

analyticsRouter.get(
  "/summary",
  query(rangeSchema),
  h(async (req, res) => {
    res.json({ success: true, ...(await analytics.summary(req.user.id, req.validQuery)) });
  })
);

analyticsRouter.get(
  "/overview",
  h(async (req, res) => {
    res.json({ success: true, ...(await analytics.overview(req.user.id)) });
  })
);

analyticsRouter.post(
  "/refresh",
  limiters.ai(),
  h(async (req, res) => {
    const result = await analytics.refreshMetrics(req.user.id, { limit: 30 });
    await activity.log(req, "analytics.refresh", { details: { updated: result.updated, failed: result.failed } });
    res.json({ success: true, ...result });
  })
);

notificationsRouter.get(
  "/",
  query(z.object({ ...schemas.pagination, unread: z.enum(["0", "1", "true", "false"]).optional() })),
  h(async (req, res) => {
    const q = req.validQuery;
    const result = await notifications.list(req.user.id, { unreadOnly: q.unread === "1" || q.unread === "true", page: q.page, pageSize: q.pageSize });
    res.json({ success: true, ...result, unreadCount: await notifications.unreadCount(req.user.id) });
  })
);

notificationsRouter.get(
  "/unread-count",
  h(async (req, res) => {
    res.json({ success: true, count: await notifications.unreadCount(req.user.id) });
  })
);

notificationsRouter.post(
  "/read-all",
  h(async (req, res) => {
    await notifications.markAllRead(req.user.id);
    res.json({ success: true });
  })
);

notificationsRouter.post(
  "/:id/read",
  h(async (req, res) => {
    const { id } = validate(z.object({ id: schemas.id }), req.params);
    if (!(await notifications.markRead(req.user.id, id))) throw notFound("Notification not found.");
    res.json({ success: true });
  })
);

notificationsRouter.delete(
  "/:id",
  h(async (req, res) => {
    const { id } = validate(z.object({ id: schemas.id }), req.params);
    if (!(await notifications.remove(req.user.id, id))) throw notFound("Notification not found.");
    res.json({ success: true });
  })
);

activityRouter.get(
  "/",
  query(z.object({ ...schemas.pagination, action: z.string().trim().max(60).regex(/^[a-z_.]*$/).optional(), from: schemas.isoDate.optional(), to: schemas.isoDate.optional() })),
  h(async (req, res) => {
    const q = req.validQuery;
    res.json({ success: true, ...(await activityModel.list({ userId: req.user.id, action: q.action, dateFrom: q.from, dateTo: q.to, page: q.page, pageSize: q.pageSize })) });
  })
);

module.exports = { analyticsRouter, notificationsRouter, activityRouter };
