// Social account connections: status, connect via OAuth, reconnect, test,
// disconnect, choose Page/Board, and the advanced token option.
import { api } from "../core/api.js";
import { mountLayout } from "../core/layout.js";
import { hydrateIcons } from "../core/page.js";
import { icon, platformIcon, PLATFORM_LABEL } from "../core/icons.js";
import { $, esc, fmt, params, setParams, accountBadge, alertHtml, errorAlert, busy, toast, toastError, confirmDialog, bindReveal } from "../core/ui.js";

const INFO = {
  facebook: {
    about: "Publish text, photos and videos to a Facebook Page you manage.",
    token: "A Page access token or a user token with pages_manage_posts, created in the Meta Graph API Explorer.",
    idLabel: "Page ID (optional)",
  },
  instagram: {
    about: "Publish photos and Reels to an Instagram professional (Business or Creator) account.",
    token: "Either an Instagram Login token (starts with IG), or a Facebook Page/user token (starts with EAA) with instagram_basic and instagram_content_publish. With a Facebook token, also enter the Instagram business account ID (or leave it empty to use the account linked to your Page).",
    idLabel: "Instagram business account ID (Facebook tokens only)",
  },
  youtube: {
    about: "Upload videos to your YouTube channel. Tokens renew automatically.",
    token: "A Google OAuth access token with the youtube.upload scope. Add a refresh token so it keeps working after an hour.",
    refresh: true,
  },
  tiktok: {
    about: "Post videos to TikTok through the Content Posting API. Tokens renew automatically.",
    token: "A TikTok user access token with video.publish. Add the refresh token so it renews automatically.",
    refresh: true,
  },
  pinterest: {
    about: "Create Pins from images and videos on the board you choose.",
    token: "A Pinterest API v5 access token with boards:read, pins:write and user_accounts:read.",
    refresh: true,
  },
};

// Connection instructions shown by the Help button on each card. This content
// is authored here (never user input), so the links are safe to render.
const link = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
const GRAPH_EXPLORER = link("https://developers.facebook.com/tools/explorer/", "Meta Graph API Explorer");

const HELP = {
  facebook: [
    { title: "Requirements", body: "<p>You must be an admin of the Facebook Page you want to publish to.</p>" },
    {
      title: "Option 1: Connect Facebook (recommended)",
      body: `<ol><li>Choose <strong>Connect Facebook</strong> above and sign in.</li><li>Allow access to the Page you publish to.</li><li>Back here, pick the Page under <strong>Page to publish to</strong>.</li></ol>
        <p class="small muted">This way the access does not expire, and you can switch Pages at any time.</p>`,
    },
    {
      title: "Option 2: Use an access token",
      body: `<ol><li>Open the ${GRAPH_EXPLORER}.</li>
        <li>Top right, choose your app under <strong>Meta App</strong>.</li>
        <li>Under <strong>User or Token</strong>, choose <strong>Get Page Access Token</strong> and select your Page.</li>
        <li>Under <strong>Permissions</strong>, add <code>pages_manage_posts</code> and <code>pages_read_engagement</code>.</li>
        <li>Choose <strong>Generate Access Token</strong> and copy it (it starts with <code>EAA</code>).</li>
        <li>Paste it above and choose <strong>Verify and save token</strong>. The Page ID is optional: it is the long number in your Page URL or under <strong>About</strong>.</li></ol>
        <p class="small muted">Tokens from the Explorer usually stop working within a few hours. Use Option 1 for a connection that lasts.</p>`,
    },
  ],
  instagram: [
    {
      title: "Requirements",
      body: "<p>The account must be a professional (Business or Creator) account. Instagram needs a photo or video on every post; text-only posts are not possible.</p>",
    },
    {
      title: "Option 1: Connect Instagram (recommended)",
      body: `<ol><li>Choose <strong>Connect Instagram</strong> above.</li><li>Sign in to Instagram and allow access.</li></ol>
        <p class="small muted">These connections renew themselves, so you do not have to reconnect every 60 days.</p>`,
    },
    {
      title: "Option 2: Use a Facebook token",
      body: `<p>Use this if your Instagram account is linked to a Facebook Page.</p>
        <ol><li>Open the ${GRAPH_EXPLORER} and add the permissions <code>instagram_basic</code> and <code>instagram_content_publish</code>.</li>
        <li>Choose <strong>Generate Access Token</strong> and copy it.</li>
        <li>In the query box, run <code>GET /me/accounts?fields=instagram_business_account</code> and copy the <code>id</code> it returns.</li>
        <li>Paste the token and that ID above. Leave the ID empty to use the account linked to your Page.</li></ol>
        <p class="small muted">Facebook-issued tokens cannot renew automatically; you will need to reconnect when they expire.</p>`,
    },
  ],
  youtube: [
    { title: "Requirements", body: "<p>Sign in with the Google account that owns the channel. Only videos can be uploaded.</p>" },
    {
      title: "Option 1: Connect YouTube (recommended)",
      body: `<ol><li>Choose <strong>Connect YouTube</strong> above.</li><li>Pick the Google account that owns the channel and allow access.</li></ol>
        <p class="small muted">Access renews automatically, so uploads keep working.</p>`,
    },
    {
      title: "Option 2: Use an access token",
      body: `<ol><li>Open the ${link("https://developers.google.com/oauthplayground/", "Google OAuth 2.0 Playground")}.</li>
        <li>Open the settings (top right) and tick <strong>Use your own OAuth credentials</strong>, then enter your client ID and secret.</li>
        <li>Select the scope <code>https://www.googleapis.com/auth/youtube.upload</code> and choose <strong>Authorize APIs</strong>.</li>
        <li>Choose <strong>Exchange authorization code for tokens</strong>.</li>
        <li>Paste the access token above, and the refresh token too so it keeps working after an hour.</li></ol>`,
    },
    { title: "Video titles", body: "<p>The title comes from the YouTube title field in the composer, or the first line of your caption if you leave it empty.</p>" },
  ],
  tiktok: [
    { title: "Requirements", body: "<p>Only videos can be posted. Until TikTok approves the app for public posting, videos may be posted privately (visible only to you).</p>" },
    { title: "Option 1: Connect TikTok (recommended)", body: "<ol><li>Choose <strong>Connect TikTok</strong> above.</li><li>Sign in and allow access to post videos.</li></ol><p class=\"small muted\">Access renews automatically.</p>" },
    {
      title: "Option 2: Use an access token",
      body: `<ol><li>Open your app in the ${link("https://developers.tiktok.com/", "TikTok for Developers portal")}.</li>
        <li>Complete its login flow with the scopes <code>video.publish</code> and <code>video.upload</code>.</li>
        <li>Paste the access token above, plus the refresh token so it renews automatically.</li></ol>`,
    },
  ],
  pinterest: [
    { title: "Requirements", body: "<p>Pins need an image or a video. After connecting, choose which board new Pins go to.</p>" },
    { title: "Option 1: Connect Pinterest (recommended)", body: "<ol><li>Choose <strong>Connect Pinterest</strong> above.</li><li>Allow access to your boards and Pins.</li><li>Pick the board under <strong>Board to publish to</strong>.</li></ol>" },
    {
      title: "Option 2: Use an access token",
      body: `<ol><li>Open your app in the ${link("https://developers.pinterest.com/apps/", "Pinterest developers portal")}.</li>
        <li>Generate a token with <code>boards:read</code>, <code>boards:write</code>, <code>pins:read</code>, <code>pins:write</code> and <code>user_accounts:read</code>.</li>
        <li>Paste it above, then choose your board.</li></ol>`,
    },
  ],
};

function helpPanel(platform) {
  return `<div class="help-panel" id="help-${platform}" hidden>
    ${HELP[platform].map((s) => `<div class="help-section"><h3>${esc(s.title)}</h3>${s.body}</div>`).join("")}
    <p class="small muted">More detail is in the <a href="/help.html#accounts">help guide</a>.</p>
  </div>`;
}

let accounts = [];
const helpOpen = new Set();

function expiryText(a) {
  if (a.status !== "connected") return null;
  if (!a.tokenExpiresAt) return "Does not expire";
  const ms = new Date(a.tokenExpiresAt).getTime() - Date.now();
  if (a.autoRefresh) {
    return ms > 0 ? `Renews automatically (current token valid until ${fmt.dateTime(a.tokenExpiresAt)})` : "Renews automatically on next use";
  }
  return ms > 0 ? `Expires ${fmt.date(a.tokenExpiresAt)} (${fmt.relative(a.tokenExpiresAt)})` : "Expired";
}

function card(a) {
  const info = INFO[a.platform];
  const connected = a.status === "connected";
  const expired = a.status === "expired";
  const details = a.status === "not_connected"
    ? `<p class="muted">${esc(info.about)}</p>`
    : `<dl class="kv">
        <dt>Account</dt><dd>${esc(a.accountName || "-")}${a.username && a.username !== a.accountName ? ` <span class="muted">@${esc(a.username)}</span>` : ""}</dd>
        ${a.resourceLabel && a.resource ? `<dt>${esc(a.resourceLabel)}</dt><dd>${esc(a.resource.name || "Not chosen")}</dd>` : ""}
        <dt>Token</dt><dd>${esc(expiryText(a) || "Needs reconnecting")}</dd>
        <dt>Connected</dt><dd>${fmt.dateTime(a.connectedAt)}</dd>
        <dt>Last checked</dt><dd>${fmt.relative(a.lastCheckedAt)}</dd>
      </dl>`;
  const problem = expired || a.status === "error"
    ? alertHtml("error", "Reconnect required", a.lastError || "The access token expired or was revoked. Scheduled posts to this platform will fail until you reconnect.")
    : "";
  const oauthBtn = a.oauthConfigured
    ? `<button type="button" class="btn ${connected ? "btn-secondary" : "btn-primary"}" data-act="connect">${icon(connected ? "refresh" : "plug")}${connected ? "Reconnect" : expired ? "Reconnect" : "Connect"} ${esc(a.label)}</button>`
    : `<button type="button" class="btn btn-primary" disabled title="The administrator has not configured ${esc(a.label)} sign-in yet">${icon("plug")}Connect ${esc(a.label)}</button>`;
  const resourcePicker = connected && a.resourceLabel && a.platform !== "youtube"
    ? `<div class="field" data-resource-box>
        <label class="label" for="res-${a.platform}">${esc(a.resourceLabel)} to publish to</label>
        <div class="row"><select class="select" id="res-${a.platform}" style="flex:1;min-width:180px"><option value="">${esc(a.resource && a.resource.name ? a.resource.name : "Loading...")}</option></select>
        <button type="button" class="btn btn-secondary" data-act="save-resource">${icon("save")}Save</button></div>
      </div>`
    : "";
  return `<section class="card account-card" id="${a.platform}" aria-labelledby="h-${a.platform}">
    <div class="card-body">
      <div class="account-top">${platformIcon(a.platform, "lg")}
        <div class="grow"><h2 id="h-${a.platform}" class="account-name">${esc(a.label)}</h2><div class="small muted">${esc(a.accountName || "Not connected")}</div></div>
        ${accountBadge(a.status)}
        <button type="button" class="btn btn-secondary btn-sm" data-act="help" aria-expanded="false" aria-controls="help-${a.platform}">${icon("help")}Help${icon("chevronDown", "icon-sm chevron")}</button>
      </div>
      ${helpPanel(a.platform)}
      ${problem}
      ${details}
      ${resourcePicker}
      ${!a.oauthConfigured ? `<p class="small muted">${icon("info", "icon-sm")} ${esc(a.label)} sign-in is not set up on this server yet. You can still connect with an access token below.</p>` : ""}
      <div class="row">
        ${oauthBtn}
        ${a.status !== "not_connected" ? `<button type="button" class="btn btn-secondary" data-act="test">${icon("checkCircle")}Test connection</button>` : ""}
        ${a.status !== "not_connected" ? `<button type="button" class="btn btn-danger-outline" data-act="disconnect">${icon("unplug")}Disconnect</button>` : ""}
      </div>
      <details class="advanced">
        <summary>${icon("chevronRight", "icon-sm")}Connect with an access token instead</summary>
        <form class="mt-12" data-token-form novalidate>
          <p class="small muted mb-12">${esc(info.token)}</p>
          <div class="field">
            <label class="label" for="tok-${a.platform}">Access token</label>
            <div class="input-wrap"><input class="input" type="password" id="tok-${a.platform}" name="accessToken" autocomplete="off" required />
            <button type="button" class="btn btn-ghost btn-reveal" data-reveal="tok-${a.platform}" aria-label="Show">${icon("eye")}</button></div>
          </div>
          ${info.refresh ? `<div class="field"><label class="label" for="rtok-${a.platform}">Refresh token <span class="optional">(optional)</span></label><input class="input" type="password" id="rtok-${a.platform}" name="refreshToken" autocomplete="off" /></div>` : ""}
          ${info.idLabel ? `<div class="field"><label class="label" for="ext-${a.platform}">${esc(info.idLabel)}</label><input class="input" id="ext-${a.platform}" name="externalId" autocomplete="off" /></div>` : ""}
          <div data-token-error></div>
          <button type="submit" class="btn btn-secondary">${icon("key")}Verify and save token</button>
        </form>
      </details>
    </div>
  </section>`;
}

function render() {
  $("#accounts").innerHTML = accounts.map(card).join("");
  bindReveal($("#accounts"));
  for (const a of accounts) {
    const root = document.getElementById(a.platform);
    root.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => act(a, b.dataset.act, b)));
    root.querySelector("[data-token-form]").addEventListener("submit", (e) => saveToken(e, a));
    if (a.status === "connected" && a.resourceLabel && a.platform !== "youtube") loadResources(a);
    // Re-rendering a card must not collapse help the user opened.
    if (helpOpen.has(a.platform)) toggleHelp(a.platform, root.querySelector('[data-act="help"]'));
  }
  if (location.hash) {
    const target = document.getElementById(location.hash.slice(1));
    if (target) target.scrollIntoView({ block: "start" });
  }
}

async function loadResources(a) {
  const select = document.getElementById(`res-${a.platform}`);
  try {
    const res = await api.get(`/api/accounts/${a.platform}/resources`);
    select.innerHTML = res.items.length
      ? res.items.map((i) => `<option value="${esc(i.id)}" ${i.id === res.selectedId ? "selected" : ""}>${esc(i.name)}</option>`).join("")
      : `<option value="">No ${a.resourceLabel.toLowerCase()}s found</option>`;
    if (!res.selectedId && res.items.length) select.insertAdjacentHTML("afterbegin", `<option value="" selected>Choose a ${a.resourceLabel.toLowerCase()}</option>`);
  } catch (err) {
    select.innerHTML = `<option value="">${esc(a.resource && a.resource.name ? a.resource.name : "Could not load list")}</option>`;
    const box = select.closest("[data-resource-box]");
    box.insertAdjacentHTML("beforeend", `<span class="field-error">${esc(err.message)}</span>`);
  }
}

async function load() {
  const res = await api.get("/api/accounts");
  accounts = res.accounts;
  render();
}

function replace(updated) {
  accounts = accounts.map((a) => (a.platform === updated.platform ? updated : a));
  render();
}

function toggleHelp(platform, btn) {
  const panel = document.getElementById(`help-${platform}`);
  const open = panel.hidden;
  if (open) helpOpen.add(platform);
  else helpOpen.delete(platform);
  panel.hidden = !open;
  btn.setAttribute("aria-expanded", String(open));
  btn.classList.toggle("is-open", open);
}

async function act(a, action, btn) {
  try {
    if (action === "help") return toggleHelp(a.platform, btn);
    if (action === "connect") {
      await busy(btn, "Redirecting...", async () => {
        const { url } = await api.post(`/api/accounts/${a.platform}/connect`);
        location.href = url;
        await new Promise(() => {});
      });
    } else if (action === "test") {
      await busy(btn, "Testing...", async () => {
        const res = await api.post(`/api/accounts/${a.platform}/test`).catch((err) => err.body || { success: false, error: err.message });
        if (res.ok) toast(`${a.label} connection works.`, "success");
        else toast(typeof res.error === "string" ? res.error : (res.error && res.error.message) || `${a.label} connection failed.`, "error");
        if (res.account) replace(res.account);
      });
    } else if (action === "disconnect") {
      const ok = await confirmDialog({
        title: `Disconnect ${a.label}?`,
        message: `Stored ${a.label} tokens will be deleted. Scheduled posts for ${a.label} will fail until you connect again.`,
        confirmLabel: "Disconnect",
        danger: true,
      });
      if (!ok) return;
      const res = await api.del(`/api/accounts/${a.platform}`);
      toast(`${a.label} disconnected.`, "success");
      replace(res.account);
    } else if (action === "save-resource") {
      const id = document.getElementById(`res-${a.platform}`).value;
      if (!id) return toast(`Choose a ${a.resourceLabel.toLowerCase()} first.`, "error");
      await busy(btn, "Saving...", async () => {
        const res = await api.put(`/api/accounts/${a.platform}/resources`, { id });
        toast(`${a.resourceLabel} saved.`, "success");
        replace(res.account);
      });
    }
  } catch (err) {
    toastError(err);
  }
}

async function saveToken(e, a) {
  e.preventDefault();
  const form = e.currentTarget;
  const data = Object.fromEntries([...new FormData(form)].filter(([, v]) => String(v).trim()));
  const errBox = form.querySelector("[data-token-error]");
  errBox.innerHTML = "";
  if (!data.accessToken) {
    errBox.innerHTML = alertHtml("error", "Enter an access token.");
    return;
  }
  await busy(form.querySelector("button[type=submit]"), "Verifying...", async () => {
    try {
      const res = await api.post(`/api/accounts/${a.platform}/token`, data);
      toast(`${a.label} connected as ${res.account.accountName || "your account"}.`, "success");
      replace(res.account);
    } catch (err) {
      errBox.innerHTML = `<div class="mb-12">${errorAlert(err)}</div>`;
    }
  });
}

async function init() {
  await mountLayout({ page: "accounts", title: "Connected accounts" });
  hydrateIcons();
  const p = params();
  if (p.get("connected")) {
    $("#banner").innerHTML = `<div class="mb-20">${alertHtml("success", `${PLATFORM_LABEL[p.get("connected")] || "Account"} connected`, "You can now publish to it.")}</div>`;
  } else if (p.get("error")) {
    $("#banner").innerHTML = `<div class="mb-20">${alertHtml("error", `Could not connect ${PLATFORM_LABEL[p.get("platform")] || "the account"}`, p.get("error"))}</div>`;
  } else if (p.get("welcome")) {
    $("#banner").innerHTML = `<div class="mb-20">${alertHtml("info", "Welcome! Start by connecting an account", "Connect at least one platform, then create your first post.")}</div>`;
  }
  setParams({ connected: "", error: "", platform: "", welcome: "" });
  $("#refresh-all").addEventListener("click", (e) =>
    busy(e.currentTarget, "Checking...", async () => {
      const connected = accounts.filter((a) => a.status !== "not_connected");
      if (!connected.length) return toast("No accounts are connected yet.", "info");
      let ok = 0;
      for (const a of connected) {
        const res = await api.post(`/api/accounts/${a.platform}/test`).catch((err) => err.body || {});
        if (res.ok) ok++;
        if (res.account) accounts = accounts.map((x) => (x.platform === a.platform ? res.account : x));
      }
      render();
      toast(`${ok} of ${connected.length} connection(s) working.`, ok === connected.length ? "success" : "error");
    })
  );
  try {
    await load();
  } catch (err) {
    $("#accounts").innerHTML = errorAlert(err);
  }
}

init();
