// Post workflow: drafts, publish now, schedule, edit, cancel, run now, retry,
// duplicate and delete. Routes stay thin and call into here.
const config = require("../config");
const db = require("../db");
const time = require("../lib/time");
const postsModel = require("../models/posts");
const mediaModel = require("../models/media");
const metricsModel = require("../models/metrics");
const accountsModel = require("../models/accounts");
const publisher = require("./publisher");
const activity = require("./activity");
const { randomToken } = require("../lib/crypto");
const { notFound, conflict, validationError, AppError } = require("../lib/errors");
const { PLATFORM_LABELS } = require("../lib/errors");

// ── Views ─────────────────────────────────────────────────────────────────────

async function detail(post) {
  const [targets, attempts, metrics, media, thumbnail] = await Promise.all([
    postsModel.listTargets(post.id),
    postsModel.listAttempts(post.id),
    metricsModel.latestForPost(post.id),
    post.media_id ? mediaModel.findById(post.media_id) : null,
    post.thumbnail_media_id ? mediaModel.findById(post.thumbnail_media_id) : null,
  ]);
  return postsModel.toPublic(post, {
    media: mediaModel.toPublic(media),
    thumbnail: mediaModel.toPublic(thumbnail),
    targets: targets.map(postsModel.targetToPublic),
    attempts,
    metrics,
  });
}

async function listView(filters) {
  const { rows, total, page, pageSize } = await postsModel.list(filters);
  const ids = rows.map((r) => r.id);
  const mediaIds = [...new Set(rows.map((r) => r.media_id).filter(Boolean))];
  const [targets, mediaRows] = await Promise.all([
    postsModel.listTargetsForPosts(ids),
    mediaIds.length ? db.all(`SELECT * FROM media WHERE id IN (${mediaIds.map(() => "?").join(", ")})`, mediaIds) : [],
  ]);
  const mediaById = Object.fromEntries(mediaRows.map((m) => [m.id, mediaModel.toPublic(m)]));
  const items = rows.map((p) =>
    postsModel.toPublic(p, {
      media: p.media_id ? mediaById[p.media_id] || null : null,
      targets: targets.filter((t) => Number(t.post_id) === Number(p.id)).map(postsModel.targetToPublic),
    })
  );
  return { items, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

async function requirePost(userId, id) {
  const post = await postsModel.findForUser(id, userId);
  if (!post) throw notFound("Post not found.");
  return post;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function resolveMedia(userId, mediaId, field = "mediaId") {
  if (!mediaId) return null;
  const media = await mediaModel.findForUser(mediaId, userId);
  if (!media) throw validationError("The selected media file was not found.", [{ field, message: "Media not found." }]);
  return media;
}

async function resolveThumbnail(userId, thumbnailMediaId) {
  const media = await resolveMedia(userId, thumbnailMediaId, "thumbnailMediaId");
  if (media && media.resource_type !== "image") {
    throw validationError("The thumbnail must be an image.", [{ field: "thumbnailMediaId", message: "The thumbnail must be an image." }]);
  }
  return media;
}

function contentFields(input) {
  return {
    title: input.title ?? "",
    caption: input.caption ?? "",
    description: input.description ?? "",
    hashtags: input.hashtags ?? "",
    mediaId: input.mediaId ?? null,
    thumbnailMediaId: input.thumbnailMediaId ?? null,
    tone: input.tone ?? null,
    platforms: input.platforms || [],
    platformContent: input.platformContent || {},
  };
}

// A stand-in for a post row so validation runs before anything is saved.
function draftRow(userId, fields) {
  return {
    id: 0,
    user_id: userId,
    title: fields.title,
    caption: fields.caption,
    description: fields.description,
    hashtags: fields.hashtags,
    media_id: fields.mediaId,
    thumbnail_media_id: fields.thumbnailMediaId,
    platform_content: JSON.stringify(fields.platformContent),
  };
}

function scheduleTimes(platformList, input) {
  const times = {};
  const problems = [];
  for (const p of platformList) {
    const at = (input.schedules && input.schedules[p]) || input.scheduledAt;
    if (!at) {
      problems.push({ field: `schedules.${p}`, message: `Choose a publish time for ${PLATFORM_LABELS[p]}.` });
      continue;
    }
    const t = Date.parse(at);
    if (Number.isNaN(t)) problems.push({ field: `schedules.${p}`, message: "Invalid date." });
    else if (t < Date.now() + 60000) problems.push({ field: `schedules.${p}`, message: `${PLATFORM_LABELS[p]} time must be at least 1 minute in the future.` });
    else if (t > Date.now() + 366 * 86400000) problems.push({ field: `schedules.${p}`, message: `${PLATFORM_LABELS[p]} time must be within 12 months.` });
    else times[p] = new Date(t);
  }
  if (problems.length) throw validationError(problems[0].message, problems);
  return times;
}

async function assertReady(userId, fields, media, thumbnail) {
  if (!fields.platforms.length) throw validationError("Select at least one platform.", [{ field: "platforms", message: "Select at least one platform." }]);
  const problems = await publisher.preflight(draftRow(userId, fields), fields.platforms, media, thumbnail);
  if (problems.length) {
    throw validationError(
      problems.length === 1 ? problems[0].message : `${problems.length} problems need fixing before publishing.`,
      problems.map((p) => ({ field: `platforms.${p.platform}`, platform: p.platform, message: p.message }))
    );
  }
}

function assertDraftHasContent(fields) {
  if (!fields.title.trim() && !fields.caption.trim() && !fields.description.trim() && !fields.mediaId) {
    throw validationError("Add some text or media before saving.", [{ field: "caption", message: "Add some text or media before saving." }]);
  }
}

async function accountIds(userId, platformList) {
  const ids = {};
  for (const p of platformList) {
    const a = await accountsModel.findByUserPlatform(userId, p);
    ids[p] = a ? a.id : null;
  }
  return ids;
}

// Writes the post row and (for publish/schedule) its targets in one transaction.
async function persist(req, existing, fields, action, times) {
  const userId = req.user.id;
  const lock = action === "publish" ? randomToken(16) : null;
  const ids = action === "draft" ? {} : await accountIds(userId, fields.platforms);
  const status = action === "draft" ? "draft" : action === "schedule" ? "scheduled" : "publishing";
  const earliest = times ? Object.values(times).sort((a, b) => a - b)[0] : null;

  const post = await db.transaction(async (tx) => {
    const data = { ...fields, status, scheduledAt: earliest, publishedAt: null };
    const row = existing ? await postsModel.update(existing.id, data, tx) : await postsModel.create(userId, data, tx);
    if (existing) await postsModel.deleteTargets(existing.id, tx);
    if (action !== "draft") {
      await postsModel.createTargets(
        row,
        fields.platforms.map((p) => ({
          platform: p,
          accountId: ids[p],
          status: action === "schedule" ? "scheduled" : "processing",
          scheduledAt: times ? times[p] : null,
          lockToken: lock,
        })),
        tx
      );
    }
    return row;
  });

  if (action === "publish") {
    const claimed = await postsModel.listTargets(post.id);
    const { post: updated, results } = await publisher.publishClaimed(post, claimed, "now");
    return { post: await detail(updated), results };
  }
  await activity.log(req, action === "schedule" ? "schedule.create" : existing ? "post.update" : "post.create", {
    entityType: "post",
    entityId: post.id,
    details: { status, platforms: fields.platforms, scheduledAt: earliest ? earliest.toISOString() : undefined },
  });
  return { post: await detail(post), results: [] };
}

// ── Workflow ──────────────────────────────────────────────────────────────────

async function create(req, input) {
  const fields = contentFields(input);
  const media = await resolveMedia(req.user.id, fields.mediaId);
  const thumbnail = await resolveThumbnail(req.user.id, fields.thumbnailMediaId);
  if (input.action === "draft") {
    assertDraftHasContent(fields);
    return persist(req, null, fields, "draft");
  }
  await assertReady(req.user.id, fields, media, thumbnail);
  const times = input.action === "schedule" ? scheduleTimes(fields.platforms, input) : null;
  return persist(req, null, fields, input.action, times);
}

// Saves edits to a draft or a scheduled post that has not started publishing.
async function update(req, id, input) {
  const existing = await requirePost(req.user.id, id);
  if (existing.status === "scheduled") {
    const targets = await postsModel.listTargets(existing.id);
    if (targets.some((t) => t.status !== "scheduled")) {
      throw conflict("Some platforms have already been published. Only the remaining schedule can be changed; duplicate the post to make a new version.");
    }
  } else if (existing.status !== "draft") {
    throw conflict(`A ${existing.status} post cannot be edited. Duplicate it to make changes.`);
  }
  const fields = contentFields(input);
  const media = await resolveMedia(req.user.id, fields.mediaId);
  const thumbnail = await resolveThumbnail(req.user.id, fields.thumbnailMediaId);
  const action = input.action || (existing.status === "scheduled" ? "schedule" : "draft");
  if (action === "draft") {
    assertDraftHasContent(fields);
    return persist(req, existing, fields, "draft");
  }
  await assertReady(req.user.id, fields, media, thumbnail);
  const times = action === "schedule" ? scheduleTimes(fields.platforms, input) : null;
  return persist(req, existing, fields, action, times);
}

// Publishes or schedules a saved draft without changing its content.
async function publishDraft(req, id, input) {
  const post = await requirePost(req.user.id, id);
  if (post.status !== "draft") throw conflict("Only drafts can be published this way.");
  const saved = postsModel.toPublic(post);
  return update(req, id, { ...saved, ...input, platforms: input.platforms || saved.platforms });
}

async function remove(req, id) {
  const post = await requirePost(req.user.id, id);
  if (post.status === "publishing") throw conflict("This post is being published right now. Try again in a moment.");
  await postsModel.remove(post.id);
  await activity.log(req, "post.delete", { entityType: "post", entityId: post.id, details: { status: post.status } });
}

async function duplicate(req, id) {
  const source = await requirePost(req.user.id, id);
  const p = postsModel.toPublic(source);
  const copy = await postsModel.create(req.user.id, {
    title: p.title ? `${p.title} (copy)`.slice(0, 255) : "",
    caption: p.caption,
    description: p.description,
    hashtags: p.hashtags,
    mediaId: p.mediaId,
    thumbnailMediaId: p.thumbnailMediaId,
    tone: p.tone,
    platforms: p.platforms,
    platformContent: p.platformContent,
    status: "draft",
  });
  await activity.log(req, "post.duplicate", { entityType: "post", entityId: copy.id, details: { sourceId: source.id } });
  return detail(copy);
}

async function cancel(req, id) {
  const post = await requirePost(req.user.id, id);
  const cancelled = await postsModel.cancelScheduledTargets(post.id);
  if (!cancelled) throw conflict("This post has nothing scheduled to cancel.");
  const updated = await publisher.refreshPostStatus(post.id);
  await activity.log(req, "schedule.cancel", { entityType: "post", entityId: post.id, details: { targets: cancelled } });
  return detail(updated);
}

async function reschedule(req, id, input) {
  const post = await requirePost(req.user.id, id);
  const targets = (await postsModel.listTargets(post.id)).filter((t) => t.status === "scheduled");
  if (!targets.length) throw conflict("This post has nothing scheduled to change.");
  const platformList = input.schedules ? Object.keys(input.schedules) : targets.map((t) => t.platform);
  const unknown = platformList.filter((p) => !targets.some((t) => t.platform === p));
  if (unknown.length) throw validationError(`${unknown.map((p) => PLATFORM_LABELS[p]).join(", ")} is not scheduled on this post.`);
  const times = scheduleTimes(platformList, input);
  await postsModel.rescheduleTargets(post.id, times);
  const updated = await publisher.refreshPostStatus(post.id);
  await activity.log(req, "schedule.update", {
    entityType: "post",
    entityId: post.id,
    details: { schedules: Object.fromEntries(Object.entries(times).map(([k, v]) => [k, v.toISOString()])) },
  });
  return detail(updated);
}

async function runNow(req, id) {
  const post = await requirePost(req.user.id, id);
  const scheduled = (await postsModel.listTargets(post.id)).filter((t) => t.status === "scheduled");
  const claimed = await publisher.claim(scheduled, ["scheduled"]);
  if (!claimed.length) throw conflict("This post has nothing waiting to be published.");
  await publisher.refreshPostStatus(post.id);
  const { post: updated, results } = await publisher.publishClaimed(await postsModel.findById(post.id), claimed, "run_now");
  return { post: await detail(updated), results };
}

// Retries failed platforms only; successful ones are never republished.
async function retry(req, id, input) {
  const post = await requirePost(req.user.id, id);
  let failed = (await postsModel.listTargets(post.id)).filter((t) => t.status === "failed");
  if (input.platforms && input.platforms.length) failed = failed.filter((t) => input.platforms.includes(t.platform));
  if (!failed.length) throw conflict("There are no failed platforms to retry on this post.");

  const exhausted = failed.filter((t) => Number(t.attempts) >= config.publishing.maxAttempts);
  const eligible = failed.filter((t) => Number(t.attempts) < config.publishing.maxAttempts);
  if (!eligible.length) {
    throw new AppError(
      409,
      "RETRY_LIMIT_REACHED",
      `Retry limit reached (${config.publishing.maxAttempts} attempts). Duplicate the post to try again with fresh content.`
    );
  }
  const claimed = await publisher.claim(eligible, ["failed"]);
  if (!claimed.length) throw conflict("A retry for this post is already in progress.");
  await publisher.refreshPostStatus(post.id);
  const { post: updated, results } = await publisher.publishClaimed(await postsModel.findById(post.id), claimed, "retry");
  return {
    post: await detail(updated),
    results,
    skipped: exhausted.map((t) => ({ platform: t.platform, reason: "Retry limit reached." })),
  };
}

// Calendar entries: one per post and distinct publish time.
async function calendar(userId, { from, to }) {
  const rows = await db.all(
    `SELECT t.*, p.title, p.caption, p.status AS post_status, p.media_id
     FROM post_targets t INNER JOIN posts p ON p.id = t.post_id
     WHERE t.user_id = ? AND COALESCE(t.published_at, t.scheduled_at) >= ? AND COALESCE(t.published_at, t.scheduled_at) <= ?
       AND t.status <> 'cancelled'
     ORDER BY COALESCE(t.published_at, t.scheduled_at), t.post_id`,
    [userId, time.toDb(from), time.toDb(to)]
  );
  const events = new Map();
  for (const r of rows) {
    const at = time.fromDb(r.published_at || r.scheduled_at);
    const key = `${r.post_id}|${at}`;
    if (!events.has(key)) {
      events.set(key, {
        postId: Number(r.post_id),
        at,
        title: r.title || (r.caption || "").split("\n")[0].slice(0, 80) || `Post #${r.post_id}`,
        postStatus: r.post_status,
        mediaId: r.media_id ? Number(r.media_id) : null,
        targets: [],
      });
    }
    events.get(key).targets.push({ platform: r.platform, status: r.status });
  }
  return [...events.values()];
}

module.exports = { detail, listView, requirePost, create, update, publishDraft, remove, duplicate, cancel, reschedule, runNow, retry, calendar };
