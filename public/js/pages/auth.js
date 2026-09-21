// Sign-in and registration pages.
import { api } from "../core/api.js";
import { icon } from "../core/icons.js";
import { $, params, busy, errorAlert, alertHtml, bindReveal } from "../core/ui.js";

const mode = document.body.dataset.auth;

// Only same-site paths are allowed as a post-login destination.
function nextUrl() {
  const next = params().get("next") || "/";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

// Length is the only rule; the rest is the user's choice.
function validPassword(v) {
  return String(v || "").length >= 8;
}

async function init() {
  document.querySelectorAll("[data-reveal]").forEach((b) => (b.innerHTML = icon("eye")));
  bindReveal();
  $("#auth-points").innerHTML = [
    ["checkCircle", "Publish to 5 platforms at once"],
    ["clock", "Schedule posts and retry failures"],
    ["sparkles", "AI captions, titles and hashtags"],
    ["chart", "Track results per platform"],
  ]
    .map(([i, t]) => `<li>${icon(i)}${t}</li>`)
    .join("");

  try {
    await api.get("/api/auth/me", { quiet401: true });
    location.replace(nextUrl());
    return;
  } catch {
    // Not signed in: show the form.
  }

  const error = params().get("error");
  if (error) $("#notice").innerHTML = alertHtml("warning", error);

  try {
    const cfg = await api.get("/api/auth/config");
    if (mode === "login") {
      $("#alt-link").hidden = !cfg.allowRegistration;
      if (cfg.needsSetup) {
        $("#notice").innerHTML =
          alertHtml("info", "No accounts exist yet", "Create the first account. It becomes the administrator.");
      }
    } else if (cfg.needsSetup) {
      $("#heading").textContent = "Create the administrator account";
      $("#lead").textContent = "This first account can manage users and system settings.";
    } else if (!cfg.allowRegistration) {
      $("#notice").innerHTML = alertHtml("warning", "Registration is closed", "Ask an administrator to create an account for you.");
      $("#auth-form").hidden = true;
    }
  } catch {
    // The form still works without the config call.
  }

  $("#auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const errorBox = $("#form-error");
    errorBox.innerHTML = "";
    const data = Object.fromEntries(new FormData(form));
    const problems = [];
    if (!/^\S+@\S+\.\S+$/.test(data.email || "")) problems.push("Enter a valid email address.");
    if (mode === "register") {
      if (!String(data.name || "").trim()) problems.push("Enter your name.");
      if (!validPassword(data.password)) problems.push("Password must be at least 8 characters.");
      if (data.password !== data.confirm) problems.push("Passwords do not match.");
    } else if (!data.password) problems.push("Enter your password.");
    if (problems.length) {
      errorBox.innerHTML = alertHtml("error", problems.length === 1 ? problems[0] : "Please fix the following:", "", problems.length > 1 ? problems : []);
      return;
    }

    await busy($("#submit-btn"), mode === "login" ? "Signing in..." : "Creating account...", async () => {
      try {
        if (mode === "login") await api.post("/api/auth/login", { email: data.email, password: data.password });
        else await api.post("/api/auth/register", { name: data.name.trim(), email: data.email, password: data.password });
        location.replace(mode === "login" ? nextUrl() : "/accounts.html?welcome=1");
      } catch (err) {
        errorBox.innerHTML = errorAlert(err);
      }
    });
  });
}

init();
