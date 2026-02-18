/**
 * SQLite schema for durable queue.
 */

import Database from "better-sqlite3";

const STALE_MS = 120_000; // 2 minutes

export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inbound_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT UNIQUE NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER,
      response_id TEXT,
      response_payload TEXT,
      processing_started_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS outbound_sent (
      response_id TEXT NOT NULL,
      send_id TEXT NOT NULL,
      PRIMARY KEY (response_id, send_id)
    );

    CREATE INDEX IF NOT EXISTS idx_inbound_queue_dequeue
      ON inbound_queue(created_at)
      WHERE status IN ('PENDING', 'RETRY');
  `);
}

export { STALE_MS };
