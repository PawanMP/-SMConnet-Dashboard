// Publishes a post to its platform targets. Each platform succeeds or fails on
// its own: one failure never undoes or blocks the others, and retries only
// touch the platforms that failed.
const config = require("../config");
const logger = require("../lib/logger");
const time = require("../lib/time");
const postsModel = require("../models/posts");
const accountsModel = require("../models/accounts");
const mediaModel = require("../models/media");
const platforms = require("./platforms");
const content = require("./content");
const tokens = require("./tokens");
const notifier = require("./notifier");
const activity = require("./activity");
const { PlatformError, PLATFORM_LABELS, toPlatformError } = require("../lib/errors");
const { randomToken } = require("../lib/crypto");
const { redact } = require("../lib/redact");

// Checks everything that can be known before calling a platform: the account
// is connected and the content fits the platform's rules.
async function preflight(post, platformList, media) {
  const problems = [];
  for (const platform of platformList) {
    const adapter = platforms.get(platform);
    const account = await accountsModel.findByUserPlatform(post.user_id, platform);
    if (!account) {
      problems.push({ platform, message: `${adapter.label} is not connected. Connect it on the Accounts page.` });
      continue;
    }
    if (account.status === "expired") {
      problems.push({ platform, message: `${adapter.label} needs to be reconnected (the access token expired).` });
      continue;
    }
    for (const message of adapter.validate(content.resolve(post, platform), media, accountsModel.metadata(account))) {
      problems.push({ platform, message });
    }
  }
  return problems;
}

async function publishOne(post, target, media, trigger) {
  const started = Date.now();
  const attemptNo = Number(target.attempts || 0) + 1;
  const platform = target.platform;
  let account = null;
  try {
    const adapter = platforms.get(platform);
    account = await accountsModel.findByUserPlatform(post.user_id, platform);
    if (!account) {
      throw new PlatformError(platform, `${PLATFORM_LABELS[platform]} is not connected. Connect it on the Accounts page.`, { code: "NOT_CONNECTED" });
    }
    const meta = accountsModel.metadata(account);
    const resolved = content.resolve(post, platform);
    const problems = adapter.validate(resolved, media, meta);
    if (problems.length) throw new PlatformError(platform, `${PLATFORM_LABELS[platform]}: ${problems.join(" ")}`, { code: "INVALID_CONTENT" });

    const t = await tokens.getValidTokens(account);
    const result = await adapter.publish({ account, tokens: t, content: resolved, media, meta });
    // Links are shown in the UI; only keep web URLs.
    if (result.url && !/^https?:\/\//i.test(result.url)) result.url = null;

    await postsModel.completeTarget(target.id, { success: true, platformPostId: result.platformPostId, url: result.url });
    await postsModel.recordAttempt(target, { attemptNo, trigger, success: true, platformPostId: result.platformPostId, durationMs: Date.now() - started });
    return { platform, success: true, platformPostId: result.platformPostId || null, url: result.url || null, attempts: attemptNo };
  } catch (err) {
    if (!(err instanceof PlatformError) && !err.response) {
      logger.error("Unexpected error while publishing", { platform, postId: post.id, err });
    }
    const pe = toPlatformError(platform, err);
    if (pe.auth && account) await tokens.handleAuthFailure(account, pe);

    // Scheduled runs retry transient failures (network, rate limits, 5xx) on their own.
    let nextStatus = "failed";
    let retryAt = null;
    if (trigger === "schedule" && pe.retryable && attemptNo <= config.scheduler.autoRetryLimit) {
      nextStatus = "scheduled";
      retryAt = time.addMinutes(new Date(), config.scheduler.autoRetryDelayMinutes * attemptNo);
    }
    const safeMessage = redact(pe.message);
    await postsModel.completeTarget(target.id, { success: false, message: safeMessage, code: pe.code, nextStatus, retryAt });
    await postsModel.recordAttempt(target, { attemptNo, trigger, success: false, message: safeMessage, durationMs: Date.now() - started });
    return {
      platform,
      success: false,
      error: safeMessage,
      code: pe.code,
      attempts: attemptNo,
      willRetry: nextStatus === "scheduled",
      retryAt: retryAt ? retryAt.toISOString() : null,
    };
  }
}

// Derives the post's overall status from its targets.
async function refreshPostStatus(postId) {
  const post = await postsModel.findById(postId);
  const targets = await postsModel.listTargets(postId);
  if (!post || !targets.length) return post;
  const active = targets.filter((t) => t.status !== "cancelled");
  let status;
  if (!active.length) status = "cancelled";
  else if (active.some((t) => t.status === "processing")) status = "publishing";
  else if (active.some((t) => t.status === "scheduled" || t.status === "pending")) status = "scheduled";
  else {
    const ok = active.filter((t) => t.status === "success").length;
    const failed = active.filter((t) => t.status === "failed").length;
    status = ok && !failed ? "published" : ok ? "partial" : "failed";
  }
  const publishedTimes = targets.filter((t) => t.published_at).map((t) => t.published_at).sort();
  const scheduledTimes = targets.filter((t) => t.status === "scheduled" && t.scheduled_at).map((t) => t.scheduled_at).sort();
  return postsModel.update(postId, {
    status,
    publishedAt: publishedTimes[0] || null,
    scheduledAt: scheduledTimes[0] || post.scheduled_at || null,
  });
}

// Publishes targets the caller has already claimed (status "processing").
async function publishClaimed(post, claimed, trigger) {
  if (!claimed.length) return { post: await refreshPostStatus(post.id), results: [] };
  const media = post.media_id ? await mediaModel.findById(post.media_id) : null;
  const results = await Promise.all(claimed.map((t) => publishOne(post, t, media, trigger)));
  const updated = await refreshPostStatus(post.id);

  await notifier.publishResult(updated, results.filter((r) => !r.willRetry), trigger);
  const action = { now: "post.publish", run_now: "schedule.run_now", retry: "post.retry", schedule: "schedule.execute" }[trigger] || "post.publish";
  await activity.log(post.user_id, action, {
    entityType: "post",
    entityId: post.id,
    details: { results: results.map((r) => ({ platform: r.platform, success: r.success, error: r.error ? redact(r.error) : undefined })) },
  });
  return { post: updated, results };
}

// Claims targets by id from the given statuses; returns the ones this call won.
async function claim(targets, fromStatuses) {
  const lock = randomToken(16);
  const won = [];
  for (const t of targets) {
    if (await postsModel.claimTarget(t.id, fromStatuses, lock)) won.push(await postsModel.findTarget(t.id));
  }
  return won;
}

module.exports = { preflight, publishClaimed, refreshPostStatus, claim, publishOne };
