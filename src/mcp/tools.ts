/**
 * Debug-mode MCP tools (Phase 1–3).
 *
 * Read-only tools that normalize CDP / AIT data into `chrome-devtools-mcp`-
 * compatible shapes. The tools never touch a websocket or HTTP endpoint
 * directly — they read from an injected `CdpConnection` (CDP events/commands)
 * or `AitSource` (AIT.* domain), which is what makes them unit-testable with a
 * fake. No phone and no running dev server are needed in tests.
 *
 *   Phase 1 (CDP events):
 *     - `list_console_messages`  ← Runtime.consoleAPICalled
 *     - `list_network_requests`  ← Network.requestWillBeSent + responseReceived
 *     - `list_pages`             ← Chii relay target list + tunnel status
 *   Phase 2 (CDP commands):
 *     - `get_dom_document`       ← DOM.getDocument
 *     - `take_snapshot`          ← DOMSnapshot.captureSnapshot
 *     - `take_screenshot`        ← Page.captureScreenshot
 *   Phase 3 (AIT.* domain — CDP can't cover these):
 *     - `AIT.getSdkCallHistory`
 *     - `AIT.getMockState`
 *     - `AIT.getOperationalEnvironment`
 */

import type {
  AitMockState,
  AitOperationalEnvironment,
  AitSdkCallHistory,
  AitSource,
} from './ait-source.js';
import type {
  CdpConnection,
  CdpRemoteObject,
  ConsoleApiCalledEvent,
  DomGetDocumentResult,
  DomSnapshotResult,
  NetworkRequestWillBeSentEvent,
  NetworkResponseReceivedEvent,
} from './cdp-connection.js';

/** Tunnel state surfaced by `list_pages`. */
export interface TunnelStatus {
  /** Whether the cloudflared quick tunnel is up. */
  up: boolean;
  /** Public `wss://*.trycloudflare.com` relay URL the phone attaches to. */
  wssUrl: string | null;
}

/** Static MCP tool descriptors (name + JSONSchema) for the Phase 1 surface. */
export const DEBUG_TOOL_DEFINITIONS = [
  {
    name: 'list_console_messages',
    description:
      'Lists recent console messages (console.log/warn/error/info) captured from the attached ' +
      'mini-app page over CDP (Runtime.consoleAPICalled). Read-only. Returns level, text, ' +
      'timestamp, and stringified args, oldest-first.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_network_requests',
    description:
      'Lists recent network requests (XHR/fetch) captured from the attached mini-app page over ' +
      'CDP (Network.requestWillBeSent + Network.responseReceived). Read-only. Returns url, ' +
      'method, status, and timing, oldest-first.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_pages',
    description:
      'Lists the mini-app page(s) the Chii relay currently sees attached, plus whether the ' +
      'cloudflared tunnel is up and the public wss relay URL the phone uses to attach. ' +
      'Call this first to confirm a page is attached before reading console/network.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_dom_document',
    description:
      'Returns the DOM tree of the attached mini-app page over CDP (DOM.getDocument). Read-only. ' +
      'Use for structural/layout regression diagnosis (e.g. confirming an element exists, ' +
      'inspecting attributes). Returns the document root node with children.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'take_snapshot',
    description:
      'Captures a serialized snapshot of the attached page over CDP (DOMSnapshot.captureSnapshot). ' +
      'Read-only. Returns the documents + interned strings table for visual-regression diagnosis ' +
      '(e.g. checking computed CSS custom properties like --sat against the live layout).',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'take_screenshot',
    description:
      'Captures a PNG screenshot of the attached mini-app page over CDP (Page.captureScreenshot) ' +
      'so the agent can see the phone screen directly. Read-only. Returns an image content block.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'AIT.getSdkCallHistory',
    description:
      'Returns the recent Apps In Toss SDK call trace (method, args, result/error, timestamp) that ' +
      'raw CDP cannot observe. Read-only. Use to confirm an SDK call fired and how it resolved ' +
      '(e.g. a saveBase64Data permission regression).',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'AIT.getMockState',
    description:
      'Returns the devtools mock state snapshot (window.__ait) — environment, permissions, location, ' +
      'auth, network, IAP, and more. Read-only. In dev mode this is the live browser mock state; in ' +
      'debug mode the in-app side reports it over the AIT domain.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'AIT.getOperationalEnvironment',
    description:
      'Returns getOperationalEnvironment() plus the resolved SDK version — metadata raw CDP cannot ' +
      'observe. Read-only.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
] as const;

export type DebugToolName = (typeof DEBUG_TOOL_DEFINITIONS)[number]['name'];

const DEBUG_TOOL_NAMES = new Set<string>(DEBUG_TOOL_DEFINITIONS.map((t) => t.name));

export function isDebugToolName(name: string): name is DebugToolName {
  return DEBUG_TOOL_NAMES.has(name);
}

/** Normalized console message returned by `list_console_messages`. */
export interface ConsoleMessage {
  level: string;
  text: string;
  timestamp: number;
  args: string[];
}

/** Normalized network request returned by `list_network_requests`. */
export interface NetworkRequest {
  requestId: string;
  url: string;
  method: string;
  /** HTTP status once a response was seen, else null (still in-flight). */
  status: number | null;
  statusText: string | null;
  /** Request start (CDP timestamp). */
  startTime: number;
  /** Response received (CDP timestamp), else null. */
  endTime: number | null;
}

/** Renders a CDP `RemoteObject` console arg to a stable display string. */
function renderRemoteObject(arg: CdpRemoteObject): string {
  if (arg.value !== undefined) {
    if (typeof arg.value === 'string') return arg.value;
    try {
      return JSON.stringify(arg.value);
    } catch {
      return String(arg.value);
    }
  }
  if (arg.description !== undefined) return arg.description;
  if (arg.className !== undefined) return arg.className;
  return arg.subtype ?? arg.type;
}

export function normalizeConsoleMessage(event: ConsoleApiCalledEvent): ConsoleMessage {
  const args = event.args.map(renderRemoteObject);
  return {
    level: event.type,
    text: args.join(' '),
    timestamp: event.timestamp,
    args,
  };
}

export function listConsoleMessages(connection: CdpConnection): ConsoleMessage[] {
  return connection
    .getBufferedEvents('Runtime.consoleAPICalled')
    .map((event) => normalizeConsoleMessage(event));
}

export function listNetworkRequests(connection: CdpConnection): NetworkRequest[] {
  const requests = connection.getBufferedEvents('Network.requestWillBeSent');
  const responses = connection.getBufferedEvents('Network.responseReceived');

  const responseByRequestId = new Map<string, NetworkResponseReceivedEvent>();
  for (const response of responses) {
    responseByRequestId.set(response.requestId, response);
  }

  return requests.map((request: NetworkRequestWillBeSentEvent) => {
    const response = responseByRequestId.get(request.requestId);
    return {
      requestId: request.requestId,
      url: request.request.url,
      method: request.request.method,
      status: response ? response.response.status : null,
      statusText: response ? response.response.statusText : null,
      startTime: request.timestamp,
      endTime: response ? response.timestamp : null,
    };
  });
}

/** Result of `list_pages`: attach status + tunnel state. */
export interface ListPagesResult {
  pages: ReturnType<CdpConnection['listTargets']>;
  tunnel: TunnelStatus;
}

export function listPages(connection: CdpConnection, tunnel: TunnelStatus): ListPagesResult {
  return { pages: connection.listTargets(), tunnel };
}

/* -------------------------------------------------------------------------- */
/* Phase 2 — DOM / snapshot / screenshot (CDP commands)                       */
/* -------------------------------------------------------------------------- */

/** Returns the DOM tree of the attached page (`DOM.getDocument`). */
export function getDomDocument(connection: CdpConnection): Promise<DomGetDocumentResult> {
  // `pierce: true` flattens shadow roots; depth -1 returns the whole subtree so
  // a single call yields the full tree for structural diagnosis.
  return connection.send('DOM.getDocument', { depth: -1, pierce: true });
}

/** Returns a serialized page snapshot (`DOMSnapshot.captureSnapshot`). */
export function takeSnapshot(connection: CdpConnection): Promise<DomSnapshotResult> {
  return connection.send('DOMSnapshot.captureSnapshot', {});
}

/** A `take_screenshot` result: the raw base64 PNG plus a ready-to-use data URI. */
export interface ScreenshotResult {
  /** Base64-encoded PNG bytes (no data-URI prefix). */
  data: string;
  /** `data:image/png;base64,…` form for clients that render a URI. */
  dataUri: string;
  mimeType: 'image/png';
}

/** Captures a PNG screenshot of the attached page (`Page.captureScreenshot`). */
export async function takeScreenshot(connection: CdpConnection): Promise<ScreenshotResult> {
  const { data } = await connection.send('Page.captureScreenshot', { format: 'png' });
  return { data, dataUri: `data:image/png;base64,${data}`, mimeType: 'image/png' };
}

/* -------------------------------------------------------------------------- */
/* Phase 3 — AIT.* domain (CDP can't cover these)                             */
/* -------------------------------------------------------------------------- */

/** Set of tool names served by the AIT source rather than the CDP connection. */
const AIT_TOOL_NAMES = new Set<string>([
  'AIT.getSdkCallHistory',
  'AIT.getMockState',
  'AIT.getOperationalEnvironment',
]);

/** True for the Phase 3 AIT.* tools (served by an `AitSource`, not CDP). */
export function isAitToolName(name: string): boolean {
  return AIT_TOOL_NAMES.has(name);
}

/** Returns the recent SDK call trace (`AIT.getSdkCallHistory`). */
export function getSdkCallHistory(source: AitSource): Promise<AitSdkCallHistory> {
  return source.get('AIT.getSdkCallHistory');
}

/** Returns the devtools mock-state snapshot (`AIT.getMockState`). */
export function getMockState(source: AitSource): Promise<AitMockState> {
  return source.get('AIT.getMockState');
}

/** Returns the operational environment + SDK version (`AIT.getOperationalEnvironment`). */
export function getOperationalEnvironment(source: AitSource): Promise<AitOperationalEnvironment> {
  return source.get('AIT.getOperationalEnvironment');
}
