# Social Poster API

Base URL: `{APP_URL}/api`. All request and response bodies are JSON unless noted.

## Authentication

| Method | How | Use |
| --- | --- | --- |
| Session cookie | `sp_session` httpOnly cookie set by `POST /auth/login` or `/auth/register` | The web app |
| Bearer token | `Authorization: Bearer <token>` (the `token` field returned by login/register) | Scripts and API clients |

- Every endpoint below requires authentication unless marked **Public**. Endpoints marked **Admin** also require the `admin` role.
- **CSRF protection:** cookie-authenticated `POST`, `PUT`, `PATCH` and `DELETE` requests must send an `X-Requested-With` header (any value). Bearer-token requests don't need it.
- Sessions last `JWT_EXPIRES_IN` (default 7 days). Changing your password, "logout everywhere", or an admin changing your role or disabling your account revokes existing sessions immediately.

## Response format

Success:

```json
{ "success": true, "...": "endpoint-specific fields" }
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "platforms: Select at least one platform.",
    "details": [{ "field": "platforms", "message": "Select at least one platform." }],
    "requestId": "8f0c2d1e-..."
  }
}
```

| HTTP | `code` | Meaning |
| --- | --- | --- |
| 400 | `BAD_REQUEST`, `INVALID_JSON`, `INVALID_PASSWORD`, `UPLOAD_ERROR` | Malformed request |
| 401 | `UNAUTHORIZED`, `INVALID_CREDENTIALS` | Not signed in, session revoked, or wrong email/password |
| 403 | `FORBIDDEN` | Missing role, disabled account, closed registration, or missing `X-Requested-With` header |
| 404 | `NOT_FOUND` | Resource doesn't exist or belongs to another user |
| 409 | `CONFLICT`, `RETRY_LIMIT_REACHED`, `TOKEN_INVALID` | State conflict, e.g. editing a published post, or a platform rejected the token |
| 413 | `FILE_TOO_LARGE`, `PAYLOAD_TOO_LARGE` | Upload or body too large |
| 422 | `VALIDATION_ERROR` | Field validation failed. See `details` |
| 429 | `RATE_LIMITED`, `AI_RATE_LIMITED` | Too many requests |
| 502 | `PLATFORM_ERROR`, `AI_PROVIDER_ERROR`, `AI_AUTH_FAILED` | A social platform or AI provider failed |
| 503 | `OAUTH_NOT_CONFIGURED`, `AI_NOT_CONFIGURED`, `MEDIA_NOT_CONFIGURED`, `DATABASE_UNAVAILABLE`, `CRON_DISABLED`, `MISCONFIGURED` | A required server setting is missing |
| 500 | `INTERNAL_ERROR` | Unexpected. In production the message is generic; use `requestId` to find the log entry |

Rate limits: sign-in and registration allow 10 requests per 15 minutes per IP. The API overall allows 1000 per 15 minutes per user. AI endpoints allow 20 per minute, publishing 30 per minute and uploads 30 per minute.

Timestamps are ISO 8601 UTC strings (`2026-09-20T09:00:00.000Z`). Platforms are `facebook`, `instagram`, `youtube`, `tiktok` and `pinterest`.

---

## Endpoint list

| Method | Path | Description |
| --- | --- | --- |
| GET | `/health` | **Public.** Health check |
| GET, POST | `/cron/scheduler` | **Public, cron secret.** Runs the scheduler |
| GET | `/auth/config` | **Public.** Registration availability |
| POST | `/auth/register` | **Public.** Create an account |
| POST | `/auth/login` | **Public.** Sign in |
| POST | `/auth/logout` | Sign out (clears the cookie) |
| POST | `/auth/logout-all` | Revoke every session |
| GET | `/auth/me` | Current user |
| GET, PUT | `/profile` | View or edit your profile |
| POST | `/profile/password` | Change your password |
| GET, PUT | `/profile/settings` | AI and notification preferences |
| DELETE | `/profile` | Delete your account |
| GET | `/accounts` | Connection status for all five platforms |
| POST | `/accounts/:platform/connect` | Start OAuth; returns the provider URL |
| GET | `/oauth/:platform/callback` | OAuth redirect target (browser only) |
| POST | `/accounts/:platform/token` | Connect with an access token |
| POST | `/accounts/:platform/test` | Verify stored credentials |
| GET, PUT | `/accounts/:platform/resources` | List or choose the Facebook Page / Pinterest board |
| DELETE | `/accounts/:platform` | Disconnect and delete the stored tokens |
| GET | `/media/config` | Upload limits and mode |
| POST | `/media/upload` | Multipart upload (`file` field) |
| POST | `/media/signature` | Signed direct-to-Cloudinary upload parameters |
| POST | `/media/complete` | Register a direct Cloudinary upload |
| GET | `/media` | Your media library |
| DELETE | `/media/:id` | Delete unused media |
| GET | `/posts` | Post history (search, filter, paginate) |
| GET | `/posts/calendar` | Calendar entries in a date range |
| GET | `/posts/:id` | Post details with targets, attempts and metrics |
| POST | `/posts` | Create a draft, publish now, or schedule |
| PUT | `/posts/:id` | Edit a draft or a not-yet-started scheduled post |
| DELETE | `/posts/:id` | Delete a post |
| POST | `/posts/:id/duplicate` | Copy to a new draft |
| POST | `/posts/:id/publish` | Publish or schedule a saved draft |
| POST | `/posts/:id/cancel` | Cancel remaining scheduled platforms |
| PATCH | `/posts/:id/schedule` | Reschedule remaining platforms |
| POST | `/posts/:id/run-now` | Publish scheduled platforms immediately |
| POST | `/posts/:id/retry` | Retry failed platforms only |
| GET | `/ai/status` | AI availability, provider and model |
| POST | `/ai/generate` | Generate content for several platforms |
| POST | `/ai/rewrite` | Regenerate, shorten, expand or rephrase one field |
| POST | `/ai/test` | Test an AI API key |
| GET | `/analytics/overview` | All-time totals for the dashboard (no date range) |
| GET | `/analytics/summary` | Totals, success rate, platform distribution, timeline, engagement |
| POST | `/analytics/refresh` | Fetch engagement numbers from the platforms |
| GET | `/notifications` | Notifications (paginated) |
| GET | `/notifications/unread-count` | Unread count |
| POST | `/notifications/:id/read` | Mark one as read |
| POST | `/notifications/read-all` | Mark all as read |
| DELETE | `/notifications/:id` | Delete one |
| GET | `/activity` | Your activity log |
| GET, POST | `/admin/users` | **Admin.** List (`q`, `role`, paging) or create users |
| GET, PATCH, DELETE | `/admin/users/:id` | **Admin.** View, change role or active flag, delete |
| GET | `/admin/stats` | **Admin.** System-wide statistics and scheduler status |
| GET | `/admin/activity` | **Admin.** System-wide activity log |
| POST | `/admin/maintenance/scheduler` | **Admin.** Run the scheduler now |
| POST | `/admin/maintenance/media-cleanup` | **Admin.** Delete unused media now |

Paginated list endpoints accept `page` (default 1) and `pageSize` (default 20, max 100), and return `items`, `total`, `page` and `pageSize`.

---

## System

### `GET /health` (Public)

```json
{ "success": true, "status": "ok", "version": "2.0.0", "environment": "production", "uptimeSeconds": 5230, "time": "2026-09-19T10:00:00.000Z", "checks": { "database": "ok" } }
```

Returns `503` with `"status": "degraded"` when the database is unreachable.

### `GET /cron/scheduler`

Runs one scheduler pass: it publishes due posts, recovers interrupted ones, refreshes expiring tokens and cleans up media. The request must include `Authorization: Bearer <CRON_SECRET>`, which Vercel Cron sends automatically.

```json
{ "success": true, "summary": { "source": "cron", "recovered": 0, "due": 2, "published": 2, "failed": 0, "retrying": 0, "posts": 1 } }
```

---

## Authentication endpoints

### `POST /auth/register` (Public)

```json
{ "name": "Ada Lovelace", "email": "ada@example.com", "password": "Str0ngPassword" }
```

Passwords need 8 to 128 characters; there are no character-type requirements. The first account created becomes `admin`. Returns `201`:

```json
{ "success": true, "user": { "id": 1, "email": "ada@example.com", "name": "Ada Lovelace", "role": "admin", "isActive": true, "timezone": null, "lastLoginAt": "...", "createdAt": "..." }, "token": "eyJhbGciOi..." }
```

Errors: `409` if the email is taken, `422` for invalid fields, `403` when registration is closed.

### `POST /auth/login` (Public)

```json
{ "email": "ada@example.com", "password": "Str0ngPassword" }
```

Returns the same shape as register. A wrong email or password gets `401 INVALID_CREDENTIALS`, with the same message either way. A disabled account gets `403`.

### `GET /auth/me`

```json
{ "success": true, "user": { "id": 1, "email": "ada@example.com", "name": "Ada Lovelace", "role": "admin", "isActive": true } }
```

---

## Profile

### `PUT /profile`

```json
{ "name": "Ada L.", "email": "ada@newmail.com", "timezone": "Asia/Colombo" }
```

### `POST /profile/password`

```json
{ "currentPassword": "Str0ngPassword", "newPassword": "EvenStr0nger1" }
```

This signs out every other session. The current session gets a new cookie.

### `PUT /profile/settings`

All fields are optional:

```json
{
  "aiProvider": "openai",
  "aiModel": "gpt-4o-mini",
  "apiKey": "sk-...",
  "clearApiKey": false,
  "defaultTone": "friendly",
  "allowEmojis": false,
  "notifyOnSuccess": true,
  "notifyOnFailure": true
}
```

Response (the key itself is never returned):

```json
{ "success": true, "settings": { "aiProvider": "openai", "aiModel": "gpt-4o-mini", "hasPersonalApiKey": true, "apiKeyHint": "sk-t••••cdef", "defaultTone": "friendly", "allowEmojis": false, "notifyOnSuccess": true, "notifyOnFailure": true } }
```

### `DELETE /profile`

Body: `{ "password": "..." }`. Returns `409` if you are the only active admin.

---

## Social accounts

### `GET /accounts`

```json
{
  "success": true,
  "accounts": [
    {
      "platform": "facebook",
      "label": "Facebook",
      "oauthConfigured": true,
      "status": "connected",
      "accountName": "Sunrise Cafe",
      "username": null,
      "avatarUrl": "https://...",
      "externalId": "1019610687906644",
      "tokenExpiresAt": null,
      "autoRefresh": false,
      "connectedAt": "2026-09-19T08:00:00.000Z",
      "lastCheckedAt": "2026-09-19T08:00:00.000Z",
      "lastError": null,
      "resourceLabel": "Page",
      "resource": { "id": "1019610687906644", "name": "Sunrise Cafe", "count": 2 }
    }
  ]
}
```

`status` is one of `connected`, `not_connected`, `expired` or `error`. Tokens are never included.

### `POST /accounts/:platform/connect`

```json
{ "success": true, "url": "https://www.facebook.com/v21.0/dialog/oauth?client_id=...&state=..." }
```

Send the browser to `url`. The provider redirects back to `GET /oauth/:platform/callback`. That callback checks the single-use `state` is bound to the signed-in user, exchanges the code, stores the encrypted tokens, then redirects to `/accounts.html?connected=facebook`. On failure it redirects to `/accounts.html?platform=facebook&error=<message>`.

Returns `503 OAUTH_NOT_CONFIGURED` if the platform's app credentials are not set on the server.

### `POST /accounts/:platform/token`

```json
{ "accessToken": "EAAB...", "refreshToken": "optional", "externalId": "optional Page ID / Instagram account ID" }
```

The server checks the token against the platform before saving it. Returns `{ "success": true, "account": { ... } }`.

### `POST /accounts/:platform/test`

```json
{ "success": true, "ok": true, "account": { "...": "..." }, "profile": { "name": "Sunrise Cafe", "followers": 1200 } }
```

If the platform rejects the token, the response is `{ "success": false, "ok": false, "error": "Facebook: Session has expired", "account": { "status": "expired" } }` with status `200`.

### `PUT /accounts/:platform/resources`

Body: `{ "id": "<page or board id>" }`. This chooses the Facebook Page or Pinterest board to publish to.

---

## Media

Accepted types are JPG, PNG, GIF, WEBP, MP4, MOV and WEBM. The type is checked from the file's content, not its name. Size limits come from `MEDIA_MAX_IMAGE_MB` and `MEDIA_MAX_VIDEO_MB`.

### `POST /media/upload` (multipart/form-data)

Field: `file`. Returns `201`:

```json
{ "success": true, "media": { "id": 7, "url": "https://res.cloudinary.com/.../photo.jpg", "thumbnailUrl": "https://...", "resourceType": "image", "mimeType": "image/jpeg", "format": "jpg", "sizeBytes": 248120, "width": 1080, "height": 1080, "duration": null, "originalName": "photo.jpg", "provider": "cloudinary", "createdAt": "..." } }
```

### Direct Cloudinary upload (large files, serverless hosting)

1. `POST /media/signature` with `{ "resourceType": "video" }` returns `{ "uploadUrl": "...", "fields": { "api_key": "...", "timestamp": 0, "folder": "...", "allowed_formats": "...", "signature": "..." }, "maxBytes": 104857600 }`.
2. POST the file and `fields` as multipart to `uploadUrl`, straight from the browser.
3. `POST /media/complete` with `{ "publicId", "version", "signature", "resourceType", "originalName" }` from Cloudinary's response. The server verifies the signature and file details, then returns `201 { "media": { ... } }`.

### `DELETE /media/:id`

Returns `409` if a draft or scheduled post still uses the media. Uploads that no post uses are deleted automatically after `MEDIA_UNUSED_TTL_HOURS` (default 24).

---

## Posts

### Post object

```json
{
  "id": 42,
  "title": "Autumn menu",
  "caption": "Our autumn menu is here.",
  "description": "",
  "hashtags": "#autumn #coffee",
  "mediaId": 7,
  "media": { "id": 7, "url": "...", "thumbnailUrl": "...", "resourceType": "image" },
  "status": "partial",
  "tone": "friendly",
  "platforms": ["facebook", "instagram"],
  "platformContent": { "instagram": { "caption": "Autumn is served. Link in bio." } },
  "scheduledAt": null,
  "publishedAt": "2026-09-19T09:00:02.000Z",
  "createdAt": "...",
  "updatedAt": "...",
  "targets": [
    { "id": 90, "platform": "facebook", "status": "success", "scheduledAt": null, "platformPostId": "1019_555", "platformUrl": "https://www.facebook.com/1019_555", "errorMessage": null, "errorCode": null, "attempts": 1, "lastAttemptAt": "...", "publishedAt": "..." },
    { "id": 91, "platform": "instagram", "status": "failed", "platformPostId": null, "errorMessage": "Instagram: The aspect ratio is not supported.", "errorCode": "PLATFORM_ERROR", "attempts": 1 }
  ],
  "attempts": [{ "id": 1, "targetId": 91, "platform": "instagram", "attemptNo": 1, "trigger": "now", "status": "failed", "errorMessage": "...", "durationMs": 2310, "createdAt": "..." }],
  "metrics": [{ "targetId": 90, "platform": "facebook", "views": 1200, "likes": 84, "comments": 12, "shares": 6, "saves": null, "fetchedAt": "..." }]
}
```

- **Post `status`:** `draft`, `scheduled`, `publishing`, `published` (every platform succeeded), `partial` (some failed), `failed` (all failed) or `cancelled`.
- **Target `status`:** `scheduled`, `processing`, `success`, `failed` or `cancelled`.
- **Attempt `trigger`:** `now`, `schedule`, `retry` or `run_now`.

`attempts` and `metrics` appear only in `GET /posts/:id`.

### `GET /posts`

Query parameters:

- `q`: searches the title, caption, description and hashtags.
- `status`: one status, or a comma list such as `failed,partial`.
- `platform`: a single platform.
- `from`, `to`: ISO dates, applied to the published date, else the scheduled date, else the created date.
- `sort`: `newest`, `oldest` or `scheduled`.
- `page`, `pageSize`.

Returns `{ "items": [Post], "total", "page", "pageSize", "totalPages" }`.

### `POST /posts`

```json
{
  "title": "Autumn menu",
  "caption": "Our autumn menu is here.",
  "hashtags": "autumn, coffee",
  "description": "",
  "mediaId": 7,
  "tone": "friendly",
  "platforms": ["facebook", "instagram", "youtube"],
  "platformContent": { "instagram": { "caption": "Autumn is served." }, "youtube": { "title": "Autumn menu tour" } },
  "action": "schedule",
  "scheduledAt": "2026-09-20T09:00:00.000Z",
  "schedules": { "youtube": "2026-09-20T12:00:00.000Z" }
}
```

- `action: "draft"` saves without publishing. A draft needs at least some text or media.
- `action: "publish"` publishes now and returns `201 { "post", "results": [{ "platform", "success", "platformPostId", "url", "error", "code", "attempts" }] }`. One platform failing never stops the others.
- `action: "schedule"` needs `scheduledAt` and/or a per-platform time in `schedules`. Each time must be between 1 minute and 12 months ahead.
- Before a publish or schedule is accepted, every platform is checked. A missing or expired connection, content that doesn't fit (such as YouTube without a video, or Instagram without media), or text over the length limit returns `422` with one `details` entry per problem, and nothing is saved.
- Hashtags are normalised to `#tag #tag`. Unknown fields are rejected.

### `PUT /posts/:id`

Same body as create, with `action` optional. It works for drafts, and for scheduled posts where no platform has started yet. `action: "draft"` on a scheduled post unschedules it. Published, failed and cancelled posts return `409`; duplicate them instead.

### `POST /posts/:id/publish`

Body: `{ "action": "publish" | "schedule", "scheduledAt"?, "schedules"?, "platforms"? }`. This publishes a saved draft as it is.

### `PATCH /posts/:id/schedule`

Body: `{ "scheduledAt": "..." }` or `{ "schedules": { "facebook": "..." } }`. Only platforms still waiting can be moved.

### `POST /posts/:id/retry`

Body: `{ "platforms": ["instagram"] }`, which is optional. The default is every failed platform. Platforms that already succeeded are never republished. Each platform can be attempted `PUBLISH_MAX_ATTEMPTS` times (default 5). After that the endpoint returns `409 RETRY_LIMIT_REACHED`.

```json
{ "success": true, "post": { "...": "..." }, "results": [{ "platform": "instagram", "success": true, "platformPostId": "1789...", "attempts": 2 }], "skipped": [] }
```

### `POST /posts/:id/run-now`, `POST /posts/:id/cancel`, `POST /posts/:id/duplicate`, `DELETE /posts/:id`

These return `409` when there is nothing to act on. For example, cancelling a post with nothing scheduled, or deleting a post while it is publishing.

### `GET /posts/calendar?from=&to=`

The range can be at most 62 days.

```json
{ "success": true, "events": [{ "postId": 42, "at": "2026-09-20T09:00:00.000Z", "title": "Autumn menu", "postStatus": "scheduled", "mediaId": 7, "targets": [{ "platform": "facebook", "status": "scheduled" }] }] }
```

---

## AI

### `POST /ai/generate`

```json
{ "platforms": ["instagram", "youtube"], "context": "Autumn menu launch, 3 new drinks", "tone": "friendly", "mediaId": 7 }
```

```json
{
  "success": true,
  "provider": "openai",
  "model": "gpt-4o-mini",
  "tone": "friendly",
  "content": {
    "instagram": { "caption": "...", "hashtags": "#autumn #coffee" },
    "youtube": { "title": "...", "description": "...", "hashtags": "#autumn" }
  }
}
```

The available tones are `professional`, `friendly`, `casual`, `humorous`, `inspirational`, `promotional` and `educational`. Emojis are stripped unless the user enables them in their settings.

### `POST /ai/rewrite`

```json
{ "platform": "tiktok", "field": "caption", "mode": "shorten", "currentText": "...", "context": "...", "tone": "casual" }
```

`field` is `caption`, `hashtags`, `title` or `description`, and must apply to the platform. `mode` is `regenerate`, `shorten`, `expand` or `rephrase`. The response is `{ "success": true, "text": "..." }`.

AI requests return `503 AI_NOT_CONFIGURED` when neither the user nor the server has an API key.

---

## Analytics

### `GET /analytics/summary?from=&to=`

The range defaults to the last 30 days.

```json
{
  "success": true,
  "range": { "from": "...", "to": "..." },
  "totals": { "posts": 15, "published": 8, "partial": 3, "failed": 3, "scheduled": 3, "drafts": 2, "cancelled": 0, "connectedAccounts": 3, "platformPublishes": 19, "platformFailures": 6, "successRate": 76 },
  "platforms": [{ "platform": "facebook", "total": 8, "success": 8, "failed": 0, "scheduled": 0, "other": 0 }],
  "timeline": [{ "date": "2026-09-19", "success": 3, "failed": 1 }],
  "engagement": {
    "byPlatform": [{ "platform": "instagram", "tracked": 4, "views": 3400, "likes": 310, "comments": 41, "shares": 21, "saves": 0 }],
    "totals": { "views": 10500, "likes": 434, "comments": 58, "shares": 30, "saves": 220 },
    "topPosts": [{ "postId": 2, "title": "Behind the scenes", "views": 4200, "likes": 350, "comments": 46, "shares": 24 }]
  }
}
```

`successRate` is successful platform attempts divided by successful plus failed attempts. It is `null` when there were none.

### `GET /analytics/overview`

The same `totals` object, counted over all time rather than a date range. This is what the dashboard shows.

```json
{ "success": true, "totals": { "posts": 15, "published": 8, "partial": 3, "failed": 3, "scheduled": 3, "drafts": 2, "cancelled": 0, "connectedAccounts": 3, "platformPublishes": 19, "platformFailures": 6, "successRate": 76 } }
```

### `POST /analytics/refresh`

This fetches engagement for up to 30 recent published targets, where each platform's API allows it.

```json
{ "success": true, "updated": 12, "unavailable": 3, "failed": 1, "errors": [{ "platform": "tiktok", "message": "..." }] }
```

---

## Notifications and activity

`GET /notifications?unread=1` returns `{ "items": [{ "id", "type", "title", "message", "link", "isRead", "createdAt", "readAt" }], "total", "unreadCount" }`.

The notification types are `publish_success`, `publish_failed`, `schedule_completed` and `connection_problem`.

`GET /activity?action=post` filters by an action prefix. The prefixes are `auth`, `account`, `post`, `schedule`, `settings`, `media`, `ai`, `analytics` and `admin`.

```json
{ "items": [{ "id": 1, "action": "post.publish", "entityType": "post", "entityId": "42", "details": { "results": [{ "platform": "facebook", "success": true }] }, "ip": "203.0.113.4", "createdAt": "..." }] }
```

---

## Admin

### `PATCH /admin/users/:id`

Body: `{ "role": "admin" | "user", "isActive": true | false, "name": "..." }`. Changing the role or disabling a user signs them out everywhere. Demoting, disabling or deleting the last active admin returns `409`.

### `POST /admin/users`

Body: `{ "name", "email", "password", "role" }`.

### `GET /admin/stats`

Returns the same data as `/analytics/summary` for all users, plus `users: { total, admins, active }`, `connectedAccounts` and `scheduler: { mode, intervalMs, running, lastRunAt, lastSummary }`.
