// Versioned schema migrations written once and rendered for MySQL or SQLite.
// Add new migrations to the end of the list; never edit an applied one.

const TYPES = {
  mysql: {
    ID: "BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY",
    REF: "BIGINT UNSIGNED",
    DATETIME: "DATETIME",
    BOOL: "TINYINT(1)",
    BIGINT: "BIGINT",
    REAL: "DOUBLE",
    LONGTEXT: "MEDIUMTEXT",
    TABLE_OPTS: " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
  },
  sqlite: {
    ID: "INTEGER PRIMARY KEY AUTOINCREMENT",
    REF: "INTEGER",
    DATETIME: "TEXT",
    BOOL: "INTEGER",
    BIGINT: "INTEGER",
    REAL: "REAL",
    LONGTEXT: "TEXT",
    TABLE_OPTS: "",
  },
};

function render(sql, dialect) {
  return sql.replace(/\{\{(\w+)\}\}/g, (_, token) => {
    const value = TYPES[dialect][token];
    if (value === undefined) throw new Error(`Unknown migration token ${token}`);
    return value;
  });
}

const migrations = [
  {
    version: 1,
    name: "initial schema",
    statements: [
      `CREATE TABLE users (
        id {{ID}},
        email VARCHAR(255) NOT NULL,
        name VARCHAR(100) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'user',
        is_active {{BOOL}} NOT NULL DEFAULT 1,
        token_version INT NOT NULL DEFAULT 0,
        timezone VARCHAR(64) NULL,
        last_login_at {{DATETIME}} NULL,
        created_at {{DATETIME}} NOT NULL,
        updated_at {{DATETIME}} NOT NULL,
        UNIQUE (email)
      ){{TABLE_OPTS}}`,

      `CREATE TABLE user_settings (
        user_id {{REF}} NOT NULL PRIMARY KEY,
        ai_provider VARCHAR(20) NULL,
        ai_model VARCHAR(100) NULL,
        ai_api_key_enc TEXT NULL,
        default_tone VARCHAR(30) NULL,
        allow_emojis {{BOOL}} NOT NULL DEFAULT 0,
        notify_on_success {{BOOL}} NOT NULL DEFAULT 1,
        notify_on_failure {{BOOL}} NOT NULL DEFAULT 1,
        updated_at {{DATETIME}} NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ){{TABLE_OPTS}}`,

      `CREATE TABLE social_accounts (
        id {{ID}},
        user_id {{REF}} NOT NULL,
        platform VARCHAR(20) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'connected',
        external_id VARCHAR(191) NULL,
        account_name VARCHAR(255) NULL,
        account_username VARCHAR(255) NULL,
        avatar_url TEXT NULL,
        access_token_enc TEXT NULL,
        refresh_token_enc TEXT NULL,
        token_expires_at {{DATETIME}} NULL,
        refresh_expires_at {{DATETIME}} NULL,
        scopes TEXT NULL,
        metadata {{LONGTEXT}} NULL,
        last_error TEXT NULL,
        last_checked_at {{DATETIME}} NULL,
        connected_at {{DATETIME}} NULL,
        created_at {{DATETIME}} NOT NULL,
        updated_at {{DATETIME}} NOT NULL,
        UNIQUE (user_id, platform),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ){{TABLE_OPTS}}`,

      `CREATE TABLE oauth_states (
        state VARCHAR(128) NOT NULL PRIMARY KEY,
        user_id {{REF}} NOT NULL,
        platform VARCHAR(20) NOT NULL,
        code_verifier VARCHAR(255) NULL,
        created_at {{DATETIME}} NOT NULL,
        expires_at {{DATETIME}} NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ){{TABLE_OPTS}}`,

      `CREATE TABLE media (
        id {{ID}},
        user_id {{REF}} NOT NULL,
        provider VARCHAR(20) NOT NULL,
        storage_key VARCHAR(512) NOT NULL,
        url TEXT NOT NULL,
        resource_type VARCHAR(10) NOT NULL,
        mime_type VARCHAR(100) NULL,
        format VARCHAR(20) NULL,
        size_bytes {{BIGINT}} NOT NULL DEFAULT 0,
        width INT NULL,
        height INT NULL,
        duration {{REAL}} NULL,
        original_name VARCHAR(255) NULL,
        created_at {{DATETIME}} NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ){{TABLE_OPTS}}`,

      `CREATE TABLE posts (
        id {{ID}},
        user_id {{REF}} NOT NULL,
        title VARCHAR(255) NULL,
        caption TEXT NULL,
        description TEXT NULL,
        hashtags TEXT NULL,
        media_id {{REF}} NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'draft',
        tone VARCHAR(30) NULL,
        platforms TEXT NULL,
        platform_content {{LONGTEXT}} NULL,
        scheduled_at {{DATETIME}} NULL,
        published_at {{DATETIME}} NULL,
        created_at {{DATETIME}} NOT NULL,
        updated_at {{DATETIME}} NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (media_id) REFERENCES media(id) ON DELETE SET NULL
      ){{TABLE_OPTS}}`,

      `CREATE TABLE post_targets (
        id {{ID}},
        post_id {{REF}} NOT NULL,
        user_id {{REF}} NOT NULL,
        platform VARCHAR(20) NOT NULL,
        social_account_id {{REF}} NULL,
        status VARCHAR(20) NOT NULL,
        scheduled_at {{DATETIME}} NULL,
        platform_post_id VARCHAR(255) NULL,
        platform_url TEXT NULL,
        error_message TEXT NULL,
        error_code VARCHAR(100) NULL,
        attempts INT NOT NULL DEFAULT 0,
        last_attempt_at {{DATETIME}} NULL,
        published_at {{DATETIME}} NULL,
        locked_at {{DATETIME}} NULL,
        lock_token VARCHAR(64) NULL,
        created_at {{DATETIME}} NOT NULL,
        updated_at {{DATETIME}} NOT NULL,
        UNIQUE (post_id, platform),
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (social_account_id) REFERENCES social_accounts(id) ON DELETE SET NULL
      ){{TABLE_OPTS}}`,

      `CREATE TABLE publish_attempts (
        id {{ID}},
        target_id {{REF}} NOT NULL,
        post_id {{REF}} NOT NULL,
        user_id {{REF}} NOT NULL,
        platform VARCHAR(20) NOT NULL,
        attempt_no INT NOT NULL,
        trigger_type VARCHAR(20) NOT NULL,
        status VARCHAR(20) NOT NULL,
        platform_post_id VARCHAR(255) NULL,
        error_message TEXT NULL,
        duration_ms INT NULL,
        created_at {{DATETIME}} NOT NULL,
        FOREIGN KEY (target_id) REFERENCES post_targets(id) ON DELETE CASCADE,
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ){{TABLE_OPTS}}`,

      `CREATE TABLE post_metrics (
        id {{ID}},
        target_id {{REF}} NOT NULL,
        post_id {{REF}} NOT NULL,
        user_id {{REF}} NOT NULL,
        platform VARCHAR(20) NOT NULL,
        views {{BIGINT}} NULL,
        likes {{BIGINT}} NULL,
        comments {{BIGINT}} NULL,
        shares {{BIGINT}} NULL,
        saves {{BIGINT}} NULL,
        raw {{LONGTEXT}} NULL,
        fetched_at {{DATETIME}} NOT NULL,
        FOREIGN KEY (target_id) REFERENCES post_targets(id) ON DELETE CASCADE,
        FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ){{TABLE_OPTS}}`,

      `CREATE TABLE notifications (
        id {{ID}},
        user_id {{REF}} NOT NULL,
        type VARCHAR(40) NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT NULL,
        link VARCHAR(512) NULL,
        is_read {{BOOL}} NOT NULL DEFAULT 0,
        created_at {{DATETIME}} NOT NULL,
        read_at {{DATETIME}} NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ){{TABLE_OPTS}}`,

      `CREATE TABLE activity_logs (
        id {{ID}},
        user_id {{REF}} NULL,
        action VARCHAR(60) NOT NULL,
        entity_type VARCHAR(40) NULL,
        entity_id VARCHAR(64) NULL,
        details {{LONGTEXT}} NULL,
        ip VARCHAR(64) NULL,
        user_agent VARCHAR(255) NULL,
        created_at {{DATETIME}} NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      ){{TABLE_OPTS}}`,

      `CREATE TABLE app_state (
        name VARCHAR(64) NOT NULL PRIMARY KEY,
        value TEXT NULL,
        updated_at {{DATETIME}} NOT NULL
      ){{TABLE_OPTS}}`,

      "CREATE INDEX idx_accounts_status ON social_accounts (status, token_expires_at)",
      "CREATE INDEX idx_oauth_states_expires ON oauth_states (expires_at)",
      "CREATE INDEX idx_media_user ON media (user_id, created_at)",
      "CREATE INDEX idx_posts_user_status ON posts (user_id, status)",
      "CREATE INDEX idx_posts_user_created ON posts (user_id, created_at)",
      "CREATE INDEX idx_targets_due ON post_targets (status, scheduled_at)",
      "CREATE INDEX idx_targets_user_platform ON post_targets (user_id, platform, status)",
      "CREATE INDEX idx_attempts_target ON publish_attempts (target_id)",
      "CREATE INDEX idx_metrics_target ON post_metrics (target_id, fetched_at)",
      "CREATE INDEX idx_notifications_user ON notifications (user_id, is_read, created_at)",
      "CREATE INDEX idx_activity_user ON activity_logs (user_id, created_at)",
      "CREATE INDEX idx_activity_action ON activity_logs (action, created_at)",
    ],
  },
  {
    version: 2,
    name: "post thumbnails",
    statements: [
      "ALTER TABLE posts ADD COLUMN thumbnail_media_id {{REF}} NULL",
    ],
  },
];

async function migrate(driver, logger) {
  await driver.exec(
    render(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version INT NOT NULL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at {{DATETIME}} NOT NULL
      ){{TABLE_OPTS}}`,
      driver.dialect
    )
  );
  const applied = new Set((await driver.all("SELECT version FROM schema_migrations")).map((r) => Number(r.version)));
  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    logger && logger.info(`Applying migration ${m.version}: ${m.name}`);
    // MySQL auto-commits DDL, so a failed migration can leave partial tables;
    // each statement is still run in order and recorded only on full success.
    for (const statement of m.statements) {
      await driver.exec(render(statement, driver.dialect));
    }
    await driver.run("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)", [
      m.version,
      m.name,
      new Date().toISOString().slice(0, 19).replace("T", " "),
    ]);
  }
}

module.exports = { migrate, migrations, render };
