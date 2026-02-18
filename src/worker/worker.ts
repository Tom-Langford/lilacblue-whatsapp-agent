/**
 * Worker: poll queue, retry, idempotency, outbound sends.
 */

import type { ClientInstance } from "../whatsapp/client.js";
import type Database from "better-sqlite3";
import {
  dequeue,
  ack,
  retry as queueRetry,
  deadLetter,
  markOutboundSent,
  wasOutboundSent,
} from "../queue/queue.js";
import { postInbound } from "../hotbags/client.js";
import type { HotBagsClientConfig } from "../hotbags/client.js";
import { sendText } from "../whatsapp/client.js";
import { calculate as backoff } from "../lib/backoff.js";
import { logger } from "../lib/logger.js";
import type { InboundRequest, InboundResponse } from "../types/index.js";

export interface WorkerConfig {
  db: Database.Database;
  hotbagsConfig: HotBagsClientConfig;
}

let stopRequested = false;

export function requestStop(): void {
  stopRequested = true;
}

export async function runWorker(
  waClient: ClientInstance,
  config: WorkerConfig
): Promise<void> {
  const { db, hotbagsConfig } = config;

  while (!stopRequested) {
    const job = dequeue(db);
    if (!job) {
      await sleep(1000);
      continue;
    }

    try {
      const payload = JSON.parse(job.payload) as InboundRequest;

      // Replay rule: if status=RETRY and response_payload exists, replay outbound only
      let response: InboundResponse;
      if (job.status === "RETRY" && job.response_payload) {
        response = JSON.parse(job.response_payload) as InboundResponse;
      } else {
        response = await postInbound(payload, hotbagsConfig);
      }

      if (!response.ok || !response.commands?.length) {
        if (!response.ok) {
          logger.error(
            { jobId: job.id, message_id: job.message_id, error: response.error },
            "Hot Bags returned ok: false"
          );
          deadLetter(db, job.id);
        } else {
          ack(db, job.id, job.message_id, JSON.stringify(response));
        }
        continue;
      }

      const chatId = payload.chat_id;
      const messageId = job.message_id;

      // Execute outbound sends (idempotent by command_id)
      let outboundFailed = false;
      for (const command of response.commands) {
        if (command.type !== "send_text") continue;

        if (wasOutboundSent(db, messageId, command.command_id)) {
          continue;
        }

        try {
          await sendText(waClient, chatId, command.text);
          markOutboundSent(db, messageId, command.command_id);
        } catch (err) {
          logger.warn(
            { err, message_id: messageId, command_id: command.command_id },
            "Outbound send failed, will retry"
          );
          queueRetry(
            db,
            job.id,
            backoff(job.attempt_count),
            messageId,
            JSON.stringify(response)
          );
          outboundFailed = true;
          break;
        }
      }

      if (!outboundFailed) {
        ack(db, job.id, messageId, JSON.stringify(response));
      }
    } catch (err) {
      const isRetriable = isRetriableError(err);
      if (isRetriable) {
        const delay = backoff(job.attempt_count);
        logger.warn(
          { err, jobId: job.id, message_id: job.message_id, delay },
          "Hot Bags POST failed, will retry"
        );
        queueRetry(db, job.id, delay);
      } else {
        logger.error(
          { err, jobId: job.id, message_id: job.message_id },
          "Non-retriable error, dead-lettering"
        );
        deadLetter(db, job.id);
      }
    }
  }
}

function isRetriableError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes("schema") || msg.includes("validation") || msg.includes("400")) {
      return false;
    }
    // Auth failures (401, 403) won't resolve with retries
    if (msg.includes("401") || msg.includes("403")) {
      return false;
    }
  }
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
