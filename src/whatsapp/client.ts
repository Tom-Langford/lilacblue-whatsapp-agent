/**
 * WhatsApp Web client - transport only.
 * Connect, receive events, send text/media.
 * whatsapp-web.js is CommonJS; ESM must use default import then destructure.
 */

import fs from "fs";
import path from "path";
import QRCode from "qrcode";
import qrcode from "qrcode-terminal";
import pkg from "whatsapp-web.js";
import { logger } from "../lib/logger.js";

const { Client, LocalAuth, MessageMedia } = pkg;

export type ClientInstance = InstanceType<typeof Client>;

export interface WhatsAppClientConfig {
  dataDir: string;
  instanceId: string;
  pairingPhoneNumber?: string;
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
  if (lower.includes("the browser is already running")) return true;
  if (lower.includes("network.getresponsebody timed out")) return true;
  if (lower.includes("timed out after") && lower.includes("while waiting")) return true;
  return false;
}

export type CreateClientFn = () => ClientInstance;

export async function initializeWithRetry(
  createClient: CreateClientFn,
  log: typeof logger,
  options: InitializeWithRetryOptions = {}
): Promise<ClientInstance> {
  const { maxAttempts = 10, baseDelayMs = 2000, maxDelayMs = 120_000 } = options;
  let client = createClient();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      log.info({ attempt, maxAttempts }, "WhatsApp client initialize attempt");
      await client.initialize();
      log.info("WhatsApp client ready");
      return client;
    } catch (err) {
      if (!isRetryableInitError(err)) {
        throw err;
      }
      if (attempt === maxAttempts) {
        throw err;
      }
      try {
        await client.destroy();
      } catch {
        /* best-effort cleanup of orphaned Chrome */
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
      client = createClient();
    }
  }
  throw new Error("initializeWithRetry: unreachable");
}

export function createWhatsAppClient(config: WhatsAppClientConfig): ClientInstance {
  const clientOptions = {
    authStrategy: new LocalAuth({
      dataPath: path.join(config.dataDir, "wwebjs_auth"),
      clientId: config.instanceId,
    }),
    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage", // required on low-RAM VMs: /dev/shm is only 64MB, Chrome crashes without this
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      protocolTimeout: 300_000, // 5 min for resource-constrained VMs (Runtime.callFunctionOn, Network.getResponseBody)
    },
    webCache: { type: "none" as const },
  };
  const client = new Client(clientOptions as ConstructorParameters<typeof Client>[0]);

  // Phone-number pairing: request a pairing code instead of showing a QR
  if (config.pairingPhoneNumber) {
    const phoneNumber = config.pairingPhoneNumber;
    client.on("qr", async () => {
      try {
        const code = await client.requestPairingCode(phoneNumber);
        logger.info(
          { code },
          `╔══════════════════════════════════════╗`
        );
        logger.info(
          { code },
          `║  PAIRING CODE: ${code}               ║`
        );
        logger.info(
          { code },
          `╚══════════════════════════════════════╝`
        );
        logger.info("Enter this code on your phone: WhatsApp → Linked Devices → Link a Device → Link with phone number");
      } catch (err) {
        logger.error({ err }, "Failed to request pairing code");
      }
    });
  } else {
    client.on("qr", async (qr: string) => {
      logger.info("Scan QR with WhatsApp to authenticate");
      qrcode.generate(qr, { small: true });

      const qrPath = "/tmp/qr-latest.png";
      try {
        await QRCode.toFile(qrPath, qr, { type: "png", width: 400, margin: 2 });
        logger.info({ qrPath }, "QR code saved — run on your Mac: scp lilacblue-gateway:/tmp/qr-latest.png ~/Desktop/qr.png && open ~/Desktop/qr.png");
      } catch (err) {
        logger.warn({ err }, "Failed to write QR PNG (terminal QR still shown above)");
      }
    });
  }

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

function mimeFromUrl(url: string): string {
  const u = url.toLowerCase();
  if (u.includes(".jpg") || u.includes(".jpeg")) return "image/jpeg";
  if (u.includes(".png")) return "image/png";
  if (u.includes(".gif")) return "image/gif";
  if (u.includes(".webp")) return "image/webp";
  return "image/png";
}

export async function sendImage(client: ClientInstance, chatId: string, url: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Image fetch failed (${res.status}): ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const base64 = buffer.toString("base64");
  const mime = mimeFromUrl(url);
  const media = new MessageMedia(mime, base64);
  await client.sendMessage(chatId, media);
}
