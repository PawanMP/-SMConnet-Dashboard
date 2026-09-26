// AI content generation (captions, hashtags, titles, descriptions) using
// OpenAI, Google Gemini or OpenRouter. A user's own API key takes precedence
// over the server's key. Keys never leave the server.
const config = require("../config");
const http = require("../lib/http");
const settingsModel = require("../models/settings");
const mediaModel = require("../models/media");
const { decrypt } = require("../lib/crypto");
const { AppError } = require("../lib/errors");
const { normalizeHashtags } = require("./platforms/common");

const TONES = ["professional", "friendly", "casual", "humorous", "inspirational", "promotional", "educational"];
const MODES = ["regenerate", "shorten", "expand", "rephrase"];
const FIELDS = ["caption", "hashtags", "title", "description"];

const PLATFORM_RULES = {
  facebook: { fields: ["caption", "hashtags"], guide: "Conversational caption that invites comments; 3-6 relevant hashtags.", limits: { caption: 2000 } },
  instagram: { fields: ["caption", "hashtags"], guide: "Visual, story-driven caption with a clear call to action; 8-15 hashtags (never more than 30).", limits: { caption: 2000 } },
  youtube: { fields: ["title", "description", "hashtags"], guide: "Searchable title under 70 characters; description with a strong first two lines and a short summary; 5-10 tags.", limits: { title: 100, description: 4500 } },
  tiktok: { fields: ["caption", "hashtags"], guide: "Short, punchy caption with a hook in the first line; 3-6 trending-style hashtags.", limits: { caption: 1500 } },
  pinterest: { fields: ["title", "description", "hashtags"], guide: "Descriptive, keyword-rich Pin title under 100 characters; helpful description under 500 characters; 3-6 hashtags.", limits: { title: 100, description: 700 } },
};

const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}]/gu;

const PROVIDERS = ["openai", "gemini", "openrouter"];
const PROVIDER_LABEL = { openai: "OpenAI", gemini: "Google Gemini", openrouter: "OpenRouter" };

function serverKey(provider) {
  return { openai: config.ai.openaiApiKey, gemini: config.ai.geminiApiKey, openrouter: config.ai.openrouterApiKey }[provider];
}

function defaultModelFor(provider) {
  return { openai: config.ai.openaiModel, gemini: config.ai.geminiModel, openrouter: config.ai.openrouterModel }[provider];
}

// OpenRouter keys start with "sk-or-", Gemini keys start with "AIza"; anything
// else is assumed to be an OpenAI key.
function guessProvider(key) {
  if (/^sk-or-/.test(key)) return "openrouter";
  if (/^AIza/.test(key)) return "gemini";
  return "openai";
}

// OpenRouter model names are "vendor/model" (e.g. "openai/gpt-4o-mini");
// Gemini model names start with "gemini"; anything else is a plain OpenAI name.
function modelFits(provider, model) {
  if (!model) return false;
  if (provider === "openrouter") return model.includes("/");
  if (provider === "gemini") return /^gemini/i.test(model);
  return !/^gemini/i.test(model) && !model.includes("/");
}

// Picks provider, key and model: personal key first, then the server's keys.
async function resolveEngine(userId) {
  const s = await settingsModel.getRaw(userId);
  let personalKey = null;
  if (s.ai_api_key_enc) {
    try {
      personalKey = decrypt(s.ai_api_key_enc);
    } catch {
      personalKey = null;
    }
  }
  let provider;
  let apiKey;
  let source;
  if (personalKey) {
    provider = s.ai_provider || guessProvider(personalKey);
    apiKey = personalKey;
    source = "personal";
  } else {
    provider = s.ai_provider || config.ai.defaultProvider;
    apiKey = serverKey(provider);
    if (!apiKey) {
      // Fall back to whichever server key is actually configured.
      const fallback = PROVIDERS.find((p) => p !== provider && serverKey(p));
      if (fallback) {
        provider = fallback;
        apiKey = serverKey(fallback);
      }
    }
    source = apiKey ? "server" : null;
  }
  return {
    provider,
    apiKey,
    source,
    model: modelFits(provider, s.ai_model) ? s.ai_model : defaultModelFor(provider),
    allowEmojis: !!Number(s.allow_emojis),
    defaultTone: s.default_tone || "friendly",
  };
}

async function status(userId) {
  const e = await resolveEngine(userId);
  return {
    available: !!e.apiKey,
    provider: e.apiKey ? e.provider : null,
    model: e.apiKey ? e.model : null,
    source: e.source,
    serverProviders: { openai: !!config.ai.openaiApiKey, gemini: !!config.ai.geminiApiKey, openrouter: !!config.ai.openrouterApiKey },
    tones: TONES,
  };
}

function requireEngine(engine) {
  if (!engine.apiKey) {
    throw new AppError(503, "AI_NOT_CONFIGURED", "AI is not set up. Add an OpenAI, Gemini or OpenRouter API key in AI Settings, or ask the administrator to add one.");
  }
}

// Image context for vision models: a small JPEG frame of the chosen media.
async function imageInput(userId, mediaId) {
  if (!mediaId) return null;
  const media = await mediaModel.findForUser(mediaId, userId);
  if (!media) return null;
  const publicMedia = mediaModel.toPublic(media);
  if (media.provider === "cloudinary") {
    const url = publicMedia.thumbnailUrl ? publicMedia.thumbnailUrl.replace(/\.(png|webp|gif)$/i, ".jpg") : null;
    return url ? { url, mime: "image/jpeg" } : null;
  }
  if (media.resource_type !== "image" || Number(media.size_bytes) > 4 * 1024 * 1024) return null;
  const buffer = await require("./media").readBuffer(media);
  return { base64: buffer.toString("base64"), mime: media.mime_type || "image/jpeg" };
}

function aiError(provider, err) {
  const res = err.response;
  const msg = (res && res.data && res.data.error && (res.data.error.message || res.data.error.status)) || err.message;
  const label = PROVIDER_LABEL[provider] || provider;
  if (res && (res.status === 401 || res.status === 403)) return new AppError(502, "AI_AUTH_FAILED", `${label} rejected the API key. Check the key in AI Settings.`);
  if (res && res.status === 429) return new AppError(429, "AI_RATE_LIMITED", `${label} rate limit or quota reached. Try again shortly.`);
  return new AppError(502, "AI_PROVIDER_ERROR", `${label} request failed: ${msg}`);
}

// OpenRouter is OpenAI-compatible (same request/response shape), just a
// different host, and it asks for these two extra identifying headers.
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
function openrouterHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "HTTP-Referer": config.appUrl, "X-Title": "Social Poster" };
}

async function completeJson(engine, system, prompt, image) {
  try {
    if (engine.provider === "gemini") {
      const parts = [{ text: prompt }];
      if (image) {
        let data = image.base64;
        if (!data && image.url) {
          const res = await http.get(image.url, { responseType: "arraybuffer", timeout: 20000, maxContentLength: 8 * 1024 * 1024 });
          data = Buffer.from(res.data).toString("base64");
        }
        if (data) parts.push({ inline_data: { mime_type: image.mime, data } });
      }
      const { data } = await http.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(engine.model)}:generateContent`,
        {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.8 },
        },
        { headers: { "x-goog-api-key": engine.apiKey, "Content-Type": "application/json" }, timeout: 60000 }
      );
      const text = (((data.candidates || [])[0] || {}).content || {}).parts || [];
      return parseJson(text.map((p) => p.text || "").join(""));
    }

    const content = [{ type: "text", text: prompt }];
    if (image) content.push({ type: "image_url", image_url: { url: image.url || `data:${image.mime};base64,${image.base64}` } });
    const messages = [
      { role: "system", content: system },
      { role: "user", content },
    ];

    if (engine.provider === "openrouter") {
      // Routed to many different underlying models, some of which reject an
      // unsupported response_format, so JSON output relies on the prompt
      // instructions plus the fence-stripping in parseJson below.
      const { data } = await http.post(
        OPENROUTER_URL,
        { model: engine.model, messages, temperature: 0.8, max_tokens: 2000 },
        { headers: openrouterHeaders(engine.apiKey), timeout: 60000 }
      );
      if (data.error) throw Object.assign(new Error(data.error.message || "OpenRouter request failed"), { response: { status: data.error.code, data } });
      return parseJson(((data.choices || [])[0] || {}).message?.content || "");
    }

    const reasoningModel = /^(o\d|gpt-5)/i.test(engine.model);
    const { data } = await http.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: engine.model,
        messages,
        response_format: { type: "json_object" },
        ...(reasoningModel ? {} : { temperature: 0.8 }),
        max_completion_tokens: 2000,
      },
      { headers: { Authorization: `Bearer ${engine.apiKey}`, "Content-Type": "application/json" }, timeout: 60000 }
    );
    return parseJson(((data.choices || [])[0] || {}).message?.content || "");
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw aiError(engine.provider, err);
  }
}

function parseJson(text) {
  const cleaned = String(text || "")
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new AppError(502, "AI_BAD_RESPONSE", "The AI returned an unexpected response. Please try again.");
  }
}

function clean(value, { allowEmojis, max, hashtags }) {
  let s = Array.isArray(value) ? value.join(" ") : String(value || "");
  if (!allowEmojis) s = s.replace(EMOJI, "").replace(/[ \t]{2,}/g, " ");
  s = s.trim();
  if (hashtags) s = normalizeHashtags(s);
  if (max && s.length > max) s = s.slice(0, max).replace(/\s+\S*$/, "").trim();
  return s;
}

function systemPrompt(engine, tone) {
  return [
    "You are an expert social media copywriter.",
    `Write in a ${tone} tone. Be specific to the user's topic and the attached image if one is provided.`,
    engine.allowEmojis ? "Emojis are allowed but use them sparingly." : "Do not use any emojis or emoticons.",
    "Hashtags must be single words or CamelCase phrases prefixed with #, separated by spaces.",
    "Never invent facts such as prices, dates or statistics that the user did not give.",
    "Respond with a single JSON object only.",
  ].join(" ");
}

async function generate(userId, { platforms, context, tone, mediaId }) {
  const engine = await resolveEngine(userId);
  requireEngine(engine);
  const useTone = tone || engine.defaultTone;
  const shape = {};
  const guides = [];
  for (const p of platforms) {
    const rule = PLATFORM_RULES[p];
    shape[p] = Object.fromEntries(rule.fields.map((f) => [f, "..."]));
    guides.push(`- ${p}: ${rule.guide}`);
  }
  const prompt = [
    `Topic / context from the user: ${context ? `"${context}"` : "(none given - describe the attached media)"}`,
    "Create platform-specific content for:",
    ...guides,
    `Return JSON exactly in this shape: ${JSON.stringify(shape)}`,
  ].join("\n");

  const raw = await completeJson(engine, systemPrompt(engine, useTone), prompt, await imageInput(userId, mediaId).catch(() => null));
  const result = {};
  for (const p of platforms) {
    const src = raw[p] || {};
    const limits = PLATFORM_RULES[p].limits;
    result[p] = {};
    for (const f of PLATFORM_RULES[p].fields) {
      const value = f === "hashtags" ? src.hashtags || src.tags : src[f];
      result[p][f] = clean(value, { allowEmojis: engine.allowEmojis, max: limits[f], hashtags: f === "hashtags" });
    }
  }
  return { content: result, provider: engine.provider, model: engine.model, tone: useTone };
}

const MODE_TEXT = {
  regenerate: "Write a fresh alternative",
  shorten: "Rewrite it to be about half as long while keeping the key message",
  expand: "Rewrite it with more detail and a stronger call to action",
  rephrase: "Rephrase it with different wording and the same meaning",
};

async function rewrite(userId, { platform, field, mode, currentText, context, tone, mediaId }) {
  const engine = await resolveEngine(userId);
  requireEngine(engine);
  const useTone = tone || engine.defaultTone;
  const rule = PLATFORM_RULES[platform];
  const what = field === "hashtags" ? "a set of hashtags" : `a ${field}`;
  const prompt = [
    `Platform: ${platform}. Guidance: ${rule.guide}`,
    `Topic / context: ${context ? `"${context}"` : "(not given)"}`,
    currentText ? `Current ${field}: """${currentText}"""` : `There is no current ${field}; write a new one.`,
    `${currentText ? MODE_TEXT[mode] : "Write"} ${what} for this post.`,
    'Return JSON: {"text": "..."}',
  ].join("\n");
  const raw = await completeJson(engine, systemPrompt(engine, useTone), prompt, await imageInput(userId, mediaId).catch(() => null));
  const text = clean(raw.text, { allowEmojis: engine.allowEmojis, max: rule.limits[field], hashtags: field === "hashtags" });
  return { text, provider: engine.provider, model: engine.model, tone: useTone };
}

// Thumbnail images are generated with OpenAI's image model, regardless of
// which provider handles text: Gemini/OpenRouter have no equivalent endpoint
// wired up here, and vision-capable text keys can't generate images.
const IMAGE_MODEL = "gpt-image-1";

function openaiImageKey(engine) {
  if (engine.provider === "openai" && engine.apiKey) return engine.apiKey;
  return config.ai.openaiApiKey || null;
}

async function generateThumbnail(userId, { title, context, tone }) {
  const engine = await resolveEngine(userId);
  const apiKey = openaiImageKey(engine);
  if (!apiKey) {
    throw new AppError(503, "AI_IMAGE_NOT_CONFIGURED", "Thumbnail generation needs an OpenAI API key. Add one in AI Settings.");
  }
  const useTone = tone || engine.defaultTone;
  const prompt = [
    "Design a bold, highly clickable YouTube video thumbnail image, 16:9 landscape.",
    title ? `Video title: "${title}".` : "",
    context ? `The video is about: ${context}.` : "",
    `Style: ${useTone}, vivid colors, strong contrast, a single clear focal point, cinematic lighting.`,
    "Do not render any text, captions, watermarks or logos in the image.",
  ]
    .filter(Boolean)
    .join(" ");
  try {
    const { data } = await http.post(
      "https://api.openai.com/v1/images/generations",
      { model: IMAGE_MODEL, prompt, size: "1536x1024", n: 1 },
      { headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, timeout: 120000 }
    );
    const b64 = ((data.data || [])[0] || {}).b64_json;
    if (!b64) throw new AppError(502, "AI_BAD_RESPONSE", "The AI did not return an image. Please try again.");
    const buffer = Buffer.from(b64, "base64");
    const media = await require("./media").storeGenerated(userId, buffer, { mimeType: "image/png", originalName: "ai-thumbnail.png" });
    return { media: mediaModel.toPublic(media), provider: "openai", model: IMAGE_MODEL };
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw aiError("openai", err);
  }
}

// Verifies a key (the one being entered, or the stored one) with a cheap call.
async function testKey(userId, { apiKey, provider, model }) {
  const engine = await resolveEngine(userId);
  const e = apiKey ? { ...engine, apiKey, provider: provider || guessProvider(apiKey), model: model || engine.model } : engine;
  if (apiKey && !modelFits(e.provider, e.model)) e.model = defaultModelFor(e.provider);
  requireEngine(e);
  try {
    if (e.provider === "gemini") {
      await http.get(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(e.model)}`, { headers: { "x-goog-api-key": e.apiKey }, timeout: 15000 });
    } else if (e.provider === "openrouter") {
      // Confirms the key itself is valid; independent of which model is chosen.
      await http.get("https://openrouter.ai/api/v1/auth/key", { headers: openrouterHeaders(e.apiKey), timeout: 15000 });
    } else {
      await http.get(`https://api.openai.com/v1/models/${encodeURIComponent(e.model)}`, { headers: { Authorization: `Bearer ${e.apiKey}` }, timeout: 15000 });
    }
  } catch (err) {
    throw aiError(e.provider, err);
  }
  return { ok: true, provider: e.provider, model: e.model, source: apiKey ? "entered" : e.source };
}

module.exports = { TONES, MODES, FIELDS, PLATFORM_RULES, PROVIDERS, PROVIDER_LABEL, status, generate, rewrite, generateThumbnail, testKey, resolveEngine };
