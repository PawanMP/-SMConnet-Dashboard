// Administrator panel: system overview, user management, system-wide activity.
import { api } from "../core/api.js";
import { mountLayout } from "../core/layout.js";
import { hydrateIcons } from "../core/page.js";
import { icon } from "../core/icons.js";
import { describe } from "../core/activity-labels.js";
import { $, $$, esc, fmt, debounce, busy, toast, toastError, confirmDialog, openDialog, errorAlert, emptyState, renderPager, setLoading } from "../core/ui.js";

let me = null;
let userPage = 1;
let activityPage = 1;

function tile(label, iconName, value, sub) {
  return `<div class="stat"><div class="stat-label">${icon(iconName)}${esc(label)}</div><div class="stat-value">${value}</div>${sub ? `<div class="stat-sub">${esc(sub)}</div>` : ""}</div>`;
}

async function loadOverview() {
  const s = await api.get("/api/admin/stats");
  const t = s.totals;
  $("#sys-stats").innerHTML = [
    tile("Users", "users", fmt.number(s.users.total), `${s.users.admins} admin(s), ${s.users.active} active`),
    tile("Connected accounts", "link", fmt.number(s.connectedAccounts), "Across all users"),
    tile("Posts (30 days)", "posts", fmt.number(t.posts), `${fmt.number(t.published)} published`),
    tile("Failed (30 days)", "xCircle", fmt.number(t.failed), `${fmt.number(t.platformFailures)} platform failures`),
    tile("Scheduled", "clock", fmt.number(t.scheduled), "Waiting to publish"),
    tile("Success rate", "percent", t.successRate === null ? "-" : `${t.successRate}%`, "Platform attempts, 30 days"),
  ].join("");
  const sch = s.scheduler;
  $("#scheduler").innerHTML = `<dt>Mode</dt><dd>${sch.mode === "interval" ? `Built-in timer, every ${Math.round(sch.intervalMs / 1000)} seconds` : "External cron (/api/cron/scheduler)"}</dd>
    <dt>Last run</dt><dd>${sch.lastRunAt ? `${fmt.dateTime(sch.lastRunAt)} (${fmt.relative(sch.lastRunAt)})` : "Not yet"}</dd>
    <dt>Running now</dt><dd>${sch.running ? "Yes" : "No"}</dd>
    ${sch.lastSummary ? `<dt>Last result</dt><dd>${sch.lastSummary.published} published, ${sch.lastSummary.failed} failed, ${sch.lastSummary.retrying} retrying</dd>` : ""}`;
}

function userRow(u) {
  const self = u.id === me.id;
  return `<tr>
    <td><div class="list-title">${esc(u.name)}${self ? ' <span class="badge badge-info">You</span>' : ""}</div><div class="small muted">${esc(u.email)}</div></td>
    <td>${u.role === "admin" ? `<span class="badge badge-info">${icon("shield")}Admin</span>` : '<span class="badge badge-neutral">User</span>'}</td>
    <td>${u.isActive ? `<span class="badge badge-success">${icon("checkCircle")}Active</span>` : `<span class="badge badge-danger">${icon("xCircle")}Disabled</span>`}</td>
    <td class="small">${u.lastLoginAt ? fmt.relative(u.lastLoginAt) : "Never"}</td>
    <td class="small">${fmt.date(u.createdAt)}</td>
    <td><div class="row" style="justify-content:flex-end">
      <button type="button" class="btn btn-secondary btn-sm" data-act="role" data-id="${u.id}" data-role="${u.role}">${u.role === "admin" ? "Make user" : "Make admin"}</button>
      ${self ? "" : `<button type="button" class="btn btn-secondary btn-sm" data-act="active" data-id="${u.id}" data-active="${u.isActive}">${u.isActive ? "Disable" : "Enable"}</button>
      <button type="button" class="btn btn-ghost btn-sm btn-icon" data-act="delete" data-id="${u.id}" data-email="${esc(u.email)}" aria-label="Delete user" title="Delete user">${icon("trash")}</button>`}
    </div></td></tr>`;
}

async function loadUsers() {
  const el = $("#users");
  setLoading(el);
  const qs = new URLSearchParams({ page: userPage, pageSize: 20 });
  if ($("#user-q").value.trim()) qs.set("q", $("#user-q").value.trim());
  if ($("#user-role").value) qs.set("role", $("#user-role").value);
  try {
    const data = await api.get(`/api/admin/users?${qs}`);
    data.totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
    el.innerHTML = data.items.length
      ? `<div class="table-wrap"><table class="table"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last sign-in</th><th>Joined</th><th></th></tr></thead><tbody>${data.items.map(userRow).join("")}</tbody></table></div>`
      : emptyState({ iconName: "users", title: "No users match" });
    renderPager($("#users-pager"), data, (n) => {
      userPage = n;
      loadUsers();
    });
  } catch (err) {
    el.innerHTML = `<div class="card-body">${errorAlert(err)}</div>`;
  }
}

async function loadActivity() {
  const el = $("#sys-activity");
  setLoading(el);
  try {
    const data = await api.get(`/api/admin/activity?page=${activityPage}&pageSize=30`);
    data.totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
    el.innerHTML = data.items.length
      ? `<div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>User</th><th>Activity</th><th>IP</th></tr></thead><tbody>${data.items
          .map((a) => {
            const { iconName, text } = describe(a);
            return `<tr><td class="small nowrap">${fmt.dateTime(a.createdAt)}</td><td class="small">${esc(a.userEmail || "(deleted user)")}</td><td><span class="row" style="gap:8px">${icon(iconName, "icon-sm")}${esc(text)}</span></td><td class="small muted">${esc(a.ip || "")}</td></tr>`;
          })
          .join("")}</tbody></table></div>`
      : emptyState({ iconName: "activity", title: "No activity yet" });
    renderPager($("#activity-pager"), data, (n) => {
      activityPage = n;
      loadActivity();
    });
  } catch (err) {
    el.innerHTML = `<div class="card-body">${errorAlert(err)}</div>`;
  }
}

async function onUserAction(e) {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const id = b.dataset.id;
  try {
    if (b.dataset.act === "role") {
      const role = b.dataset.role === "admin" ? "user" : "admin";
      if (!(await confirmDialog({ title: role === "admin" ? "Make this user an administrator?" : "Remove administrator access?", message: role === "admin" ? "Administrators can manage every user and run maintenance jobs." : "They will lose access to the admin panel. Their sessions are signed out.", confirmLabel: role === "admin" ? "Make admin" : "Make user" }))) return;
      await api.patch(`/api/admin/users/${id}`, { role });
      toast("Role updated.", "success");
    } else if (b.dataset.act === "active") {
      const isActive = b.dataset.active !== "true";
      if (!isActive && !(await confirmDialog({ title: "Disable this user?", message: "They are signed out immediately and cannot sign in until re-enabled. Their scheduled posts still run.", confirmLabel: "Disable user", danger: true }))) return;
      await api.patch(`/api/admin/users/${id}`, { isActive });
      toast(isActive ? "User enabled." : "User disabled.", "success");
    } else if (b.dataset.act === "delete") {
      if (!(await confirmDialog({ title: "Delete this user?", message: `${b.dataset.email} and all of their posts, schedules and connected accounts will be permanently deleted.`, confirmLabel: "Delete user", danger: true }))) return;
      await api.del(`/api/admin/users/${id}`);
      toast("User deleted.", "success");
    }
    loadUsers();
  } catch (err) {
    toastError(err);
  }
}

async function addUser() {
  const body = document.createElement("div");
  body.innerHTML = `<div class="field"><label class="label" for="nu-name">Full name</label><input class="input" id="nu-name" maxlength="100" /></div>
    <div class="field"><label class="label" for="nu-email">Email</label><input class="input" type="email" id="nu-email" /></div>
    <div class="field"><label class="label" for="nu-pass">Temporary password</label><input class="input" type="text" id="nu-pass" autocomplete="off" /><span class="hint">At least 8 characters. Share it securely.</span></div>
    <div class="field"><label class="label" for="nu-role">Role</label><select class="select" id="nu-role"><option value="user">User</option><option value="admin">Admin</option></select></div>
    <div id="nu-error"></div>`;
  await openDialog({
    title: "Add user",
    body,
    actions: [
      { label: "Cancel", variant: "btn-secondary" },
      {
        label: "Create user",
        variant: "btn-primary",
        icon: "plus",
        handler: async (dlg, btn) => {
          try {
            await busy(btn, "Creating...", () =>
              api.post("/api/admin/users", {
                name: dlg.querySelector("#nu-name").value.trim(),
                email: dlg.querySelector("#nu-email").value.trim(),
                password: dlg.querySelector("#nu-pass").value,
                role: dlg.querySelector("#nu-role").value,
              })
            );
            toast("User created.", "success");
            loadUsers();
          } catch (err) {
            dlg.querySelector("#nu-error").innerHTML = errorAlert(err);
            return false;
          }
        },
      },
    ],
  });
}

function showTab(name) {
  $$("[role=tab][data-tab]").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === name)));
  $$("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== name));
  if (name === "users") loadUsers();
  if (name === "activity") loadActivity();
  if (name === "overview") loadOverview().catch(toastError);
}

async function init() {
  me = await mountLayout({ page: "admin", title: "Admin panel", adminOnly: true });
  hydrateIcons();
  $$("[role=tab][data-tab]").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));
  $("#users").addEventListener("click", onUserAction);
  $("#user-q").addEventListener(
    "input",
    debounce(() => {
      userPage = 1;
      loadUsers();
    }, 350)
  );
  $("#user-role").addEventListener("change", () => {
    userPage = 1;
    loadUsers();
  });
  $("#add-user").addEventListener("click", addUser);
  $("#run-scheduler").addEventListener("click", (e) =>
    busy(e.currentTarget, "Running...", async () => {
      try {
        const { summary } = await api.post("/api/admin/maintenance/scheduler");
        toast(summary.skipped ? summary.reason : `Scheduler ran: ${summary.published} published, ${summary.failed} failed, ${summary.recovered} recovered.`, "success");
        loadOverview();
      } catch (err) {
        toastError(err);
      }
    })
  );
  $("#media-cleanup").addEventListener("click", (e) =>
    busy(e.currentTarget, "Cleaning...", async () => {
      try {
        const { removed } = await api.post("/api/admin/maintenance/media-cleanup");
        toast(`Removed ${removed} unused file(s).`, "success");
      } catch (err) {
        toastError(err);
      }
    })
  );
  showTab("overview");
}

init();
