#!/usr/bin/env node
/**
 * ClawdBot WhatsApp Gateway - thin orchestrator.
 * Transport + reliability only; no business logic.
 */

import { loadConfig } from "./config/env.js";
import { createWhatsAppClient, initializeWithRetry } from "./whatsapp/client.js";
import { saveMedia } from "./media/storage.js";
import { openQueue, enqueue } from "./queue/queue.js";
import { runWorker, requestStop } from "./worker/worker.js";
import { logger } from "./lib/logger.js";
import { toMediaMetadata } from "./types/index.js";
import type { InboundRequest } from "./types/index.js";

async function main(): Promise<void> {
  const config = loadConfig();

  if (config.HOTBAGS_HMAC_DISABLED) {
    logger.warn(
      "HOTBAGS_HMAC_DISABLED=true: running with Bearer-only auth. HMAC is recommended for production."
    );
  }

  const db = openQueue(config.QUEUE_DB_PATH);

  const waClient = createWhatsAppClient({
    dataDir: config.DATA_DIR,
    instanceId: config.GATEWAY_INSTANCE_ID,
  });

  const hotbagsConfig = {
    ingestUrl: config.HOTBAGS_INGEST_URL,
    bearerToken: config.HOTBAGS_BEARER_TOKEN,
    hmacSecret: config.HOTBAGS_HMAC_SECRET,
  };

  waClient.on("message", async (msg: import("whatsapp-web.js").Message) => {
    if (msg.fromMe) return;

    const chatId = msg.from;
    const messageId = msg.id._serialized ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const from = msg.from;
    const timestamp = msg.timestamp ? msg.timestamp : Math.floor(Date.now() / 1000);
    const text = msg.body ?? undefined;

    let mediaStored: Awaited<ReturnType<typeof saveMedia>> = [];
    if (msg.hasMedia) {
      mediaStored = await saveMedia(messageId, msg, { dataDir: config.DATA_DIR });
    }

    const inboundRequest: InboundRequest = {
      message_id: messageId,
      chat_id: chatId,
      from,
      timestamp,
      text,
      media: mediaStored.length > 0 ? mediaStored.map(toMediaMetadata) : undefined,
    };

    enqueue(db, messageId, JSON.stringify(inboundRequest));
    logger.debug({ messageId, chatId }, "Enqueued inbound message");
  });

  process.on("SIGTERM", handleShutdown);
  process.on("SIGINT", handleShutdown);

  await initializeWithRetry(waClient, logger, {
    maxAttempts: 10,
    baseDelayMs: 2000,
    maxDelayMs: 120_000,
  });

  const workerPromise = runWorker(waClient, { db, hotbagsConfig });
  logger.info("Gateway running");

  async function handleShutdown() {
    logger.info("Shutting down...");
    requestStop();
    await workerPromise;
    process.exit(0);
  }
}

main().catch((err) => {
  logger.error({ err }, "Fatal error");
  process.exit(1);
});
