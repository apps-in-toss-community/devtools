/**
 * Injectable CDP connection abstraction for the debug-mode MCP server.
 *
 * The Phase 1 tool layer (`list_console_messages`, `list_network_requests`,
 * `list_pages`) reads from CDP events captured off a Chii relay connection.
 * To keep that tool layer CI-verifiable without a phone roundtrip, the actual
 * relay websocket sits behind this interface. Production wires
 * `ChiiCdpConnection` (see `chii-connection.ts`); tests inject a fake that
 * emits canned `Runtime.consoleAPICalled` / `Network.*` events.
 *
 * Phase 2 adds CDP *commands* (request→response): `DOM.getDocument`,
 * `DOMSnapshot.captureSnapshot`, `Page.captureScreenshot`. Unlike Phase 1's
 * event streams these need a `send(method, params)` round-trip, so the
 * connection grows a typed `send`. The fake returns canned command results.
 *
 * Only the slice of the Chrome DevTools Protocol the tools need is typed here;
 * future write tools (e.g. `Runtime.evaluate`) will extend the command map.
 */

/** A target (page) the Chii relay currently sees attached. */
export interface CdpTarget {
  /** Chii's internal target id (session UUID). */
  id: string;
  /** Page title reported by the in-app target. */
  title: string;
  /** Page URL reported by the in-app target. */
  url: string;
}

/** `Runtime.RemoteObject` subset we surface for console args. */
export interface CdpRemoteObject {
  type: string;
  subtype?: string;
  value?: unknown;
  description?: string;
  className?: string;
}

/** Payload of a `Runtime.consoleAPICalled` event. */
export interface ConsoleApiCalledEvent {
  /** log | warning | error | info | debug | … */
  type: string;
  args: CdpRemoteObject[];
  /** Milliseconds since epoch (CDP `Runtime.Timestamp`). */
  timestamp: number;
  executionContextId?: number;
  stackTrace?: {
    callFrames: Array<{
      functionName: string;
      url: string;
      lineNumber: number;
      columnNumber: number;
    }>;
  };
}

/** Payload of a `Network.requestWillBeSent` event (subset). */
export interface NetworkRequestWillBeSentEvent {
  requestId: string;
  request: {
    url: string;
    method: string;
    headers?: Record<string, string>;
  };
  /** CDP `Network.MonotonicTime` (seconds). */
  timestamp: number;
  /** Wall-clock seconds since epoch, when available. */
  wallTime?: number;
  type?: string;
}

/** Payload of a `Network.responseReceived` event (subset). */
export interface NetworkResponseReceivedEvent {
  requestId: string;
  response: {
    url: string;
    status: number;
    statusText: string;
    mimeType?: string;
  };
  timestamp: number;
  type?: string;
}

/** Map of the CDP event names Phase 1 consumes to their payload shapes. */
export interface CdpEventMap {
  'Runtime.consoleAPICalled': ConsoleApiCalledEvent;
  'Network.requestWillBeSent': NetworkRequestWillBeSentEvent;
  'Network.responseReceived': NetworkResponseReceivedEvent;
}

export type CdpEventName = keyof CdpEventMap;

/* -------------------------------------------------------------------------- */
/* Phase 2 — CDP commands (request → response)                                */
/* -------------------------------------------------------------------------- */

/** A `DOM.Node` subset (recursive) returned by `DOM.getDocument`. */
export interface CdpDomNode {
  nodeId: number;
  /** CDP node type (1 = element, 3 = text, 9 = document, …). */
  nodeType: number;
  nodeName: string;
  /** Tag/local name for elements. */
  localName?: string;
  nodeValue?: string;
  /** Flattened attribute list: `[name, value, name, value, …]`. */
  attributes?: string[];
  childNodeCount?: number;
  children?: CdpDomNode[];
  documentURL?: string;
  baseURL?: string;
}

/** Result of `DOM.getDocument`. */
export interface DomGetDocumentResult {
  root: CdpDomNode;
}

/** Result of `DOMSnapshot.captureSnapshot` (subset we surface). */
export interface DomSnapshotResult {
  documents: unknown[];
  strings: string[];
}

/** Result of `Page.captureScreenshot`. */
export interface PageCaptureScreenshotResult {
  /** Base64-encoded image bytes (PNG by default). */
  data: string;
}

/**
 * Map of CDP command method → params/result shape. Keeps `send` typed so a
 * `DOM.getDocument` call resolves to a `DomGetDocumentResult`, etc.
 */
export interface CdpCommandMap {
  'DOM.getDocument': {
    params: { depth?: number; pierce?: boolean };
    result: DomGetDocumentResult;
  };
  'DOMSnapshot.captureSnapshot': {
    params: { computedStyles?: string[] };
    result: DomSnapshotResult;
  };
  'Page.captureScreenshot': {
    params: { format?: 'png' | 'jpeg' | 'webp'; quality?: number };
    result: PageCaptureScreenshotResult;
  };
}

export type CdpCommandName = keyof CdpCommandMap;

/**
 * The connection the tool layer reads from. The production implementation
 * wraps the Chii relay's CDP websocket; tests inject a fake.
 *
 * Implementations are expected to maintain an internal ring buffer of recent
 * events (so a tool call returns recent history rather than only live events).
 */
export interface CdpConnection {
  /**
   * Enable the CDP domains Phase 1 needs (`Runtime.enable`, `Network.enable`).
   * Idempotent. Resolves once the relay has acknowledged (or immediately for a
   * fake connection).
   */
  enableDomains(): Promise<void>;

  /** Targets (pages) the relay currently sees attached. */
  listTargets(): CdpTarget[];

  /** Recent buffered events for a domain, oldest-first. */
  getBufferedEvents<E extends CdpEventName>(event: E): ReadonlyArray<CdpEventMap[E]>;

  /** Subscribe to live events. Returns an unsubscribe function. */
  on<E extends CdpEventName>(event: E, listener: (payload: CdpEventMap[E]) => void): () => void;

  /**
   * Issue a CDP command (request → response). Phase 2's DOM/snapshot/screenshot
   * tools use this; resolves with the typed result or rejects on a CDP error.
   * Implementations must have called {@link enableDomains} first.
   */
  send<M extends CdpCommandName>(
    method: M,
    params?: CdpCommandMap[M]['params'],
  ): Promise<CdpCommandMap[M]['result']>;
}
