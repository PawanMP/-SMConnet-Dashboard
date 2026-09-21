// Human-readable descriptions for activity log entries.
import { PLATFORM_LABEL } from "./icons.js";

const P = (d) => PLATFORM_LABEL[d && d.platform] || (d && d.platform) || "";

export const ACTIVITY = {
  "auth.register": ["user", () => "Created the account"],
  "auth.login": ["logout", () => "Signed in"],
  "auth.login_failed": ["alert", () => "Failed sign-in attempt"],
  "auth.logout": ["logout", () => "Signed out"],
  "auth.logout_all": ["logout", () => "Signed out of all devices"],
  "auth.account_deleted": ["trash", () => "Deleted the account"],
  "account.connect": ["plug", (d) => `Connected ${P(d)}${d.account ? ` (${d.account})` : ""}${d.method === "token" ? " with an access token" : ""}`],
  "account.disconnect": ["unplug", (d) => `Disconnected ${P(d)}`],
  "account.test": ["checkCircle", (d) => `Tested the ${P(d)} connection: ${d.ok ? "working" : "failed"}`],
  "account.token_expired": ["alert", (d) => `${P(d)} token expired or was revoked`],
  "account.select_resource": ["settings", (d) => `Changed the ${P(d)} Page/Board`],
  "post.create": ["drafts", (d) => (d.status === "draft" ? "Saved a draft" : "Created a post")],
  "post.update": ["edit", () => "Edited a post"],
  "post.delete": ["trash", () => "Deleted a post"],
  "post.duplicate": ["copy", () => "Duplicated a post"],
  "post.publish": ["send", (d) => `Published a post${results(d)}`],
  "post.retry": ["retry", (d) => `Retried failed platforms${results(d)}`],
  "schedule.create": ["clock", (d) => `Scheduled a post${d.scheduledAt ? ` for ${new Date(d.scheduledAt).toLocaleString()}` : ""}`],
  "schedule.update": ["clock", () => "Rescheduled a post"],
  "schedule.cancel": ["x", () => "Cancelled a schedule"],
  "schedule.run_now": ["play", (d) => `Published a scheduled post early${results(d)}`],
  "schedule.execute": ["clock", (d) => `Scheduled post ran${results(d)}`],
  "settings.update": ["settings", (d) => `Updated settings${d.fields ? ` (${d.fields.join(", ")})` : ""}`],
  "settings.profile_update": ["user", () => "Updated profile"],
  "settings.password_change": ["key", () => "Changed password"],
  "media.upload": ["upload", (d) => `Uploaded ${d.type === "video" ? "a video" : "an image"}`],
  "media.delete": ["trash", () => "Deleted media"],
  "ai.generate": ["sparkles", (d) => `Generated AI content for ${(d.platforms || []).map((p) => PLATFORM_LABEL[p]).join(", ")}`],
  "analytics.refresh": ["refresh", (d) => `Refreshed engagement data (${d.updated || 0} updated)`],
  "admin.user_create": ["users", (d) => `Created user ${d.email || ""}`],
  "admin.user_update": ["users", (d) => `Updated a user (${Object.keys(d).join(", ")})`],
  "admin.user_delete": ["users", (d) => `Deleted user ${d.email || ""}`],
  "admin.scheduler_run": ["play", () => "Ran the scheduler manually"],
  "admin.media_cleanup": ["trash", (d) => `Cleaned up ${d.removed || 0} unused media file(s)`],
};

function results(d) {
  if (!d || !Array.isArray(d.results)) return "";
  const ok = d.results.filter((r) => r.success).map((r) => PLATFORM_LABEL[r.platform]);
  const bad = d.results.filter((r) => !r.success).map((r) => PLATFORM_LABEL[r.platform]);
  return `${ok.length ? `: succeeded on ${ok.join(", ")}` : ""}${bad.length ? `${ok.length ? ";" : ":"} failed on ${bad.join(", ")}` : ""}`;
}

export function describe(entry) {
  const [iconName, fn] = ACTIVITY[entry.action] || ["activity", () => entry.action];
  let text;
  try {
    text = fn(entry.details || {});
  } catch {
    text = entry.action;
  }
  return { iconName, text };
}
