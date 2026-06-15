import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "board.db");

/** @param {DatabaseSync} db */
export function initSchema(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS projects (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      collapsed   INTEGER NOT NULL DEFAULT 0,
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
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (project_id, thread_key)
    );

    CREATE INDEX IF NOT EXISTS idx_threads_project ON threads(project_id);
  `);
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
  initSchema(db);
  cached = db;
  return db;
}
