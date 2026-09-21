import { api } from "../core/api.js";
import { mountLayout } from "../core/layout.js";
import { hydrateIcons } from "../core/page.js";
import { icon } from "../core/icons.js";
import { $, esc, fmt, busy, toast, toastError, alertHtml, errorAlert, openDialog, bindReveal } from "../core/ui.js";

function validPassword(v) {
  return String(v || "").length >= 8;
}

function renderSummary(user) {
  $("#avatar").textContent = user.name.split(/\s+/).map((s) => s[0]).join("").slice(0, 2).toUpperCase();
  $("#summary-name").textContent = user.name;
  $("#summary-meta").textContent = `${user.role === "admin" ? "Administrator" : "User"} · member since ${fmt.date(user.createdAt)}`;
}

async function init() {
  await mountLayout({ page: "profile", title: "Profile and security" });
  hydrateIcons();
  document.querySelectorAll("[data-reveal]").forEach((b) => (b.innerHTML = icon("eye")));
  bindReveal();

  const { user, settings } = await api.get("/api/profile");
  renderSummary(user);
  $("#name").value = user.name;
  $("#email").value = user.email;
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [Intl.DateTimeFormat().resolvedOptions().timeZone];
  const current = user.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  $("#timezone").innerHTML = zones.map((z) => `<option value="${esc(z)}" ${z === current ? "selected" : ""}>${esc(z.replace(/_/g, " "))}</option>`).join("");
  $("#notify-success").checked = settings.notifyOnSuccess;
  $("#notify-failure").checked = settings.notifyOnFailure;

  $("#profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#profile-msg").innerHTML = "";
    await busy($("#profile-save"), "Saving...", async () => {
      try {
        const res = await api.put("/api/profile", { name: $("#name").value.trim(), email: $("#email").value.trim(), timezone: $("#timezone").value });
        renderSummary(res.user);
        toast("Profile saved.", "success");
      } catch (err) {
        $("#profile-msg").innerHTML = `<div class="mb-12">${errorAlert(err)}</div>`;
      }
    });
  });

  $("#password-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#password-msg");
    msg.innerHTML = "";
    const next = $("#new").value;
    if (!validPassword(next)) return (msg.innerHTML = `<div class="mb-12">${alertHtml("error", "Password too short", "Use at least 8 characters.")}</div>`);
    if (next !== $("#confirm").value) return (msg.innerHTML = `<div class="mb-12">${alertHtml("error", "The new passwords do not match.")}</div>`);
    await busy($("#password-save"), "Changing...", async () => {
      try {
        const res = await api.post("/api/profile/password", { currentPassword: $("#current").value, newPassword: next });
        e.target.reset();
        msg.innerHTML = `<div class="mb-12">${alertHtml("success", "Password changed", res.message)}</div>`;
      } catch (err) {
        msg.innerHTML = `<div class="mb-12">${errorAlert(err)}</div>`;
      }
    });
  });

  $("#notify-save").addEventListener("click", (e) =>
    busy(e.currentTarget, "Saving...", async () => {
      try {
        await api.put("/api/profile/settings", { notifyOnSuccess: $("#notify-success").checked, notifyOnFailure: $("#notify-failure").checked });
        toast("Notification preferences saved.", "success");
      } catch (err) {
        toastError(err);
      }
    })
  );

  $("#logout-all").addEventListener("click", async () => {
    const ok = await openDialog({
      title: "Sign out of all devices?",
      body: "<p>You will need to sign in again on every device, including this one.</p>",
      actions: [
        { label: "Cancel", variant: "btn-secondary", value: false },
        { label: "Sign out everywhere", variant: "btn-primary", value: true, icon: "logout" },
      ],
    });
    if (!ok) return;
    try {
      await api.post("/api/auth/logout-all");
    } finally {
      location.href = "/login.html";
    }
  });

  $("#delete-account").addEventListener("click", async () => {
    const body = document.createElement("div");
    body.innerHTML = `<p class="mb-16">This permanently deletes your account and all of its data. Posts already live on social platforms stay there.</p>
      <div class="field"><label class="label" for="del-pass">Enter your password to confirm</label><input class="input" type="password" id="del-pass" autocomplete="current-password" /></div><div id="del-error"></div>`;
    await openDialog({
      title: "Delete your account?",
      body,
      actions: [
        { label: "Cancel", variant: "btn-secondary" },
        {
          label: "Delete account",
          variant: "btn-danger",
          icon: "trash",
          handler: async (dlg, btn) => {
            try {
              await busy(btn, "Deleting...", () => api.del("/api/profile", { password: dlg.querySelector("#del-pass").value }));
              location.href = "/login.html";
              return true;
            } catch (err) {
              dlg.querySelector("#del-error").innerHTML = errorAlert(err);
              return false;
            }
          },
        },
      ],
    });
  });
}

init();
