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
import type { CdpConnection, CdpEventMap, CdpEventName, CdpTarget } from './cdp-connection.js';

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
}

/**
 * Production CDP connection. Polls the relay for the first attached target,
 * opens a client websocket to it, enables Phase 1 domains, and buffers events.
 */
export class ChiiCdpConnection implements CdpConnection {
  private readonly relayBaseUrl: string;
  private readonly bufferSize: number;
  private readonly emitter = new EventEmitter();
  private readonly buffers = new Map<CdpEventName, unknown[]>();
  private readonly targets = new Map<string, CdpTarget>();

  private ws: WebSocket | null = null;
  private nextCommandId = 1;

  constructor(options: ChiiCdpConnectionOptions) {
    this.relayBaseUrl = options.relayBaseUrl.replace(/\/$/, '');
    this.bufferSize = options.bufferSize ?? DEFAULT_BUFFER_SIZE;
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

    ws.on('message', (data: WebSocket.RawData) => this.handleMessage(data.toString()));

    this.send('Runtime.enable');
    this.send('Network.enable');
  }

  private send(method: string, params: Record<string, unknown> = {}): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const id = this.nextCommandId++;
    this.ws.send(JSON.stringify({ id, method, params }));
  }

  private handleMessage(raw: string): void {
    const message = parseInbound(raw);
    if (!message || typeof message.method !== 'string') return;
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

  /** Close the relay client websocket. */
  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
