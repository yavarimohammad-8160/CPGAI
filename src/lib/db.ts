import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const dataDir = path.join(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "cpgai.sqlite");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'گفتگوی جدید',
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    image TEXT,
    file_name TEXT,
    file_url TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(username, updated_at);
  CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at);
`);

try {
  db.exec("ALTER TABLE messages ADD COLUMN images TEXT");
} catch {
  /* already exists */
}

db.exec(`
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL DEFAULT '',
    scope TEXT NOT NULL DEFAULT 'user',
    topic TEXT NOT NULL DEFAULT 'chat',
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_mem_user ON memories(username, created_at);
  CREATE INDEX IF NOT EXISTS idx_mem_scope ON memories(scope, created_at);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS usage_events (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'chat',
    model TEXT NOT NULL DEFAULT '',
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    cost REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    meta TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_events(username, created_at);
  CREATE INDEX IF NOT EXISTS idx_usage_kind ON usage_events(kind, created_at);
  CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_events(created_at);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS message_feedback (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL DEFAULT '',
    conversation_id TEXT NOT NULL DEFAULT '',
    message_id TEXT NOT NULL DEFAULT '',
    rating TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    user_ask TEXT NOT NULL DEFAULT '',
    assistant_snippet TEXT NOT NULL DEFAULT '',
    substantive INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_feedback_user ON message_feedback(username, created_at);
  CREATE INDEX IF NOT EXISTS idx_feedback_rating ON message_feedback(rating, created_at);
`);

export default db;

export function nowIso() {
  return new Date().toISOString();
}

export function uid() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    "id-" + Date.now() + "-" + Math.random().toString(16).slice(2)
  );
}