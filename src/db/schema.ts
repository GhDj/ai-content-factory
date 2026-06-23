import Database from 'better-sqlite3';
import fs from 'fs-extra';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'output', 'content.db');

fs.ensureDirSync(path.dirname(DB_PATH));

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS topics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    source TEXT NOT NULL,
    url TEXT,
    viral_angle TEXT,
    hook_idea TEXT,
    target_emotion TEXT DEFAULT 'curiosity',
    score INTEGER DEFAULT 0,
    used INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS scripts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topic_id INTEGER REFERENCES topics(id),
    platform TEXT NOT NULL,
    hook TEXT NOT NULL,
    script_text TEXT NOT NULL,
    voice_script TEXT NOT NULL,
    caption TEXT NOT NULL,
    hashtags TEXT NOT NULL,
    thumbnail_text TEXT NOT NULL,
    duration_seconds INTEGER,
    approved INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS audio_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    script_id INTEGER REFERENCES scripts(id),
    file_path TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Migrations — idempotent ALTERs for columns added after initial release
const migrations = [
  `ALTER TABLE topics ADD COLUMN target_emotion TEXT DEFAULT 'curiosity'`,
  `ALTER TABLE topics ADD COLUMN pillar TEXT DEFAULT 'manipulation'`,
  `ALTER TABLE scripts ADD COLUMN youtube_url TEXT`,
  `ALTER TABLE scripts ADD COLUMN tiktok_publish_id TEXT`,
  `ALTER TABLE scripts ADD COLUMN published_at TEXT`,
  `ALTER TABLE scripts ADD COLUMN viral_score INTEGER`,
  `ALTER TABLE scripts ADD COLUMN viral_verdict TEXT`,
  `ALTER TABLE scripts ADD COLUMN viral_reason TEXT`,
  `ALTER TABLE scripts ADD COLUMN series_id TEXT`,
  `ALTER TABLE scripts ADD COLUMN episode_number INTEGER`,
];
for (const sql of migrations) {
  try { db.exec(sql); } catch { /* column already exists */ }
}
