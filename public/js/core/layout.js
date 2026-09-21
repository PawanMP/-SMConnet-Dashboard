// Builds the application shell (sidebar, top bar) around the page's <main id="page">
// and resolves the signed-in user. Pages call mountLayout() first.
import { api } from "./api.js";
import { icon } from "./icons.js";
import { esc, toast } from "./ui.js";

const NAV = [
  {
    label: "Workspace",
    items: [
      { href: "/", page: "dashboard", icon: "dashboard", label: "Dashboard" },
      { href: "/create.html", page: "create", icon: "create", label: "Create post" },
      { href: "/posts.html", page: "posts", icon: "posts", label: "Post history" },
      { href: "/drafts.html", page: "drafts", icon: "drafts", label: "Drafts" },
      { href: "/calendar.html", page: "calendar", icon: "calendar", label: "Calendar" },
      { href: "/analytics.html", page: "analytics", icon: "chart", label: "Analytics" },
    ],
  },
  { label: "Channels", items: [{ href: "/accounts.html", page: "accounts", icon: "link", label: "Connected accounts" }] },
  {
    label: "Account",
    items: [
      { href: "/notifications.html", page: "notifications", icon: "bell", label: "Notifications", badge: true },
      { href: "/activity.html", page: "activity", icon: "activity", label: "Activity log" },
      { href: "/ai-settings.html", page: "ai-settings", icon: "sparkles", label: "AI settings" },
      { href: "/profile.html", page: "profile", icon: "user", label: "Profile & security" },
    ],
  },
  { label: "Administration", admin: true, items: [{ href: "/admin.html", page: "admin", icon: "shield", label: "Admin panel" }] },
  {
    label: "Support",
    items: [
      { href: "/help.html", page: "help", icon: "help", label: "Help guide" },
      { href: "/privacy-policy.html", page: "privacy", icon: "lock", label: "Privacy policy" },
      { href: "/terms-of-service.html", page: "terms", icon: "file", label: "Terms of service" },
    ],
  },
];

const initials = (name) =>
  String(name || "?")
    .split(/\s+/)
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

function brand() {
  return `<a class="brand" href="/"><span class="brand-mark">S</span><span><div class="brand-name">Social Poster</div><div class="brand-sub">Multi-platform publishing</div></span></a>`;
}

function sidebar(user, page) {
  const groups = NAV.filter((g) => !g.admin || user.role === "admin")
    .map(
      (g) => `<div class="nav-group"><div class="nav-label">${g.label}</div>${g.items
        .map(
          (i) =>
            `<a class="nav-link" href="${i.href}"${i.page === page ? ' aria-current="page"' : ""}>${icon(i.icon)}<span>${i.label}</span>${
              i.badge ? '<span class="nav-count" data-unread hidden></span>' : ""
            }</a>`
        )
        .join("")}</div>`
    )
    .join("");
  return `<aside class="sidebar" id="sidebar" aria-label="Main navigation">
    ${brand()}
    <nav class="nav">${groups}</nav>
    <div class="sidebar-foot">
      <span class="avatar">${esc(initials(user.name))}</span>
      <div class="user-meta"><div class="user-name truncate">${esc(user.name)}</div><div class="user-email truncate">${esc(user.email)}</div></div>
      <button type="button" class="btn btn-ghost btn-icon btn-sm" id="logout-btn" title="Sign out" aria-label="Sign out">${icon("logout")}</button>
    </div>
  </aside><div class="scrim" id="scrim"></div>`;
}

async function refreshUnread() {
  try {
    const { count } = await api.get("/api/notifications/unread-count", { quiet401: true });
    document.querySelectorAll("[data-unread]").forEach((el) => {
      el.hidden = !count;
      el.textContent = count > 99 ? "99+" : String(count);
    });
    const bell = document.getElementById("bell-btn");
    if (bell) bell.setAttribute("aria-label", count ? `Notifications (${count} unread)` : "Notifications");
  } catch {
    // Badge refresh is best effort.
  }
}

export async function signOut() {
  try {
    await api.post("/api/auth/logout");
  } finally {
    location.href = "/login.html";
  }
}

// Options: page (nav id), title, publicPage (render without login), adminOnly.
export async function mountLayout({ page, title, publicPage = false, adminOnly = false }) {
  let user = null;
  try {
    user = (await api.get("/api/auth/me", { quiet401: true })).user;
  } catch {
    user = null;
  }
  if (!user && !publicPage) {
    location.href = `/login.html?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`;
    return new Promise(() => {});
  }
  if (adminOnly && user.role !== "admin") {
    location.href = "/";
    return new Promise(() => {});
  }

  const main = document.getElementById("page");
  const loading = document.getElementById("app-loading");

  if (!user) {
    const top = document.createElement("header");
    top.className = "public-top";
    top.innerHTML = `${brand()}<a class="btn btn-primary btn-sm" href="/login.html">Sign in</a>`;
    const wrap = document.createElement("div");
    wrap.className = "content";
    document.body.prepend(top);
    top.after(wrap);
    wrap.appendChild(main);
  } else {
    const shell = document.createElement("div");
    shell.className = "shell";
    shell.innerHTML = `${sidebar(user, page)}
      <div class="main-col">
        <header class="topbar">
          <button type="button" class="btn btn-ghost btn-icon menu-toggle" id="menu-btn" aria-label="Open navigation" aria-controls="sidebar" aria-expanded="false">${icon("menu")}</button>
          <div class="topbar-title">${esc(title)}</div>
          <div class="topbar-actions">
            ${page !== "create" ? `<a class="btn btn-primary btn-sm" href="/create.html">${icon("plus")}<span>Create post</span></a>` : ""}
            <a class="btn btn-secondary btn-icon btn-sm bell" id="bell-btn" href="/notifications.html" aria-label="Notifications">${icon("bell")}<span class="nav-count" data-unread hidden></span></a>
          </div>
        </header>
        <div class="content" id="content"></div>
      </div>`;
    document.body.prepend(shell);
    shell.querySelector("#content").appendChild(main);

    const menuBtn = shell.querySelector("#menu-btn");
    const setNav = (open) => {
      document.body.classList.toggle("nav-open", open);
      menuBtn.setAttribute("aria-expanded", String(open));
    };
    menuBtn.addEventListener("click", () => setNav(!document.body.classList.contains("nav-open")));
    shell.querySelector("#scrim").addEventListener("click", () => setNav(false));
    document.addEventListener("keydown", (e) => e.key === "Escape" && setNav(false));
    shell.querySelector("#logout-btn").addEventListener("click", signOut);

    refreshUnread();
    setInterval(refreshUnread, 60000);
  }

  document.title = `${title} - Social Poster`;
  // Media that can no longer be loaded (deleted file, offline host) shows a
  // neutral placeholder instead of a broken image.
  document.addEventListener(
    "error",
    (e) => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement) || img.dataset.fallback) return;
      img.dataset.fallback = "1";
      const ph = document.createElement("span");
      ph.className = "img-fallback";
      ph.setAttribute("role", "img");
      ph.setAttribute("aria-label", "Media preview unavailable");
      ph.innerHTML = icon("image");
      img.replaceWith(ph);
    },
    true
  );
  if (loading) loading.remove();
  main.hidden = false;
  window.addEventListener("unhandledrejection", (e) => {
    if (e.reason && e.reason.name === "ApiError") return;
    toast("Something unexpected went wrong. Please refresh the page.", "error");
  });
  return user;
}

export { refreshUnread };
