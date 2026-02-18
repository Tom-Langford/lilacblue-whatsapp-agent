/**
 * Bearer + HMAC auth for Hot Bags.
 * X-HotBags-Signature added when HMAC is enabled (HOTBAGS_HMAC_DISABLED != true).
 */

import { createHmac } from "crypto";

export function buildAuthHeaders(
  bearerToken: string,
  body: string,
  hmacSecret?: string
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${bearerToken}`,
  };
  if (hmacSecret) {
    const signature = createHmac("sha256", hmacSecret).update(body).digest("hex");
    headers["X-HotBags-Signature"] = `sha256=${signature}`;
  }
  return headers;
}
