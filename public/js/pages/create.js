// Post composer: media, platforms, shared + per-platform content, AI help,
// and publish now / schedule / save as draft. Also edits drafts and scheduled posts.
import { api, uploadWithProgress, ApiError } from "../core/api.js";
import { mountLayout } from "../core/layout.js";
import { hydrateIcons } from "../core/page.js";
import { icon, platformIcon, PLATFORMS, PLATFORM_LABEL } from "../core/icons.js";
import {
  $, $$, esc, fmt, params, busy, toast, toastError, errorAlert, alertHtml, openDialog,
  toLocalInput, fromLocalInput, localZone, statusBadge, emptyState, setLoading,
} from "../core/ui.js";

// Mirrors the server's per-platform rules so problems show before submitting.
const RULES = {
  facebook: { fields: ["caption", "hashtags"], limits: { text: 63206 }, media: "optional" },
  instagram: { fields: ["caption", "hashtags"], limits: { text: 2200 }, media: "required", maxTags: 30 },
  youtube: { fields: ["title", "description", "hashtags"], limits: { title: 100, description: 5000 }, media: "video" },
  tiktok: { fields: ["caption", "hashtags"], limits: { text: 2200 }, media: "video" },
  pinterest: { fields: ["title", "description", "hashtags", "link"], limits: { title: 100, description: 800 }, media: "required" },
};
const FIELD_META = {
  title: { label: "Title", multiline: false, max: 255, placeholder: "Used by YouTube and Pinterest" },
  caption: { label: "Caption", multiline: true, max: 5000, placeholder: "Write your post..." },
  description: { label: "Description", multiline: true, max: 5000, placeholder: "Longer text for YouTube and Pinterest" },
  hashtags: { label: "Hashtags", multiline: false, max: 1000, placeholder: "#summer #sale" },
  link: { label: "Destination link", multiline: false, max: 2048, placeholder: "https://example.com/page" },
};

const state = {
  postId: null,
  status: null,
  media: null,
  uploading: false,
  platforms: new Set(),
  fields: { title: "", caption: "", description: "", hashtags: "" },
  overrides: {},
  tab: "all",
  mode: "publish",
  perPlatform: false,
  accounts: {},
  ai: null,
  mediaConfig: null,
  dirty: false,
  locked: false,
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const normalizeTags = (v) => {
  const seen = new Set();
  return String(v || "")
    .split(/[\s,]+/)
    .map((w) => w.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, ""))
    .filter((w) => w && !seen.has(w.toLowerCase()) && seen.add(w.toLowerCase()))
    .map((w) => `#${w}`);
};
const join = (a, b, sep = "\n\n") => [String(a || "").trim(), String(b || "").trim()].filter(Boolean).join(sep);
const firstLine = (t) => (String(t || "").split(/\r?\n/).find((l) => l.trim()) || "").trim().slice(0, 100);

function value(platform, field) {
  const o = (state.overrides[platform] || {})[field];
  return o !== undefined && String(o).trim() !== "" ? String(o).trim() : String(state.fields[field] || "").trim();
}

// The text each platform will actually receive (same logic as the server).
function resolved(platform) {
  const tags = normalizeTags(value(platform, "hashtags")).join(" ");
  const caption = value(platform, "caption");
  const description = value(platform, "description");
  const title = value(platform, "title");
  if (platform === "youtube") return { title: title || firstLine(caption) || "New video", description: join(description || caption, tags), tagCount: tags ? tags.split(" ").length : 0 };
  if (platform === "pinterest") return { title: title || firstLine(caption), description: join(description || caption, tags), tagCount: tags ? tags.split(" ").length : 0 };
  return { text: join(caption, tags, platform === "tiktok" ? " " : "\n\n"), tagCount: tags ? tags.split(" ").length : 0 };
}

function markDirty() {
  state.dirty = true;
  renderChecklist();
}

// ── Media ─────────────────────────────────────────────────────────────────────
function renderMedia(progress) {
  const area = $("#media-area");
  if (state.uploading) {
    area.innerHTML = `<div class="stack-sm"><div class="row"><span class="spinner"></span><strong>Uploading ${esc(state.uploading.name)}</strong><span class="muted small">${fmt.bytes(state.uploading.size)}</span></div>
      <div class="progress" aria-label="Upload progress"><span style="width:${Math.round((progress || 0) * 100)}%"></span></div></div>`;
    return;
  }
  if (state.media) {
    const m = state.media;
    const view = m.resourceType === "video" ? `<video src="${esc(m.url)}" controls preload="metadata"></video>` : `<img src="${esc(m.url)}" alt="Selected media" />`;
    area.innerHTML = `<div class="media-preview">${view}</div>
      <div class="media-meta">
        <span class="badge badge-neutral">${icon(m.resourceType === "video" ? "video" : "image")}${m.resourceType === "video" ? "Video" : "Image"}</span>
        <span class="small muted truncate">${esc(m.originalName || "")} ${m.sizeBytes ? `- ${fmt.bytes(m.sizeBytes)}` : ""}</span>
        <span class="grow"></span>
        <button type="button" class="btn btn-secondary btn-sm" id="replace-media" ${state.locked ? "disabled" : ""}>${icon("upload")}Replace</button>
        <button type="button" class="btn btn-danger-outline btn-sm" id="remove-media" ${state.locked ? "disabled" : ""}>${icon("trash")}Remove</button>
      </div>`;
    $("#replace-media").addEventListener("click", () => $("#file-input").click());
    $("#remove-media").addEventListener("click", () => {
      state.media = null;
      renderMedia();
      markDirty();
    });
  } else {
    const cfg = state.mediaConfig;
    const limits = cfg ? `Images up to ${fmt.bytes(cfg.maxImageBytes)}, videos up to ${fmt.bytes(cfg.maxVideoBytes)}` : "";
    area.innerHTML = `<div class="dropzone" id="dropzone" tabindex="0" role="button" aria-label="Upload a photo or video">
        <div class="dropzone-icon">${icon("upload")}</div>
        <div class="dropzone-title">Drag and drop a photo or video</div>
        <div class="small muted mt-8">JPG, PNG, GIF, WEBP, MP4, MOV or WEBM. ${esc(limits)}</div>
        <div class="row">
          <button type="button" class="btn btn-primary" id="choose-file">${icon("upload")}Choose file</button>
          <button type="button" class="btn btn-secondary" id="open-library">${icon("image")}Media library</button>
        </div>
      </div>`;
    const dz = $("#dropzone");
    $("#choose-file").addEventListener("click", (e) => {
      e.stopPropagation();
      $("#file-input").click();
    });
    $("#open-library").addEventListener("click", (e) => {
      e.stopPropagation();
      openLibrary();
    });
    dz.addEventListener("click", () => $("#file-input").click());
    dz.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), $("#file-input").click()));
    dz.addEventListener("dragover", (e) => {
      e.preventDefault();
      dz.classList.add("drag");
    });
    dz.addEventListener("dragleave", () => dz.classList.remove("drag"));
    dz.addEventListener("drop", (e) => {
      e.preventDefault();
      dz.classList.remove("drag");
      if (e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0]);
    });
  }
}

async function uploadFile(file) {
  const cfg = state.mediaConfig;
  const isVideo = cfg.videoTypes.includes(file.type);
  const isImage = cfg.imageTypes.includes(file.type);
  if (!isVideo && !isImage) return toast("That file type is not supported. Use JPG, PNG, GIF, WEBP, MP4, MOV or WEBM.", "error");
  const limit = isVideo ? cfg.maxVideoBytes : cfg.maxImageBytes;
  if (file.size > limit) return toast(`${isVideo ? "Videos" : "Images"} must be ${fmt.bytes(limit)} or smaller.`, "error");

  state.uploading = file;
  renderMedia(0);
  try {
    let media;
    if (cfg.directUpload) {
      const resourceType = isVideo ? "video" : "image";
      const sig = await api.post("/api/media/signature", { resourceType });
      const form = new FormData();
      for (const [k, v] of Object.entries(sig.fields)) form.append(k, v);
      form.append("file", file);
      const uploaded = await uploadWithProgress(sig.uploadUrl, form, { onProgress: renderMedia, withCredentials: false });
      media = (
        await api.post("/api/media/complete", {
          publicId: uploaded.public_id,
          version: String(uploaded.version),
          signature: uploaded.signature,
          resourceType,
          originalName: file.name.slice(0, 255),
        })
      ).media;
    } else {
      const form = new FormData();
      form.append("file", file);
      media = (await uploadWithProgress("/api/media/upload", form, { onProgress: renderMedia, headers: { "X-Requested-With": "fetch" } })).media;
    }
    state.media = media;
    toast("Media uploaded.", "success");
    markDirty();
  } catch (err) {
    toastError(err, "Upload failed.");
  } finally {
    state.uploading = false;
    renderMedia();
    renderChecklist();
  }
}

async function openLibrary() {
  const body = document.createElement("div");
  setLoading(body, "Loading your media...");
  const pick = openDialog({ title: "Media library", body, wide: true, actions: [{ label: "Close", variant: "btn-secondary" }] });
  try {
    const { items } = await api.get("/api/media?pageSize=48");
    if (!items.length) {
      body.innerHTML = emptyState({ iconName: "image", title: "No uploads yet", text: "Files you upload appear here so you can reuse them." });
      return;
    }
    body.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px">${items
      .map(
        (m) => `<button type="button" class="card" data-media="${m.id}" style="padding:0;overflow:hidden;cursor:pointer;text-align:left">
          ${m.thumbnailUrl ? `<img src="${esc(m.thumbnailUrl)}" alt="" style="width:100%;height:100px;object-fit:cover" loading="lazy">` : `<span class="thumb" style="width:100%;height:100px;border-radius:0">${icon(m.resourceType === "video" ? "video" : "image")}</span>`}
          <span class="small" style="display:block;padding:6px 8px"><span class="truncate" style="display:block">${esc(m.originalName || `${m.resourceType} #${m.id}`)}</span><span class="muted">${fmt.date(m.createdAt)}</span></span>
        </button>`
      )
      .join("")}</div>`;
    body.querySelectorAll("[data-media]").forEach((b) =>
      b.addEventListener("click", () => {
        state.media = items.find((m) => String(m.id) === b.dataset.media);
        renderMedia();
        markDirty();
        body.closest("dialog").close();
      })
    );
  } catch (err) {
    body.innerHTML = errorAlert(err);
  }
  await pick;
}

// ── Platforms ─────────────────────────────────────────────────────────────────
function platformStatus(p) {
  const a = state.accounts[p];
  if (!a || a.status === "not_connected") return { text: "Not connected", warn: true };
  if (a.status === "expired") return { text: "Reconnect needed", warn: true };
  if (p === "pinterest" && !(a.resource && a.resource.id)) return { text: "Choose a board", warn: true };
  return { text: a.accountName ? `as ${a.accountName}` : "Connected", warn: false };
}

function renderPlatforms() {
  $("#platforms").innerHTML = PLATFORMS.map((p) => {
    const s = platformStatus(p.id);
    return `<div class="pf-option">
      <input type="checkbox" id="pf-${p.id}" value="${p.id}" ${state.platforms.has(p.id) ? "checked" : ""} ${state.locked ? "disabled" : ""} />
      <label for="pf-${p.id}">${platformIcon(p.id)}<span class="pf-text"><div class="pf-name">${p.label}</div><div class="pf-status truncate ${s.warn ? "warn" : ""}">${esc(s.text)}</div></span><span class="checkmark">${icon("check")}</span></label>
    </div>`;
  }).join("");
  $$("#platforms input").forEach((cb) =>
    cb.addEventListener("change", () => {
      if (cb.checked) state.platforms.add(cb.value);
      else state.platforms.delete(cb.value);
      if (!state.platforms.has(state.tab)) state.tab = "all";
      renderTabs();
      renderPerPlatformTimes();
      markDirty();
    })
  );
}

// ── Content tabs ──────────────────────────────────────────────────────────────
function selectedList() {
  return PLATFORMS.map((p) => p.id).filter((p) => state.platforms.has(p));
}

function isCustomised(p) {
  return Object.values(state.overrides[p] || {}).some((v) => String(v || "").trim());
}

function counterFor(platform, field) {
  if (platform === "all") {
    const len = state.fields[field].length;
    return `${fmt.number(len)} / ${fmt.number(FIELD_META[field].max)}`;
  }
  return "";
}

function fieldHtml(scope, field) {
  const meta = FIELD_META[field];
  const id = `f-${scope}-${field}`;
  const isShared = scope === "all";
  const current = isShared ? state.fields[field] : (state.overrides[scope] || {})[field] || "";
  const placeholder = isShared ? meta.placeholder : state.fields[field] ? `Shared: ${state.fields[field].slice(0, 80)}` : meta.placeholder;
  const input = meta.multiline
    ? `<textarea class="textarea" id="${id}" data-scope="${scope}" data-field="${field}" maxlength="${meta.max}" placeholder="${esc(placeholder)}" ${state.locked ? "disabled" : ""}>${esc(current)}</textarea>`
    : `<input class="input" id="${id}" data-scope="${scope}" data-field="${field}" maxlength="${meta.max}" placeholder="${esc(placeholder)}" value="${esc(current)}" ${state.locked ? "disabled" : ""} />`;
  const aiPlatform = isShared ? aiTargetFor(field) : scope;
  const tools =
    field === "link" || !aiPlatform
      ? ""
      : field === "hashtags"
        ? `<button type="button" class="btn btn-soft btn-sm" data-ai="regenerate" data-for="${id}">${icon("hash")}Suggest hashtags</button>`
        : field === "title"
          ? `<button type="button" class="btn btn-soft btn-sm" data-ai="regenerate" data-for="${id}">${icon("wand")}Suggest title</button>`
          : `<button type="button" class="btn btn-soft btn-sm" data-ai="regenerate" data-for="${id}">${icon("wand")}Rewrite</button>
             <button type="button" class="btn btn-secondary btn-sm" data-ai="shorten" data-for="${id}">${icon("scissors")}Shorten</button>
             <button type="button" class="btn btn-secondary btn-sm" data-ai="expand" data-for="${id}">${icon("expand")}Expand</button>`;
  const optional = isShared && (field === "title" || field === "description") ? '<span class="optional">(optional)</span>' : "";
  return `<div class="field">
    <label class="label" for="${id}">${meta.label} ${optional}<span class="counter" data-counter="${id}">${counterFor(scope, field)}</span></label>
    ${input}
    ${tools ? `<div class="field-tools">${tools}</div>` : ""}
  </div>`;
}

function aiTargetFor(field) {
  const list = selectedList();
  const match = list.find((p) => RULES[p].fields.includes(field));
  return match || (field === "title" || field === "description" ? "youtube" : "instagram");
}

function platformSummary(p) {
  const r = resolved(p);
  const rules = RULES[p];
  const parts = [];
  if (r.text !== undefined) parts.push(`Final text: <strong class="num">${fmt.number(r.text.length)}</strong> / ${fmt.number(rules.limits.text)} characters`);
  if (r.title !== undefined) parts.push(`Title: <strong class="num">${fmt.number(r.title.length)}</strong> / ${rules.limits.title}`);
  if (r.description !== undefined) parts.push(`Description: <strong class="num">${fmt.number(r.description.length)}</strong> / ${fmt.number(rules.limits.description)}`);
  if (rules.maxTags) parts.push(`Hashtags: <strong class="num">${r.tagCount}</strong> / ${rules.maxTags}`);
  return parts.join(" &middot; ");
}

function renderTabs() {
  const list = selectedList();
  if (state.tab !== "all" && !list.includes(state.tab)) state.tab = "all";
  $("#tabs").innerHTML =
    `<button type="button" class="tab" role="tab" data-tab="all" aria-selected="${state.tab === "all"}">${icon("layers", "icon-sm")}All platforms</button>` +
    list
      .map(
        (p) => `<button type="button" class="tab" role="tab" data-tab="${p}" aria-selected="${state.tab === p}">${platformIcon(p, "sm")}${PLATFORM_LABEL[p]}${isCustomised(p) ? '<span class="dot" title="Customised"></span>' : ""}</button>`
      )
      .join("");
  $$("#tabs .tab").forEach((t) =>
    t.addEventListener("click", () => {
      state.tab = t.dataset.tab;
      renderTabs();
    })
  );
  renderPanel();
}

function renderPanel() {
  const panel = $("#tab-panels");
  if (state.tab === "all") {
    panel.innerHTML = `${fieldHtml("all", "caption")}${fieldHtml("all", "hashtags")}${fieldHtml("all", "title")}${fieldHtml("all", "description")}
      ${selectedList().length ? "" : `<p class="small muted">Select platforms above to customise text for each one.</p>`}`;
  } else {
    const p = state.tab;
    panel.innerHTML = `<div class="row-between mb-16">
        <div class="row">${platformIcon(p)}<div><strong>${PLATFORM_LABEL[p]}</strong><div class="small muted" data-summary="${p}">${platformSummary(p)}</div></div></div>
        <button type="button" class="btn btn-secondary btn-sm" id="reset-overrides" ${isCustomised(p) && !state.locked ? "" : "disabled"}>${icon("retry")}Use shared text</button>
      </div>
      <p class="small muted mb-16">Leave a field empty to use the shared text.</p>
      ${RULES[p].fields.map((f) => fieldHtml(p, f)).join("")}`;
    $("#reset-overrides").addEventListener("click", () => {
      delete state.overrides[p];
      renderTabs();
      markDirty();
    });
  }
  panel.querySelectorAll("[data-field]").forEach((el) => el.addEventListener("input", () => onFieldInput(el)));
  panel.querySelectorAll("[data-ai]").forEach((b) => b.addEventListener("click", () => rewriteField(b)));
  updateAiButtons();
}

function onFieldInput(el) {
  const { scope, field } = el.dataset;
  if (scope === "all") state.fields[field] = el.value;
  else {
    state.overrides[scope] = state.overrides[scope] || {};
    state.overrides[scope][field] = el.value;
    const summary = document.querySelector(`[data-summary="${scope}"]`);
    if (summary) summary.innerHTML = platformSummary(scope);
    const tab = document.querySelector(`.tab[data-tab="${scope}"]`);
    if (tab && !!tab.querySelector(".dot") !== isCustomised(scope)) renderTabs();
    const reset = $("#reset-overrides");
    if (reset) reset.disabled = !isCustomised(scope);
  }
  const counter = document.querySelector(`[data-counter="${el.id}"]`);
  if (counter) counter.textContent = counterFor(scope, field);
  markDirty();
}

// ── AI ────────────────────────────────────────────────────────────────────────
function aiUnavailableReason() {
  if (!state.ai || !state.ai.available) return "AI is not set up.";
  return "";
}

function updateAiButtons() {
  const reason = aiUnavailableReason();
  $$("[data-ai]").forEach((b) => {
    b.disabled = !!reason || state.locked;
    b.title = reason;
  });
  const gen = $("#ai-generate");
  gen.disabled = !!reason || state.locked || !state.platforms.size;
  $("#ai-note").innerHTML = reason
    ? `${esc(reason)} <a href="/ai-settings.html">Add an API key</a> to enable it.`
    : !state.platforms.size
      ? "Select at least one platform first."
      : `Uses ${esc(state.ai.provider === "gemini" ? "Google Gemini" : "OpenAI")} (${esc(state.ai.model)}). Review the text before publishing.`;
}

async function generateAll() {
  const btn = $("#ai-generate");
  await busy(btn, "Generating...", async () => {
    try {
      const res = await api.post("/api/ai/generate", {
        platforms: selectedList(),
        context: $("#ai-context").value.trim(),
        tone: $("#ai-tone").value,
        mediaId: state.media ? state.media.id : null,
      });
      for (const [p, fields] of Object.entries(res.content)) {
        state.overrides[p] = { ...(state.overrides[p] || {}), ...fields };
      }
      const first = selectedList()[0];
      if (!state.fields.caption.trim() && first && res.content[first] && res.content[first].caption) state.fields.caption = res.content[first].caption;
      state.tab = first || "all";
      renderTabs();
      markDirty();
      toast(`Generated text for ${Object.keys(res.content).length} platform(s). Review each tab before publishing.`, "success");
    } catch (err) {
      toastError(err);
    }
  });
}

async function rewriteField(button) {
  const el = document.getElementById(button.dataset.for);
  const { scope, field } = el.dataset;
  const platform = scope === "all" ? aiTargetFor(field) : scope;
  await busy(button, "Working...", async () => {
    try {
      const res = await api.post("/api/ai/rewrite", {
        platform,
        field,
        mode: button.dataset.ai,
        currentText: el.value,
        context: $("#ai-context").value.trim(),
        tone: $("#ai-tone").value,
        mediaId: state.media ? state.media.id : null,
      });
      el.value = res.text;
      onFieldInput(el);
    } catch (err) {
      toastError(err);
    }
  });
}

// ── Scheduling ────────────────────────────────────────────────────────────────
function renderPerPlatformTimes() {
  const box = $("#per-platform-times");
  box.hidden = !(state.mode === "schedule" && state.perPlatform);
  const existing = Object.fromEntries($$("#per-platform-times input").map((i) => [i.dataset.platform, i.value]));
  box.innerHTML = selectedList()
    .map(
      (p) => `<div class="field"><label class="label" for="t-${p}">${platformIcon(p, "sm")}${PLATFORM_LABEL[p]}</label>
      <input class="input" type="datetime-local" id="t-${p}" data-platform="${p}" value="${esc(existing[p] || $("#schedule-at").value)}" ${state.locked ? "disabled" : ""} /></div>`
    )
    .join("");
  box.querySelectorAll("input").forEach((i) => i.addEventListener("input", markDirty));
}

function scheduleTimes() {
  const out = {};
  for (const p of selectedList()) {
    const v = state.perPlatform ? (document.getElementById(`t-${p}`) || {}).value : $("#schedule-at").value;
    out[p] = v || "";
  }
  return out;
}

function setMode(mode) {
  state.mode = mode;
  document.getElementById(`mode-${mode}`).checked = true;
  $("#schedule-box").hidden = mode !== "schedule";
  if (mode === "schedule" && !$("#schedule-at").value) {
    const d = new Date(Date.now() + 3600000);
    d.setMinutes(0, 0, 0);
    $("#schedule-at").value = toLocalInput(d);
  }
  renderPerPlatformTimes();
  renderChecklist();
}

// ── Checklist ─────────────────────────────────────────────────────────────────
function problems() {
  const items = [];
  const list = selectedList();
  const add = (level, text, link) => items.push({ level, text, link });
  const hasText = ["title", "caption", "description"].some((f) => state.fields[f].trim()) || list.some(isCustomised);

  if (state.mode === "draft") {
    if (!hasText && !state.media) add("bad", "Add some text or media to save a draft.");
    else add("ok", "Draft can be saved.");
    return items;
  }
  if (!list.length) add("bad", "Choose at least one platform.");
  if (state.uploading) add("bad", "Wait for the upload to finish.");
  const media = state.media;
  for (const p of list) {
    const label = PLATFORM_LABEL[p];
    const a = state.accounts[p];
    if (!a || a.status === "not_connected") add("bad", `Connect ${label} before publishing.`, "/accounts.html#" + p);
    else if (a.status === "expired") add("bad", `Reconnect ${label} (its token expired).`, "/accounts.html#" + p);
    else if (p === "pinterest" && !(a.resource && a.resource.id)) add("bad", "Choose a Pinterest board.", "/accounts.html#pinterest");
    const rule = RULES[p];
    if (rule.media === "video" && (!media || media.resourceType !== "video")) add("bad", `${label} only accepts videos.`);
    else if (rule.media === "required" && !media) add("bad", `${label} needs a photo or video.`);
    const r = resolved(p);
    if (p === "facebook" && !r.text && !media) add("bad", "Facebook needs text or media.");
    if (r.text !== undefined && r.text.length > rule.limits.text) add("bad", `${label} text is too long (${fmt.number(r.text.length)} / ${fmt.number(rule.limits.text)}).`);
    if (r.title !== undefined && r.title.length > rule.limits.title) add("bad", `${label} title is too long.`);
    if (r.description !== undefined && r.description.length > rule.limits.description) add("bad", `${label} description is too long.`);
    if (rule.maxTags && r.tagCount > rule.maxTags) add("bad", `${label} allows at most ${rule.maxTags} hashtags.`);
    if (p === "youtube" && !value(p, "title")) add("warn", `YouTube will use "${resolved(p).title}" as the title.`);
  }
  if (state.mode === "schedule") {
    const times = scheduleTimes();
    const missing = Object.entries(times).filter(([, v]) => !v);
    const past = Object.entries(times).filter(([, v]) => v && new Date(v).getTime() < Date.now() + 60000);
    if (list.length && missing.length) add("bad", "Choose a publish time for every platform.");
    if (past.length) add("bad", "Schedule times must be at least 1 minute in the future.");
  }
  if (!items.some((i) => i.level === "bad")) add("ok", state.mode === "schedule" ? "Ready to schedule." : `Ready to publish to ${list.length} platform${list.length === 1 ? "" : "s"}.`);
  return items;
}

function renderChecklist() {
  const items = problems();
  const iconFor = { ok: ["checkCircle", "ok"], bad: ["xCircle", "bad"], warn: ["alert", "warn"] };
  $("#checklist").innerHTML = items
    .map((i) => {
      const [ic, cls] = iconFor[i.level];
      return `<li><span class="${cls}">${icon(ic, "icon-sm")}</span><span>${esc(i.text)}${i.link ? ` <a href="${i.link}">Fix</a>` : ""}</span></li>`;
    })
    .join("");
  const blocking = items.some((i) => i.level === "bad");
  const n = state.platforms.size;
  const btn = $("#submit-btn");
  const labels = {
    publish: [`Publish to ${n || ""} platform${n === 1 ? "" : "s"}`.replace("  ", " "), "send"],
    schedule: [state.status === "scheduled" ? "Update schedule" : "Schedule post", "clock"],
    draft: ["Save draft", "save"],
  };
  const [label, ic] = labels[state.mode];
  btn.innerHTML = `${icon(ic)}<span>${esc(label)}</span>`;
  btn.disabled = blocking || state.locked;
  $("#draft-btn").hidden = state.mode === "draft";
  $("#draft-btn").disabled = state.locked || state.uploading;
  $("#submit-hint").textContent = state.locked ? "" : blocking ? "Fix the items marked above to continue." : state.mode === "publish" ? "Posts go live immediately." : "";
  updateAiButtons();
}

// ── Submit ────────────────────────────────────────────────────────────────────
function payload(action) {
  const list = selectedList();
  const platformContent = {};
  for (const p of list) {
    const o = state.overrides[p] || {};
    const clean = {};
    for (const f of RULES[p].fields) if (o[f] !== undefined && String(o[f]).trim() !== "") clean[f] = String(o[f]).trim();
    if (Object.keys(clean).length) platformContent[p] = clean;
  }
  const body = {
    title: state.fields.title.trim(),
    caption: state.fields.caption,
    description: state.fields.description,
    hashtags: state.fields.hashtags.trim(),
    mediaId: state.media ? state.media.id : null,
    tone: $("#ai-tone").value || null,
    platforms: list,
    platformContent,
    action,
  };
  if (action === "schedule") {
    const times = scheduleTimes();
    if (state.perPlatform) body.schedules = Object.fromEntries(Object.entries(times).map(([p, v]) => [p, fromLocalInput(v)]));
    else body.scheduledAt = fromLocalInput($("#schedule-at").value);
  }
  return body;
}

async function submit(action, button) {
  $("#submit-error").innerHTML = "";
  const label = { publish: "Publishing...", schedule: "Scheduling...", draft: "Saving..." }[action];
  await busy(button, label, async () => {
    try {
      const body = payload(action);
      const res = state.postId ? await api.put(`/api/posts/${state.postId}`, body) : await api.post("/api/posts", body);
      state.dirty = false;
      const post = res.post;
      state.postId = post.id;
      state.status = post.status;
      history.replaceState(null, "", `/create.html?id=${post.id}`);
      if (action === "draft") {
        toast("Draft saved.", "success");
        setHeader();
      } else if (action === "schedule") {
        showScheduled(post);
      } else {
        state.platforms.clear();
        showResults(post, res.results);
      }
    } catch (err) {
      $("#submit-error").innerHTML = errorAlert(err);
      if (!(err instanceof ApiError) || err.status >= 500) toastError(err);
    }
  });
  renderChecklist();
}

function lockComposer(reason) {
  state.locked = true;
  renderMedia();
  renderPlatforms();
  renderTabs();
  $$("input[name=mode]").forEach((r) => (r.disabled = true));
  $("#schedule-at").disabled = true;
  $("#per-platform").disabled = true;
  renderChecklist();
  if (reason) $("#submit-hint").textContent = reason;
}

function showScheduled(post) {
  lockComposer();
  $("#result-card").hidden = false;
  $("#result-title").textContent = "Scheduled";
  $("#result-body").innerHTML = `${alertHtml("success", "Your post is scheduled", "It will publish automatically at the times below.")}
    <div class="mt-12">${post.targets
      .map((t) => `<div class="result-row">${platformIcon(t.platform, "sm")}<div class="grow"><strong>${PLATFORM_LABEL[t.platform]}</strong><div class="small muted">${fmt.dateTime(t.scheduledAt)}</div></div></div>`)
      .join("")}</div>
    <div class="stack-sm mt-16">
      <a class="btn btn-primary btn-block" href="/calendar.html">${icon("calendar")}Open calendar</a>
      <a class="btn btn-secondary btn-block" href="/post.html?id=${post.id}">${icon("eye")}View post</a>
      <a class="btn btn-ghost btn-block" href="/create.html">${icon("plus")}Create another post</a>
    </div>`;
  $("#result-card").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function showResults(post, results) {
  lockComposer();
  const ok = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  $("#result-card").hidden = false;
  $("#result-title").textContent = failed.length ? (ok.length ? "Partly published" : "Publishing failed") : "Published";
  $("#result-body").innerHTML = `${
    failed.length
      ? alertHtml(ok.length ? "warning" : "error", ok.length ? `${ok.length} of ${results.length} platforms succeeded` : "No platform accepted the post", "Successful platforms are not published again when you retry.")
      : alertHtml("success", "Published everywhere", `Your post is live on ${ok.length} platform${ok.length === 1 ? "" : "s"}.`)
  }
    <div class="mt-12">${results
      .map(
        (r) => `<div class="result-row">${platformIcon(r.platform, "sm")}
        <div class="grow"><div class="row"><strong>${PLATFORM_LABEL[r.platform]}</strong>${
          r.success ? `<span class="badge badge-success">${icon("checkCircle")}Published</span>` : `<span class="badge badge-danger">${icon("xCircle")}Failed</span>`
        }</div>
        <div class="small ${r.success ? "muted" : ""}" style="${r.success ? "" : "color:var(--danger-text)"}">${esc(r.success ? r.platformPostId || "" : r.error)}</div></div>
        ${r.url ? `<a class="btn btn-ghost btn-sm" href="${esc(r.url)}" target="_blank" rel="noopener">${icon("external")}Open</a>` : ""}</div>`
      )
      .join("")}</div>
    <div class="stack-sm mt-16">
      ${failed.length ? `<button type="button" class="btn btn-primary btn-block" id="retry-btn">${icon("retry")}Retry failed platforms</button>` : ""}
      <a class="btn btn-secondary btn-block" href="/post.html?id=${post.id}">${icon("eye")}View post details</a>
      <a class="btn btn-ghost btn-block" href="/create.html">${icon("plus")}Create another post</a>
    </div>`;
  const retryBtn = $("#retry-btn");
  if (retryBtn) {
    retryBtn.addEventListener("click", () =>
      busy(retryBtn, "Retrying...", async () => {
        try {
          const res = await api.post(`/api/posts/${post.id}/retry`, {});
          const merged = results.map((r) => res.results.find((x) => x.platform === r.platform) || r);
          showResults(res.post, merged);
        } catch (err) {
          toastError(err);
        }
      })
    );
  }
  $("#result-card").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function setHeader() {
  if (!state.postId) return;
  $("#page-title").textContent = state.status === "scheduled" ? "Edit scheduled post" : "Edit draft";
  $("#page-sub").innerHTML = `${statusBadge(state.status)} <span class="muted">Changes are saved when you choose an action below.</span>`;
  $("#head-actions").innerHTML = `<a class="btn btn-secondary" href="/post.html?id=${state.postId}">${icon("eye")}View post</a>`;
}

// ── Load existing post ────────────────────────────────────────────────────────
async function loadPost(id) {
  const { post } = await api.get(`/api/posts/${id}`);
  state.postId = post.id;
  state.status = post.status;
  const editable = post.status === "draft" || (post.status === "scheduled" && post.targets.every((t) => t.status === "scheduled"));
  state.media = post.media;
  state.platforms = new Set(post.platforms);
  state.fields = { title: post.title, caption: post.caption, description: post.description, hashtags: post.hashtags };
  state.overrides = post.platformContent || {};
  if (post.tone) $("#ai-tone").value = post.tone;
  if (!editable) {
    $("#edit-notice").innerHTML = `<div class="mb-20">${alertHtml("info", `This post is ${post.status} and can no longer be edited`, "Duplicate it to publish a new version.")}</div>`;
    $("#head-actions").innerHTML = `<button type="button" class="btn btn-primary" id="dup-btn">${icon("copy")}Duplicate as new draft</button>`;
    $("#dup-btn").addEventListener("click", async () => {
      const res = await api.post(`/api/posts/${post.id}/duplicate`);
      location.href = `/create.html?id=${res.post.id}`;
    });
    return false;
  }
  setHeader();
  if (post.status === "scheduled") {
    const times = post.targets.map((t) => t.scheduledAt);
    const distinct = new Set(times);
    setMode("schedule");
    $("#schedule-at").value = toLocalInput(times.sort()[0]);
    if (distinct.size > 1) {
      state.perPlatform = true;
      $("#per-platform").checked = true;
      renderPerPlatformTimes();
      for (const t of post.targets) {
        const input = document.getElementById(`t-${t.platform}`);
        if (input) input.value = toLocalInput(t.scheduledAt);
      }
    }
  } else setMode("draft");
  return true;
}

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await mountLayout({ page: "create", title: "Create post" });
  hydrateIcons();
  const file = document.createElement("input");
  file.type = "file";
  file.id = "file-input";
  file.accept = "image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/webm";
  file.hidden = true;
  file.addEventListener("change", () => {
    if (file.files[0]) uploadFile(file.files[0]);
    file.value = "";
  });
  document.body.appendChild(file);
  $("#tz-hint").textContent = `Times are in your time zone (${localZone()}).`;

  const [accounts, ai, mediaCfg] = await Promise.all([
    api.get("/api/accounts"),
    api.get("/api/ai/status").catch(() => ({ available: false, tones: ["friendly"] })),
    api.get("/api/media/config"),
  ]);
  state.accounts = Object.fromEntries(accounts.accounts.map((a) => [a.platform, a]));
  state.ai = ai;
  state.mediaConfig = mediaCfg.config;
  $("#ai-tone").innerHTML = (ai.tones || ["friendly"]).map((t) => `<option value="${t}">${t[0].toUpperCase()}${t.slice(1)}</option>`).join("");
  try {
    const profile = await api.get("/api/profile/settings");
    if (profile.settings && profile.settings.defaultTone) $("#ai-tone").value = profile.settings.defaultTone;
  } catch {
    // Default tone is optional.
  }

  const p = params();
  let editable = true;
  if (p.get("id")) {
    try {
      editable = await loadPost(Number(p.get("id")));
    } catch (err) {
      $("#edit-notice").innerHTML = `<div class="mb-20">${errorAlert(err)}</div>`;
    }
  } else {
    if (p.get("mode") === "schedule" || p.get("date")) setMode("schedule");
    if (p.get("mode") === "draft") setMode("draft");
    if (p.get("date")) {
      const d = new Date(`${p.get("date")}T09:00`);
      if (!Number.isNaN(d.getTime()) && d.getTime() > Date.now()) $("#schedule-at").value = toLocalInput(d);
    }
  }

  renderMedia();
  renderPlatforms();
  renderTabs();
  if (!editable) lockComposer("This post can no longer be edited.");

  $$("input[name=mode]").forEach((r) => r.addEventListener("change", () => setMode(r.value)));
  $("#schedule-at").addEventListener("input", () => {
    renderPerPlatformTimes();
    markDirty();
  });
  $("#per-platform").addEventListener("change", (e) => {
    state.perPlatform = e.target.checked;
    renderPerPlatformTimes();
    renderChecklist();
  });
  $("#ai-generate").addEventListener("click", generateAll);
  $("#submit-btn").addEventListener("click", (e) => submit(state.mode, e.currentTarget));
  $("#draft-btn").addEventListener("click", (e) => submit("draft", e.currentTarget));
  window.addEventListener("beforeunload", (e) => {
    if (state.dirty && !state.locked) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  renderChecklist();
  state.dirty = false;
}

init();
