import { createClient } from "@supabase/supabase-js";

type SupabaseUploadConfig = {
  url: string;
  serviceRoleKey: string;
  bucket: string;
};

function extFromMime(mime: string) {
  const m = (mime || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("pdf")) return "pdf";
  if (m.includes("heic")) return "heic";
  // default to jpg-ish for images if unknown
  if (m.startsWith("image/")) return "jpg";
  return "bin";
}

export async function uploadMediaToSupabaseAndSign(
  buffer: Buffer,
  opts: { from: string; messageId: string; mime: string; filename?: string },
  cfg: SupabaseUploadConfig
): Promise<string | undefined> {
  const supabase = createClient(cfg.url, cfg.serviceRoleKey, {
    auth: { persistSession: false },
  });

  const ext = extFromMime(opts.mime);
  const safeFrom = opts.from.replace(/[^a-zA-Z0-9@._-]/g, "_");
  const safeName = (opts.filename ?? `media_${opts.messageId}.${ext}`).replace(/[^a-zA-Z0-9._-]/g, "_");

  // Organize by sender + messageId to avoid collisions
  const objectPath = `${safeFrom}/${opts.messageId}/${safeName}`;

  const { error: upErr } = await supabase.storage
    .from(cfg.bucket)
    .upload(objectPath, buffer, {
      contentType: opts.mime,
      upsert: true,
    });

  if (upErr) return undefined;

  const { data, error: signErr } = await supabase.storage
    .from(cfg.bucket)
    .createSignedUrl(objectPath, 60 * 60 * 24); // 24h

  if (signErr) return undefined;
  return data?.signedUrl ?? undefined;
}
