// Applies database migrations (and the optional admin seed) then exits.
// Run once per deployment against the production database:
//   npm run db:migrate
require("dotenv").config({ quiet: true });
const config = require("../src/config");
const db = require("../src/db");

(async () => {
  const problems = config.validate();
  if (problems.length) {
    for (const p of problems) console.error(`Configuration error: ${p}`);
    process.exit(1);
  }
  await db.ready();
  const rows = await db.all("SELECT version, name, applied_at FROM schema_migrations ORDER BY version");
  for (const r of rows) console.log(`migration ${r.version} (${r.name}) applied ${r.applied_at}`);
  await db.close();
  console.log(`Database is up to date (${config.db.client}).`);
})().catch((err) => {
  console.error("Migration failed:", err.message);
  process.exit(1);
});
