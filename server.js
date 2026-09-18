require("dotenv").config();

const express = require("express");
const multer  = require("multer");
const axios   = require("axios");
const FormData = require("form-data");
const fs   = require("fs");
const path = require("path");
const os   = require("os");
const { google } = require("googleapis");
const cloudinary = require("cloudinary").v2;

const app  = express();
const PORT = process.env.PORT || 3000;

const isVercel = !!process.env.VERCEL || process.env.NODE_ENV === "production";
const TMP_DIR = os.tmpdir();
const CONFIG_FILE = isVercel
  ? path.join(TMP_DIR, "config.json")
  : path.join(__dirname, "config.json");

// ─── Cloudinary Helper ────────────────────────────────────────────────────────
async function uploadToCloudinary(filePath) {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    console.error("Cloudinary upload failed: Environment variables CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, or CLOUDINARY_API_SECRET are not set.");
    return null;
  }
  if (!filePath || !fs.existsSync(filePath)) return null;

  try {
    cloudinary.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true
    });
    const res = await cloudinary.uploader.upload(filePath, { resource_type: "auto" });
    return res.secure_url;
  } catch (err) {
    console.error("Cloudinary upload error:", err.message);
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadConfig() {
  const envDefaults = {
    pageId: process.env.FB_PAGE_ID || process.env.FACEBOOK_PAGE_ID || "",
    accessToken: process.env.FB_ACCESS_TOKEN || process.env.FACEBOOK_ACCESS_TOKEN || "",
    igAccountId: process.env.IG_ACCOUNT_ID || process.env.INSTAGRAM_ACCOUNT_ID || "",
    igAccessToken: process.env.IG_ACCESS_TOKEN || process.env.INSTAGRAM_ACCESS_TOKEN || "",
    ytChannelId: process.env.YT_CHANNEL_ID || process.env.YOUTUBE_CHANNEL_ID || "",
    ytAccessToken: process.env.YT_ACCESS_TOKEN || process.env.YOUTUBE_ACCESS_TOKEN || "",
    openaiApiKey: process.env.OPENAI_API_KEY || "",
    openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
    tkClientKey: process.env.TK_CLIENT_KEY || process.env.TIKTOK_CLIENT_KEY || "",
    tkAccessToken: process.env.TK_ACCESS_TOKEN || process.env.TIKTOK_ACCESS_TOKEN || "",
    pinAppId: process.env.PIN_APP_ID || process.env.PINTEREST_APP_ID || "",
    pinAccessToken: process.env.PIN_ACCESS_TOKEN || process.env.PINTEREST_ACCESS_TOKEN || "",
    pinBoardId: process.env.PIN_BOARD_ID || process.env.PINTEREST_BOARD_ID || ""
  };

  let fileConfig = {};
  let targetFile = CONFIG_FILE;
  if (!fs.existsSync(targetFile) && fs.existsSync(path.join(__dirname, "config.json"))) {
    targetFile = path.join(__dirname, "config.json");
  }

  if (fs.existsSync(targetFile)) {
    try { fileConfig = JSON.parse(fs.readFileSync(targetFile, "utf8")); }
    catch {}
  }

  return {
    pageId: envDefaults.pageId || fileConfig.pageId || "",
    accessToken: envDefaults.accessToken || fileConfig.accessToken || "",
    igAccountId: envDefaults.igAccountId || fileConfig.igAccountId || "",
    igAccessToken: envDefaults.igAccessToken || fileConfig.igAccessToken || "",
    ytChannelId: envDefaults.ytChannelId || fileConfig.ytChannelId || "",
    ytAccessToken: envDefaults.ytAccessToken || fileConfig.ytAccessToken || "",
    openaiApiKey: envDefaults.openaiApiKey || fileConfig.openaiApiKey || "",
    openaiModel: fileConfig.openaiModel || envDefaults.openaiModel || "gpt-4o-mini",
    tkClientKey: envDefaults.tkClientKey || fileConfig.tkClientKey || "",
    tkAccessToken: envDefaults.tkAccessToken || fileConfig.tkAccessToken || "",
    pinAppId: envDefaults.pinAppId || fileConfig.pinAppId || "",
    pinAccessToken: envDefaults.pinAccessToken || fileConfig.pinAccessToken || "",
    pinBoardId: envDefaults.pinBoardId || fileConfig.pinBoardId || "",
    adminUsername: fileConfig.adminUsername || process.env.ADMIN_USERNAME || "admin",
    adminPassword: fileConfig.adminPassword || process.env.ADMIN_PASSWORD || "admin123"
  };
}

function saveConfig(data) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Failed to save config:", err);
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

// ─── Authentication Helper & Routes ──────────────────────────────────────────

const AUTH_TOKEN = process.env.AUTH_TOKEN || "admin-secret-session-token-123456";

// Auth middleware
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  
  if (!token || token !== AUTH_TOKEN) {
    return res.status(401).json({ success: false, message: "Unauthorized. Please log in." });
  }
  next();
};

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const cfg = loadConfig();
  if (username === cfg.adminUsername && password === cfg.adminPassword) {
    res.json({ success: true, token: AUTH_TOKEN, username: cfg.adminUsername });
  } else {
    res.status(401).json({ success: false, message: "Invalid username or password" });
  }
});

app.get("/api/verify-token", authMiddleware, (req, res) => {
  const cfg = loadConfig();
  res.json({ success: true, message: "Token is valid", username: cfg.adminUsername });
});

// ─── Account Settings API ───────────────────────────────────────────────────

app.get("/api/account/settings", authMiddleware, (_req, res) => {
  const cfg = loadConfig();
  res.json({
    success: true,
    username: cfg.adminUsername
  });
});

app.post("/api/account/settings", authMiddleware, (req, res) => {
  const { currentPassword, newUsername, newPassword } = req.body;
  const cfg = loadConfig();

  if (!currentPassword) {
    return res.status(400).json({ success: false, message: "Current password is required to make changes." });
  }

  if (currentPassword !== cfg.adminPassword) {
    return res.status(400).json({ success: false, message: "Incorrect current password." });
  }

  if (!newUsername && !newPassword) {
    return res.status(400).json({ success: false, message: "Please provide a new username or new password to update." });
  }

  if (newUsername) {
    cfg.adminUsername = newUsername.trim();
  }

  if (newPassword) {
    cfg.adminPassword = newPassword.trim();
  }

  saveConfig(cfg);
  res.json({
    success: true,
    message: "Account settings updated successfully.",
    username: cfg.adminUsername
  });
});

// Intercept all other APIs and publish routes
app.use("/api", (req, res, next) => {
  if (req.path === "/login") return next();
  authMiddleware(req, res, next);
});

app.use("/post-to-facebook", authMiddleware);
app.use("/post-to-instagram", authMiddleware);
app.use("/post-to-youtube", authMiddleware);

const UPLOADS_DIR = isVercel
  ? path.join(TMP_DIR, "uploads")
  : path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch (err) {}
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename:    (_req, file,  cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /jpeg|jpg|png|gif|bmp|webp|mp4|mov|avi|mkv/.test(
      path.extname(file.originalname).toLowerCase()
    );
    ok ? cb(null, true) : cb(new Error("Only images and videos are allowed."));
  },
});

// ═══════════════════════════════════════════════════════════════════════════════
//  FACEBOOK API
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Facebook Access Token Helper ────────────────────────────────────────────

async function getFacebookPageAccessToken(pageId, token) {
  if (!pageId || !token) return token;
  try {
    const { data } = await axios.get(
      `https://graph.facebook.com/v21.0/${pageId}?fields=access_token&access_token=${token}`
    );
    if (data && data.access_token) {
      return data.access_token;
    }
  } catch (e) {
    // If token is already a Page Access Token or fields query fails, fallback gracefully to token
  }
  return token;
}

// ─── Facebook Settings API ───────────────────────────────────────────────────

// GET /api/settings  →  return current Facebook config (token masked)
app.get("/api/settings", (_req, res) => {
  const cfg = loadConfig();
  res.json({
    pageId:      cfg.pageId || "",
    accessToken: cfg.accessToken
      ? cfg.accessToken.slice(0, 8) + "••••••••" + cfg.accessToken.slice(-4)
      : "",
    connected: !!(cfg.pageId && cfg.accessToken),
  });
});

// POST /api/settings  →  save new Facebook credentials
app.post("/api/settings", (req, res) => {
  const { pageId, accessToken } = req.body;
  if (!pageId || !accessToken) {
    return res.status(400).json({ success: false, message: "Both Page ID and Access Token are required." });
  }
  const cfg = loadConfig();
  cfg.pageId = pageId.trim();
  cfg.accessToken = accessToken.trim();
  saveConfig(cfg);
  res.json({ success: true, message: "Settings saved successfully." });
});

// POST /api/test-connection  →  verify Facebook credentials
app.post("/api/test-connection", async (_req, res) => {
  const cfg = loadConfig();
  if (!cfg.pageId || !cfg.accessToken) {
    return res.status(400).json({ success: false, message: "No credentials saved yet." });
  }
  try {
    const pageAccessToken = await getFacebookPageAccessToken(cfg.pageId, cfg.accessToken);
    const url = `https://graph.facebook.com/v21.0/${cfg.pageId}?fields=id,name,fan_count,picture&access_token=${pageAccessToken}`;
    const { data } = await axios.get(url);
    res.json({
      success:    true,
      pageName:   data.name,
      pageId:     data.id,
      followers:  data.fan_count ?? null,
      picture:    data.picture?.data?.url ?? null,
    });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(400).json({ success: false, message: msg });
  }
});

// ─── Post to Facebook ─────────────────────────────────────────────────────────

app.post("/post-to-facebook", upload.single("image"), async (req, res) => {
  const filePath = req.file?.path ?? null;
  const fileName = req.file?.originalname ?? "";
  const isVideo  = /mp4|mov|avi|mkv/.test(path.extname(fileName).toLowerCase());

  try {
    if (!filePath) {
      return res.status(400).json({ success: false, message: "No file provided." });
    }

    const cfg = loadConfig();
    if (!cfg.pageId || !cfg.accessToken) {
      return res.status(400).json({ success: false, message: "Facebook credentials not configured. Go to Settings first." });
    }

    const pageAccessToken = await getFacebookPageAccessToken(cfg.pageId, cfg.accessToken);

    const caption = (req.body.caption || "").trim();
    const form = new FormData();
    form.append("access_token", pageAccessToken);

    if (isVideo) {
      // Post to /videos
      form.append("source",      fs.createReadStream(filePath));
      form.append("description", caption);
      
      const { data } = await axios.post(
        `https://graph.facebook.com/v21.0/${cfg.pageId}/videos`,
        form,
        { headers: form.getHeaders(), maxContentLength: Infinity, maxBodyLength: Infinity }
      );
      
      return res.json({
        success:  true,
        message:  "Video posted to Facebook successfully!",
        post_id:  data.id,
      });
    } else {
      // Post to /photos
      form.append("source",  fs.createReadStream(filePath));
      form.append("caption", caption);

      const { data } = await axios.post(
        `https://graph.facebook.com/v21.0/${cfg.pageId}/photos`,
        form,
        { headers: form.getHeaders() }
      );

      return res.json({
        success:  true,
        message:  "Photo posted to Facebook successfully!",
        post_id:  data.post_id || data.id,
      });
    }
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    return res.status(500).json({ success: false, message: msg });
  } finally {
    if (filePath && fs.existsSync(filePath)) fs.unlink(filePath, () => {});
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  INSTAGRAM API
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Instagram Settings API ──────────────────────────────────────────────────

// GET /api/ig/settings  →  return current Instagram config (token masked)
app.get("/api/ig/settings", (_req, res) => {
  const cfg = loadConfig();
  res.json({
    igAccountId:   cfg.igAccountId || "",
    igAccessToken: cfg.igAccessToken
      ? cfg.igAccessToken.slice(0, 8) + "••••••••" + cfg.igAccessToken.slice(-4)
      : "",
    connected: !!(cfg.igAccountId && cfg.igAccessToken),
  });
});

// POST /api/ig/settings  →  save new Instagram credentials
app.post("/api/ig/settings", (req, res) => {
  const { igAccountId, igAccessToken } = req.body;
  if (!igAccountId || !igAccessToken) {
    return res.status(400).json({ success: false, message: "Both Account ID and Access Token are required." });
  }
  const cfg = loadConfig();
  cfg.igAccountId = igAccountId.trim();
  cfg.igAccessToken = igAccessToken.trim();
  saveConfig(cfg);
  res.json({ success: true, message: "Instagram settings saved successfully." });
});

// POST /api/ig/test-connection  →  verify Instagram credentials
app.post("/api/ig/test-connection", async (_req, res) => {
  const cfg = loadConfig();
  if (!cfg.igAccountId || !cfg.igAccessToken) {
    return res.status(400).json({ success: false, message: "No Instagram credentials saved yet." });
  }
  try {
    const url = `https://graph.facebook.com/v21.0/${cfg.igAccountId}?fields=id,name,username,profile_picture_url,followers_count,media_count&access_token=${cfg.igAccessToken}`;
    const { data } = await axios.get(url);
    res.json({
      success:        true,
      accountName:    data.name || data.username || "Instagram Account",
      username:       data.username || "",
      accountId:      data.id,
      followers:      data.followers_count ?? null,
      mediaCount:     data.media_count ?? null,
      profilePicture: data.profile_picture_url ?? null,
    });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(400).json({ success: false, message: msg });
  }
});

// ─── Post to Instagram ───────────────────────────────────────────────────────
// Instagram Graph API uses a two-step process:
// 1. Create a media container with the image URL
// 2. Publish the container
// NOTE: Instagram API requires a publicly accessible image URL (not file upload).

app.post("/post-to-instagram", upload.single("image"), async (req, res) => {
  const filePath = req.file?.path ?? null;
  const fileName = req.file?.originalname ?? "";
  const isVideo  = /mp4|mov|avi|mkv/.test(path.extname(fileName).toLowerCase());

  try {
    const cfg = loadConfig();
    if (!cfg.igAccountId || !cfg.igAccessToken) {
      return res.status(400).json({ success: false, message: "Instagram credentials not configured. Go to Settings first." });
    }

    const caption  = (req.body.caption || "").trim();
    const imageUrl = (req.body.image_url || "").trim(); 

    if (!imageUrl && !filePath) {
      return res.status(400).json({ success: false, message: "No file or URL provided." });
    }

    if (!imageUrl) {
      return res.status(400).json({ 
        success: false, 
        message: "Instagram API requires a public URL for videos and images. Please provide a public URL or configure an external storage service." 
      });
    }

    // Step 1: Create media container
    const params = {
      caption:      caption,
      access_token: cfg.igAccessToken,
    };

    if (isVideo) {
      params.media_type = "REELS"; // or VIDEO
      params.video_url  = imageUrl;
    } else {
      params.image_url = imageUrl;
    }

    const containerRes = await axios.post(
      `https://graph.facebook.com/v21.0/${cfg.igAccountId}/media`,
      null,
      { params }
    );

    const creationId = containerRes.data.id;

    // Step 2: Publish the container
    // For videos, we might need a delay or status check (GET /{creation-id}?fields=status_code)
    // but for simplicity we'll try to publish immediately or return the ID.
    const publishRes = await axios.post(
      `https://graph.facebook.com/v21.0/${cfg.igAccountId}/media_publish`,
      null,
      {
        params: {
          creation_id:  creationId,
          access_token: cfg.igAccessToken,
        },
      }
    );

    return res.json({
      success:  true,
      message:  `${isVideo ? 'Video' : 'Photo'} posted to Instagram successfully!`,
      post_id:  publishRes.data.id,
    });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    return res.status(500).json({ success: false, message: msg });
  } finally {
    if (filePath && fs.existsSync(filePath)) fs.unlink(filePath, () => {});
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  YOUTUBE API
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/yt/settings  →  return current YouTube config (token masked)
app.get("/api/yt/settings", (_req, res) => {
  const cfg = loadConfig();
  res.json({
    ytChannelId:   cfg.ytChannelId || "",
    ytAccessToken: cfg.ytAccessToken
      ? cfg.ytAccessToken.slice(0, 8) + "••••••••" + cfg.ytAccessToken.slice(-4)
      : "",
    connected: !!(cfg.ytChannelId && cfg.ytAccessToken),
  });
});

// POST /api/yt/settings  →  save new YouTube credentials
app.post("/api/yt/settings", (req, res) => {
  const { ytChannelId, ytAccessToken } = req.body;
  if (!ytChannelId || !ytAccessToken) {
    return res.status(400).json({ success: false, message: "Both Channel ID and Access Token are required." });
  }
  const cfg = loadConfig();
  cfg.ytChannelId = ytChannelId.trim();
  cfg.ytAccessToken = ytAccessToken.trim();
  saveConfig(cfg);
  res.json({ success: true, message: "YouTube settings saved successfully." });
});

// POST /api/yt/test-connection  →  verify YouTube credentials
app.post("/api/yt/test-connection", async (_req, res) => {
  const cfg = loadConfig();
  if (!cfg.ytAccessToken) {
    return res.status(400).json({ success: false, message: "No YouTube credentials saved yet." });
  }
  try {
    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: cfg.ytAccessToken });
    const youtube = google.youtube({ version: "v3", auth: oauth2Client });

    const response = await youtube.channels.list({
      part: "snippet,statistics",
      mine: true
    });

    if (!response.data.items || response.data.items.length === 0) {
      return res.status(404).json({ success: false, message: "No channel found for this token." });
    }

    const chan = response.data.items[0];
    res.json({
      success:     true,
      channelName: chan.snippet.title,
      channelId:   chan.id,
      subscribers: chan.statistics.subscriberCount,
      videoCount:  chan.statistics.videoCount,
      picture:     chan.snippet.thumbnails.default.url
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─── Post to YouTube ──────────────────────────────────────────────────────────

app.post("/post-to-youtube", upload.single("image"), async (req, res) => {
  const filePath = req.file?.path ?? null;
  const fileName = req.file?.originalname ?? "";
  const isVideo  = /mp4|mov|avi|mkv/.test(path.extname(fileName).toLowerCase());

  try {
    if (!filePath || !isVideo) {
      return res.status(400).json({ success: false, message: "Please upload a video file for YouTube." });
    }

    const cfg = loadConfig();
    if (!cfg.ytAccessToken) {
      return res.status(400).json({ success: false, message: "YouTube credentials not configured." });
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: cfg.ytAccessToken });
    const youtube = google.youtube({ version: "v3", auth: oauth2Client });

    const title   = req.body.title || "New Video";
    const caption = req.body.caption || "";

    const response = await youtube.videos.insert({
      part: "snippet,status",
      requestBody: {
        snippet: {
          title:       title,
          description: caption,
        },
        status: {
          privacyStatus: "public",
        },
      },
      media: {
        body: fs.createReadStream(filePath),
      },
    });

    res.json({
      success: true,
      message: "Video uploaded to YouTube successfully!",
      post_id: response.data.id
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "YouTube Upload Failed: " + err.message });
  } finally {
    if (filePath && fs.existsSync(filePath)) fs.unlink(filePath, () => {});
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  TIKTOK API
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/tiktok/settings
app.get("/api/tiktok/settings", (_req, res) => {
  const cfg = loadConfig();
  res.json({
    tkClientKey:   cfg.tkClientKey || "",
    tkAccessToken: cfg.tkAccessToken
      ? cfg.tkAccessToken.slice(0, 8) + "••••••••" + cfg.tkAccessToken.slice(-4)
      : "",
    connected: !!(cfg.tkClientKey && cfg.tkAccessToken),
  });
});

// POST /api/tiktok/settings
app.post("/api/tiktok/settings", (req, res) => {
  const { tkClientKey, tkAccessToken } = req.body;
  if (!tkClientKey || !tkAccessToken) {
    return res.status(400).json({ success: false, message: "Both Client Key and Access Token are required." });
  }
  const cfg = loadConfig();
  cfg.tkClientKey = tkClientKey.trim();
  cfg.tkAccessToken = tkAccessToken.trim();
  saveConfig(cfg);
  res.json({ success: true, message: "TikTok settings saved successfully." });
});

// POST /api/tiktok/test-connection
app.post("/api/tiktok/test-connection", async (_req, res) => {
  const cfg = loadConfig();
  if (!cfg.tkAccessToken) {
    return res.status(400).json({ success: false, message: "No TikTok credentials saved yet." });
  }
  try {
    const url = "https://open.tiktokapis.com/v2/user/info/?fields=avatar_url,display_name,union_id";
    const { data } = await axios.get(url, {
      headers: { Authorization: `Bearer ${cfg.tkAccessToken}` }
    });
    if (data.error && data.error.code !== "ok") {
      throw new Error(data.error.message || `TikTok API error code: ${data.error.code}`);
    }
    res.json({
      success:      true,
      displayName:  data.data?.user?.display_name || "TikTok User",
      avatar:       data.data?.user?.avatar_url || null,
      unionId:      data.data?.user?.union_id || "",
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  PINTEREST API
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/pinterest/settings
app.get("/api/pinterest/settings", (_req, res) => {
  const cfg = loadConfig();
  res.json({
    pinAppId:       cfg.pinAppId || "",
    pinBoardId:     cfg.pinBoardId || "",
    pinAccessToken: cfg.pinAccessToken
      ? cfg.pinAccessToken.slice(0, 8) + "••••••••" + cfg.pinAccessToken.slice(-4)
      : "",
    connected: !!(cfg.pinAppId && cfg.pinAccessToken),
  });
});

// POST /api/pinterest/settings
app.post("/api/pinterest/settings", (req, res) => {
  const { pinAppId, pinAccessToken, pinBoardId } = req.body;
  if (!pinAppId || !pinAccessToken) {
    return res.status(400).json({ success: false, message: "Both App ID and Access Token are required." });
  }
  const cfg = loadConfig();
  cfg.pinAppId = pinAppId.trim();
  cfg.pinAccessToken = pinAccessToken.trim();
  cfg.pinBoardId = (pinBoardId || "").trim();
  saveConfig(cfg);
  res.json({ success: true, message: "Pinterest settings saved successfully." });
});

// POST /api/pinterest/test-connection
app.post("/api/pinterest/test-connection", async (_req, res) => {
  const cfg = loadConfig();
  if (!cfg.pinAccessToken) {
    return res.status(400).json({ success: false, message: "No Pinterest credentials saved yet." });
  }
  try {
    const url = "https://api.pinterest.com/v5/user_account";
    const { data } = await axios.get(url, {
      headers: { Authorization: `Bearer ${cfg.pinAccessToken}` }
    });
    res.json({
      success:    true,
      username:   data.username || "Pinterest Creator",
      picture:    data.profile_image || null,
      boardId:    cfg.pinBoardId || "Not set"
    });
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    res.status(400).json({ success: false, message: msg });
  }
});

// ─── Reusable Per-Platform Publish Helper ─────────────────────────────────────

async function executePlatformPublish(platform, payload, filePath) {
  const cfg = loadConfig();
  const fileName = payload.fileName || path.basename(filePath || "");
  const isVideo = /mp4|mov|avi|mkv|webm|m4v|3gp|flv|wmv/i.test(path.extname(fileName).toLowerCase());

  if (platform === "facebook") {
    if (!cfg.pageId || !cfg.accessToken) return { success: false, message: "Facebook credentials not configured." };
    const captionField = (payload.fb_caption || "").trim();
    const hashtagsField = (payload.fb_hashtags || "").trim();
    const fullCaption = hashtagsField ? `${captionField}\n\n${hashtagsField}` : captionField;

    const pageAccessToken = await getFacebookPageAccessToken(cfg.pageId, cfg.accessToken);

    const form = new FormData();
    form.append("access_token", pageAccessToken);

    if (isVideo) {
      form.append("source", fs.createReadStream(filePath));
      form.append("description", fullCaption);
      const { data } = await axios.post(
        `https://graph.facebook.com/v21.0/${cfg.pageId}/videos`, form,
        { headers: form.getHeaders(), maxContentLength: Infinity, maxBodyLength: Infinity }
      );
      return { success: true, message: "Video posted successfully!", post_id: data.id };
    } else if (filePath && fs.existsSync(filePath)) {
      form.append("source", fs.createReadStream(filePath));
      form.append("caption", fullCaption);
      const { data } = await axios.post(
        `https://graph.facebook.com/v21.0/${cfg.pageId}/photos`, form,
        { headers: form.getHeaders() }
      );
      return { success: true, message: "Photo posted successfully!", post_id: data.post_id || data.id };
    } else {
      const { data } = await axios.post(
        `https://graph.facebook.com/v21.0/${cfg.pageId}/feed`,
        { message: fullCaption, access_token: pageAccessToken }
      );
      return { success: true, message: "Post published to Facebook Page feed!", post_id: data.id };
    }
  }

  if (platform === "instagram") {
    if (!cfg.igAccountId || !cfg.igAccessToken) return { success: false, message: "Instagram credentials not configured." };
    const captionField = (payload.ig_caption || "").trim();
    const hashtagsField = (payload.ig_hashtags || "").trim();
    const fullCaption = hashtagsField ? `${captionField}\n\n${hashtagsField}` : captionField;

    let imageUrl = (payload.image_url || "").trim();
    const isPublicHttps = imageUrl && imageUrl.startsWith("https://") && !imageUrl.includes("localhost") && !imageUrl.includes("127.0.0.1");

    if (!isPublicHttps && filePath && fs.existsSync(filePath)) {
      imageUrl = (await uploadToCloudinary(filePath)) || "";
    }

    if (!imageUrl || !imageUrl.startsWith("https://") || imageUrl.includes("localhost") || imageUrl.includes("127.0.0.1")) {
      return {
        success: false,
        message: "Instagram API requires a public HTTPS media URL. Cloudinary upload failed or is not configured. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in your .env file."
      };
    }

    const params = { caption: fullCaption, access_token: cfg.igAccessToken };
    if (isVideo) { params.media_type = "REELS"; params.video_url = imageUrl; }
    else { params.image_url = imageUrl; }

    const containerRes = await axios.post(`https://graph.facebook.com/v21.0/${cfg.igAccountId}/media`, null, { params });
    const creationId = containerRes.data.id;
    const publishRes = await axios.post(`https://graph.facebook.com/v21.0/${cfg.igAccountId}/media_publish`, null, {
      params: { creation_id: creationId, access_token: cfg.igAccessToken }
    });
    return { success: true, message: "Posted to Instagram successfully!", post_id: publishRes.data.id };
  }

  if (platform === "youtube") {
    if (!cfg.ytAccessToken) return { success: false, message: "YouTube credentials not configured." };
    if (!isVideo) return { success: false, message: "YouTube only supports video publishing. Please select a video file." };

    if (!filePath || !fs.existsSync(filePath)) {
      return { success: false, message: "YouTube requires a valid video file." };
    }

    const oauth2Client = new google.auth.OAuth2();
    oauth2Client.setCredentials({ access_token: cfg.ytAccessToken });
    const youtube = google.youtube({ version: "v3", auth: oauth2Client });

    const title = (payload.yt_title || "").trim() || "New Video";
    const descField = (payload.yt_description || "").trim();
    const tagsField = (payload.yt_tags || "").trim();
    const fullDesc = tagsField ? `${descField}\n\n${tagsField}` : descField;

    const response = await youtube.videos.insert({
      part: "snippet,status",
      requestBody: { snippet: { title, description: fullDesc }, status: { privacyStatus: "public" } },
      media: { body: fs.createReadStream(filePath) }
    });
    return { success: true, message: "Uploaded to YouTube successfully!", post_id: response.data.id };
  }

  if (platform === "tiktok") {
    if (!cfg.tkAccessToken) return { success: false, message: "TikTok credentials not configured." };
    if (!isVideo) return { success: false, message: "TikTok requires a video file." };

    const tkCaption = (payload.tk_caption || "").trim();
    const tkHashtags = (payload.tk_hashtags || "").trim();
    const fullCaption = tkHashtags ? `${tkCaption} ${tkHashtags}` : tkCaption;
    const fileSize = fs.statSync(filePath).size;

    const initRes = await axios.post(
      "https://open.tiktokapis.com/v2/post/publish/video/init/",
      {
        post_info: { title: fullCaption.slice(0, 150), privacy_level: "PUBLIC_TO_EVERYONE", video_cover_timestamp_ms: 1000 },
        source_info: { source: "FILE_UPLOAD", video_size: fileSize }
      },
      { headers: { Authorization: `Bearer ${cfg.tkAccessToken}`, "Content-Type": "application/json" } }
    );

    if (initRes.data?.error?.code !== "ok") throw new Error(initRes.data?.error?.message || "TikTok init failed.");
    const uploadUrl = initRes.data.data.upload_url;
    const publishId = initRes.data.data.publish_id;

    await axios.put(uploadUrl, fs.createReadStream(filePath), {
      headers: { "Content-Type": "video/mp4", "Content-Length": fileSize },
      maxContentLength: Infinity, maxBodyLength: Infinity
    });
    return { success: true, message: "Video uploaded/queued on TikTok!", post_id: publishId };
  }

  if (platform === "pinterest") {
    if (!cfg.pinAccessToken) return { success: false, message: "Pinterest credentials not configured." };
    if (!cfg.pinBoardId) return { success: false, message: "Pinterest requires a Board ID." };

    const pinTitle = (payload.pin_title || "Pin from Social Dashboard").trim();
    const pinDesc = (payload.pin_description || "").trim();
    const pinHashtags = (payload.pin_hashtags || "").trim();
    const fullDesc = pinHashtags ? `${pinDesc}\n\n${pinHashtags}` : pinDesc;

    let imageUrl = (payload.image_url || "").trim();
    if (!imageUrl && filePath) {
      imageUrl = (await uploadToCloudinary(filePath)) || "";
    }
    if (!imageUrl) return { success: false, message: "Pinterest API requires a public image URL. Provide a public URL or configure Cloudinary environment variables." };

    const pinRes = await axios.post(
      "https://api.pinterest.com/v5/pins",
      {
        title: pinTitle.slice(0, 100), description: fullDesc.slice(0, 800),
        board_id: cfg.pinBoardId,
        media_source: { source_type: "image_url", url: imageUrl }
      },
      { headers: { Authorization: `Bearer ${cfg.pinAccessToken}`, "Content-Type": "application/json" } }
    );
    return { success: true, message: "Pin created successfully!", post_id: pinRes.data.id };
  }

  return { success: false, message: `Unsupported platform: ${platform}` };
}

// ─── Multi-Platform Publishing (Immediate) ────────────────────────────────────

app.post("/api/publish-multi", upload.single("file"), async (req, res) => {
  const filePath = req.file?.path ?? null;
  const fileName = req.file?.originalname ?? "";

  if (!filePath) {
    return res.status(400).json({ success: false, message: "No file provided." });
  }

  let platforms = [];
  try { platforms = JSON.parse(req.body.platforms || "[]"); }
  catch (e) { if (typeof req.body.platforms === "string") platforms = [req.body.platforms]; }

  if (platforms.length === 0) {
    if (fs.existsSync(filePath)) fs.unlink(filePath, () => {});
    return res.status(400).json({ success: false, message: "No platforms selected." });
  }

  const results = {};
  for (const platform of platforms) {
    try {
      const payload = { fileName, ...req.body };
      results[platform] = await executePlatformPublish(platform, payload, filePath);
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      results[platform] = { success: false, message: msg };
    }
  }

  if (filePath && fs.existsSync(filePath)) {
    fs.unlink(filePath, () => {});
  }

  res.json({ success: true, results });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  SCHEDULED POSTS SYSTEM
// ═══════════════════════════════════════════════════════════════════════════════

const SCHEDULED_POSTS_FILE = isVercel
  ? path.join(TMP_DIR, "scheduled_posts.json")
  : path.join(__dirname, "scheduled_posts.json");

function loadScheduledPosts() {
  let targetFile = SCHEDULED_POSTS_FILE;
  if (!fs.existsSync(targetFile) && fs.existsSync(path.join(__dirname, "scheduled_posts.json"))) {
    targetFile = path.join(__dirname, "scheduled_posts.json");
  }
  if (!fs.existsSync(targetFile)) return [];
  try { return JSON.parse(fs.readFileSync(targetFile, "utf8")); }
  catch { return []; }
}

function saveScheduledPosts(posts) {
  try {
    fs.writeFileSync(SCHEDULED_POSTS_FILE, JSON.stringify(posts, null, 2));
  } catch (err) {
    console.error("Failed to save scheduled posts:", err);
  }
}

// POST /api/schedule-post  →  create a scheduled post
app.post("/api/schedule-post", upload.single("file"), async (req, res) => {
  const filePath = req.file?.path ?? null;
  const fileName = req.file?.originalname ?? "";

  if (!filePath) {
    return res.status(400).json({ success: false, message: "Media file is required for scheduling." });
  }

  let platforms = [];
  try { platforms = JSON.parse(req.body.platforms || "[]"); }
  catch (e) { if (typeof req.body.platforms === "string") platforms = [req.body.platforms]; }

  if (platforms.length === 0) {
    if (fs.existsSync(filePath)) fs.unlink(filePath, () => {});
    return res.status(400).json({ success: false, message: "No platforms selected." });
  }

  // Parse per-platform schedule times
  let schedules = {};
  try { if (req.body.schedules) schedules = JSON.parse(req.body.schedules); } catch(e) {}

  const globalScheduleTime = req.body.global_schedule_time || new Date().toISOString();

  const posts = loadScheduledPosts();
  const newPostId = "sched_" + Date.now() + "_" + Math.floor(Math.random() * 1000);

  const platformData = {};
  for (const plat of platforms) {
    const scheduledAt = schedules[plat]
      ? new Date(schedules[plat]).toISOString()
      : new Date(globalScheduleTime).toISOString();

    platformData[plat] = {
      scheduledAt,
      status: "pending",
      resultMessage: "",
      postId: "",
      payload: {
        fileName,
        image_url: req.body.image_url || "",
        fb_caption: req.body.fb_caption || "",
        fb_hashtags: req.body.fb_hashtags || "",
        ig_caption: req.body.ig_caption || "",
        ig_hashtags: req.body.ig_hashtags || "",
        yt_title: req.body.yt_title || "",
        yt_description: req.body.yt_description || "",
        yt_tags: req.body.yt_tags || "",
        tk_caption: req.body.tk_caption || "",
        tk_hashtags: req.body.tk_hashtags || "",
        pin_title: req.body.pin_title || "",
        pin_description: req.body.pin_description || "",
        pin_hashtags: req.body.pin_hashtags || ""
      }
    };
  }

  const newPost = {
    id: newPostId,
    createdAt: new Date().toISOString(),
    filePath,
    fileName,
    status: "scheduled",
    platforms: platformData
  };

  posts.unshift(newPost);
  saveScheduledPosts(posts);

  res.json({ success: true, message: "Post scheduled successfully!", postId: newPostId, post: newPost });
});

// GET /api/scheduled-posts  →  list all scheduled posts
app.get("/api/scheduled-posts", (_req, res) => {
  const posts = loadScheduledPosts();
  res.json({ success: true, posts });
});

// DELETE /api/scheduled-posts/:id  →  cancel a scheduled post
app.delete("/api/scheduled-posts/:id", (req, res) => {
  const posts = loadScheduledPosts();
  const idx = posts.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: "Scheduled post not found." });

  const post = posts[idx];

  // Cancel all pending platform items
  for (const [, item] of Object.entries(post.platforms)) {
    if (item.status === "pending") {
      item.status = "cancelled";
      item.resultMessage = "Cancelled by user.";
    }
  }
  post.status = "cancelled";

  // Clean up file if no platform succeeded
  const anySuccess = Object.values(post.platforms).some(p => p.status === "success");
  if (!anySuccess && post.filePath && fs.existsSync(post.filePath)) {
    fs.unlink(post.filePath, () => {});
  }

  saveScheduledPosts(posts);
  res.json({ success: true, message: "Scheduled post cancelled." });
});

// POST /api/scheduled-posts/:id/run-now  →  execute all pending platforms immediately
app.post("/api/scheduled-posts/:id/run-now", async (req, res) => {
  const posts = loadScheduledPosts();
  const post = posts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ success: false, message: "Scheduled post not found." });

  if (post.status === "cancelled") return res.status(400).json({ success: false, message: "This post was cancelled." });
  if (!post.filePath || !fs.existsSync(post.filePath)) {
    return res.status(400).json({ success: false, message: "Media file no longer exists." });
  }

  const results = {};
  for (const [platform, item] of Object.entries(post.platforms)) {
    if (item.status !== "pending") {
      results[platform] = { success: item.status === "success", message: item.resultMessage || `Already ${item.status}` };
      continue;
    }

    try {
      const result = await executePlatformPublish(platform, item.payload, post.filePath);
      item.status = result.success ? "success" : "failed";
      item.resultMessage = result.message;
      item.postId = result.post_id || "";
      results[platform] = result;
    } catch (err) {
      item.status = "failed";
      item.resultMessage = err.message || "Execution error";
      results[platform] = { success: false, message: item.resultMessage };
    }
  }

  // Update overall status
  const allDone = Object.values(post.platforms).every(p => p.status !== "pending");
  const anySuccess = Object.values(post.platforms).some(p => p.status === "success");
  if (allDone) post.status = anySuccess ? "completed" : "failed";

  saveScheduledPosts(posts);
  res.json({ success: true, message: "Run-now executed.", results });
});

// ─── Background Scheduler Worker ──────────────────────────────────────────────

async function checkScheduledPostsWorker() {
  const posts = loadScheduledPosts();
  let updated = false;
  const nowIso = new Date().toISOString();

  for (const post of posts) {
    if (post.status === "completed" || post.status === "cancelled" || post.status === "failed") continue;
    if (!post.filePath || !fs.existsSync(post.filePath)) {
      // File gone — mark all pending as failed
      for (const [, item] of Object.entries(post.platforms)) {
        if (item.status === "pending") {
          item.status = "failed";
          item.resultMessage = "Media file no longer available.";
          updated = true;
        }
      }
      post.status = "failed";
      updated = true;
      continue;
    }

    for (const [platform, item] of Object.entries(post.platforms)) {
      if (item.status === "pending" && item.scheduledAt && item.scheduledAt <= nowIso) {
        item.status = "processing";
        updated = true;
        saveScheduledPosts(posts);

        try {
          const result = await executePlatformPublish(platform, item.payload, post.filePath);
          item.status = result.success ? "success" : "failed";
          item.resultMessage = result.message;
          item.postId = result.post_id || "";
        } catch (err) {
          item.status = "failed";
          item.resultMessage = err.message || "Execution error";
        }
        updated = true;
      }
    }

    // Check if all platforms are done
    const allDone = Object.values(post.platforms).every(p => p.status !== "pending" && p.status !== "processing");
    const anySuccess = Object.values(post.platforms).some(p => p.status === "success");
    if (allDone) {
      post.status = anySuccess ? "completed" : "failed";
      updated = true;
    }
  }

  if (updated) saveScheduledPosts(posts);
}

// Run scheduler worker every 15 seconds
const schedulerTimer = setInterval(checkScheduledPostsWorker, 15000);
if (schedulerTimer && schedulerTimer.unref) schedulerTimer.unref();

// ═══════════════════════════════════════════════════════════════════════════════
//  OPENAI & GOOGLE GEMINI AI ASSISTANT API
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/ai/settings  →  return current AI settings (key masked)
app.get("/api/ai/settings", (_req, res) => {
  const cfg = loadConfig();
  const apiKey = cfg.openaiApiKey || cfg.geminiApiKey || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || "";
  res.json({
    openaiApiKey: apiKey
      ? apiKey.slice(0, 8) + "••••••••" + apiKey.slice(-4)
      : "",
    openaiModel: cfg.openaiModel || "gpt-4o-mini",
    connected: !!apiKey
  });
});

// POST /api/ai/settings  →  save AI settings
app.post("/api/ai/settings", (req, res) => {
  const { openaiApiKey, openaiModel } = req.body;
  if (!openaiApiKey) {
    return res.status(400).json({ success: false, message: "API Key is required." });
  }
  const cfg = loadConfig();
  const trimmedKey = openaiApiKey.trim();
  cfg.openaiApiKey = trimmedKey;
  if (trimmedKey.startsWith("AIza")) {
    cfg.geminiApiKey = trimmedKey;
  }
  cfg.openaiModel = (openaiModel || "gpt-4o-mini").trim();
  saveConfig(cfg);
  res.json({ success: true, message: "AI settings saved successfully." });
});

// POST /api/ai/test-connection  →  test AI credentials
app.post("/api/ai/test-connection", async (req, res) => {
  const cfg = loadConfig();
  const inputApiKey = (req.body?.openaiApiKey || req.body?.apiKey || "").trim();
  const inputModel  = (req.body?.openaiModel  || req.body?.model  || "").trim();

  const apiKey = inputApiKey || cfg.openaiApiKey || cfg.geminiApiKey || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(400).json({ success: false, message: "No API key provided or configured. Please enter your API key." });
  }

  const model = inputModel || cfg.openaiModel || "gpt-4o-mini";
  const isGemini = apiKey.startsWith("AIza") || model.toLowerCase().includes("gemini") || (!apiKey.startsWith("sk-") && !model.startsWith("gpt"));

  if (isGemini) {
    try {
      const response = await axios.get(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      res.json({
        success: true,
        message: "Google Gemini API authenticated successfully!",
        modelUsed: model,
        modelsCount: response.data?.models?.length || 0
      });
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      res.status(400).json({ success: false, message: "Google Gemini API Error: " + msg });
    }
  } else {
    try {
      const response = await axios.get("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` }
      });
      res.json({
        success: true,
        message: "OpenAI integration authenticated successfully!",
        modelUsed: model,
        modelsCount: response.data?.data?.length || 0
      });
    } catch (err) {
      const msg = err.response?.data?.error?.message || err.message;
      res.status(400).json({ success: false, message: "OpenAI API Error: " + msg });
    }
  }
});

// POST /api/generate-content  →  generate captions using GPT or Gemini
app.post("/api/generate-content", upload.single("file"), async (req, res) => {
  const filePath = req.file?.path ?? null;
  const fileName = req.file?.originalname ?? "";
  const isVideo  = /mp4|mov|avi|mkv/.test(path.extname(fileName).toLowerCase());

  const cfg = loadConfig();
  const apiKey = cfg.openaiApiKey || cfg.geminiApiKey || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    if (filePath && fs.existsSync(filePath)) fs.unlink(filePath, () => {});
    return res.status(400).json({
      success: false,
      message: "AI API Key is not configured. Please go to AI Settings and enter your key."
    });
  }

  let platforms = [];
  try {
    platforms = JSON.parse(req.body.platforms || "[]");
  } catch (e) {
    if (typeof req.body.platforms === "string") {
      platforms = [req.body.platforms];
    }
  }

  if (platforms.length === 0) {
    if (filePath && fs.existsSync(filePath)) fs.unlink(filePath, () => {});
    return res.status(400).json({ success: false, message: "No platforms selected." });
  }

  const contextPrompt = (req.body.context_prompt || "").trim();

  try {
    const targetModel = cfg.openaiModel || "gpt-4o-mini";
    const isGemini = targetModel.startsWith("gemini") || apiKey.startsWith("AIza");
    
    // Construct robust Social Media Prompt instructions
    const systemPrompt = `You are a professional social media manager and SEO copywriter who excels at creating viral, engaging content.
Generate unique, optimized captions, titles, descriptions, and hashtags tailored specifically for each of the following selected platforms: ${platforms.join(", ")}.

Guidelines per platform:
1. Facebook: Catchy, engaging caption (no title needed) + relevant space-separated hashtags.
2. Instagram: Visually narrative style, strong call-to-action + relevant space-separated hashtags.
3. YouTube: Optimized title (short, catchy, searchable) + detailed video description + space-separated tags.
4. TikTok: Short, punchy caption + conversational/trending hashtags.
5. Pinterest: Clean Pin Title (descriptive or aesthetic) + helpful description + relevant hashtags.

Return ONLY a raw JSON object string matching the layout below, replacing appropriate keys. Keep the exact format. Do NOT wrap it in any Markdown code fences (like \`\`\`json) or insert any general remarks.

JSON Output structure:
{
  "facebook": { "caption": "your Facebook caption here", "hashtags": "#tag1 #tag2 #tag3" },
  "instagram": { "caption": "your Instagram caption here", "hashtags": "#tag1 #tag2 #tag3" },
  "youtube": { "title": "Catchy YouTube Title", "description": "Detailed video description here...", "tags": "#tag1 #tag2" },
  "tiktok": { "caption": "Punchy TikTok caption here", "hashtags": "#tag1 #tag2" },
  "pinterest": { "title": "Pin Title here", "description": "Useful pin description...", "hashtags": "#tag1 #tag2" }
}`;

    let gptText = "";

    if (isGemini) {
      try {
        const messages = [{ role: "system", content: systemPrompt }];
        const contentArray = [];
        if (contextPrompt) {
          contentArray.push({ type: "text", text: `User request/context: "${contextPrompt}"` });
        }
        contentArray.push({ type: "text", text: `Uploaded Media Details: File name is "${fileName}", Media type is ${isVideo ? "video" : "image"}.` });

        if (!isVideo && filePath && fs.existsSync(filePath)) {
          const imageBuffer = fs.readFileSync(filePath);
          const base64Image = imageBuffer.toString("base64");
          const ext = path.extname(fileName).toLowerCase().substring(1);
          const mimeType = ext === "png" ? "image/png" : "image/jpeg";
          contentArray.push({
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${base64Image}` }
          });
        }
        messages.push({ role: "user", content: contentArray });

        const geminiRes = await axios.post(
          "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
          { model: targetModel, messages, temperature: 0.7, max_tokens: 1500 },
          { headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` } }
        );
        gptText = geminiRes.data?.choices?.[0]?.message?.content || "";
      } catch (geminiErr) {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`;
        const parts = [];
        if (contextPrompt) parts.push({ text: `User request/context: ${contextPrompt}` });
        parts.push({ text: `Uploaded Media Details: File name is "${fileName}", Media type is ${isVideo ? "video" : "image"}.` });

        if (!isVideo && filePath && fs.existsSync(filePath)) {
          const imageBuffer = fs.readFileSync(filePath);
          const base64Image = imageBuffer.toString("base64");
          const ext = path.extname(fileName).toLowerCase().substring(1);
          const mimeType = ext === "png" ? "image/png" : "image/jpeg";
          parts.push({ inline_data: { mime_type: mimeType, data: base64Image } });
        }

        const nativeRes = await axios.post(geminiUrl, {
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts }]
        });
        gptText = nativeRes.data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      }
    } else {
      const messages = [{ role: "system", content: systemPrompt }];
      const contentArray = [];
      if (contextPrompt) {
        contentArray.push({ type: "text", text: `User request/context: "${contextPrompt}"` });
      }
      contentArray.push({ type: "text", text: `Uploaded Media Details: File name is "${fileName}", Media type is ${isVideo ? "video" : "image"}.` });

      if (!isVideo && filePath && fs.existsSync(filePath)) {
        try {
          const imageBuffer = fs.readFileSync(filePath);
          const base64Image = imageBuffer.toString("base64");
          const ext = path.extname(fileName).toLowerCase().substring(1);
          const mimeType = ext === "png" ? "image/png" : "image/jpeg";
          contentArray.push({
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${base64Image}` }
          });
        } catch (err) {}
      }

      messages.push({ role: "user", content: contentArray });

      const openAiResponse = await axios.post("https://api.openai.com/v1/chat/completions", {
        model: targetModel,
        messages: messages,
        temperature: 0.7,
        max_tokens: 1500
      }, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        }
      });
      gptText = openAiResponse.data?.choices?.[0]?.message?.content || "";
    }
    
    // Clear potential code blocks Markdown wrapper
    gptText = gptText.trim();
    if (gptText.startsWith("```json")) {
      gptText = gptText.substring(7);
    } else if (gptText.startsWith("```")) {
      gptText = gptText.substring(3);
    }
    if (gptText.endsWith("```")) {
      gptText = gptText.substring(0, gptText.length - 3);
    }
    gptText = gptText.trim();

    const parsedJson = JSON.parse(gptText);
    res.json({ success: true, generated: parsedJson });

  } catch (err) {
    const errorDetail = err.response?.data?.error?.message || err.message;
    res.status(500).json({ success: false, message: "AI Content Generation failed: " + errorDetail });
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlink(filePath, () => {});
    }
  }
});

// POST /api/generate-single  →  generate or adjust a single field for a platform
app.post("/api/generate-single", upload.single("file"), async (req, res) => {
  const filePath = req.file?.path ?? null;
  const fileName = req.file?.originalname ?? "";
  const isVideo  = /mp4|mov|avi|mkv/.test(path.extname(fileName).toLowerCase());

  const cfg = loadConfig();
  const apiKey = cfg.openaiApiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    if (filePath && fs.existsSync(filePath)) fs.unlink(filePath, () => {});
    return res.status(400).json({
      success: false,
      message: "OpenAI API Key is not configured. Please configure it in AI Settings."
    });
  }

  const platform = req.body.platform || "facebook";
  const field = req.body.field || "caption"; // caption, hashtags, title, description
  const mode = req.body.mode || "regenerate"; // regenerate, shorten, add_emojis, trending_hashtags
  const currentText = (req.body.current_text || "").trim();
  const contextPrompt = (req.body.context_prompt || "").trim();

  try {
    const targetModel = cfg.openaiModel || "gpt-4o-mini";
    
    let instruction = "";
    if (mode === "shorten") {
      instruction = `Shorten the following text while keeping it engaging and impact-driven for ${platform}. Text to shorten: "${currentText}"`;
    } else if (mode === "add_emojis") {
      instruction = `Add relevant, engaging emojis to the following ${platform} ${field} without changing its main content. Original text: "${currentText}"`;
    } else if (mode === "trending_hashtags") {
      instruction = `Generate 8-15 high-reach, viral space-separated hashtags suitable for ${platform} for content related to: "${contextPrompt || currentText || fileName}". Return ONLY hashtags starting with # separated by spaces.`;
    } else if (field === "hashtags") {
      instruction = `Generate 8-12 targeted, high-converting space-separated hashtags for ${platform}. Return ONLY space-separated hashtags starting with #. Context: "${contextPrompt || fileName}".`;
    } else {
      instruction = `Write a compelling, high-converting social media ${field} specifically tailored for ${platform}. Context/Topic: "${contextPrompt}". File name: "${fileName}".`;
    }

    const systemPrompt = `You are an expert social media manager. Return ONLY the raw output string for the requested ${field}. Do NOT wrap output in JSON, quotes, or Markdown code blocks.`;

    const messages = [
      { role: "system", content: systemPrompt }
    ];

    const contentArray = [{ type: "text", text: instruction }];

    // Image vision support
    if (!isVideo && filePath && fs.existsSync(filePath)) {
      try {
        const imageBuffer = fs.readFileSync(filePath);
        const base64Image = imageBuffer.toString("base64");
        const ext = path.extname(fileName).toLowerCase().substring(1);
        const mimeType = ext === "png" ? "image/png" : "image/jpeg";
        contentArray.push({
          type: "image_url",
          image_url: { url: `data:${mimeType};base64,${base64Image}` }
        });
      } catch (err) {}
    }

    messages.push({ role: "user", content: contentArray });

    const openAiResponse = await axios.post("https://api.openai.com/v1/chat/completions", {
      model: targetModel,
      messages: messages,
      temperature: 0.7,
      max_tokens: 800
    }, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      }
    });

    let resultText = openAiResponse.data?.choices?.[0]?.message?.content || "";
    resultText = resultText.trim().replace(/^["']|["']$/g, '');

    res.json({ success: true, text: resultText });
  } catch (err) {
    const errorDetail = err.response?.data?.error?.message || err.message;
    res.status(500).json({ success: false, message: "AI adjustment failed: " + errorDetail });
  } finally {
    if (filePath && fs.existsSync(filePath)) fs.unlink(filePath, () => {});
  }
});

// ─── Catch-all Static Fallback & Server Export ────────────────────────────────

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/post-to-")) {
    return next();
  }
  const indexPath = path.join(__dirname, "public", "index.html");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send("Not found");
  }
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
}

module.exports = app;

