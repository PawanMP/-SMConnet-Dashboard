const express = require("express");
const ai = require("../services/ai");
const activity = require("../services/activity");
const { asyncHandler: h } = require("../middleware/requestContext");
const { limiters } = require("../middleware/security");
const { z, body, schemas } = require("../lib/validate");

const router = express.Router();
const aiLimiter = limiters.ai();

const generateSchema = z
  .object({
    platforms: z.array(schemas.platform).min(1, "Select at least one platform.").max(5),
    context: z.string().trim().max(1000, "Context must be at most 1,000 characters.").optional().default(""),
    tone: z.enum(ai.TONES).optional(),
    mediaId: schemas.id.nullable().optional(),
  })
  .strict();

const rewriteSchema = z
  .object({
    platform: schemas.platform,
    field: z.enum(ai.FIELDS),
    mode: z.enum(ai.MODES).default("regenerate"),
    currentText: z.string().max(5000).optional().default(""),
    context: z.string().trim().max(1000).optional().default(""),
    tone: z.enum(ai.TONES).optional(),
    mediaId: schemas.id.nullable().optional(),
  })
  .strict()
  .refine((v) => ai.PLATFORM_RULES[v.platform].fields.includes(v.field), { message: "That field does not apply to this platform.", path: ["field"] });

router.get(
  "/status",
  h(async (req, res) => {
    res.json({ success: true, ...(await ai.status(req.user.id)) });
  })
);

router.post(
  "/generate",
  aiLimiter,
  body(generateSchema),
  h(async (req, res) => {
    const result = await ai.generate(req.user.id, req.body);
    await activity.log(req, "ai.generate", { details: { platforms: req.body.platforms, tone: result.tone, provider: result.provider } });
    res.json({ success: true, ...result });
  })
);

router.post(
  "/rewrite",
  aiLimiter,
  body(rewriteSchema),
  h(async (req, res) => {
    res.json({ success: true, ...(await ai.rewrite(req.user.id, req.body)) });
  })
);

router.post(
  "/test",
  aiLimiter,
  body(
    z
      .object({
        apiKey: z.string().trim().min(10).max(300).optional(),
        provider: z.enum(["openai", "gemini"]).optional(),
        model: z.string().trim().max(100).regex(/^[\w.\-:/]*$/).optional(),
      })
      .strict()
  ),
  h(async (req, res) => {
    res.json({ success: true, ...(await ai.testKey(req.user.id, req.body)) });
  })
);

module.exports = router;
