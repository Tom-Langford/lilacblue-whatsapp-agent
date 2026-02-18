/**
 * POST inbound events to Hot Bags.
 */

import { buildAuthHeaders } from "./auth.js";
import type { InboundRequest, InboundResponse } from "../types/index.js";

export interface HotBagsClientConfig {
  ingestUrl: string;
  bearerToken: string;
  hmacSecret?: string;
}

export async function postInbound(
  payload: InboundRequest,
  config: HotBagsClientConfig
): Promise<InboundResponse> {
  const body = JSON.stringify(payload);
  const authHeaders = buildAuthHeaders(
    config.bearerToken,
    body,
    config.hmacSecret
  );

  const response = await fetch(config.ingestUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": payload.message_id,
      ...authHeaders,
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Hot Bags POST failed (${response.status}): ${text}`);
  }

  return (await response.json()) as InboundResponse;
}
