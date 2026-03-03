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
  if (m.startsWith("image/")) return "jpg";
  return "bin";
}

/** Strip @lid, @c.us, and any WhatsApp suffix from sender ID */
function cleanSenderId(from: string): string {
  const at = from.indexOf("@");
  return at >= 0 ? from.slice(0, at) : from;
}

/** Extract hex/alphanumeric message ID from WhatsApp compound ID (e.g. false_123_lid_3B888111D651EDE6E936 -> 3B888111D651EDE6E936) */
function cleanMessageId(messageId: string): string {
  const parts = messageId.split("_");
  const last = parts[parts.length - 1];
  if (last && /^[A-Za-z0-9]+$/.test(last) && last.length >= 8) return last;
  return messageId.replace(/[^A-Za-z0-9]/g, "_");
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
  const cleanFrom = cleanSenderId(opts.from).replace(/[^a-zA-Z0-9._-]/g, "_");
  const cleanId = cleanMessageId(opts.messageId);

  const objectPath = `${cleanFrom}/${cleanId}.${ext}`;

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
