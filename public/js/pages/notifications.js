import { api } from "../core/api.js";
import { mountLayout, refreshUnread } from "../core/layout.js";
import { hydrateIcons } from "../core/page.js";
import { icon } from "../core/icons.js";
import { $, $$, esc, fmt, emptyState, renderPager, toast, toastError, errorAlert, setLoading } from "../core/ui.js";

const TYPES = {
  publish_success: ["checkCircle", "badge-success", "Published"],
  schedule_completed: ["clock", "badge-success", "Schedule completed"],
  publish_failed: ["xCircle", "badge-danger", "Publishing failed"],
  connection_problem: ["alert", "badge-warning", "Connection problem"],
};

let page = 1;
let unreadOnly = false;

function row(n) {
  const [ic, cls, label] = TYPES[n.type] || ["info", "badge-neutral", n.type];
  return `<li class="list-item" style="align-items:flex-start;${n.isRead ? "" : "background:var(--primary-soft)"}">
    <span class="badge ${cls}" style="height:32px;width:32px;padding:0;justify-content:center" title="${esc(label)}">${icon(ic)}</span>
    <div class="grow">
      <div class="row" style="gap:8px"><span class="list-title">${esc(n.title)}</span>${n.isRead ? "" : '<span class="badge badge-info">New</span>'}</div>
      ${n.message ? `<div class="small mt-8" style="white-space:pre-wrap;color:var(--text-2)">${esc(n.message)}</div>` : ""}
      <div class="small muted mt-8">${esc(label)} &middot; ${fmt.dateTime(n.createdAt)}</div>
    </div>
    <div class="row">
      ${n.link ? `<a class="btn btn-secondary btn-sm" href="${esc(n.link)}" data-open="${n.id}">${icon("eye")}Open</a>` : ""}
      ${n.isRead ? "" : `<button type="button" class="btn btn-ghost btn-sm" data-read="${n.id}">${icon("check")}Mark read</button>`}
      <button type="button" class="btn btn-ghost btn-sm btn-icon" data-delete="${n.id}" aria-label="Delete notification" title="Delete">${icon("trash")}</button>
    </div>
  </li>`;
}

async function load() {
  const el = $("#list");
  setLoading(el);
  try {
    const data = await api.get(`/api/notifications?page=${page}&pageSize=20${unreadOnly ? "&unread=1" : ""}`);
    data.totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
    el.innerHTML = data.items.length
      ? `<ul class="list">${data.items.map(row).join("")}</ul>`
      : emptyState({ iconName: "bell", title: unreadOnly ? "You're all caught up" : "No notifications yet", text: "You'll be notified when posts publish, fail, or an account needs reconnecting." });
    $("#mark-all").disabled = !data.unreadCount;
    renderPager($("#pager"), data, (n) => {
      page = n;
      load();
    });
  } catch (err) {
    el.innerHTML = `<div class="card-body">${errorAlert(err)}</div>`;
  }
}

async function init() {
  await mountLayout({ page: "notifications", title: "Notifications" });
  hydrateIcons();
  $$("[data-filter]").forEach((c) =>
    c.addEventListener("click", () => {
      unreadOnly = c.dataset.filter === "unread";
      $$("[data-filter]").forEach((x) => x.setAttribute("aria-pressed", String(x === c)));
      page = 1;
      load();
    })
  );
  $("#mark-all").addEventListener("click", async () => {
    try {
      await api.post("/api/notifications/read-all");
      toast("All notifications marked as read.", "success");
      refreshUnread();
      load();
    } catch (err) {
      toastError(err);
    }
  });
  $("#list").addEventListener("click", async (e) => {
    const read = e.target.closest("[data-read]");
    const del = e.target.closest("[data-delete]");
    const open = e.target.closest("[data-open]");
    try {
      if (read) {
        await api.post(`/api/notifications/${read.dataset.read}/read`);
        refreshUnread();
        load();
      } else if (del) {
        await api.del(`/api/notifications/${del.dataset.delete}`);
        refreshUnread();
        load();
      } else if (open) {
        api.post(`/api/notifications/${open.dataset.open}/read`).catch(() => {});
      }
    } catch (err) {
      toastError(err);
    }
  });
  load();
}

init();
