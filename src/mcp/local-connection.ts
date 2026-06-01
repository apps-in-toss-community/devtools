/**
 * Local-browser `CdpConnection` — attaches directly to a Chromium instance
 * started with `--remote-debugging-port=<port>`.
 *
 * Topology (local debug mode, env 1):
 *   Chromium  --CDP WS-->  this connection  <--stdio-->  MCP host
 *
 * The core insight: local Chromium and the phone's Toss WebView both speak
 * Chrome DevTools Protocol. The only difference is the attach strategy — how
 * you reach the CDP endpoint. Here we hit the Chromium DevTools HTTP endpoint
 * (`GET /json`) to discover per-target websocket URLs, then connect directly.
 * The Chii relay (env 2/3) uses `GET /targets` + `/client/<id>?target=<id>`.
 * Every tool (list_console_messages, get_dom_document, take_screenshot, …)
 * reads only the `CdpConnection` interface and works unchanged on both.
 *
 * Node-only: imports `ws`. Never bundled into the browser/in-app entries.
 */

import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';
import type {
  CdpCommandMap,
  CdpCommandName,
  CdpConnection,
  CdpEventMap,
  CdpEventName,
  CdpTarget,
} from './cdp-connection.js';

/** Max events retained per domain ring buffer. */
const DEFAULT_BUFFER_SIZE = 500;

/** A CDP message arriving over the local Chromium websocket. */
interface CdpInboundMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message: string };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseInbound(raw: string): CdpInboundMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(parsed)) return null;
  const message: CdpInboundMessage = {};
  if (typeof parsed.id === 'number') message.id = parsed.id;
  if (typeof parsed.method === 'string') message.method = parsed.method;
  if ('params' in parsed) message.params = parsed.params;
  if ('result' in parsed) message.result = parsed.result;
  if (isObject(parsed.error) && typeof parsed.error.message === 'string') {
    message.error = { message: parsed.error.message };
  }
  return message;
}

const PHASE_1_EVENTS: readonly CdpEventName[] = [
  'Runtime.consoleAPICalled',
  'Network.requestWillBeSent',
  'Network.responseReceived',
];

/**
 * A target entry from the Chromium DevTools HTTP `/json` endpoint.
 * Each page target includes a `webSocketDebuggerUrl` pointing directly at the
 * target's CDP websocket — no relay URL indirection.
 */
interface ChromiumJsonTarget {
  id: string;
  title: string;
  url: string;
  type: string;
  webSocketDebuggerUrl?: string;
}

export interface LocalCdpConnectionOptions {
  /**
   * Base URL of the Chromium DevTools HTTP server, e.g. `http://127.0.0.1:9222`.
   * The connection hits `<devtoolsHttpUrl>/json` to discover targets.
   */
  devtoolsHttpUrl: string;
  /** Per-domain ring buffer size. Default 500. */
  bufferSize?: number;
}

/**
 * `CdpConnection` that attaches directly to a local Chromium over its built-in
 * CDP websocket. Mirrors `ChiiCdpConnection`'s buffering/command-routing/event
 * logic — same `parseInbound`, ring-buffer, `pending` map patterns — but the
 * attach strategy differs:
 *
 *   Chii relay: `GET /targets` → open `/client/<id>?target=<id>` WS
 *   Local CDP:  `GET /json`    → open `webSocketDebuggerUrl` per target directly
 *
 * Target selection: first `type === 'page'` target whose URL is not
 * `about:blank`, `about:newtab`, or a devtools:// URL.
 */
export class LocalCdpConnection implements CdpConnection {
  /** Authoritative connection kind (issue #348) — local Chromium CDP. */
  readonly kind = 'local' as const;

  private readonly devtoolsHttpUrl: string;
  private readonly bufferSize: number;
  private readonly emitter = new EventEmitter();
  private readonly buffers = new Map<CdpEventName, unknown[]>();
  private readonly targets = new Map<string, CdpTarget>();

  private ws: WebSocket | null = null;
  private nextCommandId = 1;
  /** In-flight enableDomains() promise — concurrent callers share it. */
  private enablingPromise: Promise<void> | null = null;
  /** Pending request→response commands keyed by CDP message id. */
  private readonly pending = new Map<
    number,
    { resolve: (result: unknown) => void; reject: (err: Error) => void }
  >();

  constructor(options: LocalCdpConnectionOptions) {
    this.devtoolsHttpUrl = options.devtoolsHttpUrl.replace(/\/$/, '');
    this.bufferSize = options.bufferSize ?? DEFAULT_BUFFER_SIZE;
    for (const event of PHASE_1_EVENTS) this.buffers.set(event, []);
    // EventEmitter caps listeners at 10 by default; the tool layer may add
    // several short-lived subscriptions, so lift the cap.
    this.emitter.setMaxListeners(0);
  }

  /**
   * Fetch the target list from the Chromium DevTools `/json` (or `/json/list`)
   * endpoint and pick the first non-blank page target.
   *
   * Returns the selected target's `webSocketDebuggerUrl` alongside the
   * normalized `CdpTarget` list (all page targets visible to the server).
   */
  private async fetchTargets(): Promise<{
    selected: ChromiumJsonTarget | null;
    all: CdpTarget[];
  }> {
    // Chromium exposes both /json and /json/list; /json is the canonical form.
    const res = await fetch(`${this.devtoolsHttpUrl}/json`);
    if (!res.ok) {
      throw new Error(
        `Chromium DevTools /json returned HTTP ${res.status} ${res.statusText}. ` +
          'Is the browser running with --remote-debugging-port?',
      );
    }
    const body: unknown = await res.json();
    const list: ChromiumJsonTarget[] = Array.isArray(body) ? (body as ChromiumJsonTarget[]) : [];

    this.targets.clear();
    let selected: ChromiumJsonTarget | null = null;

    for (const item of list) {
      if (!isObject(item) || typeof item.id !== 'string') continue;
      const cdpTarget: CdpTarget = {
        id: item.id,
        title: typeof item.title === 'string' ? item.title : '',
        url: typeof item.url === 'string' ? item.url : '',
      };
      this.targets.set(item.id, cdpTarget);

      // Pick the first `page` target that is not a blank/devtools page.
      if (
        selected === null &&
        item.type === 'page' &&
        typeof item.webSocketDebuggerUrl === 'string' &&
        !isBlankOrDevtoolsUrl(item.url)
      ) {
        selected = item;
      }
    }

    return { selected, all: [...this.targets.values()] };
  }

  listTargets(): CdpTarget[] {
    return [...this.targets.values()];
  }

  /**
   * Discover the target, open a direct CDP websocket to its
   * `webSocketDebuggerUrl`, and enable Phase 1+2 domains. Resolves once the
   * socket is open and domain-enable commands are sent. Idempotent — concurrent
   * callers share the in-flight promise.
   */
  async enableDomains(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this.enablingPromise) return this.enablingPromise;
    this.enablingPromise = this._doEnableDomains().finally(() => {
      this.enablingPromise = null;
    });
    return this.enablingPromise;
  }

  private async _doEnableDomains(): Promise<void> {
    const { selected } = await this.fetchTargets();
    if (!selected) {
      throw new Error(
        'No suitable page target found in the local Chromium instance. ' +
          'Ensure the browser has a non-blank page open and was started with ' +
          '--remote-debugging-port matching devtoolsHttpUrl.',
      );
    }

    // Local CDP gives us the per-target WS URL directly — no relay path needed.
    const wsUrl = selected.webSocketDebuggerUrl as string;
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', (err: Error) => reject(err));
    });

    ws.on('message', (data: WebSocket.RawData) => this.handleMessage(data.toString()));

    // Enable the same domain set as ChiiCdpConnection so all tools work identically.
    this.sendFireAndForget('Runtime.enable');
    this.sendFireAndForget('Network.enable');
    this.sendFireAndForget('DOM.enable');
    this.sendFireAndForget('Page.enable');
  }

  /** Fire-and-forget CDP message (used for `*.enable`, no result awaited). */
  private sendFireAndForget(method: string, params: Record<string, unknown> = {}): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const id = this.nextCommandId++;
    this.ws.send(JSON.stringify({ id, method, params }));
  }

  /**
   * Issue a CDP command and resolve with its typed result. Rejects on a CDP
   * error frame or when no websocket is open.
   */
  send<M extends CdpCommandName>(
    method: M,
    params?: CdpCommandMap[M]['params'],
  ): Promise<CdpCommandMap[M]['result']> {
    return this.sendCommand(method, (params ?? {}) as Record<string, unknown>) as Promise<
      CdpCommandMap[M]['result']
    >;
  }

  /**
   * Issue an arbitrary request→response command and resolve with its raw
   * result. Both the typed CDP `send` and any AIT domain commands build on this.
   */
  sendCommand(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(
        new Error(
          'No local Chromium page attached yet. Call enableDomains() first and ensure ' +
            'the browser is running with --remote-debugging-port.',
        ),
      );
    }
    const id = this.nextCommandId++;
    const ws = this.ws;
    return new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  private handleMessage(raw: string): void {
    const message = parseInbound(raw);
    if (!message) return;

    // Command response (has an id matching a pending request).
    if (typeof message.id === 'number' && this.pending.has(message.id)) {
      const waiter = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (waiter) {
        if (message.error) waiter.reject(new Error(message.error.message));
        else waiter.resolve(message.result);
      }
      return;
    }

    // Event (buffered for the Phase 1 stream tools).
    if (typeof message.method !== 'string') return;
    if (!this.buffers.has(message.method as CdpEventName)) return;
    const event = message.method as CdpEventName;
    const buffer = this.buffers.get(event);
    if (!buffer) return;
    buffer.push(message.params);
    if (buffer.length > this.bufferSize) buffer.shift();
    this.emitter.emit(event, message.params);
  }

  getBufferedEvents<E extends CdpEventName>(event: E): ReadonlyArray<CdpEventMap[E]> {
    const buffer = this.buffers.get(event);
    return (buffer ?? []) as ReadonlyArray<CdpEventMap[E]>;
  }

  on<E extends CdpEventName>(event: E, listener: (payload: CdpEventMap[E]) => void): () => void {
    this.emitter.on(event, listener as (payload: unknown) => void);
    return () => this.emitter.off(event, listener as (payload: unknown) => void);
  }

  /** Close the local CDP websocket and reject any in-flight commands. */
  close(): void {
    this.ws?.close();
    this.ws = null;
    for (const waiter of this.pending.values()) {
      waiter.reject(new Error('Local Chromium CDP connection closed.'));
    }
    this.pending.clear();
  }
}

/** True for URLs that should be skipped when selecting a page target. */
function isBlankOrDevtoolsUrl(url: string): boolean {
  return (
    url === '' ||
    url === 'about:blank' ||
    url === 'about:newtab' ||
    url.startsWith('devtools://') ||
    url.startsWith('chrome://') ||
    url.startsWith('chrome-extension://')
  );
}
