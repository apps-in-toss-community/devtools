/**
 * Telemetry send + retry.
 *
 * Rules:
 *   1. If consent ≠ "granted" — drop silently.
 *   2. POST event as JSON with 5 s timeout.
 *   3. On network error or non-2xx: retry ONCE after 2 s. On second failure: drop.
 *   4. console.debug on retry, development only (NODE_ENV !== "production").
 *   5. For "session_duration": use sendBeacon if available, fall back to fetch keepalive.
 *
 * Max meta size: 256 bytes (JSON-serialized). Over-size meta is dropped to undefined.
 */

import { TELEMETRY_ENDPOINT } from './index.js';
import { getOrCreateAnonId, readConsentState } from './state.js';

export type TelemetryEvent = 'panel_mount' | 'panel_open' | 'tab_view' | 'session_duration';

export interface EventPayload {
  source: 'devtools';
  event: TelemetryEvent;
  anon_id: string;
  version: string;
  ts: number;
  meta?: Record<string, unknown>;
}

/** Meta cap per server contract (JSON bytes). */
const META_BYTE_CAP = 256;

function sanitizeMeta(
  meta: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (meta === undefined) return undefined;
  const serialized = JSON.stringify(meta);
  if (new TextEncoder().encode(serialized).length > META_BYTE_CAP) {
    // Drop oversized meta rather than sending something the server will reject
    return undefined;
  }
  return meta;
}

async function doFetch(payload: EventPayload): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(`${TELEMETRY_ENDPOINT}/e`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send a telemetry event. Drops silently if consent is not "granted".
 */
export async function send(
  event: TelemetryEvent,
  version: string,
  meta?: Record<string, unknown>,
): Promise<void> {
  if (readConsentState() !== 'granted') return;

  const payload: EventPayload = {
    source: 'devtools',
    event,
    anon_id: getOrCreateAnonId(),
    version,
    ts: Date.now(),
    meta: sanitizeMeta(meta),
  };

  const ok = await doFetch(payload);
  if (ok) return;

  // Retry once after 2 s
  if (process.env.NODE_ENV !== 'production') {
    console.debug('[@ait-co/devtools] telemetry: retrying after failure', event);
  }
  await delay(2_000);
  await doFetch(payload);
  // Second failure → drop silently (no further action)
}

/**
 * Send the "session_duration" event via sendBeacon (unload-safe).
 * Falls back to fetch with keepalive if sendBeacon is unavailable.
 * No retry during page unload.
 */
export function sendBeaconEvent(
  event: 'session_duration',
  version: string,
  meta: Record<string, unknown>,
): void {
  if (readConsentState() !== 'granted') return;

  const payload: EventPayload = {
    source: 'devtools',
    event,
    anon_id: getOrCreateAnonId(),
    version,
    ts: Date.now(),
    meta: sanitizeMeta(meta),
  };

  const body = JSON.stringify(payload);

  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    navigator.sendBeacon(`${TELEMETRY_ENDPOINT}/e`, new Blob([body], { type: 'application/json' }));
    return;
  }

  // Fallback: fetch with keepalive (no retry — page is unloading)
  fetch(`${TELEMETRY_ENDPOINT}/e`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {
    /* unload — nothing we can do */
  });
}
