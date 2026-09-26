// Media storage: Cloudinary when configured (required for Instagram, Pinterest
// and serverless hosting), otherwise the local uploads folder for development.
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const cloudinary = require("cloudinary").v2;
const config = require("../config");
const logger = require("../lib/logger");
const http = require("../lib/http");
const mediaModel = require("../models/media");
const { AppError, validationError, badRequest } = require("../lib/errors");

const IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" };
const VIDEO_TYPES = { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" };
const FORMAT_TO_MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" };

let cloudinaryConfigured = false;
function cloud() {
  if (!config.cloudinary.enabled) throw new AppError(503, "MEDIA_NOT_CONFIGURED", "Cloudinary is not configured.");
  if (!cloudinaryConfigured) {
    cloudinary.config({
      cloud_name: config.cloudinary.cloudName,
      api_key: config.cloudinary.apiKey,
      api_secret: config.cloudinary.apiSecret,
      secure: true,
    });
    cloudinaryConfigured = true;
  }
  return cloudinary;
}

// Identifies a file by its leading bytes instead of trusting the file name or
// the browser-supplied MIME type.
function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  const hex = buf.subarray(0, 12).toString("hex");
  if (hex.startsWith("ffd8ff")) return "image/jpeg";
  if (hex.startsWith("89504e470d0a1a0a")) return "image/png";
  if (hex.startsWith("47494638")) return "image/gif";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (hex.startsWith("1a45dfa3")) return "video/webm";
  if (buf.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buf.subarray(8, 12).toString("ascii");
    return brand === "qt  " ? "video/quicktime" : "video/mp4";
  }
  return null;
}

function limitFor(type) {
  return type === "video" ? config.media.maxVideoBytes : config.media.maxImageBytes;
}

function checkSize(type, bytes) {
  const limit = limitFor(type);
  if (bytes > limit) {
    throw new AppError(413, "FILE_TOO_LARGE", `${type === "video" ? "Videos" : "Images"} must be ${Math.round(limit / 1048576)} MB or smaller.`);
  }
  if (!bytes) throw validationError("The uploaded file is empty.");
}

function publicConfig() {
  return {
    provider: config.media.provider,
    directUpload: config.media.provider === "cloudinary",
    maxImageBytes: config.media.maxImageBytes,
    maxVideoBytes: config.media.maxVideoBytes,
    imageTypes: Object.keys(IMAGE_TYPES),
    videoTypes: Object.keys(VIDEO_TYPES),
    publicUrls: config.media.provider === "cloudinary",
  };
}

async function readHead(filePath) {
  const handle = await fsp.open(filePath, "r");
  try {
    const buf = Buffer.alloc(32);
    await handle.read(buf, 0, 32, 0);
    return buf;
  } finally {
    await handle.close();
  }
}

// Stores a file received through multipart upload (multer disk storage).
async function storeUpload(userId, file) {
  if (!file) throw badRequest("No file was uploaded. Send the file in the 'file' field.");
  try {
    const mime = sniff(await readHead(file.path));
    if (!mime || !(IMAGE_TYPES[mime] || VIDEO_TYPES[mime])) {
      throw validationError("Unsupported file type. Upload a JPG, PNG, GIF or WEBP image, or an MP4, MOV or WEBM video.");
    }
    const type = IMAGE_TYPES[mime] ? "image" : "video";
    const ext = IMAGE_TYPES[mime] || VIDEO_TYPES[mime];
    checkSize(type, file.size);

    if (config.media.provider === "cloudinary") {
      const res = await cloud().uploader.upload(file.path, {
        resource_type: type,
        folder: `${config.cloudinary.folder}/u${userId}`,
      });
      return mediaModel.create(userId, {
        provider: "cloudinary",
        storageKey: res.public_id,
        url: res.secure_url,
        resourceType: type,
        mimeType: mime,
        format: res.format || ext,
        sizeBytes: res.bytes || file.size,
        width: res.width,
        height: res.height,
        duration: res.duration,
        originalName: file.originalname,
      });
    }

    await fsp.mkdir(config.media.uploadDir, { recursive: true });
    const name = `${crypto.randomBytes(16).toString("hex")}.${ext}`;
    await fsp.copyFile(file.path, path.join(config.media.uploadDir, name));
    return mediaModel.create(userId, {
      provider: "local",
      storageKey: name,
      url: `${config.appUrl}/media/${name}`,
      resourceType: type,
      mimeType: mime,
      format: ext,
      sizeBytes: file.size,
      originalName: file.originalname,
    });
  } finally {
    fsp.unlink(file.path).catch(() => {});
  }
}

// Stores a server-generated image (e.g. an AI thumbnail) that never came from
// a browser upload, so there is no multer file/path to work from.
async function storeGenerated(userId, buffer, { mimeType = "image/png", originalName = "generated.png" } = {}) {
  checkSize("image", buffer.length);
  const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[mimeType] || "png";

  if (config.media.provider === "cloudinary") {
    const res = await cloud().uploader.upload(`data:${mimeType};base64,${buffer.toString("base64")}`, {
      resource_type: "image",
      folder: `${config.cloudinary.folder}/u${userId}`,
    });
    return mediaModel.create(userId, {
      provider: "cloudinary",
      storageKey: res.public_id,
      url: res.secure_url,
      resourceType: "image",
      mimeType,
      format: res.format || ext,
      sizeBytes: res.bytes || buffer.length,
      width: res.width,
      height: res.height,
      originalName,
    });
  }

  await fsp.mkdir(config.media.uploadDir, { recursive: true });
  const name = `${crypto.randomBytes(16).toString("hex")}.${ext}`;
  await fsp.writeFile(path.join(config.media.uploadDir, name), buffer);
  return mediaModel.create(userId, {
    provider: "local",
    storageKey: name,
    url: `${config.appUrl}/media/${name}`,
    resourceType: "image",
    mimeType,
    format: ext,
    sizeBytes: buffer.length,
    originalName,
  });
}

// ── Direct browser → Cloudinary uploads ──────────────────────────────────────
// Large files never pass through this server (serverless request bodies are
// capped at a few MB). The browser uploads with a short-lived signature and
// then registers the result, which is verified here.

function userFolder(userId) {
  return `${config.cloudinary.folder}/u${userId}`;
}

function createUploadSignature(userId, resourceType) {
  const c = cloud();
  const params = {
    timestamp: Math.round(Date.now() / 1000),
    folder: userFolder(userId),
    allowed_formats: resourceType === "video" ? "mp4,mov,webm" : "jpg,jpeg,png,gif,webp",
  };
  const signature = c.utils.api_sign_request(params, config.cloudinary.apiSecret);
  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloudinary.cloudName}/${resourceType}/upload`,
    fields: { ...params, api_key: config.cloudinary.apiKey, signature },
    maxBytes: limitFor(resourceType),
  };
}

async function completeDirectUpload(userId, { publicId, version, signature, resourceType, originalName }) {
  const c = cloud();
  if (!publicId.startsWith(`${userFolder(userId)}/`)) throw badRequest("This upload does not belong to your account.");
  if (!c.utils.verify_api_response_signature(publicId, version, signature)) {
    throw badRequest("Upload signature could not be verified.");
  }
  // Trust Cloudinary's record of the file, not the browser's description.
  const res = await c.api.resource(publicId, { resource_type: resourceType });
  const format = String(res.format || "").toLowerCase();
  const mime = FORMAT_TO_MIME[format];
  const type = mime && mime.startsWith("video/") ? "video" : mime ? "image" : null;
  try {
    if (!type || type !== resourceType) throw validationError("Unsupported file type.");
    checkSize(type, res.bytes);
  } catch (err) {
    await c.uploader.destroy(publicId, { resource_type: resourceType, invalidate: true }).catch(() => {});
    throw err;
  }
  return mediaModel.create(userId, {
    provider: "cloudinary",
    storageKey: publicId,
    url: res.secure_url,
    resourceType: type,
    mimeType: mime,
    format,
    sizeBytes: res.bytes,
    width: res.width,
    height: res.height,
    duration: res.duration,
    originalName,
  });
}

// ── Reading media for publishing ─────────────────────────────────────────────

function localPath(media) {
  const file = path.basename(media.storage_key);
  return path.join(config.media.uploadDir, file);
}

async function openStream(media) {
  if (media.provider === "local") return fs.createReadStream(localPath(media));
  const res = await http.get(media.url, { responseType: "stream", timeout: 120000 });
  return res.data;
}

async function readBuffer(media) {
  if (media.provider === "local") return fsp.readFile(localPath(media));
  const res = await http.get(media.url, { responseType: "arraybuffer", timeout: 120000, maxContentLength: config.media.maxVideoBytes * 2 });
  return Buffer.from(res.data);
}

// A delivery URL in a specific format. Cloudinary converts on the fly, which
// lets Instagram (JPEG only) accept PNG/WEBP uploads.
function deliveryUrl(media, format) {
  if (media.provider !== "cloudinary" || !format || String(media.format).toLowerCase() === format) return media.url;
  return media.url.replace(/\.[a-z0-9]+(\?.*)?$/i, `.${format}`);
}

function thumbnailUrl(media) {
  return mediaModel.toPublic(media).thumbnailUrl;
}

// ── Deleting ─────────────────────────────────────────────────────────────────

async function destroy(media) {
  try {
    if (media.provider === "cloudinary") {
      await cloud().uploader.destroy(media.storage_key, { resource_type: media.resource_type, invalidate: true });
    } else {
      await fsp.unlink(localPath(media)).catch((err) => {
        if (err.code !== "ENOENT") throw err;
      });
    }
  } catch (err) {
    logger.warn("Failed to delete stored media file", { mediaId: media.id, err });
  }
  await mediaModel.remove(media.id);
}

// Deletes uploads no post ever used (abandoned composer sessions).
async function cleanupUnused() {
  const cutoff = new Date(Date.now() - config.media.unusedMediaTtlHours * 3600 * 1000);
  const unused = await mediaModel.listUnused(cutoff, 200);
  for (const m of unused) await destroy(m);
  if (unused.length) logger.info(`Removed ${unused.length} unused media file(s)`);
  return unused.length;
}

module.exports = {
  sniff,
  publicConfig,
  storeUpload,
  storeGenerated,
  createUploadSignature,
  completeDirectUpload,
  openStream,
  readBuffer,
  deliveryUrl,
  thumbnailUrl,
  destroy,
  cleanupUnused,
  localPath,
  IMAGE_TYPES,
  VIDEO_TYPES,
};
