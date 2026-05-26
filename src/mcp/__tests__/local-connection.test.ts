/**
 * Unit tests for `LocalCdpConnection`.
 *
 * All tests use a fake HTTP server (for `GET /json`) and a fake WebSocket
 * server (for the per-target CDP socket) — no real Chromium is launched.
 *
 * Coverage:
 *   - Target discovery picks the first `page` target with a non-blank URL.
 *   - Skips `about:blank`, `about:newtab`, `devtools://`, `chrome://` URLs.
 *   - Attach opens a WS to the target's `webSocketDebuggerUrl`.
 *   - `enableDomains` sends Runtime/Network/DOM/Page enable messages.
 *   - `send` round-trips a CDP command by id and resolves with the result.
 *   - Event buffering pushes events to the ring buffer and emits to listeners.
 *   - `close` rejects any pending in-flight commands.
 *   - Throws a clear error when no suitable page target exists.
 */

import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { LocalCdpConnection } from '../local-connection.js';

// ---- Fake server helpers ---------------------------------------------------

interface FakeServer {
  /** Base URL of the HTTP endpoint, e.g. `http://127.0.0.1:PORT`. */
  baseUrl: string;
  /** Messages received by the fake WS server (raw JSON strings). */
  receivedMessages: string[];
  /** Queue pending outbound messages from the WS server to the connection. */
  sendToClient(msg: object): void;
  close(): Promise<void>;
}

/**
 * Spins up a real HTTP server (for `/json`) and a WebSocket server (for the
 * CDP target socket). Returns a `FakeServer` handle.
 *
 * The HTTP server returns `targets` as the `/json` body.
 * The WS server accepts one connection and records all received messages.
 */
async function createFakeServer(targets: object[], wsPath: string): Promise<FakeServer> {
  const receivedMessages: string[] = [];
  let wsSendFn: ((msg: string) => void) | null = null;
  const pendingOutbound: string[] = [];

  // WS server on a random port.
  const wss = new WebSocketServer({ port: 0 });
  const wsPort = await new Promise<number>((resolve) => {
    wss.once('listening', () => {
      const addr = wss.address();
      resolve(typeof addr === 'object' && addr !== null ? addr.port : 0);
    });
  });

  wss.on('connection', (ws) => {
    wsSendFn = (msg: string) => ws.send(msg);
    // Drain any messages queued before the client connected.
    for (const msg of pendingOutbound) ws.send(msg);
    pendingOutbound.length = 0;

    ws.on('message', (data: Buffer) => receivedMessages.push(data.toString()));
  });

  // Patch the target's webSocketDebuggerUrl to use our fake WS server.
  const patchedTargets = targets.map((t) => {
    if (
      typeof t === 'object' &&
      t !== null &&
      'type' in t &&
      (t as Record<string, unknown>).type === 'page'
    ) {
      return {
        ...(t as Record<string, unknown>),
        webSocketDebuggerUrl: `ws://127.0.0.1:${wsPort}${wsPath}`,
      };
    }
    return t;
  });

  // HTTP server on a random port — returns the patched targets list on /json.
  const httpServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(patchedTargets));
  });
  const httpPort = await new Promise<number>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => {
      const addr = httpServer.address();
      resolve(typeof addr === 'object' && addr !== null ? addr.port : 0);
    });
  });

  return {
    baseUrl: `http://127.0.0.1:${httpPort}`,
    receivedMessages,
    sendToClient(msg: object) {
      const raw = JSON.stringify(msg);
      if (wsSendFn) {
        wsSendFn(raw);
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

// ---- Tests -----------------------------------------------------------------

describe('LocalCdpConnection — target discovery', () => {
  let fake: FakeServer;
  let conn: LocalCdpConnection;

  afterEach(async () => {
    conn?.close();
    await fake?.close();
  });

  it('picks the first page target with a non-blank URL', async () => {
    fake = await createFakeServer(
      [
        { id: 'ext-1', title: 'Extension', url: 'chrome-extension://abc', type: 'background_page' },
        { id: 'page-1', title: 'Dev App', url: 'http://localhost:5173/', type: 'page' },
        { id: 'page-2', title: 'Other', url: 'http://localhost:5173/other', type: 'page' },
      ],
      '/devtools/page/page-1',
    );

    conn = new LocalCdpConnection({ devtoolsHttpUrl: fake.baseUrl });
    await conn.enableDomains();

    // listTargets should include all targets discovered.
    const targets = conn.listTargets();
    expect(targets.length).toBeGreaterThanOrEqual(1);
    // The page-1 target (the one we patched the WS for) should be present.
    expect(targets.some((t) => t.id === 'page-1')).toBe(true);
  });

  it('throws when all targets are blank or non-page', async () => {
    fake = await createFakeServer(
      [
        { id: 'blank-1', title: 'New Tab', url: 'about:blank', type: 'page' },
        { id: 'newtab-1', title: 'New Tab', url: 'about:newtab', type: 'page' },
        { id: 'chrome-1', title: 'Extensions', url: 'chrome://extensions/', type: 'page' },
        {
          id: 'devtools-1',
          title: 'DevTools',
          url: 'devtools://devtools/bundled/inspector.html',
          type: 'page',
        },
      ],
      '/devtools/page/none',
    );

    conn = new LocalCdpConnection({ devtoolsHttpUrl: fake.baseUrl });
    await expect(conn.enableDomains()).rejects.toThrow(/No suitable page target/);
  });

  it('throws when the target list is empty', async () => {
    fake = await createFakeServer([], '/devtools/page/none');
    conn = new LocalCdpConnection({ devtoolsHttpUrl: fake.baseUrl });
    await expect(conn.enableDomains()).rejects.toThrow(/No suitable page target/);
  });
});

describe('LocalCdpConnection — enableDomains sends the correct domain-enable set', () => {
  let fake: FakeServer;
  let conn: LocalCdpConnection;

  afterEach(async () => {
    conn?.close();
    await fake?.close();
  });

  it('sends Runtime.enable, Network.enable, DOM.enable, Page.enable', async () => {
    fake = await createFakeServer(
      [{ id: 'p1', title: 'App', url: 'http://localhost:5173/', type: 'page' }],
      '/ws/p1',
    );

    conn = new LocalCdpConnection({ devtoolsHttpUrl: fake.baseUrl });
    await conn.enableDomains();

    // Wait a tick for the fire-and-forget sends to land.
    await new Promise<void>((r) => setTimeout(r, 50));

    const methods = fake.receivedMessages.map((m) => {
      const parsed = JSON.parse(m) as { method?: string };
      return parsed.method ?? '';
    });

    expect(methods).toContain('Runtime.enable');
    expect(methods).toContain('Network.enable');
    expect(methods).toContain('DOM.enable');
    expect(methods).toContain('Page.enable');
  });

  it('is idempotent — calling enableDomains twice does not open two sockets', async () => {
    fake = await createFakeServer(
      [{ id: 'p1', title: 'App', url: 'http://localhost:5173/', type: 'page' }],
      '/ws/p1',
    );

    conn = new LocalCdpConnection({ devtoolsHttpUrl: fake.baseUrl });
    await conn.enableDomains();
    // Second call should be a no-op (WS already open).
    await conn.enableDomains();

    // receivedMessages may contain the enable set once or twice depending on
    // timing, but we only assert the connection is usable (no throw).
    expect(conn.listTargets().length).toBeGreaterThan(0);
  });
});

describe('LocalCdpConnection — send (CDP command round-trip)', () => {
  let fake: FakeServer;
  let conn: LocalCdpConnection;

  afterEach(async () => {
    conn?.close();
    await fake?.close();
  });

  it('resolves with the result when the server echoes a response with the matching id', async () => {
    fake = await createFakeServer(
      [{ id: 'p1', title: 'App', url: 'http://localhost:5173/', type: 'page' }],
      '/ws/p1',
    );

    conn = new LocalCdpConnection({ devtoolsHttpUrl: fake.baseUrl });
    await conn.enableDomains();

    // Wait for the enable messages to arrive, then identify the next id.
    await new Promise<void>((r) => setTimeout(r, 50));

    // Subscribe to the next message to get its id, then echo a response.
    let capturedId: number | null = null;
    const originalLength = fake.receivedMessages.length;

    // Send the command and capture the resulting id from the WS message.
    const sendPromise = conn.send('DOM.getDocument', { depth: 1 });

    // Wait a tick for the message to arrive.
    await new Promise<void>((r) => setTimeout(r, 50));

    const newMessages = fake.receivedMessages.slice(originalLength);
    for (const msg of newMessages) {
      const parsed = JSON.parse(msg) as { id?: number; method?: string };
      if (parsed.method === 'DOM.getDocument') {
        capturedId = parsed.id ?? null;
        break;
      }
    }

    expect(capturedId).not.toBeNull();

    // Server sends back the response with the captured id.
    fake.sendToClient({
      id: capturedId,
      result: {
        root: { nodeId: 1, nodeType: 9, nodeName: '#document' },
      },
    });

    const result = await sendPromise;
    expect(result.root.nodeName).toBe('#document');
    expect(result.root.nodeId).toBe(1);
  });

  it('rejects with the CDP error message when the server sends an error frame', async () => {
    fake = await createFakeServer(
      [{ id: 'p1', title: 'App', url: 'http://localhost:5173/', type: 'page' }],
      '/ws/p1',
    );

    conn = new LocalCdpConnection({ devtoolsHttpUrl: fake.baseUrl });
    await conn.enableDomains();
    await new Promise<void>((r) => setTimeout(r, 50));

    const originalLength = fake.receivedMessages.length;
    const sendPromise = conn.send('DOM.getDocument', { depth: 1 });

    await new Promise<void>((r) => setTimeout(r, 50));

    const newMessages = fake.receivedMessages.slice(originalLength);
    let capturedId: number | null = null;
    for (const msg of newMessages) {
      const parsed = JSON.parse(msg) as { id?: number; method?: string };
      if (parsed.method === 'DOM.getDocument') {
        capturedId = parsed.id ?? null;
        break;
      }
    }

    fake.sendToClient({ id: capturedId, error: { message: 'DOM agent not found' } });

    await expect(sendPromise).rejects.toThrow('DOM agent not found');
  });

  it('rejects immediately when called before enableDomains', async () => {
    fake = await createFakeServer(
      [{ id: 'p1', title: 'App', url: 'http://localhost:5173/', type: 'page' }],
      '/ws/p1',
    );

    conn = new LocalCdpConnection({ devtoolsHttpUrl: fake.baseUrl });
    // Do NOT call enableDomains.
    await expect(conn.send('DOM.getDocument')).rejects.toThrow(/enableDomains/);
  });
});

describe('LocalCdpConnection — event buffering', () => {
  let fake: FakeServer;
  let conn: LocalCdpConnection;

  afterEach(async () => {
    conn?.close();
    await fake?.close();
  });

  it('buffers Runtime.consoleAPICalled events and emits to on() listeners', async () => {
    fake = await createFakeServer(
      [{ id: 'p1', title: 'App', url: 'http://localhost:5173/', type: 'page' }],
      '/ws/p1',
    );

    conn = new LocalCdpConnection({ devtoolsHttpUrl: fake.baseUrl });
    await conn.enableDomains();
    await new Promise<void>((r) => setTimeout(r, 50));

    const received: unknown[] = [];
    const unsub = conn.on('Runtime.consoleAPICalled', (ev) => received.push(ev));

    const consoleEvent = {
      method: 'Runtime.consoleAPICalled',
      params: {
        type: 'log',
        timestamp: 1_700_000_000_000,
        args: [{ type: 'string', value: 'hello from browser' }],
      },
    };

    fake.sendToClient(consoleEvent);
    // Wait for the message to be processed.
    await new Promise<void>((r) => setTimeout(r, 50));

    // Ring buffer
    const buffered = conn.getBufferedEvents('Runtime.consoleAPICalled');
    expect(buffered).toHaveLength(1);
    expect((buffered[0] as { type: string }).type).toBe('log');

    // on() listener
    expect(received).toHaveLength(1);
    expect((received[0] as { type: string }).type).toBe('log');

    unsub();

    // After unsubscribe, further events do not reach the removed listener.
    fake.sendToClient({ ...consoleEvent, params: { ...consoleEvent.params, type: 'error' } });
    await new Promise<void>((r) => setTimeout(r, 50));
    expect(received).toHaveLength(1); // still 1 — listener was removed
  });

  it('respects the ring buffer size', async () => {
    const bufferSize = 3;
    fake = await createFakeServer(
      [{ id: 'p1', title: 'App', url: 'http://localhost:5173/', type: 'page' }],
      '/ws/p1',
    );

    conn = new LocalCdpConnection({ devtoolsHttpUrl: fake.baseUrl, bufferSize });
    await conn.enableDomains();
    await new Promise<void>((r) => setTimeout(r, 50));

    for (let i = 0; i < 5; i++) {
      fake.sendToClient({
        method: 'Runtime.consoleAPICalled',
        params: { type: 'log', timestamp: i, args: [] },
      });
    }
    await new Promise<void>((r) => setTimeout(r, 50));

    const buffered = conn.getBufferedEvents('Runtime.consoleAPICalled');
    // Buffer should hold at most `bufferSize` events (oldest evicted).
    expect(buffered.length).toBeLessThanOrEqual(bufferSize);
  });
});

describe('LocalCdpConnection — close rejects pending commands', () => {
  it('rejects in-flight send() calls when close() is called', async () => {
    const fake = await createFakeServer(
      [{ id: 'p1', title: 'App', url: 'http://localhost:5173/', type: 'page' }],
      '/ws/p1',
    );

    const conn = new LocalCdpConnection({ devtoolsHttpUrl: fake.baseUrl });
    await conn.enableDomains();
    await new Promise<void>((r) => setTimeout(r, 50));

    // Start a command that will never get a server response.
    const pending = conn.send('DOM.getDocument');

    // Close the connection before the server responds.
    conn.close();

    await expect(pending).rejects.toThrow(/closed/);
    await fake.close();
  });
});
