/**
 * Tier 0 telemetry — opt-out, fire-and-forget daily ping.
 *
 * Payload: { tier: 0, source: 'devtools', ts: number, version: string }
 * No anon_id. No event name. No meta.
 *
 * Rules:
 *   - Sent once per calendar day (localStorage daily marker).
 *   - Skipped when __ait_telemetry:t0_off = '1' or AITC_TELEMETRY=off.
 *   - 5 s timeout, no retry. Failure is silently dropped.
 */

import { TELEMETRY_ENDPOINT } from './index.js';
import { hasSentTier0Today, isTier0Enabled, markTier0Sent } from './state.js';

export interface Tier0Payload {
  tier: 0;
  source: 'devtools';
  ts: number;
  version: string;
}

/**
 * Sends the Tier 0 daily ping if eligible.
 * Returns true if a ping was sent, false if skipped or failed.
 */
export async function sendTier0Ping(version: string): Promise<boolean> {
  if (!isTier0Enabled()) return false;
  if (hasSentTier0Today()) return false;

  const payload: Tier0Payload = {
    tier: 0,
    source: 'devtools',
    ts: Date.now(),
    version,
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5_000);

  try {
    await fetch(`${TELEMETRY_ENDPOINT}/e`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    // Mark as sent regardless of server response code — avoids re-spam on 400s too.
    markTier0Sent();
    return true;
  } catch {
    // Network error or timeout — drop silently, do NOT mark as sent (retry tomorrow).
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}
