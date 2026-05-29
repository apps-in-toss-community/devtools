/**
 * Tests for attach reliability improvements (#281):
 *
 *   1. ChiiCdpConnection.waitForFirstTarget() — event-driven attach detection.
 *   2. list_pages stale cache — refreshTargets after evict/reattach cycle.
 *   3. MCP server disconnect error — relay disconnect is identified correctly.
 */

import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { ChiiCdpConnection } from '../chii-connection.js';

// ---- Fake relay helpers ----------------------------------------------------

interface FakeRelay {
  baseUrl: string;
  receivedMessages: string[];
  sendToClient(msg: object): void;
  dropClient(): void;
  close(): Promise<void>;
  setTargets(targets: Array<{ id: string; title?: string; url?: string }>): void;
}

async function createFakeRelay(
  initialTargets: Array<{ id: string; title?: string; url?: string }> = [
    { id: 'target-1', title: 'Test Mini-App', url: 'http://localhost/' },
  ],
): Promise<FakeRelay> {
  const receivedMessages: string[] = [];
  let clientSocket: import('ws').WebSocket | null = null;
  const pendingOutbound: string[] = [];
  let targetsPayload = initialTargets;

  const httpServer = http.createServer((req, res) => {
    if (req.url?.startsWith('/targets')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ targets: targetsPayload }));
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
    setTargets(targets) {
      targetsPayload = targets;
    },
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

// ---- waitForFirstTarget tests ----------------------------------------------

describe('ChiiCdpConnection.waitForFirstTarget()', () => {
  it('resolves immediately when a matching target is already present', async () => {
    const relay = await createFakeRelay();
    const conn = new ChiiCdpConnection({ relayBaseUrl: relay.baseUrl });

    try {
      await conn.refreshTargets();
      const targets = await conn.waitForFirstTarget((t) => t.length > 0, 1000);
      expect(targets.length).toBe(1);
      expect(targets[0]?.id).toBe('target-1');
    } finally {
      await relay.close();
    }
  });

  it('rejects after timeout when no matching target attaches', async () => {
    const relay = await createFakeRelay([]);
    const conn = new ChiiCdpConnection({ relayBaseUrl: relay.baseUrl });

    try {
      await expect(conn.waitForFirstTarget((t) => t.length > 0, 100, 50)).rejects.toThrow(
        /타임아웃/,
      );
    } finally {
      await relay.close();
    }
  });

  it('resolves via polling fallback when target appears after a delay', async () => {
    const relay = await createFakeRelay([]);
    const conn = new ChiiCdpConnection({ relayBaseUrl: relay.baseUrl });

    try {
      const waitPromise = conn.waitForFirstTarget((t) => t.length > 0, 2000, 50);

      // After 80ms, make the relay return a target.
      await new Promise<void>((r) => setTimeout(r, 80));
      relay.setTargets([{ id: 'delayed-target', url: 'http://localhost/' }]);

      const targets = await waitPromise;
      expect(targets.length).toBe(1);
      expect(targets[0]?.id).toBe('delayed-target');
    } finally {
      await relay.close();
    }
  });

  it('resolves via target:attached event from refreshTargets()', async () => {
    const relay = await createFakeRelay([]);
    const conn = new ChiiCdpConnection({ relayBaseUrl: relay.baseUrl });

    try {
      // Use a very long poll interval — only the event path can resolve quickly.
      const waitPromise = conn.waitForFirstTarget((t) => t.length > 0, 3000, 10_000);

      // Let the event listener register before triggering.
      await new Promise<void>((r) => setTimeout(r, 20));
      relay.setTargets([{ id: 'event-target', url: 'http://localhost/' }]);
      // refreshTargets() should emit 'target:attached'.
      await conn.refreshTargets();

      const targets = await waitPromise;
      expect(targets.length).toBe(1);
      expect(targets[0]?.id).toBe('event-target');
    } finally {
      await relay.close();
    }
  });

  it('satisfies the deploymentId filter — does not resolve for a non-matching target', async () => {
    // A target whose URL does not contain the expected deploymentId.
    const relay = await createFakeRelay([
      { id: 'stale', url: 'intoss-private://app?_deploymentId=old-id' },
    ]);
    const conn = new ChiiCdpConnection({ relayBaseUrl: relay.baseUrl });

    try {
      await conn.refreshTargets();

      const expectedId = 'new-uuid-that-never-comes';
      // Timeout quickly — the stale target should NOT resolve the wait.
      await expect(
        conn.waitForFirstTarget(
          (targets) => targets.some((t) => t.url.includes(expectedId)),
          100,
          50,
        ),
      ).rejects.toThrow(/타임아웃/);
    } finally {
      await relay.close();
    }
  });
});

// ---- list_pages stale cache -------------------------------------------------

describe('list_pages stale cache — refreshTargets after evict/reattach', () => {
  it('returns the fresh target after evict→reattach cycle', async () => {
    const relay = await createFakeRelay();
    const conn = new ChiiCdpConnection({ relayBaseUrl: relay.baseUrl });

    try {
      // Initial refresh — target-1 present.
      await conn.refreshTargets();
      expect(conn.listTargets().length).toBe(1);

      // Evict: relay now has no targets.
      relay.setTargets([]);
      await conn.refreshTargets();
      expect(conn.listTargets().length).toBe(0);

      // Reattach: relay has a new target.
      relay.setTargets([{ id: 'fresh-attach', url: 'http://localhost/' }]);
      await conn.refreshTargets();

      const fresh = conn.listTargets();
      expect(fresh.length).toBe(1);
      expect(fresh[0]?.id).toBe('fresh-attach');
    } finally {
      await relay.close();
    }
  });
});

// ---- Disconnect error recognition ------------------------------------------

describe('relay disconnect error recognition', () => {
  it('sendCommand fails fast with a disconnect message after WebSocket close', async () => {
    const relay = await createFakeRelay();
    const conn = new ChiiCdpConnection({
      relayBaseUrl: relay.baseUrl,
      commandTimeoutMs: 500,
    });

    try {
      await conn.enableDomains();

      // Force disconnect.
      relay.dropClient();
      await new Promise<void>((r) => setTimeout(r, 100));

      await expect(conn.sendCommand('Runtime.evaluate', { expression: '1' })).rejects.toThrow(
        /relay에 연결되어 있지 않습니다|relay WebSocket|connection closed/i,
      );
    } finally {
      conn.close();
      await relay.close();
    }
  });
});
