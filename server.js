const express = require("express");
const multer  = require("multer");
const axios   = require("axios");
const FormData = require("form-data");
const fs   = require("fs");
const path = require("path");
const { google } = require("googleapis");

const app  = express();
const PORT = 3000;
const CONFIG_FILE = path.join(__dirname, "config.json");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadConfig() {
  const defaults = {
    pageId: "", accessToken: "",
    igAccountId: "", igAccessToken: "",
    ytChannelId: "", ytAccessToken: "",
    openaiApiKey: "", openaiModel: "gpt-4o-mini",
    tkClientKey: "", tkAccessToken: "",
    pinAppId: "", pinAccessToken: "", pinBoardId: ""
  };
  if (!fs.existsSync(CONFIG_FILE)) return defaults;
  try { return { ...defaults, ...JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) }; }
  catch { return defaults; }
}

function saveConfig(data) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2));
}

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

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
    const url = `https://graph.facebook.com/${cfg.pageId}?fields=id,name,fan_count,picture&access_token=${cfg.accessToken}`;
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

    const caption = (req.body.caption || "").trim();
    const form = new FormData();
    form.append("access_token", cfg.accessToken);

    if (isVideo) {
      // Post to /videos
      form.append("source",      fs.createReadStream(filePath));
      form.append("description", caption);
      
      const { data } = await axios.post(
        `https://graph.facebook.com/${cfg.pageId}/videos`,
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
        `https://graph.facebook.com/${cfg.pageId}/photos`,
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

// ─── Multi-Platform Publishing ────────────────────────────────────────────────

app.post("/api/publish-multi", upload.single("file"), async (req, res) => {
  const filePath = req.file?.path ?? null;
  const fileName = req.file?.originalname ?? "";
  const isVideo  = /mp4|mov|avi|mkv/.test(path.extname(fileName).toLowerCase());

  if (!filePath) {
    return res.status(400).json({ success: false, message: "No file provided." });
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
    if (fs.existsSync(filePath)) fs.unlink(filePath, () => {});
    return res.status(400).json({ success: false, message: "No platforms selected." });
  }

  const results = {};
  const cfg = loadConfig();

  for (const platform of platforms) {
    try {
      if (platform === "facebook") {
        if (!cfg.pageId || !cfg.accessToken) {
          results.facebook = { success: false, message: "Facebook credentials not configured." };
          continue;
        }
        const captionField = (req.body.fb_caption || "").trim();
        const hashtagsField = (req.body.fb_hashtags || "").trim();
        const fullCaption = hashtagsField ? `${captionField}\n\n${hashtagsField}` : captionField;

        const form = new FormData();
        form.append("access_token", cfg.accessToken);

        if (isVideo) {
          form.append("source", fs.createReadStream(filePath));
          form.append("description", fullCaption);
          const { data } = await axios.post(
            `https://graph.facebook.com/${cfg.pageId}/videos`,
            form,
            { headers: form.getHeaders(), maxContentLength: Infinity, maxBodyLength: Infinity }
          );
          results.facebook = { success: true, message: "Video posted successfully!", post_id: data.id };
        } else {
          form.append("source", fs.createReadStream(filePath));
          form.append("caption", fullCaption);
          const { data } = await axios.post(
            `https://graph.facebook.com/${cfg.pageId}/photos`,
            form,
            { headers: form.getHeaders() }
          );
          results.facebook = { success: true, message: "Photo posted successfully!", post_id: data.post_id || data.id };
        }
      } 
      
      else if (platform === "instagram") {
        if (!cfg.igAccountId || !cfg.igAccessToken) {
          results.instagram = { success: false, message: "Instagram credentials not configured." };
          continue;
        }
        const captionField = (req.body.ig_caption || "").trim();
        const hashtagsField = (req.body.ig_hashtags || "").trim();
        const fullCaption = hashtagsField ? `${captionField}\n\n${hashtagsField}` : captionField;

        const imageUrl = (req.body.image_url || "").trim();
        if (!imageUrl) {
          results.instagram = { 
            success: false, 
            message: "Instagram API requires a public URL for videos/images. Please configure an external storage URL." 
          };
          continue;
        }

        const params = {
          caption: fullCaption,
          access_token: cfg.igAccessToken,
        };
        if (isVideo) {
          params.media_type = "REELS";
          params.video_url = imageUrl;
        } else {
          params.image_url = imageUrl;
        }

        const containerRes = await axios.post(
          `https://graph.facebook.com/v21.0/${cfg.igAccountId}/media`,
          null,
          { params }
        );
        const creationId = containerRes.data.id;

        const publishRes = await axios.post(
          `https://graph.facebook.com/v21.0/${cfg.igAccountId}/media_publish`,
          null,
          {
            params: {
              creation_id: creationId,
              access_token: cfg.igAccessToken,
            },
          }
        );
        results.instagram = { success: true, message: "Posted successfully!", post_id: publishRes.data.id };
      } 
      
      else if (platform === "youtube") {
        if (!cfg.ytAccessToken) {
          results.youtube = { success: false, message: "YouTube credentials not configured." };
          continue;
        }
        if (!isVideo) {
          results.youtube = { success: false, message: "YouTube requires a video file." };
          continue;
        }

        const oauth2Client = new google.auth.OAuth2();
        oauth2Client.setCredentials({ access_token: cfg.ytAccessToken });
        const youtube = google.youtube({ version: "v3", auth: oauth2Client });

        const title = req.body.yt_title || "New Video";
        const descField = (req.body.yt_description || "").trim();
        const tagsField = (req.body.yt_tags || "").trim();
        const fullDesc = tagsField ? `${descField}\n\n${tagsField}` : descField;

        const response = await youtube.videos.insert({
          part: "snippet,status",
          requestBody: {
            snippet: {
              title: title,
              description: fullDesc,
            },
            status: {
              privacyStatus: "public",
            },
          },
          media: {
            body: fs.createReadStream(filePath),
          },
        });
        results.youtube = { success: true, message: "Uploaded to YouTube successfully!", post_id: response.data.id };
      } 
      
      else if (platform === "tiktok") {
        if (!cfg.tkAccessToken) {
          results.tiktok = { success: false, message: "TikTok credentials not configured." };
          continue;
        }
        if (!isVideo) {
          results.tiktok = { success: false, message: "TikTok requires a video file." };
          continue;
        }

        const tkCaption = (req.body.tk_caption || "").trim();
        const tkHashtags = (req.body.tk_hashtags || "").trim();
        const fullCaption = tkHashtags ? `${tkCaption} ${tkHashtags}` : tkCaption;
        const fileSize = fs.statSync(filePath).size;

        // Step 1: Initialize Video Upload
        const initRes = await axios.post(
          "https://open.tiktokapis.com/v2/post/publish/video/init/",
          {
            post_info: {
              title: fullCaption.slice(0, 150), // TikTok title field helper length limit
              privacy_level: "PUBLIC_TO_EVERYONE",
              video_cover_timestamp_ms: 1000
            },
            source_info: {
              source: "FILE_UPLOAD",
              video_size: fileSize
            }
          },
          {
            headers: {
              Authorization: `Bearer ${cfg.tkAccessToken}`,
              "Content-Type": "application/json"
            }
          }
        );

        if (initRes.data?.error?.code !== "ok") {
          throw new Error(initRes.data?.error?.message || "Failed initializing TikTok video upload.");
        }

        const uploadUrl = initRes.data.data.upload_url;
        const publishId = initRes.data.data.publish_id;

        // Step 2: Upload Video File Content via PUT
        await axios.put(uploadUrl, fs.createReadStream(filePath), {
          headers: {
            "Content-Type": "video/mp4",
            "Content-Length": fileSize
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity
        });

        results.tiktok = { success: true, message: "Video uploaded/queued on TikTok!", post_id: publishId };
      } 
      
      else if (platform === "pinterest") {
        if (!cfg.pinAccessToken) {
          results.pinterest = { success: false, message: "Pinterest credentials not configured." };
          continue;
        }
        if (!cfg.pinBoardId) {
          results.pinterest = { success: false, message: "Pinterest requires a Board ID. Please set it in Pinterest Settings." };
          continue;
        }

        const pinTitle = (req.body.pin_title || "Pin from Social Dashboard").trim();
        const pinDesc = (req.body.pin_description || "").trim();
        const pinHashtags = (req.body.pin_hashtags || "").trim();
        const fullDesc = pinHashtags ? `${pinDesc}\n\n${pinHashtags}` : pinDesc;

        // Pinterest requires an accessible URL
        const imageUrl = (req.body.image_url || "").trim();
        if (!imageUrl) {
          results.pinterest = { success: false, message: "Pinterest API requires a public image URL. Please enter one in the Instagram URL/Pinterest field." };
          continue;
        }

        const pinRes = await axios.post(
          "https://api.pinterest.com/v5/pins",
          {
            title: pinTitle.slice(0, 100),
            description: fullDesc.slice(0, 800),
            board_id: cfg.pinBoardId,
            media_source: {
              source_type: "image_url",
              url: imageUrl
            }
          },
          {
            headers: {
              Authorization: `Bearer ${cfg.pinAccessToken}`,
              "Content-Type": "application/json"
            }
          }
        );

        results.pinterest = { success: true, message: "Pin created successfully!", post_id: pinRes.data.id };
      }
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
//  OPENAI AI ASSISTANT API
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/ai/settings  →  return current OpenAI settings (key masked)
app.get("/api/ai/settings", (_req, res) => {
  const cfg = loadConfig();
  res.json({
    openaiApiKey: cfg.openaiApiKey
      ? cfg.openaiApiKey.slice(0, 8) + "••••••••" + cfg.openaiApiKey.slice(-4)
      : "",
    openaiModel: cfg.openaiModel || "gpt-4o-mini",
    connected: !!(cfg.openaiApiKey || process.env.OPENAI_API_KEY)
  });
});

// POST /api/ai/settings  →  save OpenAI settings
app.post("/api/ai/settings", (req, res) => {
  const { openaiApiKey, openaiModel } = req.body;
  if (!openaiApiKey) {
    return res.status(400).json({ success: false, message: "OpenAI API Key is required." });
  }
  const cfg = loadConfig();
  cfg.openaiApiKey = openaiApiKey.trim();
  cfg.openaiModel = (openaiModel || "gpt-4o-mini").trim();
  saveConfig(cfg);
  res.json({ success: true, message: "AI settings saved successfully." });
});

// POST /api/ai/test-connection  →  test OpenAI credentials
app.post("/api/ai/test-connection", async (_req, res) => {
  const cfg = loadConfig();
  const apiKey = cfg.openaiApiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(400).json({ success: false, message: "No OpenAI API key configured." });
  }

  try {
    // Validate by fetching models
    const response = await axios.get("https://api.openai.com/v1/models", {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });
    
    // Check if configuration has model, verify it's standard or default
    res.json({
      success: true,
      message: "OpenAI integration authenticated successfully!",
      modelUsed: cfg.openaiModel || "gpt-4o-mini",
      modelsCount: response.data?.data?.length || 0
    });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(400).json({ success: false, message: msg });
  }
});

// POST /api/generate-content  →  generate captions using GPT
app.post("/api/generate-content", upload.single("file"), async (req, res) => {
  const filePath = req.file?.path ?? null;
  const fileName = req.file?.originalname ?? "";
  const isVideo  = /mp4|mov|avi|mkv/.test(path.extname(fileName).toLowerCase());

  const cfg = loadConfig();
  const apiKey = cfg.openaiApiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    if (filePath && fs.existsSync(filePath)) fs.unlink(filePath, () => {});
    return res.status(400).json({
      success: false,
      message: "OpenAI API Key is not configured. Please go to AI Settings and enter your key."
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

    const messages = [
      { role: "system", content: systemPrompt }
    ];

    const contentArray = [];
    if (contextPrompt) {
      contentArray.push({ type: "text", text: `User request/context: "${contextPrompt}"` });
    }
    contentArray.push({ type: "text", text: `Uploaded Media Details: File name is "${fileName}", Media type is ${isVideo ? "video" : "image"}.` });

    // If it's an image, we can send it directly via Vision to get incredibly accurate descriptions
    if (!isVideo && filePath && fs.existsSync(filePath)) {
      try {
        const imageBuffer = fs.readFileSync(filePath);
        const base64Image = imageBuffer.toString("base64");
        const ext = path.extname(fileName).toLowerCase().substring(1);
        const mimeType = ext === "png" ? "image/png" : "image/jpeg";
        
        contentArray.push({
          type: "image_url",
          image_url: {
            url: `data:${mimeType};base64,${base64Image}`
          }
        });
      } catch (err) {
        console.error("Failed to base64 encode cover image: ", err);
      }
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

    let gptText = openAiResponse.data?.choices?.[0]?.message?.content || "";
    
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

// ─── Start ────────────────────────────────────────────────────────────────────


app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
