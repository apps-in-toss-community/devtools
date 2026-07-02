/**
 * Unit tests for `ChiiCdpConnection` — timeout + disconnect paths + TOTP auth.
 *
 * Coverage:
 *   - sendCommand times out when the relay never replies.
 *   - WebSocket close event rejects all pending commands.
 *   - Close code 4401 (relay TOTP rejection, issue #478) is named as an auth
 *     failure instead of a generic drop.
 *   - Subsequent sendCommand after disconnect fails fast (no hang).
 *   - close() rejects in-flight commands.
 *   - TOTP: client WS URL includes `&at=` when totpSecret is set.
 *   - TOTP: client WS URL has NO `at=` when totpSecret is absent.
 */

import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import {
  RELAY_AUTH_REJECT_CLOSE_CODE,
  RELAY_AUTH_REJECT_REASON,
} from '../../shared/relay-auth-close.js';
import { ChiiCdpConnection, isRelayDisconnectMessage } from '../chii-connection.js';
import { generateTotp } from '../totp.js';

// ---- Fake relay helpers ----------------------------------------------------

interface FakeRelay {
  baseUrl: string;
  receivedMessages: string[];
  /** Push a CDP response frame to the connected client. */
  sendToClient(msg: object): void;
  /**
   * Forcibly close the WebSocket to simulate a relay disconnect. Pass a
   * code/reason to simulate a NAMED close (e.g. 4401 TOTP rejection, #478).
   */
  dropClient(code?: number, reason?: string): void;
  close(): Promise<void>;
}

/**
 * Fake Chii relay: HTTP + WS share one port.
 * - GET /targets → `[{ id: 'target-1', … }]`
 * - WS accepts one client connection (any path) and records messages.
 */
async function createFakeRelay(): Promise<FakeRelay> {
  const receivedMessages: string[] = [];
  let clientSocket: import('ws').WebSocket | null = null;
  const pendingOutbound: string[] = [];

  const httpServer = http.createServer((req, res) => {
    if (req.url?.startsWith('/targets')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          targets: [{ id: 'target-1', title: 'Test Mini-App', url: 'http://localhost/' }],
        }),
      );
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (ws) => {
    clientSocket = ws;
    for (const msg of pendingOutbound) ws.send(msg);
    pendingOutbound.length = 0;
    ws.on('message', (data: Buffer) => receivedMessages.push(data.toString()));
    ws.on('close', () => {
      clientSocket = null;
    });
  });

  const port = await new Promise<number>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const addr = httpServer.address();
      resolve(typeof addr === 'object' && addr !== null ? addr.port : 0);
    });
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    receivedMessages,
    sendToClient(msg: object) {
      const raw = JSON.stringify(msg);
      if (clientSocket) {
        clientSocket.send(raw);
      } else {
        pendingOutbound.push(raw);
      }
    },
    dropClient(code?: number, reason?: string) {
      clientSocket?.close(code, reason);
    },
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        wss.close(() => {
          httpServer.close((err) => (err ? reject(err) : resolve()));
        });
      });
    },
  };
}

// ---- Tests -----------------------------------------------------------------

describe('ChiiCdpConnection — per-command timeout', () => {
  it('rejects with a timeout error when the relay never replies', async () => {
    const relay = await createFakeRelay();
    const conn = new ChiiCdpConnection({
      relayBaseUrl: relay.baseUrl,
      commandTimeoutMs: 100, // short timeout for test speed
    });

    try {
      await conn.enableDomains();
      await new Promise<void>((r) => setTimeout(r, 20));

      const cmdPromise = conn.sendCommand('Runtime.evaluate', { expression: '1+1' });

      await expect(cmdPromise).rejects.toThrow(/CDP 명령이 타임아웃됐습니다/);
      await expect(cmdPromise).rejects.toThrow(/Runtime\.evaluate/);
      await expect(cmdPromise).rejects.toThrow(/list_pages/);
    } finally {
      conn.close();
      await relay.close();
    }
  });

  it('does NOT timeout when the relay replies in time', async () => {
    const relay = await createFakeRelay();
    const conn = new ChiiCdpConnection({
      relayBaseUrl: relay.baseUrl,
      commandTimeoutMs: 500,
    });

    try {
      await conn.enableDomains();
      await new Promise<void>((r) => setTimeout(r, 20));

      const before = relay.receivedMessages.length;
      const cmdPromise = conn.sendCommand('Runtime.evaluate', { expression: '42' });

      await new Promise<void>((r) => setTimeout(r, 30));

      const newMsgs = relay.receivedMessages.slice(before);
      let capturedId: number | null = null;
      for (const msg of newMsgs) {
        const parsed = JSON.parse(msg) as { id?: number; method?: string };
        if (parsed.method === 'Runtime.evaluate') {
          capturedId = parsed.id ?? null;
          break;
        }
      }
      expect(capturedId).not.toBeNull();

      relay.sendToClient({ id: capturedId, result: { value: 42 } });

      const result = await cmdPromise;
      expect((result as { value: number }).value).toBe(42);
    } finally {
      conn.close();
      await relay.close();
    }
  });

  it('cleans up the pending entry after timeout (no memory leak)', async () => {
    const relay = await createFakeRelay();
    const conn = new ChiiCdpConnection({
      relayBaseUrl: relay.baseUrl,
      commandTimeoutMs: 80,
    });

    try {
      await conn.enableDomains();
      await new Promise<void>((r) => setTimeout(r, 20));

      const cmdPromise = conn.sendCommand('DOM.getDocument', {});
      cmdPromise.catch(() => {}); // absorb rejection

      await new Promise<void>((r) => setTimeout(r, 120));

      // Late response from relay should be silently ignored (pending cleared).
      relay.sendToClient({ id: 1, result: {} });
      await new Promise<void>((r) => setTimeout(r, 20));
      // If we get here without error, pending was cleaned up correctly.
    } finally {
      conn.close();
      await relay.close();
    }
  });
});

describe('ChiiCdpConnection — WebSocket close rejects pending', () => {
  it('rejects all pending commands when the relay closes the socket', async () => {
    const relay = await createFakeRelay();
    const conn = new ChiiCdpConnection({
      relayBaseUrl: relay.baseUrl,
      commandTimeoutMs: 10_000,
    });

    try {
      await conn.enableDomains();
      await new Promise<void>((r) => setTimeout(r, 20));

      const p1 = conn.sendCommand('Runtime.evaluate', { expression: '1' });
      const p2 = conn.sendCommand('DOM.getDocument', {});

      relay.dropClient();

      await expect(p1).rejects.toThrow(/relay WebSocket 연결이 끊겼습니다/);
      await expect(p2).rejects.toThrow(/relay WebSocket 연결이 끊겼습니다/);
    } finally {
      conn.close();
      await relay.close();
    }
  });

  it('names a close 4401 as a TOTP auth failure instead of a generic drop (issue #478)', async () => {
    const relay = await createFakeRelay();
    const conn = new ChiiCdpConnection({
      relayBaseUrl: relay.baseUrl,
      commandTimeoutMs: 10_000,
    });

    try {
      await conn.enableDomains();
      await new Promise<void>((r) => setTimeout(r, 20));

      const pending = conn.sendCommand('Runtime.evaluate', { expression: '1' });

      relay.dropClient(RELAY_AUTH_REJECT_CLOSE_CODE, RELAY_AUTH_REJECT_REASON);

      await expect(pending).rejects.toThrow(/relay 인증\(TOTP\)이 거부돼 연결이 종료됐습니다/);
      await expect(pending).rejects.toThrow(/4401/);
    } finally {
      conn.close();
      await relay.close();
    }
  });

  it('subsequent sendCommand fails fast after disconnect (no hang)', async () => {
    const relay = await createFakeRelay();
    const conn = new ChiiCdpConnection({
      relayBaseUrl: relay.baseUrl,
      commandTimeoutMs: 10_000,
    });

    try {
      await conn.enableDomains();
      await new Promise<void>((r) => setTimeout(r, 20));

      relay.dropClient();
      await new Promise<void>((r) => setTimeout(r, 30));

      const p = conn.sendCommand('Runtime.evaluate', { expression: '1' });
      await expect(p).rejects.toThrow(/relay에 연결되어 있지 않습니다/);
      await expect(p).rejects.toThrow(/list_pages/);
    } finally {
      conn.close();
      await relay.close();
    }
  });
});

describe('ChiiCdpConnection — close() rejects pending', () => {
  it('rejects in-flight commands when close() is called', async () => {
    const relay = await createFakeRelay();
    const conn = new ChiiCdpConnection({
      relayBaseUrl: relay.baseUrl,
      commandTimeoutMs: 10_000,
    });

    try {
      await conn.enableDomains();
      await new Promise<void>((r) => setTimeout(r, 20));

      const pending = conn.sendCommand('Runtime.evaluate', { expression: '1' });
      conn.close();

      await expect(pending).rejects.toThrow(/closed/);
    } finally {
      await relay.close();
    }
  });
});

// ---- TOTP client URL tests -------------------------------------------------

interface FakeRelayWithUpgrade extends FakeRelay {
  /** URL paths seen in upgrade requests (WS connections). */
  upgradeUrls: string[];
}

/**
 * Fake relay that also records the raw URL of every WS upgrade request.
 * Used to verify that ChiiCdpConnection appends (or omits) `&at=` correctly.
 */
async function createFakeRelayWithUpgradeCapture(): Promise<FakeRelayWithUpgrade> {
  const upgradeUrls: string[] = [];
  const receivedMessages: string[] = [];
  let clientSocket: import('ws').WebSocket | null = null;
  const pendingOutbound: string[] = [];

  const httpServer = http.createServer((req, res) => {
    if (req.url?.startsWith('/targets')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          targets: [{ id: 'target-1', title: 'Test Mini-App', url: 'http://localhost/' }],
        }),
      );
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  const wss = new WebSocketServer({ server: httpServer });

  // Capture the raw upgrade URL before the WS handshake completes.
  httpServer.on('upgrade', (req) => {
    upgradeUrls.push(req.url ?? '');
  });

  wss.on('connection', (ws) => {
    clientSocket = ws;
    for (const msg of pendingOutbound) ws.send(msg);
    pendingOutbound.length = 0;
    ws.on('message', (data: Buffer) => receivedMessages.push(data.toString()));
    ws.on('close', () => {
      clientSocket = null;
    });
  });

  const port = await new Promise<number>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const addr = httpServer.address();
      resolve(typeof addr === 'object' && addr !== null ? addr.port : 0);
    });
  });

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    receivedMessages,
    upgradeUrls,
    sendToClient(msg: object) {
      const raw = JSON.stringify(msg);
      if (clientSocket) {
        clientSocket.send(raw);
      } else {
        pendingOutbound.push(raw);
      }
    },
    dropClient() {
      clientSocket?.close();
    },
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        wss.close(() => {
          httpServer.close((err) => (err ? reject(err) : resolve()));
        });
      });
    },
  };
}

/** Shared test secret — hex-encoded 32-byte value (arbitrary, same pattern as relay-auth.test.ts). */
const TOTP_TEST_SECRET = 'deadbeef'.repeat(8); // 64 hex chars = 32 bytes

describe('ChiiCdpConnection — TOTP at= in client WS URL', () => {
  it('appends &at=<code> to the client WS URL when totpSecret is set', async () => {
    const relay = await createFakeRelayWithUpgradeCapture();
    const conn = new ChiiCdpConnection({
      relayBaseUrl: relay.baseUrl,
      totpSecret: TOTP_TEST_SECRET,
    });

    try {
      // Record the time just before connect so we can compute the expected code.
      const beforeConnect = Date.now();
      await conn.enableDomains();
      const afterConnect = Date.now();

      // Find the /client/... upgrade URL (not /targets HTTP).
      const clientUpgradeUrl = relay.upgradeUrls.find((u) => u.includes('/client/'));
      expect(clientUpgradeUrl).toBeDefined();

      const params = new URLSearchParams(clientUpgradeUrl!.split('?')[1] ?? '');
      const atParam = params.get('at');
      expect(atParam).not.toBeNull();

      // The code must match what generateTotp would produce at some point in
      // [beforeConnect, afterConnect]. Because the time step is 30 s we can
      // compute all candidates in that window (at most 2 distinct steps).
      const steps = new Set([
        Math.floor(beforeConnect / 1000 / 30),
        Math.floor(afterConnect / 1000 / 30),
      ]);
      const validCodes = [...steps].map((step) => generateTotp(TOTP_TEST_SECRET, step * 30 * 1000));
      expect(validCodes).toContain(atParam);
      // SECRET-HANDLING: we never print atParam or TOTP_TEST_SECRET in assertion messages.
    } finally {
      conn.close();
      await relay.close();
    }
  });

  it('does NOT append &at= to the client WS URL when totpSecret is absent', async () => {
    const relay = await createFakeRelayWithUpgradeCapture();
    const conn = new ChiiCdpConnection({
      relayBaseUrl: relay.baseUrl,
      // totpSecret intentionally omitted
    });

    try {
      await conn.enableDomains();

      const clientUpgradeUrl = relay.upgradeUrls.find((u) => u.includes('/client/'));
      expect(clientUpgradeUrl).toBeDefined();

      const params = new URLSearchParams(clientUpgradeUrl!.split('?')[1] ?? '');
      expect(params.has('at')).toBe(false);
    } finally {
      conn.close();
      await relay.close();
    }
  });
});
describe('isRelayDisconnectMessage (devtools#731)', () => {
  it('matches the ws close handler message ("relay WebSocket 연결이 끊겼습니다")', () => {
    expect(isRelayDisconnectMessage('relay WebSocket 연결이 끊겼습니다')).toBe(true);
  });

  it('matches the ws error handler message ("relay WebSocket 오류: ...")', () => {
    expect(isRelayDisconnectMessage('relay WebSocket 오류: ECONNRESET')).toBe(true);
  });

  it('matches the fail-fast sendCommand rejection ("relay에 연결되어 있지 않습니다 (...)")', () => {
    expect(
      isRelayDisconnectMessage(
        'relay에 연결되어 있지 않습니다 (Runtime.evaluate). list_pages로 attach 상태를 확인하고 enableDomains()로 재연결하세요.',
      ),
    ).toBe(true);
  });

  it('does NOT match an unrelated error message', () => {
    expect(isRelayDisconnectMessage('bundle-eval: ReferenceError: __sdk is not defined')).toBe(
      false,
    );
    expect(isRelayDisconnectMessage('rpc: evaluate timed out after 60000ms')).toBe(false);
  });
});
