/**
 * Queue operations: enqueue, dequeue, ack, retry, outbound tracking.
 */

import Database from "better-sqlite3";
import { initSchema, STALE_MS } from "./schema.js";
import type { QueueJob } from "../types/index.js";

export function openQueue(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  initSchema(db);
  return db;
}

export function enqueue(
  db: Database.Database,
  messageId: string,
  payload: string
): void {
  const now = Date.now();
  db.prepare(
    `INSERT OR IGNORE INTO inbound_queue (message_id, payload, status, created_at, updated_at)
     VALUES (?, ?, 'PENDING', ?, ?)`
  ).run(messageId, payload, now, now);
}

export function recoverStaleProcessing(db: Database.Database): number {
  const now = Date.now();
  const cutoff = now - STALE_MS;
  const result = db.prepare(
    `UPDATE inbound_queue
     SET status = 'RETRY', next_attempt_at = ?
     WHERE status = 'PROCESSING' AND processing_started_at < ?`
  ).run(now, cutoff);
  return result.changes;
}

export function dequeue(db: Database.Database): QueueJob | null {
  recoverStaleProcessing(db);

  const now = Date.now();
  const row = db
    .prepare(
      `UPDATE inbound_queue
       SET status = 'PROCESSING', processing_started_at = ?, updated_at = ?
       WHERE id = (
         SELECT id FROM inbound_queue
         WHERE status = 'PENDING'
            OR (status = 'RETRY' AND next_attempt_at <= ?)
         ORDER BY created_at ASC
         LIMIT 1
       )
       RETURNING id, message_id, payload, status, attempt_count, next_attempt_at,
                 response_id, response_payload, processing_started_at, created_at, updated_at`
    )
    .get(now, now, now) as Row | undefined;

  if (!row) return null;
  return rowToJob(row);
}

interface Row {
  id: number;
  message_id: string;
  payload: string;
  status: string;
  attempt_count: number;
  next_attempt_at: number | null;
  response_id: string | null;
  response_payload: string | null;
  processing_started_at: number | null;
  created_at: number;
  updated_at: number;
}

function rowToJob(row: Row): QueueJob {
  return {
    id: row.id,
    message_id: row.message_id,
    payload: row.payload,
    status: row.status as QueueJob["status"],
    attempt_count: row.attempt_count,
    next_attempt_at: row.next_attempt_at,
    response_id: row.response_id,
    response_payload: row.response_payload,
    processing_started_at: row.processing_started_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function ack(
  db: Database.Database,
  id: number,
  responseId?: string,
  responsePayload?: string
): void {
  const now = Date.now();
  if (responseId !== undefined && responsePayload !== undefined) {
    db.prepare(
      `UPDATE inbound_queue SET status = 'DONE', response_id = ?, response_payload = ?, updated_at = ? WHERE id = ?`
    ).run(responseId, responsePayload, now, id);
  } else {
    db.prepare(
      `UPDATE inbound_queue SET status = 'DONE', updated_at = ? WHERE id = ?`
    ).run(now, id);
  }
}

export function retry(
  db: Database.Database,
  id: number,
  backoffMs: number,
  responseId?: string,
  responsePayload?: string
): void {
  const now = Date.now();
  const nextAttempt = now + backoffMs;
  if (responseId !== undefined && responsePayload !== undefined) {
    db.prepare(
      `UPDATE inbound_queue SET status = 'RETRY', attempt_count = attempt_count + 1, next_attempt_at = ?, response_id = ?, response_payload = ?, updated_at = ? WHERE id = ?`
    ).run(nextAttempt, responseId, responsePayload, now, id);
  } else {
    db.prepare(
      `UPDATE inbound_queue SET status = 'RETRY', attempt_count = attempt_count + 1, next_attempt_at = ?, updated_at = ? WHERE id = ?`
    ).run(nextAttempt, now, id);
  }
}

export function deadLetter(db: Database.Database, id: number): void {
  const now = Date.now();
  db.prepare(
    `UPDATE inbound_queue SET status = 'DEAD', updated_at = ? WHERE id = ?`
  ).run(now, id);
}

export function markOutboundSent(
  db: Database.Database,
  responseId: string,
  sendId: string
): void {
  db.prepare(
    `INSERT OR IGNORE INTO outbound_sent (response_id, send_id) VALUES (?, ?)`
  ).run(responseId, sendId);
}

export function wasOutboundSent(
  db: Database.Database,
  responseId: string,
  sendId: string
): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM outbound_sent WHERE response_id = ? AND send_id = ?`
    )
    .get(responseId, sendId);
  return !!row;
}
