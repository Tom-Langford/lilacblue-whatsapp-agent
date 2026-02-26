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

    // Ignore group chats entirely
    if (msg.from.endsWith("@g.us")) {
      logger.debug({ from: msg.from }, "Ignoring message from group chat");
      return;
    }

    // Only process messages from allowed numbers (direct chats)
    let senderNumber: string;
    if (msg.from.endsWith("@lid")) {
      // WhatsApp uses @lid for some direct chats - resolve to phone number
      try {
        const results = await waClient.getContactLidAndPhone([msg.from]);
        const pn = results[0]?.pn ?? "";
        senderNumber = pn.replace(/@c\.us$/, "").replace(/\D/g, "");
        logger.debug({ from: msg.from, pn, senderNumber }, "LID resolved to phone");
      } catch (err) {
        logger.warn({ err, from: msg.from }, "Could not resolve LID to phone number");
        return;
      }
    } else {
      senderNumber = msg.from.replace(/@c\.us$/, "").replace(/\D/g, "");
    }
    if (!config.ALLOWED_PHONE_NUMBERS.has(senderNumber)) {
      logger.debug({ from: msg.from, senderNumber }, "Ignoring message from non-allowed number");
      return;
    }

    const messageId = msg.id._serialized ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    logger.info(
      { messageId, from: msg.from, hasMedia: msg.hasMedia, bodyPreview: msg.body?.slice(0, 80) },
      "Inbound WhatsApp message"
    );

    try {
      const chatId = msg.from;
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
    } catch (err) {
      logger.error({ err, messageId }, "Error processing inbound WhatsApp message");
    }
  });

  let workerPromise: Promise<void> = Promise.resolve();

  async function handleShutdown() {
    logger.info("Shutting down...");
    requestStop();
    await workerPromise;
    process.exit(0);
  }

  process.on("SIGTERM", handleShutdown);
  process.on("SIGINT", handleShutdown);

  await initializeWithRetry(waClient, logger, {
    maxAttempts: 10,
    baseDelayMs: 2000,
    maxDelayMs: 120_000,
  });

  workerPromise = runWorker(waClient, { db, hotbagsConfig });
  logger.info("Gateway running");
}

main().catch((err) => {
  logger.error({ err }, "Fatal error");
  process.exit(1);
});
