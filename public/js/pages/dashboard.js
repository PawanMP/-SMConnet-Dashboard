import { api } from "../core/api.js";
import { mountLayout } from "../core/layout.js";
import { hydrateIcons } from "../core/page.js";
import { icon, platformIcon } from "../core/icons.js";
import { $, esc, fmt, statusBadge, targetPill, accountBadge, emptyState, alertHtml, postTitle, mediaThumb, busy, toast, toastError, setLoading } from "../core/ui.js";

function statTile(label, iconName, value, sub = "") {
  return `<div class="stat"><div class="stat-label">${icon(iconName)}${esc(label)}</div><div class="stat-value">${value}</div>${sub ? `<div class="stat-sub">${esc(sub)}</div>` : ""}</div>`;
}

function postRow(p, extra = "") {
  const when = p.status === "scheduled" ? `Scheduled ${fmt.relative(p.scheduledAt)}` : p.publishedAt ? `Published ${fmt.relative(p.publishedAt)}` : `Created ${fmt.relative(p.createdAt)}`;
  return `<li class="list-item">
    ${mediaThumb(p.media)}
    <div class="grow">
      <a class="list-title truncate" href="/post.html?id=${p.id}" style="display:block">${esc(postTitle(p))}</a>
      <div class="list-sub">${esc(when)}</div>
      <div class="target-list mt-8">${(p.targets || []).map(targetPill).join("")}</div>
    </div>
    <div class="stack-sm" style="align-items:flex-end">${statusBadge(p.status)}${extra}</div>
  </li>`;
}

async function loadStats() {
  const { totals: t } = await api.get("/api/analytics/overview");
  $("#stats").innerHTML = [
    statTile("Published", "checkCircle", fmt.number(t.published + t.partial)),
    statTile("Failed", "xCircle", fmt.number(t.failed)),
    statTile("Scheduled", "clock", fmt.number(t.scheduled)),
    statTile("Success rate", "percent", t.successRate === null ? "-" : `${t.successRate}%`),
    statTile("Connected accounts", "link", `${t.connectedAccounts} / 5`),
  ].join("");
  return t;
}

async function loadAttention() {
  const el = $("#attention");
  const { items } = await api.get("/api/posts?status=failed,partial&pageSize=4");
  if (!items.length) {
    el.innerHTML = emptyState({ iconName: "checkCircle", title: "Nothing needs attention", text: "Failed or partly published posts will show up here." });
    return;
  }
  el.innerHTML = `<ul class="list">${items
    .map((p) => postRow(p, `<button type="button" class="btn btn-secondary btn-sm" data-retry="${p.id}">${icon("retry")}Retry failed</button>`))
    .join("")}</ul>`;
  el.querySelectorAll("[data-retry]").forEach((b) =>
    b.addEventListener("click", () =>
      busy(b, "Retrying...", async () => {
        try {
          const res = await api.post(`/api/posts/${b.dataset.retry}/retry`, {});
          const ok = res.results.filter((r) => r.success).length;
          toast(ok === res.results.length ? "Retry succeeded on every platform." : `Retried: ${ok} of ${res.results.length} platforms succeeded.`, ok ? "success" : "error");
          loadAttention();
        } catch (err) {
          toastError(err);
        }
      })
    )
  );
}

async function loadUpcoming() {
  const el = $("#upcoming");
  const { items } = await api.get("/api/posts?status=scheduled&sort=scheduled&pageSize=5");
  el.innerHTML = items.length
    ? `<ul class="list">${items.map((p) => postRow(p)).join("")}</ul>`
    : emptyState({ iconName: "calendar", title: "Nothing scheduled", text: "Schedule a post and it will appear here.", action: '<a class="btn btn-primary btn-sm" href="/create.html?mode=schedule">Schedule a post</a>' });
}

async function loadRecent() {
  const el = $("#recent");
  const { items } = await api.get("/api/posts?pageSize=5");
  el.innerHTML = items.length
    ? `<ul class="list">${items.map((p) => postRow(p)).join("")}</ul>`
    : emptyState({ iconName: "posts", title: "No posts yet", text: "Create your first post to see it here.", action: '<a class="btn btn-primary btn-sm" href="/create.html">Create post</a>' });
}

async function loadAccounts() {
  const { accounts } = await api.get("/api/accounts");
  $("#accounts").innerHTML = `<ul class="list">${accounts
    .map(
      (a) => `<li class="list-item">${platformIcon(a.platform)}
        <div class="grow"><div class="list-title">${esc(a.label)}</div><div class="list-sub truncate">${esc(a.accountName || (a.status === "not_connected" ? "Not connected yet" : ""))}</div></div>
        ${accountBadge(a.status)}</li>`
    )
    .join("")}</ul>`;
  const connected = accounts.filter((a) => a.status === "connected").length;
  const expired = accounts.filter((a) => a.status === "expired");
  if (!connected) {
    $("#onboarding").innerHTML = `<div class="card mb-20"><div class="card-body row-between">
      <div><h2>Connect your first account</h2><p class="muted mt-8">Link Facebook, Instagram, YouTube, TikTok or Pinterest to start publishing.</p></div>
      <a class="btn btn-primary" href="/accounts.html">${icon("link")}Connect accounts</a></div></div>`;
  } else if (expired.length) {
    $("#onboarding").innerHTML = `<div class="mb-20">${alertHtml(
      "warning",
      `${expired.map((a) => a.label).join(", ")} ${expired.length === 1 ? "needs" : "need"} to be reconnected`,
      "The access token expired. Scheduled posts to these platforms will fail until you reconnect."
    )}</div>`;
  }
}

async function init() {
  await mountLayout({ page: "dashboard", title: "Dashboard" });
  hydrateIcons();
  for (const id of ["#attention", "#upcoming", "#recent", "#accounts"]) setLoading($(id));
  const jobs = [loadStats(), loadAttention(), loadUpcoming(), loadRecent(), loadAccounts()];
  const results = await Promise.allSettled(jobs);
  const failed = results.find((r) => r.status === "rejected");
  if (failed) toastError(failed.reason, "Some dashboard data could not be loaded.");
}

init();
