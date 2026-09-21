// Post history: search, filter by status/platform/date, paginate, and act on posts.
import { api } from "../core/api.js";
import { mountLayout } from "../core/layout.js";
import { hydrateIcons } from "../core/page.js";
import { icon } from "../core/icons.js";
import { $, esc, fmt, params, setParams, debounce, statusBadge, targetPill, emptyState, renderPager, postTitle, mediaThumb, busy, toast, toastError, confirmDialog, errorAlert, setLoading } from "../core/ui.js";

let page = 1;
let lastData = null;

function dateParam(value, endOfDay) {
  if (!value) return undefined;
  const d = new Date(`${value}T${endOfDay ? "23:59:59" : "00:00:00"}`);
  return d.toISOString();
}

function filters() {
  return { q: $("#q").value.trim(), status: $("#status").value, platform: $("#platform").value, from: $("#from").value, to: $("#to").value };
}

function whenText(p) {
  if (p.status === "scheduled") return `Scheduled for ${fmt.dateTime(p.scheduledAt)}`;
  if (p.publishedAt) return `Published ${fmt.dateTime(p.publishedAt)}`;
  return `Created ${fmt.dateTime(p.createdAt)}`;
}

function actionsFor(p) {
  const out = [`<a class="btn btn-secondary btn-sm" href="/post.html?id=${p.id}">${icon("eye")}View</a>`];
  if (p.status === "draft" || p.status === "scheduled") out.push(`<a class="btn btn-secondary btn-sm" href="/create.html?id=${p.id}">${icon("edit")}Edit</a>`);
  if (p.status === "failed" || p.status === "partial") out.push(`<button type="button" class="btn btn-primary btn-sm" data-act="retry" data-id="${p.id}">${icon("retry")}Retry</button>`);
  out.push(`<button type="button" class="btn btn-ghost btn-sm btn-icon" data-act="duplicate" data-id="${p.id}" title="Duplicate" aria-label="Duplicate">${icon("copy")}</button>`);
  if (p.status !== "publishing") out.push(`<button type="button" class="btn btn-ghost btn-sm btn-icon" data-act="delete" data-id="${p.id}" title="Delete" aria-label="Delete">${icon("trash")}</button>`);
  return out.join("");
}

function render(data) {
  const el = $("#results");
  el.classList.remove("is-refreshing");
  if (!data.items.length) {
    const f = filters();
    const filtered = Object.values(f).some(Boolean);
    el.innerHTML = filtered
      ? emptyState({ iconName: "search", title: "No posts match these filters", text: "Try a different search or clear the filters." })
      : emptyState({ iconName: "posts", title: "No posts yet", text: "Posts you publish, schedule or save as drafts appear here.", action: '<a class="btn btn-primary" href="/create.html">Create your first post</a>' });
    renderPager($("#pager"), data, go);
    return;
  }
  el.innerHTML = `<ul class="list">${data.items
    .map(
      (p) => `<li class="list-item" style="align-items:flex-start">
      ${mediaThumb(p.media)}
      <div class="grow">
        <div class="row" style="gap:8px"><a class="list-title" href="/post.html?id=${p.id}">${esc(postTitle(p))}</a>${statusBadge(p.status)}</div>
        <div class="list-sub mt-8">${esc(whenText(p))}</div>
        <div class="target-list mt-8">${
          p.targets.length ? p.targets.map(targetPill).join("") : p.platforms.map((pl) => targetPill({ platform: pl, status: "pending" })).join("")
        }</div>
      </div>
      <div class="row" style="justify-content:flex-end">${actionsFor(p)}</div>
    </li>`
    )
    .join("")}</ul>`;
  renderPager($("#pager"), data, go);
}

async function load() {
  const f = filters();
  setParams({ ...f, page: page > 1 ? page : "" });
  const qs = new URLSearchParams({ page, pageSize: 15 });
  if (f.q) qs.set("q", f.q);
  if (f.status) qs.set("status", f.status);
  if (f.platform) qs.set("platform", f.platform);
  if (f.from) qs.set("from", dateParam(f.from));
  if (f.to) qs.set("to", dateParam(f.to, true));
  const el = $("#results");
  if (lastData) el.classList.add("is-refreshing");
  else setLoading(el);
  try {
    lastData = await api.get(`/api/posts?${qs}`);
    render(lastData);
  } catch (err) {
    el.classList.remove("is-refreshing");
    el.innerHTML = `<div class="card-body">${errorAlert(err)}</div>`;
  }
}

function go(n) {
  page = n;
  load();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function onAction(e) {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const id = btn.dataset.id;
  const act = btn.dataset.act;
  if (act === "delete") {
    const ok = await confirmDialog({ title: "Delete this post?", message: "It is removed from your history. Posts already live on social platforms are not deleted there.", confirmLabel: "Delete post", danger: true });
    if (!ok) return;
    try {
      await api.del(`/api/posts/${id}`);
      toast("Post deleted.", "success");
      load();
    } catch (err) {
      toastError(err);
    }
  } else if (act === "duplicate") {
    await busy(btn, "", async () => {
      try {
        const res = await api.post(`/api/posts/${id}/duplicate`);
        toast("Copied to a new draft.", "success");
        location.href = `/create.html?id=${res.post.id}`;
      } catch (err) {
        toastError(err);
      }
    });
  } else if (act === "retry") {
    await busy(btn, "Retrying...", async () => {
      try {
        const res = await api.post(`/api/posts/${id}/retry`, {});
        const ok = res.results.filter((r) => r.success).length;
        toast(`${ok} of ${res.results.length} platform(s) succeeded on retry.`, ok === res.results.length ? "success" : "error");
        load();
      } catch (err) {
        toastError(err);
      }
    });
  }
}

async function init() {
  await mountLayout({ page: "posts", title: "Post history" });
  hydrateIcons();
  const p = params();
  for (const key of ["q", "status", "platform", "from", "to"]) if (p.get(key)) $(`#${key}`).value = p.get(key);
  if (p.get("status") && !$("#status").value) {
    $("#status").insertAdjacentHTML("beforeend", `<option value="${esc(p.get("status"))}">${esc(p.get("status"))}</option>`);
    $("#status").value = p.get("status");
  }
  page = Number(p.get("page")) || 1;
  const reload = () => {
    page = 1;
    load();
  };
  $("#q").addEventListener("input", debounce(reload, 350));
  for (const id of ["#status", "#platform", "#from", "#to"]) $(id).addEventListener("change", reload);
  $("#filters").addEventListener("submit", (e) => e.preventDefault());
  $("#clear-filters").addEventListener("click", () => {
    $("#filters").reset();
    reload();
  });
  $("#results").addEventListener("click", onAction);
  load();
}

init();
