// Post details: media, content, per-platform status, errors, retries,
// schedule controls, engagement metrics and the attempt history.
import { api } from "../core/api.js";
import { mountLayout } from "../core/layout.js";
import { hydrateIcons } from "../core/page.js";
import { icon, platformIcon, PLATFORM_LABEL } from "../core/icons.js";
import {
  $, esc, fmt, params, statusBadge, targetLabel, busy, toast, toastError, confirmDialog, openDialog, errorAlert, alertHtml,
  postTitle, toLocalInput, fromLocalInput, setLoading, localZone,
} from "../core/ui.js";

let post = null;

const TARGET_BADGE = {
  success: ["badge-success", "checkCircle"],
  failed: ["badge-danger", "xCircle"],
  scheduled: ["badge-info", "clock"],
  pending: ["badge-info", "clock"],
  processing: ["badge-warning", "refresh"],
  cancelled: ["badge-neutral", "x"],
};
const TRIGGER = { now: "Publish now", schedule: "Scheduler", retry: "Retry", run_now: "Run now" };

function targetBadge(status) {
  const [cls, ic] = TARGET_BADGE[status] || ["badge-neutral", "info"];
  return `<span class="badge ${cls}">${icon(ic)}${esc(targetLabel(status))}</span>`;
}

function mediaBlock() {
  if (!post.media) return `<div class="empty" style="padding:24px">${icon("file")}<p class="mt-8">Text-only post</p></div>`;
  const m = post.media;
  return `<div class="media-preview">${m.resourceType === "video" ? `<video src="${esc(m.url)}" controls preload="metadata"></video>` : `<img src="${esc(m.url)}" alt="Post media" />`}</div>`;
}

function contentBlock() {
  const rows = [
    ["Title", post.title],
    ["Caption", post.caption],
    ["Hashtags", post.hashtags],
    ["Description", post.description],
  ].filter(([, v]) => v);
  const custom = Object.entries(post.platformContent || {}).filter(([, v]) => Object.values(v).some(Boolean));
  return `${rows.length ? rows.map(([k, v]) => `<div class="field"><div class="label">${k}</div><div style="white-space:pre-wrap">${esc(v)}</div></div>`).join("") : '<p class="muted">No shared text.</p>'}
    ${custom
      .map(
        ([p, v]) => `<details class="advanced mt-12"><summary>${icon("chevronRight", "icon-sm")}${PLATFORM_LABEL[p]} version</summary>
        <div class="mt-12">${Object.entries(v)
          .filter(([, x]) => x)
          .map(([k, x]) => `<div class="field"><div class="label">${esc(k[0].toUpperCase() + k.slice(1))}</div><div style="white-space:pre-wrap">${esc(x)}</div></div>`)
          .join("")}</div></details>`
      )
      .join("")}`;
}

function targetsTable() {
  if (!post.targets.length) {
    return `<div class="card-body"><p class="muted">Not published or scheduled yet. Selected platforms: ${esc(post.platforms.map((p) => PLATFORM_LABEL[p]).join(", ") || "none")}.</p></div>`;
  }
  return `<div class="table-wrap"><table class="table">
    <thead><tr><th>Platform</th><th>Status</th><th>When</th><th>Attempts</th><th>Details</th><th></th></tr></thead>
    <tbody>${post.targets
      .map((t) => {
        const when = t.publishedAt ? `Published ${fmt.dateTime(t.publishedAt)}` : t.scheduledAt ? `${t.status === "scheduled" ? "Scheduled" : "Was due"} ${fmt.dateTime(t.scheduledAt)}` : t.lastAttemptAt ? `Tried ${fmt.dateTime(t.lastAttemptAt)}` : "-";
        const details = t.status === "success"
          ? `<span class="small muted">ID ${esc(t.platformPostId || "-")}</span>`
          : t.errorMessage
            ? `<span class="small" style="color:var(--danger-text)">${esc(t.errorMessage)}</span>${t.status === "scheduled" ? '<div class="small muted">Will retry automatically.</div>' : ""}`
            : "";
        const action = t.status === "failed"
          ? `<button type="button" class="btn btn-primary btn-sm" data-retry="${t.platform}">${icon("retry")}Retry</button>`
          : t.platformUrl
            ? `<a class="btn btn-secondary btn-sm" href="${esc(t.platformUrl)}" target="_blank" rel="noopener">${icon("external")}Open</a>`
            : "";
        return `<tr><td><div class="row">${platformIcon(t.platform, "sm")}<strong>${PLATFORM_LABEL[t.platform]}</strong></div></td>
          <td>${targetBadge(t.status)}</td><td class="small nowrap">${esc(when)}</td><td class="num">${t.attempts}</td><td style="max-width:360px">${details}</td><td class="nowrap">${action}</td></tr>`;
      })
      .join("")}</tbody></table></div>`;
}

function metricsTable() {
  if (!post.metrics.length) {
    return `<div class="card-body"><p class="muted">No engagement data yet. Use "Refresh engagement" on the Analytics page after the post has been live for a while. Figures appear where each platform's API provides them.</p></div>`;
  }
  const cell = (v) => `<td class="num">${v === null ? '<span class="muted">n/a</span>' : fmt.number(v)}</td>`;
  return `<div class="table-wrap"><table class="table"><thead><tr><th>Platform</th><th class="num">Views</th><th class="num">Likes</th><th class="num">Comments</th><th class="num">Shares</th><th class="num">Saves</th><th>Updated</th></tr></thead>
    <tbody>${post.metrics
      .map((m) => `<tr><td><div class="row">${platformIcon(m.platform, "sm")}${PLATFORM_LABEL[m.platform]}</div></td>${cell(m.views)}${cell(m.likes)}${cell(m.comments)}${cell(m.shares)}${cell(m.saves)}<td class="small">${fmt.relative(m.fetchedAt)}</td></tr>`)
      .join("")}</tbody></table></div>`;
}

function attemptsList() {
  if (!post.attempts.length) return `<div class="card-body"><p class="muted">No publishing attempts yet.</p></div>`;
  return `<ul class="list">${post.attempts
    .map(
      (a) => `<li class="list-item">${platformIcon(a.platform, "sm")}
      <div class="grow"><div class="row" style="gap:8px"><strong>${PLATFORM_LABEL[a.platform]}</strong>${targetBadge(a.status === "success" ? "success" : "failed")}<span class="small muted">Attempt ${a.attemptNo} &middot; ${esc(TRIGGER[a.trigger] || a.trigger)}${a.durationMs ? ` &middot; ${(a.durationMs / 1000).toFixed(1)}s` : ""}</span></div>
      ${a.errorMessage ? `<div class="small mt-8" style="color:var(--danger-text)">${esc(a.errorMessage)}</div>` : ""}</div>
      <span class="small muted nowrap">${fmt.dateTime(a.createdAt)}</span></li>`
    )
    .join("")}</ul>`;
}

function headerActions() {
  const a = [];
  const scheduled = post.targets.filter((t) => t.status === "scheduled");
  const failed = post.targets.filter((t) => t.status === "failed");
  const editable = post.status === "draft" || (post.status === "scheduled" && post.targets.every((t) => t.status === "scheduled"));
  if (editable) a.push(`<a class="btn btn-secondary" href="/create.html?id=${post.id}">${icon("edit")}Edit</a>`);
  if (post.status === "draft") a.push(`<a class="btn btn-primary" href="/create.html?id=${post.id}">${icon("send")}Publish or schedule</a>`);
  if (scheduled.length) {
    a.push(`<button type="button" class="btn btn-secondary" data-act="reschedule">${icon("clock")}Reschedule</button>`);
    a.push(`<button type="button" class="btn btn-danger-outline" data-act="cancel">${icon("x")}Cancel schedule</button>`);
    a.push(`<button type="button" class="btn btn-primary" data-act="run-now">${icon("play")}Publish now</button>`);
  }
  if (failed.length) a.push(`<button type="button" class="btn btn-primary" data-act="retry-all">${icon("retry")}Retry failed (${failed.length})</button>`);
  a.push(`<button type="button" class="btn btn-secondary" data-act="duplicate">${icon("copy")}Duplicate</button>`);
  if (post.status !== "publishing") a.push(`<button type="button" class="btn btn-ghost btn-icon" data-act="delete" title="Delete post" aria-label="Delete post">${icon("trash")}</button>`);
  return a.join("");
}

function render() {
  const partialNote =
    post.status === "partial"
      ? alertHtml("warning", "Some platforms failed", "Retrying only republishes to the platforms that failed. Platforms that succeeded are left alone.")
      : post.status === "failed"
        ? alertHtml("error", "Publishing failed", "Check the error for each platform below, fix the cause (for example reconnect the account), then retry.")
        : "";
  $("#post-root").innerHTML = `
    <div class="page-head">
      <div><div class="row" style="gap:10px"><h1>${esc(postTitle(post))}</h1>${statusBadge(post.status)}</div>
        <p>Created ${fmt.dateTime(post.createdAt)}${post.publishedAt ? ` &middot; First published ${fmt.dateTime(post.publishedAt)}` : ""}${post.status === "scheduled" && post.scheduledAt ? ` &middot; Next publish ${fmt.dateTime(post.scheduledAt)}` : ""}</p></div>
      <div class="actions" id="actions">${headerActions()}</div>
    </div>
    ${partialNote ? `<div class="mb-20">${partialNote}</div>` : ""}
    <div class="grid-2 mb-20">
      <section class="card"><div class="card-head"><h2>Media</h2></div><div class="card-body">${mediaBlock()}</div></section>
      <section class="card"><div class="card-head"><h2>Content</h2></div><div class="card-body">${contentBlock()}</div></section>
    </div>
    <section class="card mb-20"><div class="card-head"><h2>Platform status</h2></div>${targetsTable()}</section>
    <section class="card mb-20"><div class="card-head"><h2>Engagement</h2></div>${metricsTable()}</section>
    <section class="card"><div class="card-head"><h2>Publishing history</h2></div>${attemptsList()}</section>`;
  $("#post-root").querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => act(b.dataset.act, b)));
  $("#post-root").querySelectorAll("[data-retry]").forEach((b) => b.addEventListener("click", () => retry(b, [b.dataset.retry])));
}

async function reload() {
  post = (await api.get(`/api/posts/${post.id}`)).post;
  render();
}

function reportResults(results) {
  const ok = results.filter((r) => r.success).length;
  if (ok === results.length) toast(`Published to ${ok} platform${ok === 1 ? "" : "s"}.`, "success");
  else toast(`${ok} of ${results.length} platforms succeeded. See the errors below.`, "error");
}

async function retry(btn, platforms) {
  await busy(btn, "Retrying...", async () => {
    try {
      const res = await api.post(`/api/posts/${post.id}/retry`, platforms ? { platforms } : {});
      post = res.post;
      reportResults(res.results);
      render();
    } catch (err) {
      toastError(err);
    }
  });
}

async function reschedule() {
  const scheduled = post.targets.filter((t) => t.status === "scheduled");
  const body = document.createElement("div");
  body.innerHTML = `<p class="mb-16">New publish time for the platforms still waiting. Times are in ${esc(localZone())}.</p>
    ${scheduled
      .map((t) => `<div class="field"><label class="label" for="rs-${t.platform}">${platformIcon(t.platform, "sm")}${PLATFORM_LABEL[t.platform]}</label><input class="input" type="datetime-local" id="rs-${t.platform}" value="${toLocalInput(t.scheduledAt)}" /></div>`)
      .join("")}<div id="rs-error"></div>`;
  await openDialog({
    title: "Reschedule post",
    body,
    actions: [
      { label: "Cancel", variant: "btn-secondary" },
      {
        label: "Save new time",
        variant: "btn-primary",
        icon: "clock",
        handler: async (dlg, btn) => {
          const schedules = {};
          for (const t of scheduled) schedules[t.platform] = fromLocalInput(dlg.querySelector(`#rs-${t.platform}`).value);
          try {
            await busy(btn, "Saving...", async () => {
              post = (await api.patch(`/api/posts/${post.id}/schedule`, { schedules })).post;
            });
            toast("Schedule updated.", "success");
            render();
          } catch (err) {
            dlg.querySelector("#rs-error").innerHTML = errorAlert(err);
            return false;
          }
        },
      },
    ],
  });
}

async function act(action, btn) {
  try {
    if (action === "retry-all") return retry(btn, null);
    if (action === "reschedule") return reschedule();
    if (action === "run-now") {
      if (!(await confirmDialog({ title: "Publish now?", message: "The platforms still scheduled will be published immediately instead of at their scheduled time.", confirmLabel: "Publish now", icon: "play" }))) return;
      await busy(btn, "Publishing...", async () => {
        const res = await api.post(`/api/posts/${post.id}/run-now`);
        post = res.post;
        reportResults(res.results);
        render();
      });
    } else if (action === "cancel") {
      if (!(await confirmDialog({ title: "Cancel the schedule?", message: "Platforms that have not published yet will not be published. Anything already published stays live.", confirmLabel: "Cancel schedule", danger: true }))) return;
      post = (await api.post(`/api/posts/${post.id}/cancel`)).post;
      toast("Schedule cancelled.", "success");
      render();
    } else if (action === "duplicate") {
      const res = await api.post(`/api/posts/${post.id}/duplicate`);
      toast("Copied to a new draft.", "success");
      location.href = `/create.html?id=${res.post.id}`;
    } else if (action === "delete") {
      if (!(await confirmDialog({ title: "Delete this post?", message: "It is removed from your history. Posts already live on social platforms are not deleted there.", confirmLabel: "Delete post", danger: true }))) return;
      await api.del(`/api/posts/${post.id}`);
      toast("Post deleted.", "success");
      location.href = "/posts.html";
    }
  } catch (err) {
    toastError(err);
    reload().catch(() => {});
  }
}

async function init() {
  await mountLayout({ page: "posts", title: "Post details" });
  hydrateIcons();
  const id = Number(params().get("id"));
  const root = $("#post-root");
  if (!id) {
    root.innerHTML = errorAlert({ message: "No post selected." });
    return;
  }
  setLoading(root);
  try {
    post = (await api.get(`/api/posts/${id}`)).post;
    render();
    // Keep the view current while something is publishing.
    setInterval(() => {
      if (post && post.status === "publishing") reload().catch(() => {});
    }, 5000);
  } catch (err) {
    root.innerHTML = errorAlert(err);
  }
}

init();
