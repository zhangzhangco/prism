import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ServerConfig } from "./config.js";

export type Db = DatabaseSync;

/**
 * Schema migrations, applied in order. Each entry runs exactly once; the
 * applied version is recorded in the `schema_migrations` table.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    display_name  TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE api_tokens (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    created_at  TEXT NOT NULL,
    revoked_at  TEXT
  );
  CREATE INDEX idx_api_tokens_user ON api_tokens(user_id);

  CREATE TABLE canvases (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    document     TEXT NOT NULL,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );
  CREATE INDEX idx_canvases_user ON canvases(user_id, updated_at DESC);

  CREATE TABLE assets (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    canvas_id  TEXT REFERENCES canvases(id) ON DELETE CASCADE,
    mime       TEXT NOT NULL,
    filename   TEXT NOT NULL,
    bytes      INTEGER NOT NULL,
    width      INTEGER,
    height     INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_assets_canvas ON assets(canvas_id, created_at DESC);

  CREATE TABLE runs (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    canvas_id  TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
    node_id    TEXT NOT NULL,
    plugin_id  TEXT NOT NULL,
    status     TEXT NOT NULL,
    params     TEXT NOT NULL,
    error      TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_runs_canvas ON runs(canvas_id, created_at DESC);
  CREATE INDEX idx_runs_status ON runs(status);

  CREATE TABLE run_tasks (
    id        TEXT PRIMARY KEY,
    run_id    TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    key       TEXT NOT NULL,
    status    TEXT NOT NULL,
    assets    TEXT,
    text      TEXT,
    error     TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_run_tasks_run ON run_tasks(run_id);
  `,
  `
  ALTER TABLE run_tasks ADD COLUMN synthetic INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE runs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE runs ADD COLUMN recovered_at TEXT;
  `,
  `
  ALTER TABLE runs ADD COLUMN model_key TEXT NOT NULL DEFAULT '';
  ALTER TABLE runs ADD COLUMN inputs TEXT;
  `,
  `
  CREATE TABLE subjects (
    id                  TEXT PRIMARY KEY,
    user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind                TEXT NOT NULL,
    name                TEXT NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    tags                TEXT NOT NULL DEFAULT '[]',
    data                TEXT NOT NULL DEFAULT '{}',
    thumbnail_asset_id  TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
  );
  CREATE INDEX idx_subjects_user ON subjects(user_id, kind, name);
  `,
];

export function openDatabase(config: ServerConfig): Db {
  mkdirSync(dirname(config.databaseFile), { recursive: true });
  const db = new DatabaseSync(config.databaseFile);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);
  return db;
}

export function migrate(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = db
    .prepare("SELECT version FROM schema_migrations")
    .all()
    .map((row) => Number((row as { version: number }).version));
  const maxApplied = applied.length === 0 ? 0 : Math.max(...applied);

  for (let index = maxApplied; index < MIGRATIONS.length; index += 1) {
    const version = index + 1;
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[index]!);
      db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)").run(
        version,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
