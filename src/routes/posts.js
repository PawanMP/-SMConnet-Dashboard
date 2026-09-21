const express = require("express");
const posts = require("../services/posts");
const { TONES } = require("../services/ai");
const { asyncHandler: h } = require("../middleware/requestContext");
const { limiters } = require("../middleware/security");
const { z, body, query, validate, schemas } = require("../lib/validate");
const { validationError } = require("../lib/errors");

const router = express.Router();
const publishLimiter = limiters.publish();

const STATUSES = ["draft", "scheduled", "publishing", "published", "partial", "failed", "cancelled"];

const text = (max, label) => z.string().max(max, `${label} must be at most ${max.toLocaleString()} characters.`);

const platformContent = z
  .object({
    caption: text(5000, "Caption").optional(),
    hashtags: text(1000, "Hashtags").optional(),
    title: text(255, "Title").optional(),
    description: text(5000, "Description").optional(),
    link: z.union([z.literal(""), z.string().trim().url("Link must be a valid URL.").max(2048)]).optional(),
  })
  .strict();

const fields = {
  title: text(255, "Title").optional(),
  caption: text(5000, "Caption").optional(),
  description: text(5000, "Description").optional(),
  hashtags: text(1000, "Hashtags").optional(),
  mediaId: schemas.id.nullable().optional(),
  tone: z.enum(TONES).nullable().optional(),
  platforms: z
    .array(schemas.platform)
    .max(5)
    .optional()
    .transform((list) => (list ? [...new Set(list)] : list)),
  platformContent: z.record(schemas.platform, platformContent).optional(),
  scheduledAt: schemas.isoDate.nullable().optional(),
  schedules: z.record(schemas.platform, schemas.isoDate).optional(),
};

const createSchema = z.object({ ...fields, action: z.enum(["draft", "publish", "schedule"]).default("draft") }).strict();
const updateSchema = z.object({ ...fields, action: z.enum(["draft", "publish", "schedule"]).optional() }).strict();
const publishSchema = z
  .object({
    action: z.enum(["publish", "schedule"]),
    platforms: fields.platforms,
    scheduledAt: fields.scheduledAt,
    schedules: fields.schedules,
  })
  .strict();
const rescheduleSchema = z
  .object({ scheduledAt: fields.scheduledAt, schedules: fields.schedules })
  .refine((v) => v.scheduledAt || (v.schedules && Object.keys(v.schedules).length), { message: "Provide scheduledAt or schedules." });
const retrySchema = z.object({ platforms: z.array(schemas.platform).max(5).optional() }).strict();

const listSchema = z.object({
  ...schemas.pagination,
  status: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").map((x) => x.trim()).filter(Boolean) : undefined))
    .refine((list) => !list || list.every((s) => STATUSES.includes(s)), { message: `Status must be one of: ${STATUSES.join(", ")}.` }),
  platform: schemas.platform.optional(),
  q: z.string().trim().max(200).optional(),
  from: schemas.isoDate.optional(),
  to: schemas.isoDate.optional(),
  sort: z.enum(["newest", "oldest", "scheduled"]).optional(),
});

const idParam = (req) => validate(z.object({ id: schemas.id }), req.params).id;

router.get(
  "/",
  query(listSchema),
  h(async (req, res) => {
    const q = req.validQuery;
    const result = await posts.listView({
      userId: req.user.id,
      status: q.status,
      platform: q.platform,
      q: q.q,
      dateFrom: q.from,
      dateTo: q.to,
      page: q.page,
      pageSize: q.pageSize,
      sort: q.sort,
    });
    res.json({ success: true, ...result });
  })
);

router.get(
  "/calendar",
  query(z.object({ from: schemas.isoDate, to: schemas.isoDate })),
  h(async (req, res) => {
    const { from, to } = req.validQuery;
    if (new Date(to) - new Date(from) > 62 * 86400000) throw validationError("Calendar range must be 62 days or less.");
    res.json({ success: true, events: await posts.calendar(req.user.id, { from, to }) });
  })
);

router.get(
  "/:id",
  h(async (req, res) => {
    res.json({ success: true, post: await posts.detail(await posts.requirePost(req.user.id, idParam(req))) });
  })
);

router.post(
  "/",
  publishLimiter,
  body(createSchema),
  h(async (req, res) => {
    const result = await posts.create(req, req.body);
    res.status(201).json({ success: true, ...result });
  })
);

router.put(
  "/:id",
  publishLimiter,
  body(updateSchema),
  h(async (req, res) => {
    res.json({ success: true, ...(await posts.update(req, idParam(req), req.body)) });
  })
);

router.delete(
  "/:id",
  h(async (req, res) => {
    await posts.remove(req, idParam(req));
    res.json({ success: true });
  })
);

router.post(
  "/:id/duplicate",
  h(async (req, res) => {
    res.status(201).json({ success: true, post: await posts.duplicate(req, idParam(req)) });
  })
);

router.post(
  "/:id/publish",
  publishLimiter,
  body(publishSchema),
  h(async (req, res) => {
    res.json({ success: true, ...(await posts.publishDraft(req, idParam(req), req.body)) });
  })
);

router.post(
  "/:id/cancel",
  h(async (req, res) => {
    res.json({ success: true, post: await posts.cancel(req, idParam(req)) });
  })
);

router.patch(
  "/:id/schedule",
  body(rescheduleSchema),
  h(async (req, res) => {
    res.json({ success: true, post: await posts.reschedule(req, idParam(req), req.body) });
  })
);

router.post(
  "/:id/run-now",
  publishLimiter,
  h(async (req, res) => {
    res.json({ success: true, ...(await posts.runNow(req, idParam(req))) });
  })
);

router.post(
  "/:id/retry",
  publishLimiter,
  body(retrySchema),
  h(async (req, res) => {
    res.json({ success: true, ...(await posts.retry(req, idParam(req), req.body)) });
  })
);

module.exports = router;
