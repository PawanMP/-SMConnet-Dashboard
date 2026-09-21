// Analytics dashboard: KPIs, outcomes over time, platform distribution,
// engagement and top posts, all scoped by one date-range filter.
import { api } from "../core/api.js";
import { mountLayout } from "../core/layout.js";
import { hydrateIcons } from "../core/page.js";
import { icon, platformIcon, PLATFORM_LABEL } from "../core/icons.js";
import { stackedColumns, stackedBars } from "../core/charts.js";
import { $, $$, esc, fmt, params, setParams, busy, toast, toastError, errorAlert, emptyState } from "../core/ui.js";

let data = null;
const tableMode = { timeline: false, platforms: false };

const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function setPreset(days) {
  const to = new Date();
  const from = new Date(Date.now() - (days - 1) * 86400000);
  $("#from").value = isoDate(from);
  $("#to").value = isoDate(to);
  $$("#presets .chip").forEach((c) => c.setAttribute("aria-pressed", String(Number(c.dataset.days) === days)));
}

function tile(label, iconName, value, sub) {
  return `<div class="stat"><div class="stat-label">${icon(iconName)}${esc(label)}</div><div class="stat-value">${value}</div>${sub ? `<div class="stat-sub">${esc(sub)}</div>` : ""}</div>`;
}

function renderStats() {
  const t = data.totals;
  $("#stats").innerHTML = [
    tile("Total posts", "posts", fmt.number(t.posts), `${fmt.number(t.drafts)} drafts not counted`),
    tile("Published", "checkCircle", fmt.number(t.published), t.partial ? `+${fmt.number(t.partial)} partly published` : "All platforms succeeded"),
    tile("Failed", "xCircle", fmt.number(t.failed), `${fmt.number(t.platformFailures)} failed platform attempts`),
    tile("Scheduled", "clock", fmt.number(t.scheduled), "Waiting to publish"),
    tile("Success rate", "percent", t.successRate === null ? "-" : `${t.successRate}%`, `${fmt.number(t.platformPublishes)} of ${fmt.number(t.platformPublishes + t.platformFailures)} attempts`),
    tile("Connected accounts", "link", `${t.connectedAccounts} / 5`, "Platforms ready"),
  ].join("");
}

function tableHtml(head, rows) {
  return `<div class="table-wrap"><table class="table"><thead><tr>${head.map((h, i) => `<th${i ? ' class="num"' : ""}>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i ? ' class="num"' : ""}>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function renderTimeline() {
  const box = $("#timeline");
  const total = data.timeline.reduce((a, d) => a + d.success + d.failed, 0);
  if (tableMode.timeline) {
    box.innerHTML = tableHtml(
      ["Date", "Published", "Failed"],
      data.timeline.filter((d) => d.success || d.failed).map((d) => [esc(fmt.date(`${d.date}T12:00:00`)), fmt.number(d.success), fmt.number(d.failed)])
    ) || "";
    if (!total) box.innerHTML = emptyState({ iconName: "chart", title: "No publishing activity in this range" });
    return;
  }
  box.innerHTML = total ? "" : emptyState({ iconName: "chart", title: "No publishing activity in this range", text: "Published and failed attempts will be charted here." });
  if (total) stackedColumns(box, data.timeline);
}

function renderPlatforms() {
  const box = $("#platforms");
  const rows = data.platforms.map((p) => ({ label: PLATFORM_LABEL[p.platform], success: p.success, failed: p.failed, scheduled: p.scheduled }));
  if (tableMode.platforms) {
    box.innerHTML = tableHtml(
      ["Platform", "Published", "Failed", "Scheduled", "Success rate"],
      data.platforms.map((p) => [
        `<span class="row">${platformIcon(p.platform, "sm")}${esc(PLATFORM_LABEL[p.platform])}</span>`,
        fmt.number(p.success),
        fmt.number(p.failed),
        fmt.number(p.scheduled),
        p.success + p.failed ? `${Math.round((p.success / (p.success + p.failed)) * 100)}%` : "-",
      ])
    );
    return;
  }
  const any = rows.some((r) => r.success || r.failed);
  box.innerHTML = any ? "" : emptyState({ iconName: "layers", title: "No results per platform yet" });
  if (any) stackedBars(box, rows);
}

function renderEngagement() {
  const e = data.engagement;
  if (!e.byPlatform.length) {
    $("#engagement").innerHTML = emptyState({
      iconName: "heart",
      title: "No engagement data yet",
      text: 'Use "Refresh engagement data" to fetch views, likes and comments from the platforms.',
    });
  } else {
    const cell = (v) => fmt.number(v);
    $("#engagement").innerHTML = tableHtml(
      ["Platform", "Views", "Likes", "Comments", "Shares", "Saves"],
      [
        ...e.byPlatform.map((p) => [`<span class="row">${platformIcon(p.platform, "sm")}${esc(PLATFORM_LABEL[p.platform])}</span>`, cell(p.views), cell(p.likes), cell(p.comments), cell(p.shares), cell(p.saves)]),
        ["<strong>Total</strong>", `<strong>${cell(e.totals.views)}</strong>`, `<strong>${cell(e.totals.likes)}</strong>`, `<strong>${cell(e.totals.comments)}</strong>`, `<strong>${cell(e.totals.shares)}</strong>`, `<strong>${cell(e.totals.saves)}</strong>`],
      ]
    );
  }
  $("#top").innerHTML = e.topPosts.length
    ? tableHtml(
        ["Post", "Likes", "Comments", "Shares", "Views"],
        e.topPosts.map((p) => [`<a href="/post.html?id=${p.postId}">${esc(p.title)}</a>`, fmt.number(p.likes), fmt.number(p.comments), fmt.number(p.shares), fmt.number(p.views)])
      )
    : emptyState({ iconName: "chart", title: "No ranked posts yet", text: "Posts are ranked once engagement data has been fetched." });
}

function renderAll() {
  renderStats();
  renderTimeline();
  renderPlatforms();
  renderEngagement();
}

async function load() {
  const from = $("#from").value;
  const to = $("#to").value;
  setParams({ from, to });
  const root = $("#analytics-root");
  if (data) root.classList.add("is-refreshing");
  try {
    const qs = new URLSearchParams();
    if (from) qs.set("from", new Date(`${from}T00:00:00`).toISOString());
    if (to) qs.set("to", new Date(`${to}T23:59:59`).toISOString());
    data = await api.get(`/api/analytics/summary?${qs}`);
    renderAll();
  } catch (err) {
    toastError(err);
    if (!data) root.innerHTML = errorAlert(err);
  } finally {
    root.classList.remove("is-refreshing");
  }
}

async function init() {
  await mountLayout({ page: "analytics", title: "Analytics" });
  hydrateIcons();
  const p = params();
  if (p.get("from") && p.get("to")) {
    $("#from").value = p.get("from");
    $("#to").value = p.get("to");
    $$("#presets .chip").forEach((c) => c.setAttribute("aria-pressed", "false"));
  } else setPreset(30);

  $$("#presets .chip").forEach((c) =>
    c.addEventListener("click", () => {
      setPreset(Number(c.dataset.days));
      load();
    })
  );
  for (const id of ["#from", "#to"]) {
    $(id).addEventListener("change", () => {
      $$("#presets .chip").forEach((c) => c.setAttribute("aria-pressed", "false"));
      load();
    });
  }
  $$("[data-toggle-table]").forEach((b) =>
    b.addEventListener("click", () => {
      const key = b.dataset.toggleTable;
      tableMode[key] = !tableMode[key];
      b.lastChild.textContent = tableMode[key] ? "Chart" : "Table";
      if (key === "timeline") renderTimeline();
      else renderPlatforms();
    })
  );
  $("#refresh-metrics").addEventListener("click", (e) =>
    busy(e.currentTarget, "Fetching...", async () => {
      try {
        const res = await api.post("/api/analytics/refresh");
        const extra = res.failed ? ` ${res.failed} could not be fetched${res.errors[0] ? ` (${res.errors[0].message})` : ""}.` : "";
        toast(`Updated engagement for ${res.updated} post(s).${extra}`, res.failed ? "error" : "success");
        await load();
      } catch (err) {
        toastError(err);
      }
    })
  );
  // Redraw on width changes only (a redraw changes height, which must not loop).
  let resizeTimer;
  let lastWidth = $("#timeline").clientWidth;
  new ResizeObserver(() => {
    const w = $("#timeline").clientWidth;
    if (w === lastWidth) return;
    lastWidth = w;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => data && (renderTimeline(), renderPlatforms()), 150);
  }).observe($("#timeline"));
  await load();
}

init();
