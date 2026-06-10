/**
 * Node-side e2e for the relay TOTP gate — REAL chii + real HTTP/WS sockets.
 *
 * Unlike relay-auth.test.ts (pure listener-logic units), this suite boots
 * `startChiiRelay` with the actual `chii` server module attached and dials it
 * with the `ws` client + global fetch, pinning the full issue #466/#467
 * behaviour end to end:
 *
 *   - phone-target transport: `/at/<code>/target/<id>` WS upgrade with a valid
 *     code is ACCEPTED (chii registers the target after the prefix strip);
 *   - wrong/stale code → accept-then-close with the NAMED code 4401 / reason
 *     'totp-rejected' (issue #478 — a raw 401-destroy only surfaced as 1006
 *     in browsers), the secret-free `onAuthReject` counter fires with kind
 *     'ws-upgrade', and the rejected target never reaches chii's registry
 *     (the upgrade dispatcher keeps chii away from rejected sockets);
 *   - script fetch: `GET /at/<code>/target.js` serves the real chii asset on a
 *     valid code and 401s (kind 'http-request') on a wrong one, with a CORS
 *     header + JSON error body so a cross-origin fetch() probe can read it;
 *   - daemon back-compat: the query transport (`/client/<id>?…&at=<code>`)
 *     keeps working unchanged;
 *   - SECRET-HANDLING: nothing observable (console output, reject events)
 *     carries the code, the secret, `at=`, `/at/`, or any request URL.
 *
 * SECRET-HANDLING: the only secret here is a fixed, public test vector
 * (`'deadbeef'.repeat(8)`). Codes derived from it are sent over loopback
 * sockets (the intended transport) and asserted for ABSENCE in logs — never
 * printed.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import {
  RELAY_AUTH_REJECT_CLOSE_CODE,
  RELAY_AUTH_REJECT_REASON,
} from '../../shared/relay-auth-close.js';
import { type ChiiRelay, type RelayAuthRejectEvent, startChiiRelay } from '../chii-relay.js';
import { buildRelayVerifyAuth, generateTotp } from '../totp.js';

/** Shared test secret — hex-encoded 32-byte value (public test vector). */
const TEST_SECRET = 'deadbeef'.repeat(8);

/**
 * Returns a 6-digit code that is INVALID for the relay's full acceptance
 * window (current step ±1). Candidates are the ten repdigit codes; at most
 * three can collide with the valid set, so one always remains.
 */
function wrongCode(): string {
  const now = Date.now();
  const valid = new Set([
    generateTotp(TEST_SECRET, now - 30_000),
    generateTotp(TEST_SECRET, now),
    generateTotp(TEST_SECRET, now + 30_000),
  ]);
  for (let digit = 0; digit <= 9; digit++) {
    const candidate = String(digit).repeat(6);
    if (!valid.has(candidate)) return candidate;
  }
  /* v8 ignore next — 10 candidates can never all be inside a 3-element set */
  throw new Error('no invalid candidate found');
}

/** Dials a WS URL; resolves with the OPEN socket, rejects on 'error'. */
function dialWs(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => resolve(ws));
    ws.on('error', (err) => reject(err));
  });
}

/**
 * Dials a WS URL and waits for the server to close it; resolves with the
 * close code/reason. With accept-then-close (#478) a rejected dial completes
 * the handshake first, so 'error' never fires — the close frame is the signal.
 */
function dialWsAwaitClose(url: string): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('close', (code, reason) => resolve({ code, reason: reason.toString() }));
    ws.on('error', (err) => reject(err));
  });
}

describe('relay TOTP gate e2e (real chii + real sockets)', () => {
  let relay: ChiiRelay;
  /** Secret-free reject events observed via onAuthReject (issue #467). */
  const rejects: RelayAuthRejectEvent[] = [];

  beforeAll(async () => {
    const verifyAuth = buildRelayVerifyAuth({ AIT_DEBUG_TOTP_SECRET: TEST_SECRET });
    if (verifyAuth === undefined) throw new Error('verifyAuth was not built');
    relay = await startChiiRelay({
      port: 0,
      verifyAuth,
      onAuthReject: (event) => {
        rejects.push(event);
      },
    });
  });

  afterAll(async () => {
    await relay.close();
  });

  beforeEach(() => {
    rejects.length = 0;
  });

  it('accepts a valid path-prefix target upgrade and registers the target', async () => {
    const code = generateTotp(TEST_SECRET);
    const wsUrl =
      `ws://127.0.0.1:${relay.port}/at/${code}/target/e2e-test-id` +
      `?${new URLSearchParams({ url: 'https://example.invalid/page', title: 'e2e' })}`;

    // Keep the socket OPEN while polling /targets — chii's route serialises
    // the live target entry, and a half-closed ws would race the listing.
    const ws = await dialWs(wsUrl);
    try {
      expect(rejects).toHaveLength(0);

      // The stripped URL reached chii — the target shows up in its registry.
      // Registration happens in the synchronous 'connection' handler, but poll
      // briefly to stay robust against handshake scheduling.
      let listed = false;
      for (let i = 0; i < 20 && !listed; i++) {
        const res = await fetch(`${relay.baseUrl}/targets`);
        const body = (await res.json()) as { targets: Array<{ id: string }> };
        listed = body.targets.some((t) => t.id === 'e2e-test-id');
        if (!listed) await new Promise((r) => setTimeout(r, 50));
      }
      expect(listed).toBe(true);
    } finally {
      ws.close();
    }
  });

  it('rejects a wrong path-prefix code with close 4401/totp-rejected and counts a ws-upgrade reject', async () => {
    const wsUrl = `ws://127.0.0.1:${relay.port}/at/${wrongCode()}/target/e2e-bad-id?url=u`;

    await expect(dialWsAwaitClose(wsUrl)).resolves.toEqual({
      code: RELAY_AUTH_REJECT_CLOSE_CODE,
      reason: RELAY_AUTH_REJECT_REASON,
    });
    expect(rejects).toEqual([{ kind: 'ws-upgrade' }]);

    // Auth-bypass guard (#478): accept-then-close keeps the socket alive, so
    // the dispatcher must keep chii away from it — the rejected target id must
    // never appear in chii's registry.
    const res = await fetch(`${relay.baseUrl}/targets`);
    const body = (await res.json()) as { targets: Array<{ id: string }> };
    expect(body.targets.some((t) => t.id === 'e2e-bad-id')).toBe(false);
  });

  it('rejects a prefix-less target upgrade carrying no code (stock chii dial)', async () => {
    const wsUrl = `ws://127.0.0.1:${relay.port}/target/e2e-naked-id?url=u`;

    await expect(dialWsAwaitClose(wsUrl)).resolves.toEqual({
      code: RELAY_AUTH_REJECT_CLOSE_CODE,
      reason: RELAY_AUTH_REJECT_REASON,
    });
    expect(rejects).toEqual([{ kind: 'ws-upgrade' }]);
  });

  it('serves target.js for a valid path-prefix script fetch', async () => {
    const code = generateTotp(TEST_SECRET);
    const res = await fetch(`${relay.baseUrl}/at/${code}/target.js`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/javascript/);
    const body = await res.text();
    expect(body.length).toBeGreaterThan(0);
    expect(rejects).toHaveLength(0);
  });

  it('rejects a wrong path-prefix script fetch with a CORS-readable 401 JSON body', async () => {
    const res = await fetch(`${relay.baseUrl}/at/${wrongCode()}/target.js`);

    expect(res.status).toBe(401);
    // Cross-origin fetch() probe contract (#478): the phone page must be able
    // to READ this status, so the error response carries ACAO + a JSON body.
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.json()).toEqual({ error: RELAY_AUTH_REJECT_REASON });
    expect(rejects).toEqual([{ kind: 'http-request' }]);
  });

  it('keeps the daemon query transport working unchanged (back-compat)', async () => {
    const code = generateTotp(TEST_SECRET);
    const wsUrl = `ws://127.0.0.1:${relay.port}/client/e2e-client-id?target=t&at=${code}`;

    const ws = await dialWs(wsUrl);
    ws.close();
    expect(rejects).toHaveLength(0);
  });
});

describe('relay TOTP gate e2e — SECRET-HANDLING', () => {
  const consoleSpies = [
    vi.spyOn(console, 'log'),
    vi.spyOn(console, 'info'),
    vi.spyOn(console, 'warn'),
    vi.spyOn(console, 'error'),
    vi.spyOn(console, 'debug'),
  ];

  afterEach(() => {
    for (const spy of consoleSpies) spy.mockClear();
  });

  it('emits no code/secret/URL through console or reject events on rejection', async () => {
    const verifyAuth = buildRelayVerifyAuth({ AIT_DEBUG_TOTP_SECRET: TEST_SECRET });
    if (verifyAuth === undefined) throw new Error('verifyAuth was not built');
    const rejects: RelayAuthRejectEvent[] = [];
    const relay = await startChiiRelay({
      port: 0,
      verifyAuth,
      onAuthReject: (event) => {
        rejects.push(event);
      },
    });

    const bad = wrongCode();
    const validCode = generateTotp(TEST_SECRET);
    // One rejected upgrade + one rejected script fetch. With accept-then-close
    // (#478) the WS rejection is a close frame, not an error — the close
    // code/reason and the HTTP body are the client-observable surfaces.
    const wsClose = await dialWsAwaitClose(
      `ws://127.0.0.1:${relay.port}/at/${bad}/target/leak-probe?url=u`,
    );
    const httpRes = await fetch(`${relay.baseUrl}/at/${bad}/target.js`);
    const httpBody = await httpRes.text();
    await relay.close();

    // Reject events carry ONLY the kind — the shape itself is the contract.
    expect(rejects).toHaveLength(2);
    for (const event of rejects) {
      expect(Object.keys(event)).toEqual(['kind']);
    }

    // Everything observable stays free of the code, the secret, and the URL.
    const observable = [
      JSON.stringify(wsClose),
      httpBody,
      JSON.stringify(rejects),
      ...consoleSpies.flatMap((spy) => spy.mock.calls.map((call) => call.map(String).join(' '))),
    ].join('\n');
    expect(observable).not.toContain(bad);
    expect(observable).not.toContain(validCode);
    expect(observable).not.toContain(TEST_SECRET);
    expect(observable).not.toContain('/at/');
    expect(observable).not.toContain('at=');
    expect(observable).not.toContain('target.js');
  });
});
