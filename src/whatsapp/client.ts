/**
 * WhatsApp Web client - transport only.
 * Connect, receive events, send text/media.
 * Uses createRequire for ESM/CJS interop (whatsapp-web.js is CommonJS).
 */

import { createRequire } from "module";
import path from "path";
import qrcode from "qrcode-terminal";
import { logger } from "../lib/logger.js";

const require = createRequire(import.meta.url);
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");

export type ClientInstance = InstanceType<typeof Client>;

export interface WhatsAppClientConfig {
  dataDir: string;
  instanceId: string;
}

export function createWhatsAppClient(config: WhatsAppClientConfig): ClientInstance {
  const authPath = path.join(config.dataDir, "wwebjs_auth");
  const puppeteerOpts: { args: string[]; executablePath?: string } = {
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  };
  const execPath = process.env.PUPPETEER_EXECUTABLE_PATH;
  if (execPath) {
    puppeteerOpts.executablePath = execPath;
  }

  const client = new Client({
    authStrategy: new LocalAuth({
      dataPath: authPath,
      clientId: config.instanceId,
    }),
    puppeteer: puppeteerOpts,
  });

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
