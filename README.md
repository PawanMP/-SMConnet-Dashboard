# Social Poster

A multi-user dashboard for publishing to Facebook, Instagram, YouTube, TikTok and Pinterest from one place: compose once, adapt per platform, publish now or schedule, retry failures, and track results.

## Features

- **Accounts and security.** Registration and sign-in with scrypt-hashed passwords. JWT sessions in httpOnly cookies. Admin and user roles, rate limiting, CSP and other secure headers, and CSRF protection.
- **Per-user social accounts.** Each user connects their own platforms through OAuth (or an access token), with automatic token refresh where the platform supports it. Tokens are encrypted with AES-256-GCM and never reach the browser.
- **Composer.**
  - Direct-to-Cloudinary media upload with progress.
  - Shared text with per-platform overrides.
  - A live checklist of anything a platform would reject.
  - AI captions, hashtags, titles and descriptions (OpenAI or Gemini) in a chosen tone.
- **Publishing.** Every platform succeeds or fails on its own. Retries only touch the platforms that failed, and every attempt is recorded.
- **Scheduling.** Schedules are stored in the database (MySQL in production). The scheduler catches up after a restart, recovers interrupted jobs safely, and retries temporary errors automatically. It also has a cron endpoint for serverless hosting.
- **History, drafts, calendar and analytics.**
  - Post history has search, filters and pagination.
  - The calendar has month and week views.
  - The analytics dashboard shows success rate, platform distribution, daily outcomes and engagement.
- **Notifications and activity log.** In-app notifications cover publish results, completed schedules and connection problems. A full activity log records sign-ins, connections, publishing and settings changes.
- **Admin panel.** User management, system statistics, system-wide activity and maintenance jobs.

## Quick start (local)

Requires Node.js 22.13 or newer. Node 24 is recommended.

```bash
cd facebook
npm install
cp .env.example .env        # optional for a first look; see SETUP_GUIDE.md
npm run dev                 # http://localhost:3000
```

Without any configuration the app uses a local SQLite database (`data/app.db`), stores uploads in `uploads/`, and generates development secrets in `data/.dev-secrets.json`. The first account you register becomes the administrator.

To publish for real you need at least one platform app (see [SETUP_GUIDE.md](SETUP_GUIDE.md)). Instagram and Pinterest also need Cloudinary, because they download media from a public URL.

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Start the server |
| `npm run dev` | Start with auto-reload (nodemon) |
| `npm test` | Run the automated tests (SQLite, in memory) |
| `TEST_MYSQL_URL=mysql://root:pass@127.0.0.1:3306 npm test` | Run the same tests against MySQL/MariaDB |
| `npm run db:migrate` | Apply database migrations (run on each production deploy) |
| `npm run import:legacy -- you@example.com` | Import the old single-user `config.json` into a user account |

## Project layout

```
server.js               Entry point (HTTP server + scheduler); also exported for Vercel
api/index.js            Vercel serverless entry (same app)
src/
  app.js                Express app: security middleware, routes, static files, error handler
  config/               All environment variables, validated at start-up
  db/                   MySQL / SQLite drivers, versioned migrations, admin seed
  lib/                  Errors, logging, encryption, passwords, JWT, validation, HTTP client
  middleware/           Authentication, roles, CSRF, rate limits, secure headers, error handling
  models/               Data access (users, accounts, posts and targets, media, notifications, ...)
  services/
    platforms/          One adapter per platform: OAuth, token refresh, publish, metrics
    publisher.js        Per-platform publishing, partial success, retries, attempt history
    scheduler.js        Due posts, restart recovery, auto-retry, maintenance
    ai.js, analytics.js, media.js, tokens.js, oauth.js, posts.js, ...
  routes/               HTTP endpoints (see docs/API.md)
public/                 Frontend (plain HTML, CSS and ES modules; no build step)
tests/                  node:test + supertest suites
docs/API.md             API reference
```

## Documentation

- [SETUP_GUIDE.md](SETUP_GUIDE.md): configuration, platform app setup, MySQL, Cloudinary, deployment to Vercel.
- [docs/API.md](docs/API.md): every endpoint, with request and response examples, authentication and error codes.
