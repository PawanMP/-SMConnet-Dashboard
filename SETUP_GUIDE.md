# Setup and deployment guide

This guide covers configuring Social Poster for development and production, creating each platform's developer app, and deploying to Vercel. Every setting lives in environment variables (see `.env.example`); secrets never go in the code or the database in plain text.

## 1. Core settings

| Variable | Development | Production |
| --- | --- | --- |
| `NODE_ENV` | `development` | `production` (enables secure cookies, HSTS, strict checks and generic error messages) |
| `APP_URL` | `http://localhost:3000` | Your public HTTPS URL, e.g. `https://poster.example.com` |
| `JWT_SECRET` | Auto-generated | **Required.** At least 32 random characters |
| `ENCRYPTION_KEY` | Auto-generated | **Required.** 32 random bytes, base64 |
| `CRON_SECRET` | Optional | **Required on Vercel** for the scheduler endpoint |

Generate the secrets:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"   # JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"      # CRON_SECRET
```

Keep `ENCRYPTION_KEY` safe and stable. Changing it makes stored social tokens unreadable, and every user would have to reconnect.

In production the server refuses to start, and every request returns `503 MISCONFIGURED`, until the required settings are present. The response lists what is missing.

### The first administrator

Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` to create the administrator on first start. Without them, the first person to register becomes the administrator. Set `ALLOW_REGISTRATION=false` to let only admins create users.

## 2. Database (MySQL)

Production uses MySQL 8 or MariaDB 10.4 and later. Development falls back to SQLite automatically when no MySQL settings are present.

```env
DATABASE_URL=mysql://user:password@host:3306/social_poster
DB_SSL=true            # most hosted providers (PlanetScale, Aiven, TiDB Cloud, Railway) require TLS
```

or `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`.

Create an empty database, then apply the schema:

```bash
npm run db:migrate
```

Migrations are versioned and also run automatically on start-up. They are safe to run more than once.

**Local MySQL with XAMPP:** start MySQL in the XAMPP control panel, create a database (for example `CREATE DATABASE social_poster CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`), then set `DATABASE_URL=mysql://root@127.0.0.1:3306/social_poster`.

## 3. Media storage (Cloudinary)

Instagram and Pinterest download media from a public HTTPS URL, and serverless hosts can't keep uploaded files. So Cloudinary is required in production and for those two platforms.

1. Create a free account at <https://cloudinary.com>.
2. Copy the **API environment variable** from the dashboard into `CLOUDINARY_URL` (`cloudinary://KEY:SECRET@CLOUD_NAME`).

Browsers upload directly to Cloudinary with a short-lived signature, so large videos never pass through the server. Limits: `MEDIA_MAX_IMAGE_MB` (default 10) and `MEDIA_MAX_VIDEO_MB` (default 100).

Without Cloudinary, files are stored in `uploads/`. That is fine for testing Facebook, YouTube and TikTok locally.

## 4. Platform apps (OAuth)

Each platform needs a developer app. Register this redirect URI with every one of them:

```
{APP_URL}/api/oauth/{platform}/callback
```

For example, `https://poster.example.com/api/oauth/facebook/callback`. Use your real `APP_URL`; platforms compare the URI exactly.

If a platform's app isn't configured, users can still connect it with an access token from the platform's developer tools. That option is under "Connect with an access token instead" on the Accounts page.

### Facebook Pages

1. Create an app at <https://developers.facebook.com/apps> with the **Business** type, then add **Facebook Login for Business**.
2. Add the redirect URI under **Facebook Login > Settings > Valid OAuth Redirect URIs**.
3. Request these permissions: `pages_show_list`, `pages_manage_posts`, `pages_read_engagement` and `business_management`. Publishing for other people's Pages needs Meta App Review.
4. Set `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET` (from **App settings > Basic**).

After connecting, users choose which Page to publish to. Page tokens obtained this way don't expire.

### Instagram (professional accounts)

**Option A, Instagram Login (the Connect button):**

1. In the same Meta app, add the **Instagram API with Instagram Login** product.
2. Add the redirect URI. Request `instagram_business_basic` and `instagram_business_content_publish`.
3. Set `INSTAGRAM_APP_ID` and `INSTAGRAM_APP_SECRET`. These are the Instagram app ID and secret shown in that product, not the Facebook app ID.

These tokens last 60 days and are refreshed automatically.

**Option B, a Facebook token (for an Instagram account linked to a Facebook Page):** on the Accounts page, use "Connect with an access token instead". Paste a Page or user token (`EAA...`) that has `instagram_basic` and `instagram_content_publish`, plus the Instagram business account ID. These tokens can't be renewed automatically.

### YouTube

1. In <https://console.cloud.google.com>, create a project and enable **YouTube Data API v3**.
2. Configure the **OAuth consent screen**, and add the scopes `youtube.upload` and `youtube.readonly`.
3. Create **OAuth client ID** credentials of type **Web application**, and add the redirect URI.
4. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Optionally set `YOUTUBE_PRIVACY_STATUS` (`public`, `unlisted` or `private`).

While the consent screen is in **Testing**, only listed test users can connect, and refresh tokens expire after 7 days. Publish the app for long-term use.

### TikTok

1. Create an app at <https://developers.tiktok.com>, add **Login Kit** and **Content Posting API**, and enable **Direct Post**.
2. Add the redirect URI. Request `user.info.basic`, `video.publish`, `video.upload` and `video.list`.
3. Set `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET`.

Until TikTok audits the app, posts can only be private. Keep `TIKTOK_PRIVACY_LEVEL=SELF_ONLY`, then switch to `PUBLIC_TO_EVERYONE` after approval.

### Pinterest

1. Create an app at <https://developers.pinterest.com/apps>, and add the redirect URI.
2. Request `boards:read`, `boards:write`, `pins:read`, `pins:write` and `user_accounts:read`.
3. Set `PINTEREST_APP_ID` and `PINTEREST_APP_SECRET`.

New apps start with Trial access, which only works with the sandbox. Apply for Standard access to publish to real boards. For sandbox testing, set `PINTEREST_API_BASE=https://api-sandbox.pinterest.com`.

## 5. AI (optional)

Set `OPENAI_API_KEY` and/or `GEMINI_API_KEY` to give every user AI features. `AI_DEFAULT_PROVIDER` chooses which one is used first. Users can also add their own key on the AI settings page; it is stored encrypted and takes precedence over the server key.

## 6. Scheduler

- **Normal servers** (VPS, Docker, Render, Railway, `npm start`): a built-in timer checks for due posts every `SCHEDULER_INTERVAL_MS` (default 30 seconds). Nothing else is needed.
- **Vercel and other serverless hosts** can't run timers. Call `GET /api/cron/scheduler` with `Authorization: Bearer <CRON_SECRET>`:
  - **Vercel Pro:** change the schedule in `vercel.json` to `* * * * *` (every minute).
  - **Vercel Hobby** allows only one cron run per day, so the included `vercel.json` runs daily. Use a free external service such as cron-job.org, set to call the URL every minute with that header.

Schedules survive restarts because they are stored in the database. When the scheduler runs:

- Posts that became due while the server was down are published, unless they were missed by more than `SCHEDULER_MAX_LATENESS_HOURS` (default 24).
- Temporary platform errors are retried automatically, up to `SCHEDULER_AUTO_RETRY_LIMIT` times.
- A publish interrupted by a crash is marked failed rather than repeated, so nothing is posted twice.

## 7. Deploying to Vercel

1. Push the `facebook` folder to GitHub and import it in Vercel. The project root is the folder containing `package.json`.
2. Add the environment variables: `NODE_ENV=production`, `APP_URL`, `JWT_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`, the MySQL settings, `CLOUDINARY_URL`, and your platform and AI keys.
3. Deploy, then run `npm run db:migrate` once against the production database. Migrations also run automatically on first request.
4. Open `{APP_URL}/api/health`. It should report `"database": "ok"`.
5. Register the redirect URIs from section 4 with each platform, using the production `APP_URL`.
6. Set up the scheduler as described in section 6.

`vercel.json` serves the frontend from Vercel's CDN (with security headers) and routes everything else to the Express function in `api/index.js`, with a 60-second limit.

## 8. Moving from the old single-user version

The old version kept one set of tokens in `config.json`, which was committed to git. To carry the credentials over:

```bash
npm run import:legacy -- you@example.com            # register the account first
```

Then, on the Accounts page, choose **Test connection** for each platform. Afterwards:

1. Delete `config.json` from the project.
2. Remove it from the repository history, for example with `git filter-repo --path config.json --invert-paths`, and force-push.
3. **Rotate every token and key it contained.** Assume they are compromised: generate new Facebook and Instagram tokens, revoke the Google token, and create a new OpenAI key.

## 9. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `503 MISCONFIGURED` | The response lists missing variables. Add them and redeploy. |
| "Sign-in is not set up on this server yet" | That platform's app ID or secret isn't set. |
| OAuth error "redirect_uri mismatch" | Register exactly `{APP_URL}/api/oauth/{platform}/callback` and check `APP_URL`. |
| Instagram/Pinterest: "media must be hosted at a public HTTPS URL" | Configure Cloudinary. |
| Account shows **Token expired** | Choose **Reconnect**. Meta tokens can't be renewed without the user. |
| Scheduled posts don't go out on Vercel | Set up the cron call (section 6) and check `CRON_SECRET`. |
| Errors in production show only a request ID | Search the server logs for that `requestId`. |
