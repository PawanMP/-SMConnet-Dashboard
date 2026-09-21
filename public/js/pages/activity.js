import { api } from "../core/api.js";
import { mountLayout } from "../core/layout.js";
import { hydrateIcons } from "../core/page.js";
import { icon } from "../core/icons.js";
import { describe } from "../core/activity-labels.js";
import { $, esc, fmt, params, setParams, emptyState, renderPager, errorAlert, setLoading } from "../core/ui.js";

let page = 1;

function entityLink(a) {
  if (a.entityType === "post" && a.entityId && !a.action.endsWith("delete")) return `<a class="btn btn-ghost btn-sm" href="/post.html?id=${esc(a.entityId)}">${icon("eye")}View post</a>`;
  return "";
}

async function load() {
  const el = $("#list");
  setLoading(el);
  const category = $("#category").value;
  setParams({ category, page: page > 1 ? page : "" });
  try {
    const data = await api.get(`/api/activity?page=${page}&pageSize=30${category ? `&action=${category}` : ""}`);
    data.totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
    el.innerHTML = data.items.length
      ? `<ul class="list">${data.items
          .map((a) => {
            const { iconName, text } = describe(a);
            return `<li class="list-item"><span class="empty-icon" style="width:34px;height:34px;margin:0;border-radius:9px">${icon(iconName)}</span>
              <div class="grow"><div class="list-title" style="font-weight:550">${esc(text)}</div>
              <div class="list-sub">${fmt.dateTime(a.createdAt)}${a.ip ? ` &middot; IP ${esc(a.ip)}` : ""}</div></div>${entityLink(a)}</li>`;
          })
          .join("")}</ul>`
      : emptyState({ iconName: "activity", title: "No activity recorded", text: "Actions you take will be listed here." });
    renderPager($("#pager"), data, (n) => {
      page = n;
      load();
    });
  } catch (err) {
    el.innerHTML = `<div class="card-body">${errorAlert(err)}</div>`;
  }
}

async function init() {
  await mountLayout({ page: "activity", title: "Activity log" });
  hydrateIcons();
  const p = params();
  if (p.get("category")) $("#category").value = p.get("category");
  page = Number(p.get("page")) || 1;
  $("#category").addEventListener("change", () => {
    page = 1;
    load();
  });
  load();
}

init();
