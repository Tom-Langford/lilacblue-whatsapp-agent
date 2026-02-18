/**
 * Pino logger with structured fields.
 */

import pino from "pino";

const instanceId = process.env.GATEWAY_INSTANCE_ID ?? "clawdbot";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: {
    instanceId,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
