/**
 * WhatsApp Web client - transport only.
 * Connect, receive events, send text/media.
 * whatsapp-web.js is CommonJS; ESM must use default import then destructure.
 */

import path from "path";
import qrcode from "qrcode-terminal";
import pkg from "whatsapp-web.js";
import { logger } from "../lib/logger.js";

const { Client, LocalAuth, MessageMedia } = pkg;

export type ClientInstance = InstanceType<typeof Client>;

export interface WhatsAppClientConfig {
  dataDir: string;
  instanceId: string;
}

export interface InitializeWithRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const JITTER_MS = 500;

function delayWithJitter(baseMs: number, maxMs: number): number {
  const jitter = Math.random() * JITTER_MS;
  return Math.floor(Math.min(maxMs, baseMs + jitter));
}

function isRetryableInitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();
  if (lower.includes("execution context was destroyed")) return true;
  if (lower.includes("protocolerror") && lower.includes("timeout")) return true;
  if (err instanceof Error && err.name === "ProtocolError" && lower.includes("timeout")) return true;
  return false;
}

export async function initializeWithRetry(
  client: ClientInstance,
  log: typeof logger,
  options: InitializeWithRetryOptions = {}
): Promise<void> {
  const { maxAttempts = 10, baseDelayMs = 2000, maxDelayMs = 120_000 } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      log.info({ attempt, maxAttempts }, "WhatsApp client initialize attempt");
      await client.initialize();
      log.info("WhatsApp client ready");
      return;
    } catch (err) {
      if (!isRetryableInitError(err)) {
        throw err;
      }
      if (attempt === maxAttempts) {
        throw err;
      }
      const delay = delayWithJitter(
        Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt - 1)),
        maxDelayMs
      );
      log.warn(
        { err, attempt, maxAttempts, delayMs: delay },
        "WhatsApp initialize failed (retryable), retrying"
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export function createWhatsAppClient(config: WhatsAppClientConfig): ClientInstance {
  const clientOptions = {
    authStrategy: new LocalAuth({
      dataPath: path.join(config.dataDir, "wwebjs_auth"),
      clientId: config.instanceId,
    }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    },
    webCache: { type: "none" as const },
  };
  const client = new Client(clientOptions as ConstructorParameters<typeof Client>[0]);

  client.on("qr", (qr: string) => {
    logger.info("Scan QR with WhatsApp to authenticate");
    qrcode.generate(qr, { small: true });
  });

  client.on("ready", () => {
    logger.info("WhatsApp client ready");
  });

  client.on("auth_failure", (msg: string) => {
    logger.error({ msg }, "WhatsApp auth failure");
    process.exit(1);
  });

  return client;
}

export async function sendText(client: ClientInstance, chatId: string, text: string): Promise<void> {
  await client.sendMessage(chatId, text);
}

export async function sendMedia(
  client: ClientInstance,
  chatId: string,
  localPath: string,
  caption?: string
): Promise<void> {
  const media = MessageMedia.fromFilePath(localPath);
  await client.sendMessage(chatId, media, { caption: caption ?? "" });
}
