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

const envSchema = z
  .object({
    HOTBAGS_INGEST_URL: z.string().url(),
    HOTBAGS_BEARER_TOKEN: z.string().min(1),
    HOTBAGS_HMAC_DISABLED: hmacDisabledSchema,
    HOTBAGS_HMAC_SECRET: z.string().optional(),
    QUEUE_DB_PATH: z.string().min(1),
    DATA_DIR: z.string().min(1),
    GATEWAY_INSTANCE_ID: z.string().min(1),
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
