// Small UI toolkit shared by every page: escaping, formatting, toasts,
// dialogs, busy buttons, badges, empty states and pagination.
import { icon, platformIcon, PLATFORM_LABEL } from "./icons.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

export const params = () => new URLSearchParams(location.search);
export function setParams(values) {
  const p = params();
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined || v === null || v === "") p.delete(k);
    else p.set(k, v);
  }
  const qs = p.toString();
  history.replaceState(null, "", `${location.pathname}${qs ? `?${qs}` : ""}${location.hash}`);
}

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ── Formatting ────────────────────────────────────────────────────────────────
const dtf = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const df = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const tf = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const nf = new Intl.NumberFormat();
const cf = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export const fmt = {
  dateTime: (v) => (v ? dtf.format(new Date(v)) : "-"),
  date: (v) => (v ? df.format(new Date(v)) : "-"),
  time: (v) => (v ? tf.format(new Date(v)) : ""),
  number: (v) => (v === null || v === undefined ? "-" : nf.format(v)),
  compact: (v) => (v === null || v === undefined ? "-" : v >= 10000 ? cf.format(v) : nf.format(v)),
  bytes: (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`),
  relative(v) {
    if (!v) return "-";
    const diff = (new Date(v).getTime() - Date.now()) / 1000;
    const abs = Math.abs(diff);
    if (abs < 45) return diff < 0 ? "just now" : "in a moment";
    if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
    if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
    if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
    return df.format(new Date(v));
  },
};

// <input type="datetime-local"> works in local time without a zone.
export function toLocalInput(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const fromLocalInput = (value) => (value ? new Date(value).toISOString() : null);
export const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

// ── Toasts ────────────────────────────────────────────────────────────────────
function toastHost() {
  let host = $(".toasts");
  if (!host) {
    host = document.createElement("div");
    host.className = "toasts";
    host.setAttribute("role", "status");
    host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
  }
  return host;
}

export function toast(message, type = "info", { timeout = type === "error" ? 8000 : 4500 } = {}) {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  const iconName = type === "success" ? "checkCircle" : type === "error" ? "alertCircle" : "info";
  el.innerHTML = `${icon(iconName)}<div class="grow"></div><button type="button" class="btn btn-ghost btn-icon btn-sm toast-close" aria-label="Dismiss">${icon("x", "icon-sm")}</button>`;
  el.querySelector(".grow").textContent = message;
  const close = () => el.remove();
  el.querySelector("button").addEventListener("click", close);
  toastHost().appendChild(el);
  if (timeout) setTimeout(close, timeout);
}

export function toastError(err, fallback = "Something went wrong.") {
  toast((err && err.message) || fallback, "error");
}

// ── Alerts ────────────────────────────────────────────────────────────────────
export function alertHtml(type, title, body = "", items = []) {
  const iconName = { error: "alertCircle", success: "checkCircle", warning: "alert", info: "info" }[type];
  return `<div class="alert alert-${type}" role="${type === "error" ? "alert" : "status"}">${icon(iconName)}<div>
    ${title ? `<div class="alert-title">${esc(title)}</div>` : ""}${body ? `<div>${esc(body)}</div>` : ""}
    ${items.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>` : ""}</div></div>`;
}

// Renders an ApiError with its per-field details.
export function errorAlert(err) {
  const details = (err && err.details) || [];
  const items = details.length > 1 || (details.length === 1 && details[0].message !== err.message) ? details.map((d) => d.message) : [];
  return alertHtml("error", err && err.message ? err.message : "Something went wrong.", "", items);
}

// ── Dialogs ───────────────────────────────────────────────────────────────────
export function openDialog({ title, body, actions = [], wide = false, onOpen }) {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = `modal${wide ? " wide" : ""}`;
    dlg.innerHTML = `<form method="dialog" novalidate>
      <div class="modal-head"><h2></h2><button type="button" class="btn btn-ghost btn-icon btn-sm" data-close aria-label="Close">${icon("x")}</button></div>
      <div class="modal-body"></div>
      <div class="modal-foot"></div></form>`;
    dlg.querySelector("h2").textContent = title;
    const bodyEl = dlg.querySelector(".modal-body");
    if (typeof body === "string") bodyEl.innerHTML = body;
    else if (body) bodyEl.appendChild(body);
    const foot = dlg.querySelector(".modal-foot");
    let result;
    for (const a of actions) {
      const b = document.createElement("button");
      b.type = a.submit ? "submit" : "button";
      b.className = `btn ${a.variant || "btn-secondary"}`;
      b.innerHTML = `${a.icon ? icon(a.icon) : ""}<span></span>`;
      b.querySelector("span").textContent = a.label;
      b.addEventListener("click", async (e) => {
        e.preventDefault();
        if (a.handler) {
          const out = await a.handler(dlg, b);
          if (out === false) return;
          result = out === undefined ? a.value : out;
        } else result = a.value;
        dlg.close();
      });
      foot.appendChild(b);
    }
    dlg.querySelector("[data-close]").addEventListener("click", () => dlg.close());
    dlg.addEventListener("close", () => {
      dlg.remove();
      resolve(result);
    });
    document.body.appendChild(dlg);
    dlg.showModal();
    if (onOpen) onOpen(dlg);
  });
}

export function confirmDialog({ title, message, confirmLabel = "Confirm", danger = false, icon: iconName }) {
  const body = document.createElement("p");
  body.textContent = message;
  return openDialog({
    title,
    body,
    actions: [
      { label: "Cancel", variant: "btn-secondary", value: false },
      { label: confirmLabel, variant: danger ? "btn-danger" : "btn-primary", value: true, icon: iconName },
    ],
  }).then(Boolean);
}

// ── Busy state ────────────────────────────────────────────────────────────────
export async function busy(button, label, fn) {
  const original = button.innerHTML;
  const wasDisabled = button.disabled;
  button.disabled = true;
  button.classList.add("is-busy");
  button.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>${esc(label)}</span>`;
  try {
    return await fn();
  } finally {
    button.innerHTML = original;
    button.disabled = wasDisabled;
    button.classList.remove("is-busy");
  }
}

export function setLoading(container, text = "Loading...") {
  container.innerHTML = `<div class="loading-block"><span class="spinner"></span><span>${esc(text)}</span></div>`;
}

// ── Status badges ─────────────────────────────────────────────────────────────
const POST_STATUS = {
  draft: ["badge-neutral", "drafts", "Draft"],
  scheduled: ["badge-info", "clock", "Scheduled"],
  publishing: ["badge-warning", "refresh", "Publishing"],
  published: ["badge-success", "checkCircle", "Published"],
  partial: ["badge-warning", "alert", "Partly published"],
  failed: ["badge-danger", "xCircle", "Failed"],
  cancelled: ["badge-neutral", "x", "Cancelled"],
};
export function statusBadge(status) {
  const [cls, ic, label] = POST_STATUS[status] || ["badge-neutral", "info", status];
  return `<span class="badge ${cls}">${icon(ic)}${esc(label)}</span>`;
}

const TARGET_STATUS = {
  success: ["checkCircle", "Published"],
  failed: ["xCircle", "Failed"],
  scheduled: ["clock", "Scheduled"],
  pending: ["clock", "Pending"],
  processing: ["refresh", "Publishing"],
  cancelled: ["x", "Cancelled"],
};
export const targetLabel = (status) => (TARGET_STATUS[status] || ["info", status])[1];
export function targetPill(t) {
  const [ic, label] = TARGET_STATUS[t.status] || ["info", t.status];
  const title = `${PLATFORM_LABEL[t.platform]}: ${label}${t.errorMessage ? ` - ${t.errorMessage}` : ""}`;
  return `<span class="target-pill ${esc(t.status)}" title="${esc(title)}">${platformIcon(t.platform, "sm")}<span class="state">${icon(ic, "icon-sm")}</span>${esc(label)}</span>`;
}

const ACCOUNT_STATUS = {
  connected: ["badge-success", "checkCircle", "Connected"],
  not_connected: ["badge-neutral", "unplug", "Not connected"],
  expired: ["badge-danger", "alert", "Token expired"],
  error: ["badge-danger", "alertCircle", "Connection error"],
};
export function accountBadge(status) {
  const [cls, ic, label] = ACCOUNT_STATUS[status] || ACCOUNT_STATUS.not_connected;
  return `<span class="badge ${cls}">${icon(ic)}${label}</span>`;
}

// ── Empty state & pager ───────────────────────────────────────────────────────
export function emptyState({ iconName = "inbox", title, text = "", action = "" }) {
  return `<div class="empty"><div class="empty-icon">${icon(iconName)}</div><h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ""}${action}</div>`;
}

export function renderPager(container, { page, totalPages, total, pageSize }, onChange) {
  if (!total) {
    container.innerHTML = "";
    return;
  }
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  container.innerHTML = `<div class="pager">
    <span class="pager-info">Showing ${fmt.number(from)}-${fmt.number(to)} of ${fmt.number(total)}</span>
    <div class="row">
      <button type="button" class="btn btn-secondary btn-sm" data-dir="-1" ${page <= 1 ? "disabled" : ""}>${icon("chevronLeft")}Previous</button>
      <span class="small muted">Page ${page} of ${totalPages}</span>
      <button type="button" class="btn btn-secondary btn-sm" data-dir="1" ${page >= totalPages ? "disabled" : ""}>Next${icon("chevronRight")}</button>
    </div></div>`;
  container.querySelectorAll("button[data-dir]").forEach((b) => b.addEventListener("click", () => onChange(page + Number(b.dataset.dir))));
}

export function postTitle(p) {
  return p.title || (p.caption || p.description || "").split("\n").find((l) => l.trim()) || `Post #${p.id}`;
}

export function mediaThumb(media) {
  if (media && media.thumbnailUrl) return `<span class="thumb"><img src="${esc(media.thumbnailUrl)}" alt="" loading="lazy"></span>`;
  if (media) return `<span class="thumb">${icon(media.resourceType === "video" ? "video" : "image")}</span>`;
  return `<span class="thumb">${icon("file")}</span>`;
}

// Wires a password field's show/hide button.
export function bindReveal(root = document) {
  root.querySelectorAll("[data-reveal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const input = document.getElementById(btn.dataset.reveal);
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.innerHTML = icon(show ? "eyeOff" : "eye");
      btn.setAttribute("aria-label", show ? "Hide" : "Show");
    });
  });
}
