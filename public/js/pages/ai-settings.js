import { api } from "../core/api.js";
import { mountLayout } from "../core/layout.js";
import { hydrateIcons } from "../core/page.js";
import { icon } from "../core/icons.js";
import { $, esc, busy, toast, alertHtml, errorAlert, bindReveal } from "../core/ui.js";

let settings = null;
const PROVIDER_LABEL = { openai: "OpenAI", gemini: "Google Gemini", openrouter: "OpenRouter" };

async function renderStatus() {
  const s = await api.get("/api/ai/status");
  $("#status").innerHTML = s.available
    ? `${alertHtml("success", "AI is ready", `Using ${PROVIDER_LABEL[s.provider] || s.provider} (${s.model}) with ${s.source === "personal" ? "your own API key" : "the server's API key"}.`)}`
    : alertHtml("warning", "AI is not set up", "Add your own API key here, or ask the administrator to set OPENAI_API_KEY, GEMINI_API_KEY or OPENROUTER_API_KEY on the server.");
  $("#status").insertAdjacentHTML(
    "beforeend",
    `<dl class="kv mt-16"><dt>Server OpenAI key</dt><dd>${s.serverProviders.openai ? "Configured" : "Not configured"}</dd><dt>Server Gemini key</dt><dd>${s.serverProviders.gemini ? "Configured" : "Not configured"}</dd><dt>Server OpenRouter key</dt><dd>${s.serverProviders.openrouter ? "Configured" : "Not configured"}</dd><dt>Your key</dt><dd>${settings.hasPersonalApiKey ? esc(settings.apiKeyHint) : "Not set"}</dd></dl>`
  );
  $("#tone").innerHTML = s.tones.map((t) => `<option value="${t}">${t[0].toUpperCase()}${t.slice(1)}</option>`).join("");
  $("#tone").value = settings.defaultTone;
}

function fill() {
  $("#provider").value = settings.aiProvider || "";
  $("#model").value = settings.aiModel || "";
  $("#allow-emojis").checked = settings.allowEmojis;
  $("#clear-key-wrap").hidden = !settings.hasPersonalApiKey;
  $("#api-key").placeholder = settings.hasPersonalApiKey ? `Saved: ${settings.apiKeyHint} (enter a new key to replace it)` : "sk-... or AIza... or sk-or-...";
}

async function init() {
  await mountLayout({ page: "ai-settings", title: "AI settings" });
  hydrateIcons();
  document.querySelectorAll("[data-reveal]").forEach((b) => (b.innerHTML = icon("eye")));
  bindReveal();
  settings = (await api.get("/api/profile/settings")).settings;
  fill();
  await renderStatus();

  $("#ai-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#form-msg").innerHTML = "";
    const body = {
      aiProvider: $("#provider").value || null,
      aiModel: $("#model").value.trim() || null,
      defaultTone: $("#tone").value,
      allowEmojis: $("#allow-emojis").checked,
    };
    const key = $("#api-key").value.trim();
    if (key) body.apiKey = key;
    if ($("#clear-key").checked && !key) body.clearApiKey = true;
    await busy($("#save-btn"), "Saving...", async () => {
      try {
        settings = (await api.put("/api/profile/settings", body)).settings;
        $("#api-key").value = "";
        $("#clear-key").checked = false;
        fill();
        await renderStatus();
        toast("AI settings saved.", "success");
      } catch (err) {
        $("#form-msg").innerHTML = `<div class="mb-12">${errorAlert(err)}</div>`;
      }
    });
  });

  $("#test-btn").addEventListener("click", (e) =>
    busy(e.currentTarget, "Testing...", async () => {
      $("#form-msg").innerHTML = "";
      const key = $("#api-key").value.trim();
      const body = {};
      if (key) body.apiKey = key;
      if ($("#provider").value) body.provider = $("#provider").value;
      if ($("#model").value.trim()) body.model = $("#model").value.trim();
      try {
        const res = await api.post("/api/ai/test", body);
        $("#form-msg").innerHTML = `<div class="mb-12">${alertHtml("success", "Connection works", `${PROVIDER_LABEL[res.provider] || res.provider} accepted the key for model ${res.model}.`)}</div>`;
      } catch (err) {
        $("#form-msg").innerHTML = `<div class="mb-12">${errorAlert(err)}</div>`;
      }
    })
  );
}

init();
