// ── Navigation Router for Multi-Page Application ────────────────────────────
function goTo(pageId) {
  let targetFile = pageId === "dashboard" ? "index.html" : pageId + ".html";
  const currentPath = window.location.pathname;
  const alreadyHere =
    currentPath.endsWith("/" + targetFile) ||
    currentPath.endsWith(targetFile) ||
    (pageId === "dashboard" && (currentPath.endsWith("/") || currentPath === "/" || currentPath.endsWith("/index.html")));

  if (alreadyHere) return; // avoid full page refresh when already on the page
  window.location.href = targetFile;
}

function updateActiveSidebar() {
  const currentPath = window.location.pathname;
  let pageId = "dashboard";
  
  if (currentPath.includes("scheduled-posts.html")) pageId = "scheduled-posts";
  else if (currentPath.includes("facebook.html")) pageId = "facebook";
  else if (currentPath.includes("instagram.html")) pageId = "instagram";
  else if (currentPath.includes("youtube.html")) pageId = "youtube";
  else if (currentPath.includes("tiktok.html")) pageId = "tiktok";
  else if (currentPath.includes("pinterest.html")) pageId = "pinterest";
  else if (currentPath.includes("ai-settings.html")) pageId = "ai-settings";
  else if (currentPath.includes("account-settings.html")) pageId = "account-settings";
  else if (currentPath.includes("help.html")) pageId = "help";
  else if (currentPath.includes("privacy-policy.html")) pageId = "privacy-policy";
  else if (currentPath.includes("terms-of-service.html")) pageId = "terms-of-service";
  else if (currentPath.includes("index.html") || currentPath.endsWith("/")) pageId = "dashboard";

  document.querySelectorAll(".nav-item").forEach(item => {
    item.classList.remove("active");
    item.classList.remove("ig-active");
    item.classList.remove("yt-active");
    item.classList.remove("tk-active");
    item.classList.remove("pin-active");
    
    if (item.dataset.page === pageId) {
      if (pageId === "instagram") item.classList.add("ig-active");
      else if (pageId === "youtube") item.classList.add("yt-active");
      else if (pageId === "tiktok") item.classList.add("tk-active");
      else if (pageId === "pinterest") item.classList.add("pin-active");
      else item.classList.add("active");
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".nav-item[data-page]").forEach(item => {
    item.addEventListener("click", () => goTo(item.dataset.page));
  });
  updateActiveSidebar();
});
