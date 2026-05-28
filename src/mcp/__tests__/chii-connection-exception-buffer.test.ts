/**
 * Unit tests for Runtime.exceptionThrown ring buffer in ChiiCdpConnection.
 *
 * Coverage (#267):
 *   - `Runtime.exceptionThrown` events are buffered with normalized fields.
 *   - Ring buffer caps at EXCEPTION_BUFFER_SIZE (50); oldest is dropped.
 *   - Buffer survives target replacement (replaced lifecycle) — an exception
 *     fired just before a crash must not be lost.
 *   - Buffer survives target crash (Inspector.targetCrashed).
 */

import http from 'node:http';
import { describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { ChiiCdpConnection } from '../chii-connection.js';

// ---- Fake relay helpers (same pattern as chii-connection.test.ts) -----------

interface FakeRelay {
  baseUrl: string;
  sendToClient(msg: object): void;
  close(): Promise<void>;
}

async function createFakeRelay(): Promise<FakeRelay> {
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
    sendToClient(msg: object) {
      const raw = JSON.stringify(msg);
      if (clientSocket) {
        clientSocket.send(raw);
      } else {
        pendingOutbound.push(raw);
      }
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

/** Waits until `predicate()` returns true (polling 20 ms) or times out. */
async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise<void>((r) => setTimeout(r, 20));
  }
}

// ---- Helpers to build CDP event frames -------------------------------------

function makeExceptionEvent(timestamp: number, text = 'Uncaught TypeError') {
  return {
    method: 'Runtime.exceptionThrown',
    params: {
      timestamp,
      exceptionDetails: {
        exceptionId: 1,
        text,
        lineNumber: 5,
        columnNumber: 0,
        url: 'https://example/app.js',
        exception: { type: 'object', subtype: 'error', description: `${text}: bad args` },
        stackTrace: {
          callFrames: [
            {
              functionName: 'callSdk',
              url: 'https://example/app.js',
              lineNumber: 5,
              columnNumber: 0,
            },
          ],
        },
      },
    },
  };
}

// ---- Tests -----------------------------------------------------------------

describe('ChiiCdpConnection — Runtime.exceptionThrown ring buffer', () => {
  it('buffers a single exception event with correct fields', async () => {
    const relay = await createFakeRelay();
    const conn = new ChiiCdpConnection({ relayBaseUrl: relay.baseUrl, commandTimeoutMs: 500 });

    try {
      await conn.enableDomains();
      relay.sendToClient(makeExceptionEvent(1_700_000_100_000, 'Uncaught TypeError'));

      await waitFor(() => conn.getBufferedEvents('Runtime.exceptionThrown').length === 1);

      const events = conn.getBufferedEvents('Runtime.exceptionThrown');
      expect(events).toHaveLength(1);
      const e = events[0];
      expect(e?.timestamp).toBe(1_700_000_100_000);
      expect(e?.exceptionDetails.text).toBe('Uncaught TypeError');
      expect(e?.exceptionDetails.url).toBe('https://example/app.js');
      expect(e?.exceptionDetails.stackTrace?.callFrames).toHaveLength(1);
    } finally {
      conn.close();
      await relay.close();
    }
  });

  it('ring buffer caps at 50 — oldest is evicted when full', async () => {
    const relay = await createFakeRelay();
    const conn = new ChiiCdpConnection({ relayBaseUrl: relay.baseUrl, commandTimeoutMs: 500 });

    try {
      await conn.enableDomains();

      // Send 55 exception events.
      for (let i = 0; i < 55; i++) {
        relay.sendToClient(makeExceptionEvent(i + 1));
      }

      await waitFor(() => conn.getBufferedEvents('Runtime.exceptionThrown').length >= 50, 2000);

      const events = conn.getBufferedEvents('Runtime.exceptionThrown');
      expect(events.length).toBe(50);
      // The oldest retained event should be timestamp=6 (i.e. 55-50+1=6).
      expect(events[0]?.timestamp).toBe(6);
      // The newest should be timestamp=55.
      expect(events[events.length - 1]?.timestamp).toBe(55);
    } finally {
      conn.close();
      await relay.close();
    }
  });

  it('exception buffer survives target replacement (replaced lifecycle)', async () => {
    const relay = await createFakeRelay();
    const conn = new ChiiCdpConnection({ relayBaseUrl: relay.baseUrl, commandTimeoutMs: 500 });

    try {
      await conn.enableDomains();

      // Emit an exception, then simulate a target replacement.
      relay.sendToClient(makeExceptionEvent(999, 'TypeError: before crash'));

      await waitFor(() => conn.getBufferedEvents('Runtime.exceptionThrown').length === 1);

      // Send a replaced lifecycle — a new attach evicts the old target.
      // The chii-connection's `refreshTargets` does the eviction, but we can also
      // simulate by sending Target.targetDestroyed and then checking the buffer
      // is still intact (the buffer is not cleared on lifecycle events by design).
      relay.sendToClient({ method: 'Target.targetDestroyed', params: { targetId: 'target-1' } });

      // Allow the message to be processed.
      await new Promise<void>((r) => setTimeout(r, 50));

      // Buffer must still contain the pre-crash exception.
      const events = conn.getBufferedEvents('Runtime.exceptionThrown');
      expect(events).toHaveLength(1);
      expect(events[0]?.exceptionDetails.text).toBe('TypeError: before crash');
    } finally {
      conn.close();
      await relay.close();
    }
  });

  it('exception buffer survives Inspector.targetCrashed', async () => {
    const relay = await createFakeRelay();
    const conn = new ChiiCdpConnection({ relayBaseUrl: relay.baseUrl, commandTimeoutMs: 500 });

    try {
      await conn.enableDomains();

      relay.sendToClient(makeExceptionEvent(123, 'RangeError: stack overflow'));
      await waitFor(() => conn.getBufferedEvents('Runtime.exceptionThrown').length === 1);

      // Simulate page crash.
      relay.sendToClient({ method: 'Inspector.targetCrashed', params: {} });
      await new Promise<void>((r) => setTimeout(r, 50));

      // Exception from before the crash is still in the buffer.
      const events = conn.getBufferedEvents('Runtime.exceptionThrown');
      expect(events).toHaveLength(1);
      expect(events[0]?.exceptionDetails.text).toBe('RangeError: stack overflow');
      expect(events[0]?.timestamp).toBe(123);
    } finally {
      conn.close();
      await relay.close();
    }
  });
});
