/**
 * Environment validation via Zod.
 * Exit on validation failure.
 * HMAC is required by default; set HOTBAGS_HMAC_DISABLED=true for temporary Bearer-only mode.
 */

import { z } from "zod";

const hmacDisabledSchema = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .default("false")
  .transform((s) => s === "true" || s === "1");

/** Normalize phone to digits only (e.g. +447584662710 -> 447584662710) */
function parseAllowedNumbers(raw: string): Set<string> {
  const numbers = raw
    .split(/[,\s]+/)
    .map((s) => s.replace(/\D/g, ""))
    .filter((s) => s.length > 0);
  return new Set(numbers);
}

function parseAllowedLids(raw: string | undefined): Set<string> {
  if (!raw?.trim()) return new Set();
  return new Set(raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean));
}

const envSchema = z
  .object({
    HOTBAGS_INGEST_URL: z.string().url(),
    HOTBAGS_BEARER_TOKEN: z.string().min(1),
    HOTBAGS_HMAC_DISABLED: hmacDisabledSchema,
    HOTBAGS_HMAC_SECRET: z.string().optional(),
    QUEUE_DB_PATH: z.string().min(1),
    DATA_DIR: z.string().min(1),
    GATEWAY_INSTANCE_ID: z.string().min(1),
    /** Comma- or space-separated list of allowed phone numbers (e.g. 447584662710 or +447584662710) */
    ALLOWED_PHONE_NUMBERS: z.string().min(1).transform(parseAllowedNumbers),
    /** Optional: LIDs to allow when getContactLidAndPhone fails (e.g. 103160920166626 for Tom) */
    ALLOWED_LIDS: z.string().optional().transform(parseAllowedLids),
    /** Optional: phone number for pairing-code auth instead of QR (e.g. 447436118855, no + sign) */
    PAIRING_PHONE_NUMBER: z.string().optional(),
    /** Optional: Supabase config for uploading media and generating signed URLs */
    SUPABASE_URL: z.string().url().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  })
  .refine(
    (data) => {
      if (data.HOTBAGS_HMAC_DISABLED) return true;
      return (
        typeof data.HOTBAGS_HMAC_SECRET === "string" &&
        data.HOTBAGS_HMAC_SECRET.length > 0
      );
    },
    { message: "HOTBAGS_HMAC_SECRET is required when HOTBAGS_HMAC_DISABLED is not true", path: ["HOTBAGS_HMAC_SECRET"] }
  )
  .transform((data) => ({
    ...data,
    HOTBAGS_HMAC_SECRET: data.HOTBAGS_HMAC_DISABLED
      ? undefined
      : (data.HOTBAGS_HMAC_SECRET as string),
  }));

export type Env = z.infer<typeof envSchema>;

export function loadConfig(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error("Config validation failed:", result.error.flatten());
    process.exit(1);
  }
  return result.data;
}
