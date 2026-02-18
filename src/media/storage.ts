/**
 * Save media to disk, compute hash, return metadata.
 * Gateway uses local_path internally; Hot Bags gets MediaMetadata only.
 */

import fs from "fs/promises";
import path from "path";
import { sha256Hex } from "../lib/hash.js";
import { logger } from "../lib/logger.js";
import type { MediaStored } from "../types/index.js";

export interface SaveMediaOptions {
  dataDir: string;
}

export async function saveMedia(
  messageId: string,
  rawMediaMessage: { hasMedia: boolean; downloadMedia: () => Promise<{ data: string; mimetype: string; filename?: string | null }> },
  options: SaveMediaOptions
): Promise<MediaStored[]> {
  if (!rawMediaMessage.hasMedia) return [];

  const mediaDir = path.join(options.dataDir, "media");
  await fs.mkdir(mediaDir, { recursive: true, mode: 0o750 });

  const media = await rawMediaMessage.downloadMedia();
  if (!media) return [];

  const buffer = Buffer.from(media.data, "base64");
  const sha256 = sha256Hex(buffer);
  const ext = media.mimetype.split("/")[1] ?? "bin";
  const filename = media.filename ?? `media_${messageId}.${ext}`;
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const localPath = path.join(mediaDir, `${messageId}_${safeFilename}`);

  await fs.writeFile(localPath, buffer, { mode: 0o640 });

  const result: MediaStored = {
    mime: media.mimetype,
    filename: media.filename ?? undefined,
    size: buffer.length,
    sha256,
    local_path: localPath,
  };

  logger.debug({ messageId, localPath, mime: media.mimetype }, "Saved media");
  return [result];
}
