/**
 * Production `CdpConnection` backed by the local Chii relay.
 *
 * Topology (debug mode):
 *   phone target.js  --WS-->  Chii relay :9100  <--WS--  this connection
 *
 * The phone connects to the relay as a `target`; this module connects as a
 * `client` (the role a CDP frontend would take) so CDP events the page emits
 * (`Runtime.consoleAPICalled`, `Network.*`) flow back here. We buffer recent
 * events in ring buffers the tool layer reads via `getBufferedEvents`.
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

/** A CDP message arriving over the relay websocket. */
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

export interface ChiiCdpConnectionOptions {
  /** Base URL of the local Chii relay HTTP/WS server, e.g. `http://127.0.0.1:9100`. */
  relayBaseUrl: string;
  /** Per-domain ring buffer size. */
  bufferSize?: number;
  /**
   * Default per-command timeout in milliseconds.
   * Override via env `AIT_CDP_COMMAND_TIMEOUT_MS`.
   * Defaults to 30 000 ms (30s).
   */
  commandTimeoutMs?: number;
}

/** Default per-command timeout if neither option nor env var is set. */
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;

/**
 * Production CDP connection. Polls the relay for the first attached target,
 * opens a client websocket to it, enables Phase 1 domains, and buffers events.
 */
export class ChiiCdpConnection implements CdpConnection {
  private readonly relayBaseUrl: string;
  private readonly bufferSize: number;
  private readonly commandTimeoutMs: number;
  private readonly emitter = new EventEmitter();
  private readonly buffers = new Map<CdpEventName, unknown[]>();
  private readonly targets = new Map<string, CdpTarget>();

  private ws: WebSocket | null = null;
  private connectionState: 'idle' | 'connected' | 'disconnected' = 'idle';
  private nextCommandId = 1;
  /** In-flight enableDomains() promise — concurrent callers share it. */
  private enablingPromise: Promise<void> | null = null;
  /** Pending request→response commands keyed by CDP message id. */
  private readonly pending = new Map<
    number,
    { resolve: (result: unknown) => void; reject: (err: Error) => void }
  >();

  constructor(options: ChiiCdpConnectionOptions) {
    this.relayBaseUrl = options.relayBaseUrl.replace(/\/$/, '');
    this.bufferSize = options.bufferSize ?? DEFAULT_BUFFER_SIZE;
    const envMs = process.env.AIT_CDP_COMMAND_TIMEOUT_MS
      ? Number(process.env.AIT_CDP_COMMAND_TIMEOUT_MS)
      : undefined;
    this.commandTimeoutMs =
      (envMs !== undefined && Number.isFinite(envMs) && envMs > 0 ? envMs : undefined) ??
      options.commandTimeoutMs ??
      DEFAULT_COMMAND_TIMEOUT_MS;
    for (const event of PHASE_1_EVENTS) this.buffers.set(event, []);
    // EventEmitter caps listeners at 10 by default; the tool layer may add
    // several short-lived subscriptions, so lift the cap.
    this.emitter.setMaxListeners(0);
  }

  /** Refresh the attached-target list from the relay's `GET /targets`. */
  async refreshTargets(): Promise<CdpTarget[]> {
    const res = await fetch(`${this.relayBaseUrl}/targets`);
    if (!res.ok) {
      throw new Error(`Chii relay /targets returned HTTP ${res.status} ${res.statusText}`);
    }
    const body: unknown = await res.json();
    const list = isObject(body) && Array.isArray(body.targets) ? body.targets : [];
    this.targets.clear();
    for (const item of list) {
      if (!isObject(item) || typeof item.id !== 'string') continue;
      this.targets.set(item.id, {
        id: item.id,
        title: typeof item.title === 'string' ? item.title : '',
        url: typeof item.url === 'string' ? item.url : '',
      });
    }
    return [...this.targets.values()];
  }

  listTargets(): CdpTarget[] {
    return [...this.targets.values()];
  }

  /**
   * Connect a client websocket to the first attached target and enable Phase 1
   * domains. Resolves once the socket is open and enable commands are sent.
   */
  async enableDomains(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    // If a connect attempt is already in-flight, await it rather than racing
    // to open a second websocket that would overwrite `this.ws` and leak the first.
    if (this.enablingPromise) return this.enablingPromise;
    this.enablingPromise = this._doEnableDomains().finally(() => {
      this.enablingPromise = null;
    });
    return this.enablingPromise;
  }

  private async _doEnableDomains(): Promise<void> {
    const targets = await this.refreshTargets();
    const target = targets[0];
    if (!target) {
      throw new Error('No mini-app page attached to the Chii relay yet.');
    }

    const wsBase = this.relayBaseUrl.replace(/^http/, 'ws');
    const clientId = `devtools-mcp-${Date.now()}`;
    const ws = new WebSocket(
      `${wsBase}/client/${clientId}?target=${encodeURIComponent(target.id)}`,
    );
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', (err: Error) => reject(err));
    });

    this.connectionState = 'connected';
    ws.on('message', (data: WebSocket.RawData) => this.handleMessage(data.toString()));
    ws.on('close', () => this.handleDisconnect('relay WebSocket 연결이 끊겼습니다'));
    ws.on('error', (err: Error) => this.handleDisconnect(`relay WebSocket 오류: ${err.message}`));

    this.sendFireAndForget('Runtime.enable');
    this.sendFireAndForget('Network.enable');
    // DOM/Page domains back the Phase 2 command tools; Chii answers their
    // request→response commands once enabled.
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
   * Issue a CDP command and resolve with its result (Phase 2). Rejects on a CDP
   * error frame or when no websocket is open (no page attached yet).
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
   * Issue an arbitrary request→response command over the relay and resolve with
   * its raw result. Both the typed CDP {@link send} and the AIT domain (Phase 3
   * `AIT.*` methods, forwarded over the same Chii channel) build on this.
   *
   * Rejects immediately if the connection is disconnected (fail-fast — no
   * auto-reconnect). Caller should re-run `list_pages` or `enableDomains` to
   * reattach.
   *
   * Times out after `commandTimeoutMs` (default 30s, env
   * `AIT_CDP_COMMAND_TIMEOUT_MS`). On timeout the pending entry is cleaned up
   * and the promise rejects with a descriptive Korean error.
   */
  sendCommand(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    // Fail-fast: connection already known to be dead — don't write into a dead socket.
    if (this.connectionState === 'disconnected') {
      return Promise.reject(
        new Error(
          `relay에 연결되어 있지 않습니다 (${method}). list_pages로 attach 상태를 확인하고 enableDomains()로 재연결하세요.`,
        ),
      );
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(
        new Error('No mini-app page attached to the Chii relay yet. Call enableDomains() first.'),
      );
    }
    const id = this.nextCommandId++;
    const ws = this.ws;
    const timeoutMs = this.commandTimeoutMs;
    return new Promise<unknown>((resolve, reject) => {
      const handle = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `CDP 명령이 타임아웃됐습니다 (${method}, ${timeoutMs}ms). ` +
              '폰 측 토스 앱이 백그라운드로 내려갔거나 미니앱이 unload됐을 수 있습니다. ' +
              'list_pages로 attach 상태를 확인하세요.',
          ),
        );
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(handle);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(handle);
          reject(e);
        },
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /**
   * Called on WebSocket `close` or `error` after a successful connection.
   * Rejects all pending commands and marks the connection as disconnected so
   * subsequent `sendCommand` calls fail fast (no auto-reconnect).
   */
  private handleDisconnect(reason: string): void {
    if (this.connectionState === 'disconnected') return; // already handled
    this.connectionState = 'disconnected';
    this.ws = null;
    const err = new Error(
      `${reason}. list_pages로 attach 상태를 확인하고 enableDomains()로 재연결하세요.`,
    );
    for (const waiter of this.pending.values()) {
      waiter.reject(err);
    }
    this.pending.clear();
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

  /** Close the relay client websocket and reject any in-flight commands. */
  close(): void {
    const ws = this.ws;
    // handleDisconnect clears this.ws and pending; call it first so the 'close'
    // event from ws.close() below is a no-op (already disconnected).
    this.handleDisconnect('Chii relay connection closed');
    ws?.close();
  }
}
