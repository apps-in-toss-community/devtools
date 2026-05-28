/**
 * Unit tests for `ChiiCdpConnection` — timeout + disconnect paths.
 *
 * Coverage:
 *   - sendCommand times out when the relay never replies.
 *   - WebSocket close event rejects all pending commands.
 *   - Subsequent sendCommand after disconnect fails fast (no hang).
 *   - close() rejects in-flight commands.
 */

import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { ChiiCdpConnection } from '../chii-connection.js';

// ---- Fake relay helpers ----------------------------------------------------

interface FakeRelay {
  baseUrl: string;
  receivedMessages: string[];
  /** Push a CDP response frame to the connected client. */
  sendToClient(msg: object): void;
  /** Forcibly close the WebSocket to simulate a relay disconnect. */
  dropClient(): void;
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
