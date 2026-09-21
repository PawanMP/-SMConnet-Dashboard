const express = require("express");
const os = require("os");
const path = require("path");
const multer = require("multer");
const config = require("../config");
const mediaModel = require("../models/media");
const mediaService = require("../services/media");
const activity = require("../services/activity");
const { asyncHandler: h } = require("../middleware/requestContext");
const { limiters } = require("../middleware/security");
const { z, body, query, schemas } = require("../lib/validate");
const { notFound, conflict } = require("../lib/errors");

const router = express.Router();
const uploadLimiter = limiters.upload();

const upload = multer({
  dest: path.join(os.tmpdir(), "social-poster-uploads"),
  limits: { fileSize: Math.max(config.media.maxImageBytes, config.media.maxVideoBytes), files: 1, fields: 10 },
});

router.get("/config", (_req, res) => {
  res.json({ success: true, config: mediaService.publicConfig() });
});

router.get(
  "/",
  query(z.object({ ...schemas.pagination, type: z.enum(["image", "video"]).optional() })),
  h(async (req, res) => {
    res.json({ success: true, ...(await mediaModel.list(req.user.id, req.validQuery)) });
  })
);

// Multipart upload through this server (field name "file").
router.post(
  "/upload",
  uploadLimiter,
  upload.single("file"),
  h(async (req, res) => {
    const media = await mediaService.storeUpload(req.user.id, req.file);
    await activity.log(req, "media.upload", { entityType: "media", entityId: media.id, details: { type: media.resource_type, bytes: Number(media.size_bytes) } });
    res.status(201).json({ success: true, media: mediaModel.toPublic(media) });
  })
);

// Direct-to-Cloudinary uploads: 1) get a signature, 2) upload, 3) register.
router.post(
  "/signature",
  uploadLimiter,
  body(z.object({ resourceType: z.enum(["image", "video"]) })),
  (req, res) => {
    res.json({ success: true, ...mediaService.createUploadSignature(req.user.id, req.body.resourceType) });
  }
);

router.post(
  "/complete",
  body(
    z.object({
      publicId: z.string().trim().min(1).max(500),
      version: z.union([z.string(), z.number()]).transform(String),
      signature: z.string().trim().min(10).max(128),
      resourceType: z.enum(["image", "video"]),
      originalName: z.string().max(255).optional(),
    })
  ),
  h(async (req, res) => {
    const media = await mediaService.completeDirectUpload(req.user.id, req.body);
    await activity.log(req, "media.upload", { entityType: "media", entityId: media.id, details: { type: media.resource_type, bytes: Number(media.size_bytes), direct: true } });
    res.status(201).json({ success: true, media: mediaModel.toPublic(media) });
  })
);

router.delete(
  "/:id",
  h(async (req, res) => {
    const media = await mediaModel.findForUser(Number(req.params.id), req.user.id);
    if (!media) throw notFound("Media not found.");
    if (await mediaModel.activeReferences(media.id)) {
      throw conflict("This media is used by a draft or scheduled post. Remove it from those posts first.");
    }
    await mediaService.destroy(media);
    await activity.log(req, "media.delete", { entityType: "media", entityId: media.id });
    res.json({ success: true });
  })
);

module.exports = router;
