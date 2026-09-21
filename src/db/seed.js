// Creates the first administrator from ADMIN_EMAIL / ADMIN_PASSWORD when the
// users table is empty. Without them, the first person to register becomes admin.
const config = require("../config");
const logger = require("../lib/logger");

async function seed() {
  const users = require("../models/users");
  const { hashPassword } = require("../lib/password");
  if ((await users.count()) > 0) return;
  const { adminEmail, adminPassword, adminName } = config.auth;
  if (adminEmail && adminPassword) {
    await users.create({
      email: adminEmail,
      name: adminName,
      passwordHash: await hashPassword(adminPassword),
      role: "admin",
    });
    logger.info(`Created initial admin account ${adminEmail}`);
  } else if (!config.isTest) {
    logger.warn("No users exist yet. The first account registered will become the administrator.");
  }
}

module.exports = { seed };
