// Draft management: edit, duplicate, publish now, delete.
import { api } from "../core/api.js";
import { mountLayout } from "../core/layout.js";
import { hydrateIcons } from "../core/page.js";
import { icon, platformIcon } from "../core/icons.js";
import { $, esc, fmt, debounce, emptyState, renderPager, postTitle, busy, toast, toastError, confirmDialog, errorAlert, setLoading } from "../core/ui.js";

let page = 1;

function card(p) {
  const media = p.media && p.media.thumbnailUrl
    ? `<img src="${esc(p.media.thumbnailUrl)}" alt="" style="width:100%;height:150px;object-fit:cover;border-radius:13px 13px 0 0" loading="lazy">`
    : `<div class="thumb" style="width:100%;height:150px;border-radius:13px 13px 0 0">${icon(p.media ? (p.media.resourceType === "video" ? "video" : "image") : "drafts", "icon-lg")}</div>`;
  const excerpt = (p.caption || p.description || "").slice(0, 160);
  return `<article class="card" style="display:flex;flex-direction:column">
    ${media}
    <div class="card-body" style="flex:1;display:flex;flex-direction:column;gap:8px">
      <a class="list-title" href="/create.html?id=${p.id}">${esc(postTitle(p))}</a>
      ${excerpt && excerpt !== postTitle(p) ? `<p class="small muted" style="white-space:pre-wrap">${esc(excerpt)}${(p.caption || "").length > 160 ? "..." : ""}</p>` : ""}
      <div class="row" style="gap:6px">${p.platforms.map((pl) => platformIcon(pl, "sm")).join("") || '<span class="small muted">No platforms chosen</span>'}</div>
      <div class="small muted mt-8">Updated ${fmt.relative(p.updatedAt)}</div>
    </div>
    <div class="card-foot">
      <a class="btn btn-primary btn-sm" href="/create.html?id=${p.id}">${icon("edit")}Edit</a>
      <button type="button" class="btn btn-secondary btn-sm" data-act="publish" data-id="${p.id}" ${p.platforms.length ? "" : 'disabled title="Choose platforms first (Edit)"'}>${icon("send")}Publish now</button>
      <span class="grow" style="flex:1"></span>
      <button type="button" class="btn btn-ghost btn-sm btn-icon" data-act="duplicate" data-id="${p.id}" title="Duplicate" aria-label="Duplicate draft">${icon("copy")}</button>
      <button type="button" class="btn btn-ghost btn-sm btn-icon" data-act="delete" data-id="${p.id}" title="Delete" aria-label="Delete draft">${icon("trash")}</button>
    </div>
  </article>`;
}

async function load() {
  const el = $("#drafts");
  setLoading(el, "Loading drafts...");
  const qs = new URLSearchParams({ status: "draft", page, pageSize: 12 });
  const q = $("#q").value.trim();
  if (q) qs.set("q", q);
  try {
    const data = await api.get(`/api/posts?${qs}`);
    if (!data.items.length) {
      el.innerHTML = `<div class="card">${
        q
          ? emptyState({ iconName: "search", title: "No drafts match", text: "Try a different search." })
          : emptyState({ iconName: "drafts", title: "No drafts", text: "Choose 'Save as draft' in the composer to keep a post for later.", action: '<a class="btn btn-primary" href="/create.html?mode=draft">Start a draft</a>' })
      }</div>`;
      $("#pager-card").hidden = true;
      return;
    }
    el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">${data.items.map(card).join("")}</div>`;
    $("#pager-card").hidden = data.totalPages <= 1;
    renderPager($("#pager"), data, (n) => {
      page = n;
      load();
    });
  } catch (err) {
    el.innerHTML = errorAlert(err);
  }
}

async function onClick(e) {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const { act, id } = btn.dataset;
  if (act === "delete") {
    if (!(await confirmDialog({ title: "Delete this draft?", message: "This cannot be undone.", confirmLabel: "Delete draft", danger: true }))) return;
    try {
      await api.del(`/api/posts/${id}`);
      toast("Draft deleted.", "success");
      load();
    } catch (err) {
      toastError(err);
    }
  } else if (act === "duplicate") {
    try {
      await api.post(`/api/posts/${id}/duplicate`);
      toast("Draft duplicated.", "success");
      load();
    } catch (err) {
      toastError(err);
    }
  } else if (act === "publish") {
    if (!(await confirmDialog({ title: "Publish this draft now?", message: "It will be posted to the platforms saved on the draft right away.", confirmLabel: "Publish now", icon: "send" }))) return;
    await busy(btn, "Publishing...", async () => {
      try {
        const res = await api.post(`/api/posts/${id}/publish`, { action: "publish" });
        const ok = res.results.filter((r) => r.success).length;
        toast(`Published to ${ok} of ${res.results.length} platform(s).`, ok === res.results.length ? "success" : "error");
        location.href = `/post.html?id=${id}`;
      } catch (err) {
        toastError(err);
      }
    });
  }
}

async function init() {
  await mountLayout({ page: "drafts", title: "Drafts" });
  hydrateIcons();
  $("#q").addEventListener(
    "input",
    debounce(() => {
      page = 1;
      load();
    }, 350)
  );
  $("#drafts").addEventListener("click", onClick);
  load();
}

init();
