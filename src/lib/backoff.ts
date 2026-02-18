/**
 * Exponential backoff + jitter.
 * Infinite retries with max delay cap.
 */

const BASE_MS = 1000;
const MAX_DELAY_MS = 300_000; // 5 min
const JITTER_MS = 500;

export function calculate(attemptCount: number): number {
  const exponential = BASE_MS * Math.pow(2, attemptCount);
  const jitter = Math.random() * JITTER_MS;
  const delay = Math.min(MAX_DELAY_MS, exponential + jitter);
  return Math.floor(delay);
}
