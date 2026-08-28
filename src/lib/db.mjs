import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "board.db");

// 既存テーブルに列が無ければ追加する (軽量マイグレーション)。
function ensureColumn(db, table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

/** @param {DatabaseSync} db */
export function initSchema(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS projects (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      collapsed   INTEGER NOT NULL DEFAULT 0,
      layout      TEXT NOT NULL DEFAULT 'card',
      manual_order INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS threads (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      thread_key  TEXT NOT NULL,
      port        INTEGER,
      current     TEXT,
      next        TEXT,
      memo        TEXT,
      done        INTEGER NOT NULL DEFAULT 0,
      starred     INTEGER NOT NULL DEFAULT 0,
      status      TEXT NOT NULL DEFAULT 'run',
      session_id  TEXT,
      worktree    TEXT,
      agent_name  TEXT,
      thread_auto INTEGER NOT NULL DEFAULT 0,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (project_id, thread_key)
    );

    CREATE INDEX IF NOT EXISTS idx_threads_project ON threads(project_id);
    DROP TABLE IF EXISTS messages;
  `);

  // 既存 DB 向けマイグレーション (新規 DB では CREATE 時点で存在)
  ensureColumn(db, "projects", "layout", "layout TEXT NOT NULL DEFAULT 'card'");
  ensureColumn(
    db,
    "projects",
    "manual_order",
    "manual_order INTEGER NOT NULL DEFAULT 0",
  );
  ensureColumn(db, "threads", "done", "done INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "threads", "starred", "starred INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "threads", "status", "status TEXT NOT NULL DEFAULT 'run'");
  ensureColumn(db, "threads", "session_id", "session_id TEXT");
  ensureColumn(db, "threads", "worktree", "worktree TEXT");
  ensureColumn(db, "threads", "agent_name", "agent_name TEXT");
  ensureColumn(
    db,
    "threads",
    "thread_auto",
    "thread_auto INTEGER NOT NULL DEFAULT 0",
  );
}

/** @returns {DatabaseSync} */
export function createInMemoryDb() {
  const db = new DatabaseSync(":memory:");
  initSchema(db);
  return db;
}

/** @type {DatabaseSync | undefined} */
let cached;

/** @returns {DatabaseSync} */
export function getDb() {
  if (cached) {
    return cached;
  }
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  const db = new DatabaseSync(DB_PATH);
  // ローカル単一プロセス向けに書き込みレイテンシを下げる (in-memory DB には不要)
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  initSchema(db);
  cached = db;
  return db;
}
