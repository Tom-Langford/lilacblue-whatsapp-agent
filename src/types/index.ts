/**
 * Shared domain models. Prevents cross-layer coupling.
 */

/** Internal representation of inbound WhatsApp message */
export interface NormalizedEvent {
  message_id: string;
  chat_id: string;
  from: string;
  timestamp: number;
  text?: string;
  media?: MediaStored[];
}

/** Internal: media with local_path for gateway outbound send */
export interface MediaStored {
  mime: string;
  filename?: string;
  size?: number;
  sha256?: string;
  local_path: string;
  url?: string;
}

/** For Hot Bags: metadata only, no local_path */
export interface MediaMetadata {
  mime: string;
  filename?: string;
  size?: number;
  sha256?: string;
  url?: string;
}

/** Queue row shape */
export interface QueueJob {
  id: number;
  message_id: string;
  payload: string;
  status: "PENDING" | "PROCESSING" | "RETRY" | "DONE" | "DEAD";
  attempt_count: number;
  next_attempt_at: number | null;
  response_id: string | null;
  response_payload: string | null;
  processing_started_at: number | null;
  created_at: number;
  updated_at: number;
}

/** Documents outbound_sent table: (response_id, send_id) = (message_id, command_id) */
export interface OutboundSendRecord {
  response_id: string;
  send_id: string;
}

/** JSON contract to Hot Bags */
export interface InboundRequest {
  message_id: string;
  chat_id: string;
  from: string;
  timestamp: number;
  text?: string;
  media?: MediaMetadata[];
}

/** JSON contract from Hot Bags */
export interface InboundResponse {
  ok: boolean;
  commands?: Array<{
    command_id: string;
    type: "send_text";
    text: string;
  }>;
  error?: string;
  issues?: unknown[];
}

/** Map MediaStored to MediaMetadata (omit local_path) */
export function toMediaMetadata(stored: MediaStored): MediaMetadata {
  return {
    mime: stored.mime,
    filename: stored.filename,
    size: stored.size,
    sha256: stored.sha256,
    url: stored.url,
  };
}
