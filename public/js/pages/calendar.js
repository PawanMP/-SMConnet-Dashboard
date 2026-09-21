// Monthly and weekly calendar of scheduled and published posts, plus the
// upcoming queue. Events open a dialog to view, reschedule, run or cancel.
import { api } from "../core/api.js";
import { mountLayout } from "../core/layout.js";
import { hydrateIcons } from "../core/page.js";
import { icon, platformIcon, PLATFORM_LABEL } from "../core/icons.js";
import {
  $, esc, fmt, params, setParams, targetPill, emptyState, statusBadge, postTitle, mediaThumb, openDialog, confirmDialog, busy, toast, toastError,
  errorAlert, toLocalInput, fromLocalInput, localZone, setLoading,
} from "../core/ui.js";

let view = "month";
let cursor = new Date();
let events = [];

const DAY_MS = 86400000;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const mondayOf = (d) => addDays(startOfDay(d), -((d.getDay() + 6) % 7));

function range() {
  if (view === "week") {
    const start = mondayOf(cursor);
    return { start, end: addDays(start, 7) };
  }
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const start = mondayOf(first);
  return { start, end: addDays(start, 42) };
}

function eventState(e) {
  const s = e.targets.map((t) => t.status);
  if (s.every((x) => x === "success")) return "success";
  if (s.some((x) => x === "success") && s.some((x) => x === "failed")) return "partial";
  if (s.every((x) => x === "failed")) return "failed";
  return "scheduled";
}

function eventButton(e, idx) {
  const st = eventState(e);
  const label = `${fmt.time(e.at)} ${e.title} (${e.targets.map((t) => PLATFORM_LABEL[t.platform]).join(", ")})`;
  return `<button type="button" class="cal-event ${st}" data-event="${idx}" title="${esc(label)}"><span class="t">${esc(fmt.time(e.at))}</span><span class="n">${esc(e.title)}</span></button>`;
}

function renderMonth() {
  const { start } = range();
  const today = new Date();
  const byDay = new Map();
  events.forEach((e, i) => {
    const k = dayKey(new Date(e.at));
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(i);
  });
  const dows = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => `<div class="cal-dow">${d}</div>`).join("");
  let cells = "";
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    const list = byDay.get(dayKey(d)) || [];
    const other = d.getMonth() !== cursor.getMonth();
    const future = startOfDay(d) >= startOfDay(today);
    const shown = list.slice(0, 3).map((idx) => eventButton(events[idx], idx)).join("");
    const more = list.length > 3 ? `<button type="button" class="cal-more btn btn-ghost btn-sm" data-day="${dayKey(d)}">+${list.length - 3} more</button>` : "";
    const dayLabel = future
      ? `<a class="cal-day" href="/create.html?date=${dayKey(d)}" title="Schedule a post on ${esc(fmt.date(d))}">${d.getDate()}</a>`
      : `<span class="cal-day">${d.getDate()}</span>`;
    cells += `<div class="cal-cell${other ? " other" : ""}${sameDay(d, today) ? " today" : ""}">${dayLabel}${shown}${more}</div>`;
  }
  $("#calendar").innerHTML = `<div class="cal-grid" role="grid">${dows}${cells}</div>`;
  $("#cal-title").textContent = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function renderWeek() {
  const { start } = range();
  const today = new Date();
  let cols = "";
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    const list = events.map((e, idx) => [e, idx]).filter(([e]) => sameDay(new Date(e.at), d));
    cols += `<div class="cal-week-col${sameDay(d, today) ? " today" : ""}">
      <div class="cal-week-head">${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</div>
      <div class="cal-week-body">${list.length ? list.map(([e, idx]) => eventButton(e, idx)).join("") : '<span class="small muted">No posts</span>'}
        ${startOfDay(d) >= startOfDay(today) ? `<a class="btn btn-ghost btn-sm" href="/create.html?date=${dayKey(d)}">${icon("plus")}Add</a>` : ""}</div>
    </div>`;
  }
  $("#calendar").innerHTML = `<div class="cal-week">${cols}</div>`;
  const end = addDays(start, 6);
  $("#cal-title").textContent = `${start.toLocaleDateString(undefined, { day: "numeric", month: "short" })} - ${end.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
}

async function load() {
  const { start, end } = range();
  setParams({ view, date: dayKey(cursor) });
  $("#calendar").classList.add("is-refreshing");
  try {
    const res = await api.get(`/api/posts/calendar?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(new Date(end.getTime() - 1).toISOString())}`);
    events = res.events;
  } catch (err) {
    toastError(err);
    events = [];
  }
  $("#calendar").classList.remove("is-refreshing");
  if (view === "month") renderMonth();
  else renderWeek();
}

async function loadUpcoming() {
  const el = $("#upcoming");
  setLoading(el);
  try {
    const { items, total } = await api.get("/api/posts?status=scheduled&sort=scheduled&pageSize=20");
    $("#upcoming-count").textContent = total ? `${total} waiting` : "";
    el.innerHTML = items.length
      ? `<ul class="list">${items
          .map(
            (p) => `<li class="list-item">${mediaThumb(p.media)}
            <div class="grow"><a class="list-title" href="/post.html?id=${p.id}">${esc(postTitle(p))}</a>
              <div class="list-sub">Next: ${fmt.dateTime(p.scheduledAt)} (${fmt.relative(p.scheduledAt)})</div>
              <div class="target-list mt-8">${p.targets.filter((t) => t.status !== "cancelled").map(targetPill).join("")}</div></div>
            <div class="row"><a class="btn btn-secondary btn-sm" href="/create.html?id=${p.id}">${icon("edit")}Edit</a><a class="btn btn-secondary btn-sm" href="/post.html?id=${p.id}">${icon("eye")}View</a></div></li>`
          )
          .join("")}</ul>`
      : emptyState({ iconName: "calendar", title: "Nothing scheduled", text: "Scheduled posts will be listed here in the order they go out.", action: '<a class="btn btn-primary" href="/create.html?mode=schedule">Schedule a post</a>' });
  } catch (err) {
    el.innerHTML = `<div class="card-body">${errorAlert(err)}</div>`;
  }
}

async function openEvent(e) {
  let post;
  try {
    post = (await api.get(`/api/posts/${e.postId}`)).post;
  } catch (err) {
    return toastError(err);
  }
  const waiting = post.targets.filter((t) => t.status === "scheduled");
  const body = document.createElement("div");
  body.innerHTML = `<div class="row mb-12">${statusBadge(post.status)}<span class="small muted">${fmt.dateTime(e.at)}</span></div>
    <p class="mb-12" style="white-space:pre-wrap">${esc((post.caption || post.description || "").slice(0, 280))}</p>
    <div class="target-list mb-16">${post.targets.map(targetPill).join("")}</div>
    ${
      waiting.length
        ? `<div class="field"><label class="label" for="move-to">Move remaining platforms to</label><input class="input" type="datetime-local" id="move-to" value="${toLocalInput(waiting[0].scheduledAt)}" /><span class="hint">Time zone: ${esc(localZone())}</span></div><div id="dlg-error"></div>`
        : ""
    }`;
  const actions = [{ label: "Close", variant: "btn-secondary" }];
  if (waiting.length) {
    actions.unshift({
      label: "Cancel schedule",
      variant: "btn-danger-outline",
      icon: "x",
      handler: async () => {
        if (!(await confirmDialog({ title: "Cancel the schedule?", message: "Platforms that have not published yet will not be published.", confirmLabel: "Cancel schedule", danger: true }))) return false;
        try {
          await api.post(`/api/posts/${post.id}/cancel`);
          toast("Schedule cancelled.", "success");
          refresh();
        } catch (err) {
          toastError(err);
        }
      },
    });
    actions.push({
      label: "Publish now",
      variant: "btn-secondary",
      icon: "play",
      handler: async (dlg, btn) => {
        try {
          await busy(btn, "Publishing...", async () => {
            const res = await api.post(`/api/posts/${post.id}/run-now`);
            const ok = res.results.filter((r) => r.success).length;
            toast(`Published to ${ok} of ${res.results.length} platform(s).`, ok === res.results.length ? "success" : "error");
          });
          refresh();
        } catch (err) {
          dlg.querySelector("#dlg-error").innerHTML = errorAlert(err);
          return false;
        }
      },
    });
    actions.push({
      label: "Save new time",
      variant: "btn-primary",
      icon: "clock",
      handler: async (dlg, btn) => {
        const at = fromLocalInput(dlg.querySelector("#move-to").value);
        try {
          await busy(btn, "Saving...", () => api.patch(`/api/posts/${post.id}/schedule`, { scheduledAt: at }));
          toast("Rescheduled.", "success");
          refresh();
        } catch (err) {
          dlg.querySelector("#dlg-error").innerHTML = errorAlert(err);
          return false;
        }
      },
    });
  }
  const openLink = document.createElement("div");
  openLink.className = "row mt-12";
  openLink.innerHTML = `<a class="btn btn-ghost btn-sm" href="/post.html?id=${post.id}">${icon("eye")}Open post details</a>${
    post.status === "scheduled" && post.targets.every((t) => t.status === "scheduled") ? `<a class="btn btn-ghost btn-sm" href="/create.html?id=${post.id}">${icon("edit")}Edit content</a>` : ""
  }`;
  body.appendChild(openLink);
  await openDialog({ title: postTitle(post), body, actions });
}

function refresh() {
  load();
  loadUpcoming();
}

function setView(v) {
  view = v;
  $("#view-month").setAttribute("aria-pressed", String(v === "month"));
  $("#view-week").setAttribute("aria-pressed", String(v === "week"));
  load();
}

async function init() {
  await mountLayout({ page: "calendar", title: "Calendar" });
  hydrateIcons();
  const p = params();
  if (p.get("view") === "week") view = "week";
  if (p.get("date")) {
    const d = new Date(`${p.get("date")}T12:00`);
    if (!Number.isNaN(d.getTime())) cursor = d;
  }
  if (view === "week") setView("week");
  $("#prev").addEventListener("click", () => {
    cursor = view === "week" ? addDays(cursor, -7) : new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
    load();
  });
  $("#next").addEventListener("click", () => {
    cursor = view === "week" ? addDays(cursor, 7) : new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    load();
  });
  $("#today").addEventListener("click", () => {
    cursor = new Date();
    load();
  });
  $("#view-month").addEventListener("click", () => setView("month"));
  $("#view-week").addEventListener("click", () => setView("week"));
  $("#calendar").addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-event]");
    if (btn) return openEvent(events[Number(btn.dataset.event)]);
    const more = ev.target.closest("[data-day]");
    if (more) {
      cursor = new Date(`${more.dataset.day}T12:00`);
      setView("week");
    }
  });
  if (view === "month") load();
  loadUpcoming();
}

init();
