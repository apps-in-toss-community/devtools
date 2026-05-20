/**
 * Phase 1 debug-mode MCP tools.
 *
 * Three read-only tools that normalize CDP events captured off the Chii relay
 * into `chrome-devtools-mcp`-compatible shapes:
 *   - `list_console_messages`   ← Runtime.consoleAPICalled
 *   - `list_network_requests`   ← Network.requestWillBeSent + responseReceived
 *   - `list_pages`              ← Chii relay target list + tunnel status
 *
 * The tools never touch a websocket directly — they read from an injected
 * `CdpConnection`, which is what makes them unit-testable with a fake. Later
 * phases (DOM/snapshot, evaluate_script, AIT.* domain) add tools here.
 */

import type {
  CdpConnection,
  CdpRemoteObject,
  ConsoleApiCalledEvent,
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
