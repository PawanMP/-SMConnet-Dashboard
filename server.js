// Entry point. Locally it starts an HTTP server and the scheduler; on Vercel
// the exported app is used as a serverless function.
require("dotenv").config({ quiet: true });

const config = require("./src/config");
const logger = require("./src/lib/logger");
const db = require("./src/db");
const scheduler = require("./src/services/scheduler");
const { createApp } = require("./src/app");

const app = createApp();

async function main() {
  const problems = config.validate();
  if (problems.length) {
    for (const p of problems) logger.error(`Configuration error: ${p}`);
    process.exit(1);
  }
  await db.ready();
  const server = app.listen(config.port, () => {
    logger.info(`Social Poster running at ${config.appUrl} (${config.env}, ${config.db.client}, media: ${config.media.provider})`);
  });
  scheduler.start();

  const shutdown = (signal) => {
    logger.info(`${signal} received, shutting down`);
    scheduler.stop();
    server.close(async () => {
      await db.close().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

if (require.main === module && !config.isVercel) {
  main().catch((err) => {
    logger.error("Failed to start", { err });
    process.exit(1);
  });
}

module.exports = app;
