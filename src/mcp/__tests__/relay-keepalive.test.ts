/**
 * Integration tests for the relay WS keepalive ping (issue #483).
 *
 * Cloudflare proxied connections are dropped after ~100 s of no traffic.
 * The relay mitigates this by sending a WS protocol ping to every connected
 * socket on a configurable interval — both the phone-target leg and the
 * daemon-client leg terminate on the relay, so a single ping loop covers both.
 *
 * These tests use the REAL chii server (no vi.mock('chii')) so that chii's
 * internal WebSocketServer instance is actually constructed and its `_wss`
 * socket set is populated by real WebSocket connections. A short
 * `keepaliveIntervalMs` (50 ms) is passed to avoid real-time waits.
 *
 * Peer behaviour: `ws` library clients respond to protocol ping frames with
 * pong automatically (RFC 6455 §5.5). The 'ping' event on a `ws` WebSocket
 * fires when the CLIENT receives a ping from the server — we assert this event
 * to verify the keepalive loop is working.
 *
 * Note on the client leg: chii immediately closes a `/client/…` connection if
 * the requested target id is not registered. To test the client leg we first
 * dial a target connection and use its id as the client's `?target=` param.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { type ChiiRelay, startChiiRelay } from '../chii-relay.js';
import { generateTotp } from '../totp.js';

/** Shared test secret — hex-encoded 32-byte value (public test vector). */
const TEST_SECRET = 'deadbeef'.repeat(8);

/** Dials a WS URL and resolves with the open WebSocket. */
function dialWs(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => resolve(ws));
    ws.on('error', (err) => reject(err));
  });
}

/** Waits up to `timeoutMs` ms for a 'ping' event on the socket. */
function waitForPing(ws: WebSocket, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`No ping received within ${timeoutMs} ms`));
    }, timeoutMs);
    ws.once('ping', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// keepalive ping is delivered to a connected target-leg WebSocket
// ---------------------------------------------------------------------------

describe('relay WS keepalive — target leg receives periodic ping', () => {
  let relay: ChiiRelay;

  beforeAll(async () => {
    relay = await startChiiRelay({
      port: 0,
      // 50 ms interval — fast enough for a test without real-time waits.
      keepaliveIntervalMs: 50,
    });
  });

  afterAll(async () => {
    await relay.close();
  });

  it('connected ws client (target leg) receives a ping frame within 2× the interval', async () => {
    // Dial as a chii "target" so the socket enters chii's _wss.clients set.
    const wsUrl =
      `ws://127.0.0.1:${relay.port}/target/keepalive-target-id` +
      `?${new URLSearchParams({ url: 'https://example.invalid/page', title: 'keepalive-test' })}`;

    const ws = await dialWs(wsUrl);
    try {
      // The keepalive loop fires every 50 ms. Allow 2× (100 ms) as margin.
      await waitForPing(ws, 100);
    } finally {
      ws.close();
    }
  });

  it('connected ws client (client leg) receives a ping frame within 2× the interval', async () => {
    // The client leg requires a registered target — chii closes the socket
    // immediately if the target id is not found. Dial a target first, then
    // connect a client that references it.
    const targetWs = await dialWs(
      `ws://127.0.0.1:${relay.port}/target/cl-leg-target` +
        `?${new URLSearchParams({ url: 'https://example.invalid/', title: 'cl-target' })}`,
    );

    const clientWs = await dialWs(
      `ws://127.0.0.1:${relay.port}/client/cl-leg-client?target=cl-leg-target`,
    );
    try {
      await waitForPing(clientWs, 100);
    } finally {
      clientWs.close();
      targetWs.close();
    }
  });
});

// ---------------------------------------------------------------------------
// keepalive is skipped when keepaliveIntervalMs = 0
// ---------------------------------------------------------------------------

describe('relay WS keepalive — disabled when keepaliveIntervalMs is 0', () => {
  let relay: ChiiRelay;

  beforeAll(async () => {
    relay = await startChiiRelay({
      port: 0,
      keepaliveIntervalMs: 0,
    });
  });

  afterAll(async () => {
    await relay.close();
  });

  it('connected client does NOT receive a ping within 200 ms when keepalive is disabled', async () => {
    const wsUrl =
      `ws://127.0.0.1:${relay.port}/target/nokeepalive-id` +
      `?${new URLSearchParams({ url: 'https://example.invalid/', title: 'no-keepalive' })}`;

    const ws = await dialWs(wsUrl);
    try {
      // Assert absence of ping for 200 ms. If a ping arrives, the test fails.
      await expect(waitForPing(ws, 200)).rejects.toThrow(/No ping received/);
    } finally {
      ws.close();
    }
  });
});

// ---------------------------------------------------------------------------
// keepalive still works when TOTP gate is armed (verifyAuth path)
// ---------------------------------------------------------------------------

describe('relay WS keepalive — ping is delivered when TOTP gate is active', () => {
  let relay: ChiiRelay;

  beforeAll(async () => {
    const { buildRelayVerifyAuth } = await import('../debug-server.js');
    const verifyAuth = buildRelayVerifyAuth({ AIT_DEBUG_TOTP_SECRET: TEST_SECRET });
    if (verifyAuth === undefined) throw new Error('verifyAuth not built');

    relay = await startChiiRelay({
      port: 0,
      keepaliveIntervalMs: 50,
      verifyAuth,
    });
  });

  afterAll(async () => {
    await relay.close();
  });

  it('connected target leg (valid TOTP) receives a ping within 2× interval', async () => {
    const code = generateTotp(TEST_SECRET);
    const wsUrl =
      `ws://127.0.0.1:${relay.port}/at/${code}/target/totp-keepalive-id` +
      `?${new URLSearchParams({ url: 'https://example.invalid/', title: 'totp-keepalive' })}`;

    const ws = await dialWs(wsUrl);
    try {
      await waitForPing(ws, 100);
    } finally {
      ws.close();
    }
  });
});

// ---------------------------------------------------------------------------
// close() clears the keepalive interval — no pings after shutdown
// ---------------------------------------------------------------------------

describe('relay WS keepalive — interval cleared on close()', () => {
  it('no pings are sent after relay.close() is called', async () => {
    const relay = await startChiiRelay({
      port: 0,
      keepaliveIntervalMs: 50,
    });

    const wsUrl =
      `ws://127.0.0.1:${relay.port}/target/close-test-id` +
      `?${new URLSearchParams({ url: 'https://example.invalid/', title: 'close-test' })}`;

    const ws = await dialWs(wsUrl);

    // Confirm at least one ping arrives before closing.
    await waitForPing(ws, 100);

    // Force-close the WS before closing the relay so httpServer.close() can
    // complete (Node keeps the server open while connections are live).
    ws.terminate();

    // Close the relay (clears the keepalive interval).
    await relay.close();

    // Track any ping frames that arrive after close().
    let pingAfterClose = 0;
    ws.on('ping', () => {
      pingAfterClose++;
    });

    // Wait 200 ms — 4× the keepalive interval. If the interval were still
    // running it would have fired at least twice.
    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    // The ws is terminated and the interval is cleared — no pings expected.
    expect(pingAfterClose).toBe(0);
  }, 10_000);
});
