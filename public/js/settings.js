// ── Facebook Connection Settings ──────────────────────────────────────────────
async function loadSettingsStatus() {
  try {
    const cfg = await fetch("/api/settings").then(r => r.json());
    const badge = document.getElementById("conn-status-badge");
    const dot   = document.getElementById("conn-dot");
    const text  = document.getElementById("conn-status-text");
    
    if (badge && dot && text) {
      if (cfg.connected) {
        badge.className = "status-badge ok";
        dot.className   = "dot green";
        text.textContent = "Credentials saved";
      } else {
        badge.className = "status-badge bad";
        dot.className   = "dot red";
        text.textContent = "Not configured";
      }
    }
    
    const pageIdInput = document.getElementById("s-page-id");
    if (pageIdInput && cfg.pageId) {
      pageIdInput.value = cfg.pageId;
    }
  } catch(e) {}
}

async function testConnection() {
  const btn     = document.getElementById("test-btn");
  const spinner = document.getElementById("test-spinner");
  const btnTxt  = document.getElementById("test-btn-text");
  
  if (btn && spinner && btnTxt) {
    btn.disabled  = true;
    spinner.style.display = "inline-block";
    btnTxt.textContent    = "Testing…";
  }
  
  const successEl = document.getElementById("test-success");
  const errorEl = document.getElementById("test-error");
  if (successEl) successEl.style.display = "none";
  if (errorEl) errorEl.style.display = "none";

  try {
    const res  = await fetch("/api/test-connection", { method: "POST" });
    const data = await res.json();
    if (data.success) {
      if (successEl) {
        successEl.textContent = `✅ Connected! Page: "${data.pageName}" (ID: ${data.pageId})` + (data.followers !== null ? ` · ${data.followers.toLocaleString()} followers` : "");
        successEl.style.display = "block";
      }
      
      const badge = document.getElementById("conn-status-badge");
      const dot   = document.getElementById("conn-dot");
      const text  = document.getElementById("conn-status-text");
      if (badge && dot && text) {
        badge.className = "status-badge ok";
        dot.className   = "dot green";
        text.textContent = "Connected ✓";
      }
    } else {
      if (errorEl) {
        errorEl.textContent = "❌ " + data.message;
        errorEl.style.display = "block";
      }
    }
  } catch {
    if (errorEl) {
      errorEl.textContent = "❌ Could not reach the server.";
      errorEl.style.display = "block";
    }
  } finally {
    if (btn && spinner && btnTxt) {
      btn.disabled = false;
      spinner.style.display = "none";
      btnTxt.textContent    = "Test Connection";
    }
  }
}

// ── Instagram Connection Settings ─────────────────────────────────────────────
async function igLoadSettingsStatus() {
  try {
    const cfg = await fetch("/api/ig/settings").then(r => r.json());
    const badge = document.getElementById("ig-conn-status-badge");
    const dot   = document.getElementById("ig-conn-dot");
    const text  = document.getElementById("ig-conn-status-text");
    
    if (badge && dot && text) {
      if (cfg.connected) {
        badge.className = "status-badge ig-ok";
        dot.className   = "dot green";
        text.textContent = "Credentials saved";
      } else {
        badge.className = "status-badge bad";
        dot.className   = "dot red";
        text.textContent = "Not configured";
      }
    }
    
    const igAccInput = document.getElementById("ig-account-id");
    if (igAccInput && cfg.igAccountId) {
      igAccInput.value = cfg.igAccountId;
    }
  } catch(e) {}
}

async function igTestConnection() {
  const btn     = document.getElementById("ig-test-btn");
  const spinner = document.getElementById("ig-test-spinner");
  const btnTxt  = document.getElementById("ig-test-btn-text");
  
  if (btn && spinner && btnTxt) {
    btn.disabled  = true;
    spinner.style.display = "inline-block";
    btnTxt.textContent    = "Testing…";
  }
  
  const successEl = document.getElementById("ig-test-success");
  const errorEl = document.getElementById("ig-test-error");
  if (successEl) successEl.style.display = "none";
  if (errorEl) errorEl.style.display = "none";

  try {
    const res  = await fetch("/api/ig/test-connection", { method: "POST" });
    const data = await res.json();
    if (data.success) {
      if (successEl) {
        successEl.textContent = `✅ Connected! @${data.username || data.accountName} (ID: ${data.accountId})` +
          (data.followers !== null ? ` · ${data.followers.toLocaleString()} followers` : "") +
          (data.mediaCount !== null ? ` · ${data.mediaCount} posts` : "");
        successEl.style.display = "block";
      }
      
      const badge = document.getElementById("ig-conn-status-badge");
      const dot   = document.getElementById("ig-conn-dot");
      const text  = document.getElementById("ig-conn-status-text");
      if (badge && dot && text) {
        badge.className = "status-badge ig-ok";
        dot.className   = "dot green";
        text.textContent = "Connected ✓";
      }
    } else {
      if (errorEl) {
        errorEl.textContent = "❌ " + data.message;
        errorEl.style.display = "block";
      }
    }
  } catch {
    if (errorEl) {
      errorEl.textContent = "❌ Could not reach the server.";
      errorEl.style.display = "block";
    }
  } finally {
    if (btn && spinner && btnTxt) {
      btn.disabled = false;
      spinner.style.display = "none";
      btnTxt.textContent    = "Test Connection";
    }
  }
}

// ── YouTube Connection Settings ──────────────────────────────────────────────
async function ytLoadSettingsStatus() {
  try {
    const cfg = await fetch("/api/yt/settings").then(r => r.json());
    const badge = document.getElementById("yt-conn-status-badge");
    const dot   = document.getElementById("yt-conn-dot");
    const text  = document.getElementById("yt-conn-status-text");
    
    if (badge && dot && text) {
      if (cfg.connected) {
        badge.className = "status-badge yt-ok";
        dot.className   = "dot green";
        text.textContent = "Connected";
      } else {
        badge.className = "status-badge bad";
        dot.className   = "dot red";
        text.textContent = "Not configured";
      }
    }
    
    const ytChannelInput = document.getElementById("yt-channel-id-input");
    if (ytChannelInput && cfg.ytChannelId) {
      ytChannelInput.value = cfg.ytChannelId;
    }
  } catch(e) {}
}

async function ytTestConnection() {
  const btn     = document.getElementById("yt-test-btn");
  const spinner = document.getElementById("yt-test-spinner");
  const btnTxt  = document.getElementById("yt-test-btn-text");
  
  if (btn && spinner && btnTxt) {
    btn.disabled  = true;
    spinner.style.display = "inline-block";
    btnTxt.textContent    = "Testing…";
  }
  
  const successEl = document.getElementById("yt-save-success");
  const errorEl = document.getElementById("yt-save-error");
  if (successEl) successEl.style.display = "none";
  if (errorEl) errorEl.style.display = "none";

  try {
    const res  = await fetch("/api/yt/test-connection", { method: "POST" });
    const data = await res.json();
    if (data.success) {
      if (successEl) {
        successEl.textContent = `✅ Connected to "${data.channelName}" (${parseInt(data.subscribers).toLocaleString()} subs)`;
        successEl.style.display = "block";
      }
      ytLoadSettingsStatus();
    } else {
      if (errorEl) {
        errorEl.textContent = "❌ " + data.message;
        errorEl.style.display = "block";
      }
    }
  } catch {
  } finally {
    if (btn && spinner && btnTxt) {
      btn.disabled = false;
      spinner.style.display = "none";
      btnTxt.textContent    = "Test Connection";
    }
  }
}

// ── TikTok Connection Settings ───────────────────────────────────────────────
async function tkLoadSettingsStatus() {
  try {
    const cfg = await fetch("/api/tiktok/settings").then(r => r.json());
    const badge = document.getElementById("tk-conn-status-badge");
    const dot   = document.getElementById("tk-conn-dot");
    const text  = document.getElementById("tk-conn-status-text");
    if (badge && dot && text) {
      if (cfg.connected) {
        badge.className = "status-badge ok";
        dot.className   = "dot green";
        text.textContent = "Credentials saved";
      } else {
        badge.className = "status-badge bad";
        dot.className   = "dot red";
        text.textContent = "Not configured";
      }
    }
    const keyInput = document.getElementById("tk-client-key");
    if (keyInput && cfg.tkClientKey) keyInput.value = cfg.tkClientKey;
  } catch(e) {}
}

async function tkTestConnection() {
  const btn     = document.getElementById("tk-test-btn");
  const spinner = document.getElementById("tk-test-spinner");
  const btnTxt  = document.getElementById("tk-test-btn-text");
  if (btn && spinner && btnTxt) {
    btn.disabled = true;
    spinner.style.display = "inline-block";
    btnTxt.textContent = "Testing…";
  }
  const successEl = document.getElementById("tk-test-success");
  const errorEl   = document.getElementById("tk-test-error");
  if (successEl) successEl.style.display = "none";
  if (errorEl) errorEl.style.display = "none";
  try {
    const res  = await fetch("/api/tiktok/test-connection", { method: "POST" });
    const data = await res.json();
    if (data.success) {
      if (successEl) {
        successEl.textContent = `✅ Connected! @${data.displayName}`;
        successEl.style.display = "block";
      }
      const badge = document.getElementById("tk-conn-status-badge");
      const dot   = document.getElementById("tk-conn-dot");
      const text  = document.getElementById("tk-conn-status-text");
      if (badge && dot && text) {
        badge.className = "status-badge ok";
        dot.className   = "dot green";
        text.textContent = "Connected ✓";
      }
    } else {
      if (errorEl) { errorEl.textContent = "❌ " + data.message; errorEl.style.display = "block"; }
    }
  } catch {
    if (errorEl) { errorEl.textContent = "❌ Could not reach the server."; errorEl.style.display = "block"; }
  } finally {
    if (btn && spinner && btnTxt) {
      btn.disabled = false;
      spinner.style.display = "none";
      btnTxt.textContent = "Test Connection";
    }
  }
}

// ── Pinterest Connection Settings ────────────────────────────────────────────
async function pinLoadSettingsStatus() {
  try {
    const cfg = await fetch("/api/pinterest/settings").then(r => r.json());
    const badge = document.getElementById("pin-conn-status-badge");
    const dot   = document.getElementById("pin-conn-dot");
    const text  = document.getElementById("pin-conn-status-text");
    if (badge && dot && text) {
      if (cfg.connected) {
        badge.className = "status-badge ok";
        dot.className   = "dot green";
        text.textContent = "Credentials saved";
      } else {
        badge.className = "status-badge bad";
        dot.className   = "dot red";
        text.textContent = "Not configured";
      }
    }
    const appInput = document.getElementById("pin-app-id");
    if (appInput && cfg.pinAppId) appInput.value = cfg.pinAppId;
    const boardInput = document.getElementById("pin-board-id");
    if (boardInput && cfg.pinBoardId) boardInput.value = cfg.pinBoardId;
  } catch(e) {}
}

async function pinTestConnection() {
  const btn     = document.getElementById("pin-test-btn");
  const spinner = document.getElementById("pin-test-spinner");
  const btnTxt  = document.getElementById("pin-test-btn-text");
  if (btn && spinner && btnTxt) {
    btn.disabled = true;
    spinner.style.display = "inline-block";
    btnTxt.textContent = "Testing…";
  }
  const successEl = document.getElementById("pin-test-success");
  const errorEl   = document.getElementById("pin-test-error");
  if (successEl) successEl.style.display = "none";
  if (errorEl) errorEl.style.display = "none";
  try {
    const res  = await fetch("/api/pinterest/test-connection", { method: "POST" });
    const data = await res.json();
    if (data.success) {
      if (successEl) {
        successEl.textContent = `✅ Connected! @${data.username} · Board ID: ${data.boardId}`;
        successEl.style.display = "block";
      }
      const badge = document.getElementById("pin-conn-status-badge");
      const dot   = document.getElementById("pin-conn-dot");
      const text  = document.getElementById("pin-conn-status-text");
      if (badge && dot && text) {
        badge.className = "status-badge ok";
        dot.className   = "dot green";
        text.textContent = "Connected ✓";
      }
    } else {
      if (errorEl) { errorEl.textContent = "❌ " + data.message; errorEl.style.display = "block"; }
    }
  } catch {
    if (errorEl) { errorEl.textContent = "❌ Could not reach the server."; errorEl.style.display = "block"; }
  } finally {
    if (btn && spinner && btnTxt) {
      btn.disabled = false;
      spinner.style.display = "none";
      btnTxt.textContent = "Test Connection";
    }
  }
}

// ── AI Settings ──────────────────────────────────────────────────────────────
async function aiLoadSettingsStatus() {
  try {
    const cfg = await fetch("/api/ai/settings").then(r => r.json());
    const badge = document.getElementById("ai-conn-status-badge");
    const dot   = document.getElementById("ai-conn-dot");
    const text  = document.getElementById("ai-conn-status-text");
    
    if (badge && dot && text) {
      if (cfg.connected) {
        badge.className = "status-badge ok";
        dot.className   = "dot green";
        text.textContent = "Connected (" + cfg.openaiModel + ")";
      } else {
        badge.className = "status-badge bad";
        dot.className   = "dot red";
        text.textContent = "Not configured";
      }
    }
    
    const modelSelect = document.getElementById("ai-model-select");
    if (modelSelect && cfg.openaiModel) {
      modelSelect.value = cfg.openaiModel;
    }
  } catch(e) {}
}

async function aiTestConnection() {
  const btn     = document.getElementById("ai-test-btn");
  const spinner = document.getElementById("ai-test-spinner");
  const btnTxt  = document.getElementById("ai-test-btn-text");
  
  if (btn && spinner && btnTxt) {
    btn.disabled  = true;
    spinner.style.display = "inline-block";
    btnTxt.textContent    = "Testing…";
  }
  
  const successEl = document.getElementById("ai-test-success");
  const errorEl = document.getElementById("ai-test-error");
  if (successEl) successEl.style.display = "none";
  if (errorEl) errorEl.style.display = "none";

  try {
    const res  = await fetch("/api/ai/test-connection", { method: "POST" });
    const data = await res.json();
    if (data.success) {
      if (successEl) {
        successEl.textContent = `✅ Connected successfully! Model used: ${data.modelUsed}. Verified access to OpenAI API.`;
        successEl.style.display = "block";
      }
      const badge = document.getElementById("ai-conn-status-badge");
      const dot   = document.getElementById("ai-conn-dot");
      const text  = document.getElementById("ai-conn-status-text");
      if (badge && dot && text) {
        badge.className = "status-badge ok";
        dot.className   = "dot green";
        text.textContent = "Connected ✓";
      }
    } else {
      if (errorEl) {
        errorEl.textContent = "❌ " + data.message;
        errorEl.style.display = "block";
      }
    }
  } catch {
    if (errorEl) {
      errorEl.textContent = "❌ Could not reach the server.";
      errorEl.style.display = "block";
    }
  } finally {
    if (btn && spinner && btnTxt) {
      btn.disabled = false;
      spinner.style.display = "none";
      btnTxt.textContent    = "Test API Connection";
    }
  }
}

// ── Account Settings ─────────────────────────────────────────────────────────
async function loadAccountSettings() {
  try {
    const res = await fetch("/api/account/settings");
    const data = await res.json();
    if (data.success && data.username) {
      const usernameInput = document.getElementById("acc-username");
      if (usernameInput) usernameInput.value = data.username;
    }
  } catch (err) {
    console.error("Error loading account settings:", err);
  }
}

function togglePassField(fieldId) {
  const input = document.getElementById(fieldId);
  if (input) {
    input.type = input.type === 'password' ? 'text' : 'password';
  }
}

// ── Form Submit Event Listeners ──────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("s-page-id")) loadSettingsStatus();
  if (document.getElementById("ig-account-id")) igLoadSettingsStatus();
  if (document.getElementById("yt-channel-id-input")) ytLoadSettingsStatus();
  if (document.getElementById("tk-client-key")) tkLoadSettingsStatus();
  if (document.getElementById("pin-app-id")) pinLoadSettingsStatus();
  if (document.getElementById("ai-model-select")) aiLoadSettingsStatus();
  if (document.getElementById("acc-username")) loadAccountSettings();

  // Facebook settings form
  document.getElementById("settings-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const pageId      = document.getElementById("s-page-id").value.trim();
    const accessToken = document.getElementById("s-access-token").value.trim();
    const saveBtn  = document.getElementById("save-btn");
    const spinner  = document.getElementById("save-spinner");
    const saveTxt  = document.getElementById("save-btn-text");
    const successEl = document.getElementById("save-success");
    const errorEl = document.getElementById("save-error");
    if (successEl) successEl.style.display = "none";
    if (errorEl) errorEl.style.display = "none";
    if (!pageId || !accessToken) {
      if (errorEl) { errorEl.textContent = "Both fields are required."; errorEl.style.display = "block"; }
      return;
    }
    if (saveBtn && spinner && saveTxt) { saveBtn.disabled = true; spinner.style.display = "inline-block"; saveTxt.textContent = "Saving…"; }
    try {
      const res  = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pageId, accessToken }) });
      const data = await res.json();
      if (data.success) {
        if (successEl) { successEl.textContent = "✅ " + data.message; successEl.style.display = "block"; }
        document.getElementById("s-access-token").value = "";
        loadSettingsStatus();
      } else { if (errorEl) { errorEl.textContent = "❌ " + data.message; errorEl.style.display = "block"; } }
    } catch { if (errorEl) { errorEl.textContent = "❌ Network error."; errorEl.style.display = "block"; } }
    finally { if (saveBtn && spinner && saveTxt) { saveBtn.disabled = false; spinner.style.display = "none"; saveTxt.textContent = "Save Credentials"; } }
  });

  document.getElementById("eye-btn")?.addEventListener("click", () => {
    const input = document.getElementById("s-access-token");
    if (input) input.type = input.type === "password" ? "text" : "password";
  });

  // Instagram settings form
  document.getElementById("ig-settings-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const igAccountId   = document.getElementById("ig-account-id").value.trim();
    const igAccessToken = document.getElementById("ig-access-token").value.trim();
    const saveBtn  = document.getElementById("ig-save-btn");
    const spinner  = document.getElementById("ig-save-spinner");
    const saveTxt  = document.getElementById("ig-save-btn-text");
    const successEl = document.getElementById("ig-save-success");
    const errorEl = document.getElementById("ig-save-error");
    if (successEl) successEl.style.display = "none";
    if (errorEl) errorEl.style.display = "none";
    if (!igAccountId || !igAccessToken) {
      if (errorEl) { errorEl.textContent = "Both fields are required."; errorEl.style.display = "block"; }
      return;
    }
    if (saveBtn && spinner && saveTxt) { saveBtn.disabled = true; spinner.style.display = "inline-block"; saveTxt.textContent = "Saving…"; }
    try {
      const res  = await fetch("/api/ig/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ igAccountId, igAccessToken }) });
      const data = await res.json();
      if (data.success) {
        if (successEl) { successEl.textContent = "✅ " + data.message; successEl.style.display = "block"; }
        document.getElementById("ig-access-token").value = "";
        igLoadSettingsStatus();
      } else { if (errorEl) { errorEl.textContent = "❌ " + data.message; errorEl.style.display = "block"; } }
    } catch { if (errorEl) { errorEl.textContent = "❌ Network error."; errorEl.style.display = "block"; } }
    finally { if (saveBtn && spinner && saveTxt) { saveBtn.disabled = false; spinner.style.display = "none"; saveTxt.textContent = "Save Credentials"; } }
  });

  document.getElementById("ig-eye-btn")?.addEventListener("click", () => {
    const input = document.getElementById("ig-access-token");
    if (input) input.type = input.type === "password" ? "text" : "password";
  });

  // YouTube settings form
  document.getElementById("yt-settings-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const ytChannelId   = document.getElementById("yt-channel-id-input").value.trim();
    const ytAccessToken = document.getElementById("yt-access-token").value.trim();
    try {
      const res = await fetch("/api/yt/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ytChannelId, ytAccessToken }) });
      const data = await res.json();
      if (data.success) {
        document.getElementById("yt-save-success").textContent = "✅ Settings saved.";
        document.getElementById("yt-save-success").style.display = "block";
        document.getElementById("yt-access-token").value = "";
        ytLoadSettingsStatus();
      }
    } catch (err) {}
  });

  document.getElementById("yt-eye-btn-settings")?.addEventListener("click", () => {
    const input = document.getElementById("yt-access-token");
    if (input) input.type = input.type === "password" ? "text" : "password";
  });

  // AI settings form
  document.getElementById("ai-settings-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const openaiApiKey = document.getElementById("ai-api-key").value.trim();
    const openaiModel  = document.getElementById("ai-model-select").value.trim();
    const saveBtn  = document.getElementById("ai-save-btn");
    const spinner  = document.getElementById("ai-save-spinner");
    const saveTxt  = document.getElementById("ai-save-btn-text");
    const successEl = document.getElementById("ai-save-success");
    const errorEl = document.getElementById("ai-save-error");
    if (successEl) successEl.style.display = "none";
    if (errorEl) errorEl.style.display = "none";
    if (!openaiApiKey) { if (errorEl) { errorEl.textContent = "API Key is required."; errorEl.style.display = "block"; } return; }
    if (saveBtn && spinner && saveTxt) { saveBtn.disabled = true; spinner.style.display = "inline-block"; saveTxt.textContent = "Saving…"; }
    try {
      const res  = await fetch("/api/ai/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ openaiApiKey, openaiModel }) });
      const data = await res.json();
      if (data.success) {
        if (successEl) { successEl.textContent = "✅ " + data.message; successEl.style.display = "block"; }
        document.getElementById("ai-api-key").value = "";
        aiLoadSettingsStatus();
      } else { if (errorEl) { errorEl.textContent = "❌ " + data.message; errorEl.style.display = "block"; } }
    } catch { if (errorEl) { errorEl.textContent = "❌ Network error."; errorEl.style.display = "block"; } }
    finally { if (saveBtn && spinner && saveTxt) { saveBtn.disabled = false; spinner.style.display = "none"; saveTxt.textContent = "Save Configuration"; } }
  });

  document.getElementById("ai-eye-btn")?.addEventListener("click", () => {
    const input = document.getElementById("ai-api-key");
    if (input) input.type = input.type === "password" ? "text" : "password";
  });

  // TikTok settings form
  document.getElementById("tk-settings-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const tkClientKey   = document.getElementById("tk-client-key").value.trim();
    const tkAccessToken = document.getElementById("tk-access-token").value.trim();
    const saveBtn = document.getElementById("tk-save-btn");
    const spinner = document.getElementById("tk-save-spinner");
    const saveTxt = document.getElementById("tk-save-btn-text");
    const successEl = document.getElementById("tk-save-success");
    const errorEl   = document.getElementById("tk-save-error");
    if (successEl) successEl.style.display = "none";
    if (errorEl) errorEl.style.display = "none";
    if (!tkClientKey || !tkAccessToken) { if (errorEl) { errorEl.textContent = "Both fields are required."; errorEl.style.display = "block"; } return; }
    if (saveBtn && spinner && saveTxt) { saveBtn.disabled = true; spinner.style.display = "inline-block"; saveTxt.textContent = "Saving…"; }
    try {
      const res = await fetch("/api/tiktok/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tkClientKey, tkAccessToken }) });
      const data = await res.json();
      if (data.success) {
        if (successEl) { successEl.textContent = "✅ " + data.message; successEl.style.display = "block"; }
        document.getElementById("tk-access-token").value = "";
        tkLoadSettingsStatus();
      } else { if (errorEl) { errorEl.textContent = "❌ " + data.message; errorEl.style.display = "block"; } }
    } catch { if (errorEl) { errorEl.textContent = "❌ Network error."; errorEl.style.display = "block"; } }
    finally { if (saveBtn && spinner && saveTxt) { saveBtn.disabled = false; spinner.style.display = "none"; saveTxt.textContent = "Save Credentials"; } }
  });

  // Pinterest settings form
  document.getElementById("pin-settings-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const pinAppId       = document.getElementById("pin-app-id").value.trim();
    const pinAccessToken = document.getElementById("pin-access-token").value.trim();
    const pinBoardId     = document.getElementById("pin-board-id").value.trim();
    const saveBtn = document.getElementById("pin-save-btn");
    const spinner = document.getElementById("pin-save-spinner");
    const saveTxt = document.getElementById("pin-save-btn-text");
    const successEl = document.getElementById("pin-save-success");
    const errorEl   = document.getElementById("pin-save-error");
    if (successEl) successEl.style.display = "none";
    if (errorEl) errorEl.style.display = "none";
    if (!pinAppId || !pinAccessToken) { if (errorEl) { errorEl.textContent = "App ID and Access Token are required."; errorEl.style.display = "block"; } return; }
    if (saveBtn && spinner && saveTxt) { saveBtn.disabled = true; spinner.style.display = "inline-block"; saveTxt.textContent = "Saving…"; }
    try {
      const res = await fetch("/api/pinterest/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pinAppId, pinAccessToken, pinBoardId }) });
      const data = await res.json();
      if (data.success) {
        if (successEl) { successEl.textContent = "✅ " + data.message; successEl.style.display = "block"; }
        document.getElementById("pin-access-token").value = "";
        pinLoadSettingsStatus();
      } else { if (errorEl) { errorEl.textContent = "❌ " + data.message; errorEl.style.display = "block"; } }
    } catch { if (errorEl) { errorEl.textContent = "❌ Network error."; errorEl.style.display = "block"; } }
    finally { if (saveBtn && spinner && saveTxt) { saveBtn.disabled = false; spinner.style.display = "none"; saveTxt.textContent = "Save Credentials"; } }
  });

  // Account settings form
  document.getElementById("account-settings-form")?.addEventListener("submit", async e => {
    e.preventDefault();
    const newUsername     = document.getElementById("acc-username").value.trim();
    const currentPassword = document.getElementById("acc-current-password").value.trim();
    const newPassword     = document.getElementById("acc-new-password").value.trim();
    const confirmPassword = document.getElementById("acc-confirm-password").value.trim();
    const saveBtn   = document.getElementById("acc-save-btn");
    const spinner   = document.getElementById("acc-save-spinner");
    const saveTxt   = document.getElementById("acc-save-btn-text");
    const successEl = document.getElementById("acc-save-success");
    const errorEl   = document.getElementById("acc-save-error");
    if (successEl) successEl.style.display = "none";
    if (errorEl)   errorEl.style.display = "none";
    if (!currentPassword) { if (errorEl) { errorEl.textContent = "❌ Current password is required to save changes."; errorEl.style.display = "block"; } return; }
    if (newPassword && newPassword !== confirmPassword) { if (errorEl) { errorEl.textContent = "❌ New password and confirmation do not match."; errorEl.style.display = "block"; } return; }
    if (saveBtn && spinner && saveTxt) { saveBtn.disabled = true; spinner.style.display = "inline-block"; saveTxt.textContent = "Saving…"; }
    try {
      const res = await fetch("/api/account/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, newUsername, newPassword }) });
      const data = await res.json();
      if (data.success) {
        if (successEl) { successEl.textContent = "✅ " + data.message; successEl.style.display = "block"; }
        document.getElementById("acc-current-password").value = "";
        document.getElementById("acc-new-password").value = "";
        document.getElementById("acc-confirm-password").value = "";
        if (data.username) document.getElementById("acc-username").value = data.username;
      } else { if (errorEl) { errorEl.textContent = "❌ " + (data.message || "Failed to update account settings."); errorEl.style.display = "block"; } }
    } catch { if (errorEl) { errorEl.textContent = "❌ Network error. Please try again."; errorEl.style.display = "block"; } }
    finally { if (saveBtn && spinner && saveTxt) { saveBtn.disabled = false; spinner.style.display = "none"; saveTxt.textContent = "Save Account Changes"; } }
  });
});
