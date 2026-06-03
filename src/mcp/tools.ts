/**
 * Debug-mode MCP tools (Phase 1–3 + safe-area probe).
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
 *     - `measure_safe_area`      ← Runtime.evaluate (safe-area probe)
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
  CdpCallFrame,
  CdpConnection,
  CdpRemoteObject,
  ConsoleApiCalledEvent,
  DomGetDocumentResult,
  DomSnapshotResult,
  NetworkRequestWillBeSentEvent,
  NetworkResponseReceivedEvent,
  RuntimeExceptionThrownEvent,
} from './cdp-connection.js';
import { buildDeepLinkAttachUrl, validateSchemeAuthority } from './deeplink.js';
import type { McpEnvironment } from './environment.js';
import { isLiveRelayEnv, isRelayEnv, toLegacyEnv } from './environment.js';
import { lookupSignature, warnPassthrough } from './sdk-signatures.js';
import { isPidAlive } from './server-lock.js';
import { generateTotp } from './totp.js';

/** Tunnel state surfaced by `list_pages`. */
export interface TunnelStatus {
  /** Whether the cloudflared quick tunnel is up. */
  up: boolean;
  /** Public `wss://*.trycloudflare.com` relay URL the phone attaches to. */
  wssUrl: string | null;
  /**
   * ISO timestamp when a tunnel drop was first detected by the health probe.
   * `null` means the tunnel has not dropped (or has recovered since the last
   * drop). When non-null and `up` is false, the tunnel is down and the probe
   * has exhausted all reissue attempts — the server must be restarted.
   */
  droppedAt?: string | null;
  /**
   * Number of automatic reissue attempts made after a drop was detected.
   * Resets to 0 after a successful reissue. Reaches `MAX_REISSUE_ATTEMPTS`
   * (3) before the probe gives up and enters the permanent-error state.
   */
  reissueAttempts?: number;
}

/**
 * Tier classification per RFC #277 ("MCP tool surface fidelity"):
 *
 * - **Tier A** (`mock` only) — mock-internal state dials with no real-device
 *   equivalent. Hidden when env is `relay`.
 * - **Tier B** (`relay` only) — relay infrastructure tools that have no mock
 *   equivalent (e.g. `build_attach_url` needs a cloudflared tunnel URL). Hidden
 *   when env is `mock`.
 * - **Tier C** (`both`) — fidelity-parallel tools that produce semantically
 *   equivalent results across mock and relay. The agent sees the same tool with
 *   the same shape; only the `source` provenance field (where applicable)
 *   differs.
 */
export type ToolAvailability = 'mock' | 'relay' | 'both';

/** Static MCP tool descriptors (name + JSONSchema) for the full debug tool surface. */
export const DEBUG_TOOL_DEFINITIONS = [
  {
    name: 'list_console_messages',
    description:
      'Lists recent console messages (console.log/warn/error/info) captured from the attached ' +
      'mini-app page over CDP (Runtime.consoleAPICalled). Read-only. Returns level, text, ' +
      'timestamp, and stringified args, oldest-first.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    availableIn: 'both' as ToolAvailability,
  },
  {
    name: 'list_network_requests',
    description:
      'Lists recent network requests (XHR/fetch) captured from the attached mini-app page over ' +
      'CDP (Network.requestWillBeSent + Network.responseReceived). Read-only. Returns url, ' +
      'method, status, and timing, oldest-first.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    availableIn: 'both' as ToolAvailability,
  },
  {
    name: 'list_pages',
    description:
      'Returns the single active page (at most one) the relay sees attached. ' +
      'When a second page attaches, the previous one is evicted (last-attach wins — ' +
      'single-attach model). The result includes `singleAttachModel: true` so the agent ' +
      'knows the array is always 0 or 1 entries. ' +
      'Also returns whether the cloudflared tunnel is up and the public wss relay URL. ' +
      'The `tunnel` field includes `droppedAt` (ISO timestamp or null/undefined): when non-null ' +
      'the tunnel has permanently dropped after 3 failed reissue attempts — restart the debug ' +
      'server with `npx @ait-co/devtools devtools-mcp`. ' +
      'Each page entry includes a `lastSeenAt` ISO timestamp (last inbound CDP message from ' +
      'that target — useful to detect stale entries when the phone app backgrounded). ' +
      'The result also includes `crashDetectedAt` (ISO timestamp or null): when non-null, ' +
      'a page crash was detected via Inspector.targetCrashed / Target.targetDestroyed since ' +
      'the last attach, the pages list will be empty, and `crashWarning` shows a Korean hint ' +
      'to re-attach. ' +
      'Call this first to confirm a page is attached before reading console/network. ' +
      'When a page attaches or detaches the server emits notifications/tools/list_changed — ' +
      'call tools/list again to get the full updated tool surface.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    availableIn: 'both' as ToolAvailability,
  },
  {
    name: 'build_attach_url',
    description:
      "The tool result already shows the QR to the user directly (Claude Code renders MCP tool output to the user's screen; they press Ctrl+O to expand if it's collapsed). Do NOT re-print or re-render the QR in your reply — that just wastes output tokens. Simply tell the user to scan the QR shown in this tool's output with their phone camera. " +
      'Turns an `ait deploy --scheme-only` URL (intoss-private://…?_deploymentId=<uuid>) into a ' +
      'self-attaching deep link by splicing in debug=1 and the live relay URL for this session. ' +
      'Returns the deep link JSON and a unicode QR of that deep link. Scan the QR with the phone ' +
      'camera to open the mini-app and attach it to this debug session (QR is the single entry ' +
      'path — no USB cable or platform CLI needed). Requires the tunnel to be up — call ' +
      'list_pages first. If the tunnel is not up, restart the MCP server: ' +
      '`npx @ait-co/devtools devtools-mcp`. ' +
      'Set wait_for_attach=true to block until the phone scans and a page attaches ' +
      '(polls listTargets up to 30 s by default), then returns the attached page info too. ' +
      'On timeout, call build_attach_url again to resume polling. ' +
      'When open_in_browser=true (default), saves the QR as a PNG and opens it in the OS default ' +
      'browser — only works when the MCP server runs on a local GUI machine (not headless/remote containers). ' +
      'Requires MCP_ENV=relay-dev or relay-live (set automatically in debug-mode default).\n\n' +
      'TOTP auth: when AIT_DEBUG_TOTP_SECRET is set on the MCP server, the returned attachUrl ' +
      'automatically includes the current one-time code (at=<code>) — the URL is single-use for ' +
      'that 30-second step. The response includes a `totp` field with `expiresAt` (ISO timestamp). ' +
      'If the phone scan happens after expiresAt, the relay will reject the code — just call ' +
      'build_attach_url again to get a fresh one-time URL. ' +
      'Without AIT_DEBUG_TOTP_SECRET, the attachUrl has no expiry.',
    inputSchema: {
      type: 'object',
      properties: {
        scheme_url: {
          type: 'string',
          description:
            'The intoss-private:// scheme URL from `ait deploy --scheme-only` (must carry _deploymentId). ' +
            'The authority (host) must be the app name (e.g. intoss-private://aitc-sdk-example?_deploymentId=…). ' +
            'Generic values like "web" or an empty host indicate a malformed URL.',
        },
        wait_for_attach: {
          type: 'boolean',
          description:
            'If true, block after returning the QR until a page attaches to the relay (polls ' +
            'listTargets ~1 s interval, timeout 30 s). On attach, the response includes the ' +
            'attached page list. On timeout, call build_attach_url again to resume polling.',
        },
        open_in_browser: {
          type: 'boolean',
          description:
            'If true (default), render the QR as a PNG and open it in the OS default browser. ' +
            'Only works when the MCP server is running on a local GUI machine — headless or ' +
            'remote container environments should set this to false to use the text QR fallback.',
        },
      },
      required: ['scheme_url'],
    },
    // Tier B per RFC #277 — the URL synthesis requires a live cloudflared
    // tunnel + relay, which only exists in the `relay` environment.
    availableIn: 'relay' as ToolAvailability,
  },
  {
    name: 'get_dom_document',
    description:
      'Returns the DOM tree of the attached mini-app page over CDP (DOM.getDocument). Read-only. ' +
      'Use for structural/layout regression diagnosis (e.g. confirming an element exists, ' +
      'inspecting attributes). Returns the document root node with children.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    availableIn: 'both' as ToolAvailability,
  },
  {
    name: 'take_snapshot',
    description:
      'Captures a serialized snapshot of the attached page over CDP (DOMSnapshot.captureSnapshot). ' +
      'Read-only. Returns the documents + interned strings table for visual-regression diagnosis ' +
      '(e.g. checking computed CSS custom properties like --sat against the live layout).',
    inputSchema: { type: 'object', properties: {}, required: [] },
    availableIn: 'both' as ToolAvailability,
  },
  {
    name: 'take_screenshot',
    description:
      'Captures a PNG screenshot of the attached mini-app page over CDP (Page.captureScreenshot) ' +
      'so the agent can see the phone screen directly. Read-only. ' +
      'Returns an image content block — this is the only debug tool that returns an image; ' +
      'all other debug tools return text (JSON).',
    inputSchema: { type: 'object', properties: {}, required: [] },
    availableIn: 'both' as ToolAvailability,
  },
  {
    name: 'measure_safe_area',
    description:
      'Runs a safe-area probe on the attached mini-app page via Runtime.evaluate and returns ' +
      'normalized safe-area insets, viewport geometry, device pixel ratio, and User-Agent. ' +
      'Read-only — does not modify page state. ' +
      'Tier C per RFC #277: the same Runtime.evaluate probe runs in both `mock` (devtools panel ' +
      'page with window.__ait state) and `relay` (real-device WebView with window.__sdk). ' +
      'The result includes a `source: "mock" | "relay-dev" | "relay-live"` field so consumers can identify ' +
      'provenance without inspecting payload values. ' +
      'Use in a relay session (phone attached) to get ground-truth values for upgrading a ' +
      'viewport preset from extrapolated/placeholder to measured. ' +
      'Requires a page to be attached — call list_pages first.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    availableIn: 'both' as ToolAvailability,
  },
  {
    name: 'evaluate',
    description:
      'Evaluates an arbitrary JavaScript expression on the attached mini-app page via ' +
      'CDP Runtime.evaluate (returnByValue: true) and returns the result. ' +
      'NOT read-only — the expression can have side effects (DOM mutations, SDK calls, ' +
      'state changes). Requires the relay to be attached — call list_pages first. ' +
      'Throws if the evaluation throws an exception on the page.\n\n' +
      'SECURITY: expression and result are not redacted — never include secrets or auth ' +
      'tokens in the expression.\n\n' +
      'LIVE guard: when running against a live/production relay (relay-live env, ' +
      'MCP_ENV=relay-live), this tool requires `confirm: true` to acknowledge that ' +
      'the expression may affect real users. Without it the call is rejected with a ' +
      'structured error. mock and relay-dev sessions are unaffected.',
    inputSchema: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'JavaScript expression to evaluate in the page context.',
        },
        confirm: {
          type: 'boolean',
          description:
            'Required when MCP_ENV=relay-live. Set to `true` to explicitly acknowledge ' +
            'that this expression may have side effects on real/live users. ' +
            'Omitting this in a relay-live session results in a structured rejection error. ' +
            'Has no effect in mock or relay-dev sessions.',
        },
      },
      required: ['expression'],
    },
    availableIn: 'both' as ToolAvailability,
  },
  {
    name: 'list_exceptions',
    description:
      'Lists JS-level exceptions captured via `Runtime.exceptionThrown` from the relay attached ' +
      'page. Includes timestamp, exception text, source URL/line, and stack trace. ' +
      'Use to root-cause SDK throws that may precede a Toss app crash (#265 / #267). ' +
      'The buffer holds up to 50 most recent exceptions and survives target ' +
      'replaced/crashed/destroyed events so an exception just before a crash is preserved. ' +
      'Returns up to 50 most recent by default.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of exceptions to return (default 50, max 50).',
        },
      },
      required: [],
    },
    availableIn: 'both' as ToolAvailability,
  },
  {
    name: 'call_sdk',
    description:
      'Calls a dogfood SDK method via the window.__sdkCall bridge ' +
      '(exported by @apps-in-toss/web-framework only in __DEBUG_BUILD__ bundles). ' +
      'NOT read-only — SDK calls have side effects (navigation, payments, permissions, etc.). ' +
      'On env 3/4 (real device relay) this hits the real SDK; on env 1 (local mock) it hits ' +
      'the mock SDK. (env 2 PWA does not inject the SDK — call_sdk is not available there.) ' +
      'Requires the relay to be attached — call list_pages first. ' +
      'Returns {ok: true, value} on success or {ok: false, error} on failure. ' +
      'If a Runtime.exceptionThrown event was observed within [callStart-50ms, callEnd+200ms], ' +
      'the result also includes `recentException` for crash triage. ' +
      'Returns a clear error if window.__sdkCall is not available (non-dogfood bundle) — ' +
      'redeploy via dogfood channel: `ait build && aitcc app deploy`.\n\n' +
      'SECURITY: method name, args, and result value are not redacted — never include secrets.\n\n' +
      'LIVE guard: when running against a live/production relay (relay-live env, ' +
      'MCP_ENV=relay-live), this tool requires `confirm: true` to acknowledge that ' +
      'the SDK call may affect real users. Without it the call is rejected with a ' +
      'structured error. mock and relay-dev sessions are unaffected.\n\n' +
      'IMPORTANT — 인자 시그니처 (잘못된 인자로 호출하면 토스 앱 crash 위험):\n' +
      '  setDeviceOrientation:        call_sdk("setDeviceOrientation", [{ type: "landscape" }])  // NOT "landscape"\n' +
      '  setIosSwipeGestureEnabled:   call_sdk("setIosSwipeGestureEnabled", [{ isEnabled: false }])\n' +
      '  setSecureScreen:             call_sdk("setSecureScreen", [{ enabled: true }])\n' +
      '  setScreenAwakeMode:          call_sdk("setScreenAwakeMode", [{ enabled: true }])\n' +
      '  getOperationalEnvironment:   call_sdk("getOperationalEnvironment", [])\n' +
      '  getPlatformOS:               call_sdk("getPlatformOS", [])\n' +
      '  getDeviceId:                 call_sdk("getDeviceId", [])\n' +
      '  getLocale:                   call_sdk("getLocale", [])\n' +
      '  getNetworkStatus:            call_sdk("getNetworkStatus", [])\n' +
      '  getSchemeUri:                call_sdk("getSchemeUri", [])\n' +
      '  requestReview:               call_sdk("requestReview", [])\n' +
      '  closeView:                   call_sdk("closeView", [])',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'SDK method name to call (e.g. "getOperationalEnvironment").',
        },
        args: {
          type: 'array',
          description: 'Arguments to pass to the SDK method (optional, default []).',
          items: {},
        },
        confirm: {
          type: 'boolean',
          description:
            'Required when MCP_ENV=relay-live. Set to `true` to explicitly acknowledge ' +
            'that this SDK call may have side effects on real/live users. ' +
            'Omitting this in a relay-live session results in a structured rejection error. ' +
            'Has no effect in mock or relay-dev sessions.',
        },
      },
      required: ['name'],
    },
    availableIn: 'both' as ToolAvailability,
  },
  {
    name: 'AIT.getSdkCallHistory',
    description:
      'Returns the recent Apps In Toss SDK call trace (method, args, result/error, timestamp) that ' +
      'raw CDP cannot observe. Read-only. Use to confirm an SDK call fired and how it resolved ' +
      '(e.g. a saveBase64Data permission regression).',
    inputSchema: { type: 'object', properties: {}, required: [] },
    availableIn: 'both' as ToolAvailability,
  },
  {
    name: 'AIT.getMockState',
    description:
      'Returns the devtools mock state snapshot (window.__ait) — environment, permissions, location, ' +
      'auth, network, IAP, and more. Read-only. In dev mode this is the live browser mock state; in ' +
      'debug mode the in-app side reports it over the AIT domain.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    availableIn: 'both' as ToolAvailability,
  },
  {
    name: 'AIT.getOperationalEnvironment',
    description:
      'Returns getOperationalEnvironment() plus the resolved SDK version — metadata raw CDP cannot ' +
      'observe. Read-only.',
    inputSchema: { type: 'object', properties: {}, required: [] },
    availableIn: 'both' as ToolAvailability,
  },
  {
    name: 'start_debug',
    description:
      'Switches the active debug environment in-place (issue #348) — no Claude Code restart and ' +
      'no MCP re-handshake. One daemon holds both a local (env 1, mock SDK in a Chromium) and a ' +
      'relay (env 3/4, real-device Toss WebView over the Chii relay + cloudflared tunnel) ' +
      'connection at once; this tool flips which one every other tool reads from, lazily booting ' +
      "the requested family's infra on first use and keeping the inactive one warm so an existing " +
      'attach survives the switch. After switching it emits notifications/tools/list_changed — ' +
      'call tools/list again to see the updated tool surface for the new environment.\n\n' +
      'modes:\n' +
      '  local — env 1: desktop Chromium with the MOCK SDK and a local CDP attach. Side-effect ' +
      'tools (call_sdk/evaluate) run unguarded against the mock; nothing touches a real device or ' +
      'real users. No prerequisites — the default, always-available environment for state/contract ' +
      'and visual-layout work.\n' +
      '  staging — env 3: a real-device Toss WebView dogfood build with the REAL SDK over the ' +
      'intoss-private relay. The first environment where call_sdk exercises the genuine native ' +
      'bridge. Side-effect tools run unguarded (dogfood, not released to real users). ' +
      'Prerequisite: a deployed dogfood candidate bundle + the device cold-loaded via the ' +
      'intoss-private deep-link/QR relay injection.\n' +
      '  live — env 4: the REVIEW-PASSED, released production runtime with the REAL SDK over the ' +
      'intoss relay — real end users are on the other side. Read-only debugging is the intent: ' +
      'the LIVE guard is armed, so call_sdk/evaluate require confirm:true per call, and ENTERING ' +
      'live ALSO requires confirm:true on this call. Use it only to observe a shipped regression; ' +
      'verify fixes in staging first.\n\n' +
      'Switching back to local automatically disarms the LIVE guard.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['local', 'staging', 'live'],
          description:
            'Target environment to switch to. mode=live additionally requires confirm: true (and arms the read-only LIVE guard).',
        },
        confirm: {
          type: 'boolean',
          description:
            'Required when mode=live — set true to acknowledge entering LIVE (env 4) ' +
            'debugging that can affect real users. Ignored for the other modes.',
        },
      },
      required: ['mode'],
    },
    // Tier C — always callable so the agent can enter any environment from any
    // starting environment (including a fresh, unattached session).
    availableIn: 'both' as ToolAvailability,
  },
  {
    name: 'get_diagnostics',
    description:
      'Returns a single-call server status snapshot so the agent can diagnose "why is this not ' +
      'working?" without calling multiple tools. Fields: mcpVersion (MCP SDK version), ' +
      'devtoolsVersion (@ait-co/devtools package version), tunnel (up/wssUrl/pid/startedAt), ' +
      'pages (list_pages result + lastSeenAt stats), lastAttachAt, lastDetachAt, ' +
      'recentErrors (last N server-side errors, PII/secret redacted), ' +
      'environment (kind: mock|relay-dev|relay-live|relay-mobile, env: mock|relay backward-compat, reason, ' +
      'liveGuardActive: true when relay-live LIVE guard is active), ' +
      'serverLockHolder (pid + startedAt from the lock file, or null), ' +
      'nextRecommendedAction ({tool, reason} or null — the single next tool to call; ' +
      'in local-target mode tunnel.up=false is normal so "restart" is never recommended). ' +
      'All fields are nullable — missing data is null, not an error. ' +
      'debug-mode only — dev-mode (--mode=dev) does not support relay diagnostics. ' +
      'Tier C (both mock and relay). Call this first when debugging session state.',
    inputSchema: {
      type: 'object',
      properties: {
        recent_errors_limit: {
          type: 'number',
          description:
            'Maximum number of recent server-side errors to include (default 10, max 50).',
        },
      },
      required: [],
    },
    availableIn: 'both' as ToolAvailability,
  },
] as const;

export type DebugToolName = (typeof DEBUG_TOOL_DEFINITIONS)[number]['name'];

const DEBUG_TOOL_NAMES = new Set<string>(DEBUG_TOOL_DEFINITIONS.map((t) => t.name));

export function isDebugToolName(name: string): name is DebugToolName {
  return DEBUG_TOOL_NAMES.has(name);
}

/**
 * Returns the `ToolAvailability` declared on a registered debug tool, or
 * `undefined` when the name is not a known debug tool. Used by the tool
 * registry to filter `tools/list` by current env and by the call handler to
 * reject env-mismatch invocations.
 */
export function getToolAvailability(name: string): ToolAvailability | undefined {
  for (const t of DEBUG_TOOL_DEFINITIONS) {
    if (t.name === name) return t.availableIn;
  }
  return undefined;
}

/**
 * Returns true when the named tool is available in the given environment.
 * Unknown tools return `false` — callers should reject them as unknown rather
 * than as env-mismatched.
 *
 * Relay variants (`relay-dev`, `relay-live`, `relay-mobile`) all satisfy the
 * `'relay'` availability tier — `isRelayEnv()` is used for the check.
 */
export function isToolAvailableIn(name: string, env: McpEnvironment): boolean {
  const availability = getToolAvailability(name);
  if (availability === undefined) return false;
  if (availability === 'both') return true;
  if (availability === 'relay') return isRelayEnv(env);
  return availability === env;
}

/**
 * Filters a `DEBUG_TOOL_DEFINITIONS`-shaped list to those whose `availableIn`
 * matches the given env. Pure — preserves order; both Tier C ("both") and the
 * matching single-env tier pass through.
 *
 * Relay variants (`relay-dev`, `relay-live`, `relay-mobile`) all satisfy the
 * `'relay'` tier.
 */
export function filterToolsByEnvironment<T extends { name: string; availableIn: ToolAvailability }>(
  tools: ReadonlyArray<T>,
  env: McpEnvironment,
): T[] {
  return tools.filter(
    (t) =>
      t.availableIn === 'both' ||
      (t.availableIn === 'relay' && isRelayEnv(env)) ||
      t.availableIn === env,
  );
}

/**
 * Tool names that are available before any page attaches (bootstrap tier).
 *
 * `build_attach_url` — pure URL synthesis, no attach needed.
 * `list_pages`       — reports tunnel status + empty pages even pre-attach.
 *
 * All other tools require an attached page (`enableDomains` must succeed) and
 * are only advertised in `tools/list` once a target appears.
 */
export const BOOTSTRAP_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  'build_attach_url',
  'get_diagnostics',
  'list_pages',
  // start_debug must be visible from the very first tools/list (before any
  // attach) so the agent can switch environments to bootstrap an attach.
  'start_debug',
]);

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

/* -------------------------------------------------------------------------- */
/* list_exceptions — Runtime.exceptionThrown ring buffer                       */
/* -------------------------------------------------------------------------- */

/**
 * Normalized exception returned by `list_exceptions`.
 *
 * Flattens the CDP `Runtime.ExceptionDetails` shape into the most useful
 * fields. The `raw` field carries the original event for callers that need
 * the full payload.
 */
export interface BufferedException {
  /** Wall-clock ms since epoch (CDP `Runtime.Timestamp`). */
  timestamp: number;
  /** Short summary text from `exceptionDetails.text`. */
  text: string;
  /** Source URL where the exception was thrown, if known. */
  url?: string;
  /** 0-based line number in the source file, if known. */
  lineNumber?: number;
  /** 0-based column number in the source file, if known. */
  columnNumber?: number;
  /** `description` of the thrown `RemoteObject` (e.g. "TypeError: …"). */
  exceptionText?: string;
  /**
   * Formatted stack trace: `at fn (url:line:col)` lines joined by `\n`.
   * Omitted when no `stackTrace.callFrames` are available.
   */
  stack?: string;
  /** Full original `Runtime.exceptionThrown` event payload. */
  raw: RuntimeExceptionThrownEvent;
}

/** Formats a single CDP call frame into `at fn (url:line:col)`. */
function formatCallFrame(frame: CdpCallFrame): string {
  const fn = frame.functionName || '(anonymous)';
  return `at ${fn} (${frame.url}:${frame.lineNumber}:${frame.columnNumber})`;
}

/** Normalizes a raw `Runtime.exceptionThrown` event into a `BufferedException`. */
export function normalizeException(event: RuntimeExceptionThrownEvent): BufferedException {
  const { timestamp, exceptionDetails } = event;
  const frames = exceptionDetails.stackTrace?.callFrames;
  const stack = frames && frames.length > 0 ? frames.map(formatCallFrame).join('\n') : undefined;
  const exceptionText = exceptionDetails.exception?.description ?? undefined;

  const result: BufferedException = {
    timestamp,
    text: exceptionDetails.text,
    raw: event,
  };
  if (exceptionDetails.url !== undefined) result.url = exceptionDetails.url;
  if (exceptionDetails.lineNumber !== undefined) result.lineNumber = exceptionDetails.lineNumber;
  if (exceptionDetails.columnNumber !== undefined)
    result.columnNumber = exceptionDetails.columnNumber;
  if (exceptionText !== undefined) result.exceptionText = exceptionText;
  if (stack !== undefined) result.stack = stack;
  return result;
}

/**
 * Returns the most recent buffered `Runtime.exceptionThrown` events, normalized.
 * Oldest-first; limited to `limit` entries (default 50, max 50).
 */
export function listExceptions(connection: CdpConnection, limit = 50): BufferedException[] {
  const cap = Math.min(Math.max(1, limit), 50);
  const events = connection.getBufferedEvents('Runtime.exceptionThrown');
  // Slice from the tail to respect the cap while preserving oldest-first order.
  const sliced = events.length > cap ? events.slice(events.length - cap) : events;
  return sliced.map((e) => normalizeException(e));
}

/** A page entry in the `list_pages` result, extended with freshness info. */
export interface ListPagesEntry {
  id: string;
  title: string;
  url: string;
  /** ISO timestamp of the last inbound CDP message from this target, or null. */
  lastSeenAt: string | null;
}

/** Result of `list_pages`: attach status + tunnel state + crash info. */
export interface ListPagesResult {
  /**
   * The single active page, or an empty array when nothing is attached.
   * Under the single-attach model this is always 0 or 1 entries.
   */
  pages: ListPagesEntry[];
  tunnel: TunnelStatus;
  /**
   * ISO timestamp of the most recent crash / targetDestroyed / detachedFromTarget
   * event detected since the last `enableDomains()`, or `null` if none.
   * When non-null, all attached pages have been removed from the relay map and
   * a new `enableDomains()` call is required to resume debugging.
   */
  crashDetectedAt: string | null;
  /** Korean warning line shown in tool output when a crash was detected. */
  crashWarning: string | null;
  /**
   * Always `true` — signals to the agent that at most one page is ever present.
   * When a second page attaches, the previous one is evicted (last-attach wins).
   */
  singleAttachModel: true;
}

/**
 * Duck-type interface for the crash-detection extras exposed by `ChiiCdpConnection`.
 * The base `CdpConnection` interface is kept minimal (fake-friendly); the extras
 * are opt-in so tests without them continue to compile.
 */
interface CrashAwareCdpConnection extends CdpConnection {
  getLastCrashDetectedAt(): number | null;
  getTargetLastSeenAt(targetId: string): number | null;
}

function isCrashAware(conn: CdpConnection): conn is CrashAwareCdpConnection {
  return (
    typeof (conn as CrashAwareCdpConnection).getLastCrashDetectedAt === 'function' &&
    typeof (conn as CrashAwareCdpConnection).getTargetLastSeenAt === 'function'
  );
}

export function listPages(connection: CdpConnection, tunnel: TunnelStatus): ListPagesResult {
  const rawTargets = connection.listTargets();
  const pages: ListPagesEntry[] = rawTargets.map((t) => {
    const lastSeenMs = isCrashAware(connection) ? connection.getTargetLastSeenAt(t.id) : null;
    return {
      id: t.id,
      title: t.title,
      url: t.url,
      lastSeenAt: lastSeenMs !== null ? new Date(lastSeenMs).toISOString() : null,
    };
  });

  const crashMs = isCrashAware(connection) ? connection.getLastCrashDetectedAt() : null;
  const crashDetectedAt = crashMs !== null ? new Date(crashMs).toISOString() : null;
  const crashWarning = crashDetectedAt
    ? `[ait-debug] page crash 감지됨 — 새 attach 필요 (관측 시각: ${crashDetectedAt})`
    : null;

  return { pages, tunnel, crashDetectedAt, crashWarning, singleAttachModel: true };
}

/** A `build_attach_url` result: the spliced deep link the phone should open. */
export interface BuildAttachUrlResult {
  /** The scheme URL with `debug=1&relay=<wss>[&at=<totp-code>]` spliced in. */
  attachUrl: string;
  /** The relay URL that was spliced in (this session's quick tunnel). */
  relayUrl: string;
  /**
   * Non-fatal warning about the scheme URL's authority being missing or
   * suspicious (e.g. "web", "localhost"). Callers should surface this to
   * help the user catch a malformed URL early.
   */
  authorityWarning?: string;
  /**
   * TOTP metadata — present when `AIT_DEBUG_TOTP_SECRET` is set.
   *
   * SECRET-HANDLING: the `at=` code value is spliced into `attachUrl` only.
   * It is never surfaced separately here to avoid inadvertent logging of the
   * one-time code outside of the URL.
   */
  totp?: {
    /** `true` when a TOTP code was spliced into `attachUrl`. */
    enabled: true;
    /** RFC 6238 step duration in seconds. */
    ttlSeconds: number;
    /** ISO timestamp when the current step expires. Rescan or call build_attach_url again after this. */
    expiresAt: string;
  };
}

/**
 * Builds a self-attaching dogfood deep link from an `ait deploy --scheme-only`
 * URL plus this session's live relay. Throws if the tunnel is not up yet (no
 * relay URL to splice in) — the caller surfaces that as a tool error.
 *
 * When `AIT_DEBUG_TOTP_SECRET` is set, generates the current TOTP code and
 * splices it as `at=<code>` into the attach URL. The code is valid for one
 * 30-second time step (±1 skew accepted by the relay, so the effective window
 * is up to 90 s). If the scan happens after `totp.expiresAt`, call
 * `build_attach_url` again to get a fresh code.
 *
 * Also validates the scheme URL's authority. A suspicious authority (empty,
 * "web", "localhost", etc.) is surfaced as a non-fatal `authorityWarning` on
 * the result so the caller can show a helpful hint without blocking the link
 * generation (the warning is consistent with how other validation in
 * `buildDeepLinkAttachUrl` works — hard errors for relay, soft warning for
 * the scheme authority which is in the caller's input, not ours to own).
 *
 * SECRET-HANDLING: `totpSecret` (if provided) is used only to compute a code
 * and must never appear in any log, error message, or output outside of the
 * spliced `at=` param in `attachUrl`.
 *
 * @param schemeUrl - The `intoss-private://…?_deploymentId=<uuid>` URL.
 * @param tunnel - Current tunnel status from the running debug server.
 * @param totpSecret - Optional hex-encoded TOTP secret (from
 *   `AIT_DEBUG_TOTP_SECRET`). When provided, the current code is spliced into
 *   the attach URL as `at=<code>`.
 */
export function buildAttachUrl(
  schemeUrl: string,
  tunnel: TunnelStatus,
  totpSecret?: string,
): BuildAttachUrlResult {
  if (!tunnel.up || tunnel.wssUrl === null) {
    throw new Error(
      'tunnel-down: cloudflared 터널이 안 떠 있습니다. ' +
        'MCP 서버를 재시작하거나 잠시 후 list_pages로 터널 상태를 다시 확인하세요.',
    );
  }
  const authorityWarning = validateSchemeAuthority(schemeUrl) ?? undefined;

  // Generate a live TOTP code when a secret is provided.
  // SECRET-HANDLING: the code value is placed into attachUrl only — not logged.
  let totpCode: string | undefined;
  let totpMeta: BuildAttachUrlResult['totp'];
  if (totpSecret !== undefined && totpSecret !== '') {
    const now = Date.now();
    totpCode = generateTotp(totpSecret, now);
    const STEP_SECONDS = 30;
    // Current step number (floor). The step expires at the start of the NEXT step.
    const currentStep = Math.floor(now / 1000 / STEP_SECONDS);
    const expiresAtMs = (currentStep + 1) * STEP_SECONDS * 1000;
    totpMeta = {
      enabled: true,
      ttlSeconds: STEP_SECONDS,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  return {
    attachUrl: buildDeepLinkAttachUrl(schemeUrl, tunnel.wssUrl, totpCode),
    relayUrl: tunnel.wssUrl,
    ...(authorityWarning !== undefined ? { authorityWarning } : {}),
    ...(totpMeta !== undefined ? { totp: totpMeta } : {}),
  };
}

/* -------------------------------------------------------------------------- */
/* QR PNG rendering + browser open                                             */
/* -------------------------------------------------------------------------- */

/**
 * Heuristic: can this process open a GUI browser?
 *
 * Returns `true` when we think a GUI is available:
 *   - On macOS (`darwin`) we assume yes (MCP normally runs on the user's Mac).
 *   - On Linux we check for `DISPLAY` or `WAYLAND_DISPLAY`.
 *   - On Windows we assume yes.
 *   - In a CI environment (`CI=true`) we assume no.
 */
export function canOpenBrowser(): boolean {
  if (process.env.CI === 'true' || process.env.CI === '1') return false;
  const platform = process.platform;
  if (platform === 'darwin' || platform === 'win32') return true;
  if (platform === 'linux') {
    return Boolean(process.env.DISPLAY ?? process.env.WAYLAND_DISPLAY);
  }
  return false;
}

/**
 * Result of `openQrInBrowser`.
 *
 * HTTP URL 기반으로 재구현 — tmp 파일 없음. `httpUrl`이 브라우저에 전달되는 URL이다.
 * SECRET-HANDLING: `httpUrl`은 127.0.0.1 로컬 전용이며 at= 코드 값을 직접 담지 않는다
 * (attachUrl은 /attach?u= query로 전달되어 서버 메모리에서만 처리).
 */
export interface OpenQrInBrowserResult {
  /** `true` if the browser was successfully opened. */
  opened: boolean;
  /** `http://127.0.0.1:<port>/attach?u=...` — 브라우저에 전달된 URL. */
  httpUrl: string;
  /** `http://127.0.0.1:<port>/qr.png?u=...` — PNG fallback URL. */
  pngUrl: string;
  /** Error message if `opened` is false (browser spawn failed). */
  error?: string;
  /** Captured stderr from failed spawn attempts (at= 값은 redact됨). */
  stderrSummary?: string;
  /**
   * `true` when the first attempt failed but a retry succeeded.
   * Helps distinguish "worked on first try" from "needed retry" in diagnostics.
   */
  retried?: boolean;
}

/** platform별 browser open 명령 후보 목록 — 앞에서부터 순차 시도. */
function getBrowserCandidates(httpUrl: string): Array<{ cmd: string; args: string[] }> {
  const platform = process.platform;
  if (platform === 'darwin') {
    return [
      { cmd: 'open', args: [httpUrl] },
      { cmd: 'open', args: ['-a', 'Safari', httpUrl] },
      { cmd: 'open', args: ['-a', 'Google Chrome', httpUrl] },
      { cmd: 'open', args: ['-a', 'Firefox', httpUrl] },
    ];
  }
  if (platform === 'win32') {
    return [
      { cmd: 'cmd', args: ['/c', 'start', '', httpUrl] },
      { cmd: 'rundll32', args: ['url.dll,FileProtocolHandler', httpUrl] },
    ];
  }
  // linux + fallback
  return [
    { cmd: 'xdg-open', args: [httpUrl] },
    { cmd: 'sensible-browser', args: [httpUrl] },
    { cmd: 'x-www-browser', args: [httpUrl] },
    { cmd: 'firefox', args: [httpUrl] },
    { cmd: 'google-chrome', args: [httpUrl] },
    { cmd: 'chromium', args: [httpUrl] },
  ];
}

/** stderr에서 at= TOTP 코드 값을 redact한다. */
function redactSecrets(text: string): string {
  // at=<value> 패턴에서 값 부분을 redact — TOTP 코드가 노출되지 않도록.
  return text.replace(/\bat=([^&\s"']+)/g, 'at=<redacted>');
}

/** spawnSync exit 0이어도 stderr에 launch 실패 시그널이 있으면 실패로 판단한다. */
const LAUNCH_FAILURE_PATTERNS = [
  /LSOpenURLsWithRole\(\) failed/,
  /kLSApplicationNotFoundErr/,
  /No application/,
  /Unable to find application/,
  /xdg-open: not found/,
  /command not found/,
];

function isLaunchFailureStderr(stderr: string): boolean {
  return LAUNCH_FAILURE_PATTERNS.some((p) => p.test(stderr));
}

/**
 * 로컬 HTTP 서버 URL(`http://127.0.0.1:<port>/attach?u=...`)을 OS 기본 브라우저로 연다.
 *
 * platform별 fallback chain으로 시도하며, 모두 실패하면 1회 retry를 수행한다
 * (ephemeral process launch 타이밍 문제 대응). retry까지 실패해도 `opened: false` +
 * `httpUrl`을 반환해 사용자가 직접 브라우저에 붙여넣을 수 있게 한다.
 *
 * SECRET-HANDLING:
 *   - tmp 파일을 만들지 않는다 (HTML/PNG는 HTTP 서버가 메모리에서 응답).
 *   - httpUrl/pngUrl은 127.0.0.1 로컬 전용.
 *   - stderr 캡처 결과에서 at= 코드 값을 redact한 후 stderrSummary에 포함.
 *   - attachUrl, deploymentId, TOTP 코드를 stdout/stderr/로그에 직접 출력 금지.
 *
 * @param httpUrl - `http://127.0.0.1:<port>/attach?u=<encoded>` HTTP URL.
 * @param pngUrl  - `http://127.0.0.1:<port>/qr.png?u=<encoded>` PNG fallback URL.
 */
export async function openQrInBrowser(
  httpUrl: string,
  pngUrl: string,
): Promise<OpenQrInBrowserResult> {
  const { spawnSync } = await import('node:child_process');

  /**
   * 한 번의 fallback chain 시도. 성공하면 열린 후보 cmd를 반환, 실패하면 null.
   * stderrLines에 각 후보의 stderr를 누적한다.
   */
  function tryOnce(stderrLines: string[]): boolean {
    const candidates = getBrowserCandidates(httpUrl);
    for (const { cmd, args } of candidates) {
      const result = spawnSync(cmd, args, { encoding: 'utf8', timeout: 5000 });

      if (result.error) {
        stderrLines.push(`${cmd}: ${result.error.message}`);
        continue;
      }

      const stderr = typeof result.stderr === 'string' ? result.stderr : '';
      if (stderr) {
        stderrLines.push(`${cmd}: ${redactSecrets(stderr.trim())}`);
      }

      if (result.status === 0 && !isLaunchFailureStderr(stderr)) {
        return true;
      }
    }
    return false;
  }

  const stderrLines: string[] = [];

  // 1차 시도
  if (tryOnce(stderrLines)) {
    return { opened: true, httpUrl, pngUrl };
  }

  // 1회 retry (ephemeral process launch 타이밍 문제 대응)
  if (tryOnce(stderrLines)) {
    return { opened: true, httpUrl, pngUrl, retried: true };
  }

  const stderrSummary = stderrLines.length > 0 ? stderrLines.join('\n') : undefined;
  return {
    opened: false,
    httpUrl,
    pngUrl,
    error: '모든 브라우저 실행 후보가 실패했습니다.',
    stderrSummary,
  };
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
/* measure_safe_area — Runtime.evaluate probe                                  */
/* -------------------------------------------------------------------------- */

/**
 * The JS probe injected via `Runtime.evaluate`. It reads:
 *   1. `env(safe-area-inset-*)` via a temporary element with padding set to
 *      those CSS env vars, then `getComputedStyle`.
 *   2. SDK insets via a priority chain so the SAME probe works on both relay
 *      (real device) and mock (devtools panel page):
 *        a. `window.__sdk.SafeAreaInsets.get()`  — dogfood bundle on real device.
 *        b. `window.__sdk.getSafeAreaInsets()`   — dogfood bundle (deprecated).
 *        c. `window.__ait.state.safeAreaInsets`  — devtools mock state (mock env).
 *      The probe records `sdkInsetsSource` = `'window.__sdk'` | `'window.__ait'`
 *      | `null`. If all paths fail the result carries `sdkInsetsError`.
 *   3. nav bar geometry: the SDK does not expose navBar height as a standalone
 *      API — `.ait-navbar` DOM height is read as a cross-check, and
 *      `navBarHeightSource` records where it came from.
 *   4. `innerWidth`, `innerHeight`, `devicePixelRatio`, `navigator.userAgent`.
 *
 * Returns a plain JSON-serialisable object so `returnByValue: true` works.
 *
 * NOTE: This expression is evaluated in the page context — on the real device
 * (relay) or on the mock panel page. It does not mutate any page state — the
 * temporary element is removed after reading. No secret or auth token is read
 * or returned.
 *
 * RFC #277 Tier C parity: the SAME probe string runs in both envs. Mock fidelity
 * comes from the panel's `applyViewport` / `computeSafeAreaInsets` correctly
 * setting `window.__ait.state.safeAreaInsets` (#275). When that is correct,
 * the cssEnv + sdkInsets pair returned here matches the relay's shape.
 */
export const SAFE_AREA_PROBE_EXPRESSION = `
(function() {
  var el = document.createElement('div');
  el.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;' +
    'padding-top:env(safe-area-inset-top,0px);' +
    'padding-right:env(safe-area-inset-right,0px);' +
    'padding-bottom:env(safe-area-inset-bottom,0px);' +
    'padding-left:env(safe-area-inset-left,0px)';
  document.documentElement.appendChild(el);
  var cs = window.getComputedStyle(el);
  var cssEnv = {
    top: parseFloat(cs.paddingTop) || 0,
    right: parseFloat(cs.paddingRight) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0
  };
  document.documentElement.removeChild(el);
  var sdkInsets = null;
  var sdkInsetsSource = null;
  var sdkInsetsError = undefined;
  try {
    var sdk = window.__sdk;
    var ait = window.__ait;
    if (sdk && sdk.SafeAreaInsets && typeof sdk.SafeAreaInsets.get === 'function') {
      sdkInsets = sdk.SafeAreaInsets.get();
      sdkInsetsSource = 'window.__sdk';
    } else if (sdk && typeof sdk.getSafeAreaInsets === 'function') {
      sdkInsets = sdk.getSafeAreaInsets();
      sdkInsetsSource = 'window.__sdk';
    } else if (ait && ait.state && ait.state.safeAreaInsets &&
               typeof ait.state.safeAreaInsets.top === 'number') {
      var s = ait.state.safeAreaInsets;
      sdkInsets = { top: s.top, bottom: s.bottom, left: s.left, right: s.right };
      sdkInsetsSource = 'window.__ait';
    } else if (!sdk && !ait) {
      sdkInsetsError = 'neither window.__sdk (relay) nor window.__ait (mock) available';
    } else if (sdk) {
      sdkInsetsError = 'neither SafeAreaInsets.get nor getSafeAreaInsets found on window.__sdk';
    } else {
      sdkInsetsError = 'window.__ait.state.safeAreaInsets is missing or malformed';
    }
  } catch(e) {
    sdkInsetsError = String(e && e.message || e);
  }
  var navBarHeight = null;
  var navBarHeightSource = 'not-exposed-by-sdk';
  try {
    var nb = document.querySelector('.ait-navbar');
    if (nb) {
      navBarHeight = nb.getBoundingClientRect().height;
      navBarHeightSource = 'dom-.ait-navbar';
    }
  } catch(_) {}
  var result = {
    cssEnv: cssEnv,
    sdkInsets: sdkInsets,
    sdkInsetsSource: sdkInsetsSource,
    navBarHeight: navBarHeight,
    navBarHeightSource: navBarHeightSource,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    userAgent: navigator.userAgent
  };
  if (sdkInsetsError !== undefined) result.sdkInsetsError = sdkInsetsError;
  return JSON.stringify(result);
})()
`.trim();

/**
 * Where the SDK insets came from. `null` when the lookup failed (in which case
 * `sdkInsetsError` is populated).
 *
 *   - `'window.__sdk'`  — real-device dogfood bundle (relay env).
 *   - `'window.__ait'`  — devtools mock state (mock env).
 *   - `null`            — both paths absent or threw.
 */
export type SdkInsetsSource = 'window.__sdk' | 'window.__ait' | null;

/**
 * Normalized result returned by `measure_safe_area`.
 *
 * All inset values are in CSS pixels as reported by the page context.
 * `userAgent` is included for device identification; it never contains
 * authentication secrets or session tokens.
 */
export interface SafeAreaMeasurement {
  /**
   * MCP environment this measurement was taken in:
   *   - `'mock'`         — dev browser panel
   *   - `'relay-dev'`    — real-device WebView, dogfood build
   *   - `'relay-live'`   — real-device WebView, live/production build
   *   - `'relay-mobile'` — real-device PWA (env 2) over an external relay
   *
   * Set by the caller (`measureSafeArea`) from the env detection SSoT
   * (`getEnvironment`).
   */
  source: McpEnvironment;
  /**
   * `env(safe-area-inset-*)` values read via `getComputedStyle` on the page.
   * On iOS inside the Toss host WebView this is typically all-zero because the
   * WebView viewport is placed below the physical notch by the host app.
   */
  cssEnv: { top: number; right: number; bottom: number; left: number };
  /**
   * SDK insets from one of three paths (in priority order):
   *   - `window.__sdk.SafeAreaInsets.get()`  (relay, dogfood bundle)
   *   - `window.__sdk.getSafeAreaInsets()`   (relay, deprecated)
   *   - `window.__ait.state.safeAreaInsets`  (mock, devtools panel state)
   *
   * `null` when all paths fail — see `sdkInsetsError` for the reason.
   * In the Toss host WebView `top` is the nav bar height and `bottom` is the
   * home-indicator height.
   */
  sdkInsets: { top: number; right: number; bottom: number; left: number } | null;
  /**
   * Which path resolved `sdkInsets` — useful for diagnosis of fidelity gaps
   * between mock and relay. `null` when `sdkInsets` is `null`.
   */
  sdkInsetsSource: SdkInsetsSource;
  /**
   * Populated when the SDK inset lookup failed (all paths absent or threw).
   * `undefined` when `sdkInsets` is non-null (i.e. the lookup succeeded).
   *
   * Example values:
   *   - `"neither window.__sdk (relay) nor window.__ait (mock) available"`
   *   - `"neither SafeAreaInsets.get nor getSafeAreaInsets found on window.__sdk"`
   *   - `"window.__ait.state.safeAreaInsets is missing or malformed"`
   *   - `"TypeError: ..."`
   */
  sdkInsetsError?: string;
  /**
   * Height of the `.ait-navbar` element (px) if present, else `null`.
   * The SDK does not expose navBar height as a standalone API; this DOM
   * measurement is used to cross-validate `sdkInsets.top`.
   */
  navBarHeight: number | null;
  /**
   * Describes where `navBarHeight` came from:
   *   - `"dom-.ait-navbar"` — read from the `.ait-navbar` element's bounding rect.
   *   - `"not-exposed-by-sdk"` — the SDK has no standalone navBar height API and
   *     no `.ait-navbar` element was found in the DOM.
   */
  navBarHeightSource: string;
  /** CSS viewport width (`window.innerWidth`). */
  innerWidth: number;
  /** CSS viewport height (`window.innerHeight`). */
  innerHeight: number;
  /**
   * Device pixel ratio (`window.devicePixelRatio`).
   * Note: `window.devicePixelRatio` is read-only in the browser, so devtools
   * cannot emulate DPR locally — this is the ground-truth value from the device.
   */
  devicePixelRatio: number;
  /**
   * `navigator.userAgent` string for device identification.
   * Does not contain authentication secrets.
   */
  userAgent: string;
}

/**
 * Parses a raw `Runtime.evaluate` result value into a `SafeAreaMeasurement`.
 * The probe returns a JSON string (because `returnByValue:true` with a plain
 * object works unreliably across Chii relay versions — stringifying is safer).
 *
 * `source` is supplied by the caller (`measureSafeArea`) from the env SSoT.
 *
 * Throws if the result is missing, contains an exception, or cannot be parsed.
 */
export function normalizeSafeAreaResult(
  rawValue: unknown,
  source: McpEnvironment,
): SafeAreaMeasurement {
  if (typeof rawValue !== 'string') {
    throw new Error(
      `measure_safe_area: probe returned unexpected type "${typeof rawValue}" — expected JSON string`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    throw new Error(`measure_safe_area: probe returned non-JSON string: ${rawValue}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('measure_safe_area: parsed result is not an object');
  }
  const obj = parsed as Record<string, unknown>;

  function requireInsets(
    key: string,
  ): { top: number; right: number; bottom: number; left: number } | null {
    const v = obj[key];
    if (v === null || v === undefined) return null;
    if (typeof v !== 'object') return null;
    const r = v as Record<string, unknown>;
    return {
      top: typeof r.top === 'number' ? r.top : 0,
      right: typeof r.right === 'number' ? r.right : 0,
      bottom: typeof r.bottom === 'number' ? r.bottom : 0,
      left: typeof r.left === 'number' ? r.left : 0,
    };
  }

  const cssEnv = requireInsets('cssEnv') ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const sdkInsets = requireInsets('sdkInsets');
  const sdkInsetsSource: SdkInsetsSource =
    obj.sdkInsetsSource === 'window.__sdk' || obj.sdkInsetsSource === 'window.__ait'
      ? obj.sdkInsetsSource
      : null;
  const sdkInsetsError = typeof obj.sdkInsetsError === 'string' ? obj.sdkInsetsError : undefined;
  const navBarHeight = typeof obj.navBarHeight === 'number' ? obj.navBarHeight : null;
  const navBarHeightSource =
    typeof obj.navBarHeightSource === 'string' ? obj.navBarHeightSource : 'not-exposed-by-sdk';
  const innerWidth = typeof obj.innerWidth === 'number' ? obj.innerWidth : 0;
  const innerHeight = typeof obj.innerHeight === 'number' ? obj.innerHeight : 0;
  const devicePixelRatio = typeof obj.devicePixelRatio === 'number' ? obj.devicePixelRatio : 1;
  const userAgent = typeof obj.userAgent === 'string' ? obj.userAgent : '';

  return {
    source,
    cssEnv,
    sdkInsets,
    sdkInsetsSource,
    ...(sdkInsetsError !== undefined ? { sdkInsetsError } : {}),
    navBarHeight,
    navBarHeightSource,
    innerWidth,
    innerHeight,
    devicePixelRatio,
    userAgent,
  };
}

/**
 * Runs the safe-area probe on the attached page and returns a normalized
 * `SafeAreaMeasurement`. Read-only — does not mutate page state.
 *
 * `source` is supplied by the caller from the env detection SSoT (see
 * `src/mcp/environment.ts`). The same `Runtime.evaluate` call runs in both
 * envs — the probe expression tries `window.__sdk` first (relay) then
 * `window.__ait` (mock), so mock fidelity is enforced by the panel's
 * `applyViewport`/`computeSafeAreaInsets` keeping `__ait.state.safeAreaInsets`
 * correct (RFC #277 Tier C parity, #275 model).
 *
 * Throws on CDP error, probe exception, or result parse failure.
 */
export async function measureSafeArea(
  connection: CdpConnection,
  source: McpEnvironment,
): Promise<SafeAreaMeasurement> {
  const result = await connection.send('Runtime.evaluate', {
    expression: SAFE_AREA_PROBE_EXPRESSION,
    returnByValue: true,
    awaitPromise: false,
  });
  if (result.exceptionDetails) {
    const msg =
      result.exceptionDetails.exception?.description ??
      result.exceptionDetails.text ??
      'Runtime.evaluate threw an exception';
    throw new Error(`measure_safe_area: probe threw — ${msg}`);
  }
  return normalizeSafeAreaResult(result.result.value, source);
}

/* -------------------------------------------------------------------------- */
/* evaluate — arbitrary JS via Runtime.evaluate                               */
/* -------------------------------------------------------------------------- */

/**
 * Result returned by the `evaluate` tool.
 *
 * `value` holds the `returnByValue` result from CDP — it may be any
 * JSON-serialisable type. Treat it as opaque for logging purposes (it could
 * carry sensitive data from the page context).
 *
 * SECRET-HANDLING: do NOT write `value` to any log or stderr — return it to
 * the agent via the tool result only.
 */
export interface EvaluateResult {
  /** The evaluated result value (`returnByValue: true`). */
  value: unknown;
  /** CDP type string of the result (e.g. "string", "number", "object"). */
  type: string;
}

/**
 * Evaluates an arbitrary JS expression on the attached page via
 * `Runtime.evaluate`. NOT read-only — the expression may have side effects.
 *
 * Throws if the evaluation produced a CDP exception.
 *
 * SECRET-HANDLING: expression and result value are NOT written to any log.
 */
export async function evaluate(
  connection: CdpConnection,
  expression: string,
): Promise<EvaluateResult> {
  const result = await connection.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: false,
  });
  if (result.exceptionDetails) {
    // Surface only the engine error string — never the expression or result value.
    const msg =
      result.exceptionDetails.exception?.description ??
      result.exceptionDetails.text ??
      'Runtime.evaluate threw an exception';
    throw new Error(`evaluate failed: ${msg}`);
  }
  return { value: result.result.value, type: result.result.type };
}

/* -------------------------------------------------------------------------- */
/* call_sdk — window.__sdkCall bridge via Runtime.evaluate                    */
/* -------------------------------------------------------------------------- */

/**
 * Result returned by the `call_sdk` tool.
 * The bridge call wraps success/failure in a JSON envelope so cross-Chii
 * stringification is reliable (same approach as `measure_safe_area`).
 *
 * `recentException` is populated when a `Runtime.exceptionThrown` event was
 * observed within the heuristic triage window [callStart-50ms, callEnd+200ms].
 * This helps correlate an SDK throw with the bridge result, especially when
 * the SDK throws synchronously before the promise resolves.
 */
export type CallSdkResult =
  | { ok: true; value: unknown; recentException?: BufferedException }
  | { ok: false; error: string; recentException?: BufferedException };

/**
 * Builds the Runtime.evaluate expression that calls `window.__sdkCall` with
 * the given method name and args, awaits the promise, and returns a JSON
 * envelope `{ok, value/error}` as a string.
 *
 * Name and args are embedded via `JSON.stringify` so they are safely escaped.
 * The expression checks for `window.__sdkCall` and returns a clear error if
 * it is absent (non-dogfood bundle).
 *
 * SECRET-HANDLING: the expression is built here and MUST NOT be written to
 * any log or stderr by the caller.
 */
export function buildCallSdkExpression(name: string, args: unknown[]): string {
  const safeName = JSON.stringify(name);
  const safeArgs = JSON.stringify(args);
  return (
    `(async () => {` +
    ` if (typeof window.__sdkCall !== 'function') {` +
    `  return JSON.stringify({ok:false,error:'sdk-absent: window.__sdkCall이 주입되지 않았습니다 (dogfood 빌드가 아닙니다). dogfood 채널로 재배포하세요.'});` +
    ` }` +
    ` try {` +
    `  const r = await window.__sdkCall(${safeName}, ...${safeArgs});` +
    `  return JSON.stringify({ok:true,value:r});` +
    ` } catch(e) {` +
    `  return JSON.stringify({ok:false,error:String(e && e.message || e)});` +
    ` }` +
    `})()`
  );
}

/**
 * Parses the JSON envelope string returned by the `call_sdk` expression.
 * Returns a typed `CallSdkResult`.
 *
 * Throws only on parse failure (not on ok:false — that is a normal result).
 */
export function normalizeCallSdkResult(rawValue: unknown): CallSdkResult {
  if (typeof rawValue !== 'string') {
    throw new Error(
      `call_sdk: bridge returned unexpected type "${typeof rawValue}" — expected JSON string`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    // Do NOT include rawValue in the error message — it could contain secrets.
    throw new Error('call_sdk: bridge returned non-JSON string');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('call_sdk: parsed result is not an object');
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.ok === true) {
    return { ok: true, value: obj.value };
  }
  if (obj.ok === false) {
    return { ok: false, error: typeof obj.error === 'string' ? obj.error : String(obj.error) };
  }
  throw new Error('call_sdk: bridge result missing "ok" field');
}

/**
 * Looks up the most recent exception from the buffer that falls within the
 * triage window [windowStart, windowEnd]. Returns `undefined` if none found.
 *
 * The heuristic window is:
 *   - windowStart = callStart - 50ms  (catch sync throws before bridge fires)
 *   - windowEnd   = callEnd + 200ms   (catch async throws resolved soon after)
 *
 * Only the most recent exception within the window is returned (the one most
 * likely to be causally related to the SDK call).
 */
function findRecentException(
  connection: CdpConnection,
  windowStart: number,
  windowEnd: number,
): BufferedException | undefined {
  const events = connection.getBufferedEvents('Runtime.exceptionThrown');
  // Scan from the tail (most recent) to find the closest-in-time exception.
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.timestamp >= windowStart && e.timestamp <= windowEnd) {
      return normalizeException(e);
    }
  }
  return undefined;
}

/**
 * Calls a dogfood SDK method via `window.__sdkCall` on the attached page.
 * NOT read-only — SDK calls may have side effects.
 *
 * On env 3/4 (toss WebView relay) this hits the real SDK. On env 1 (local
 * mock) and env 2 (PWA relay — real WebKit, mock SDK) it hits the mock SDK.
 *
 * 인자 시그니처 검증: 등록된 메서드는 bridge 호출 전에 인자를 검증하고, mismatch면
 * `{ok:false, error}` MCP 오류 결과를 반환한다(bridge에 도달하지 않음).
 * 미등록 메서드는 passthrough + stderr 경고 1회.
 *
 * Throws on CDP error or result parse failure. Returns `{ok:false, error}`
 * for bridge-level errors (method not found, SDK threw, bridge absent) or
 * argument schema violations.
 *
 * If a `Runtime.exceptionThrown` event was observed within the triage window
 * [callStart-50ms, callEnd+200ms], the result includes `recentException` for
 * crash triage. This window is a heuristic — it catches the common case of an
 * SDK throw immediately before/after the bridge resolves.
 *
 * SECRET-HANDLING: name, args, and the result value are NOT written to any log.
 */
export async function callSdk(
  connection: CdpConnection,
  name: string,
  args: unknown[],
): Promise<CallSdkResult> {
  // 인자 시그니처 검증 — bridge 호출 전에 reject하여 native crash를 예방한다.
  const signature = lookupSignature(name);
  if (signature !== undefined) {
    const validation = signature.validateArgs(args);
    if (!validation.ok) {
      // isError: true 형태로 반환 — bridge에 도달하지 않음.
      const errorText =
        `call_sdk("${name}") 인자 시그니처 오류.\n` +
        `받음: ${validation.received}\n` +
        `기대: ${validation.expected}\n` +
        `올바른 예시: ${signature.example}`;
      return { ok: false, error: errorText };
    }
  } else {
    // 미등록 메서드 — passthrough하지만 stderr에 경고 1회.
    warnPassthrough(name);
  }

  const callStart = Date.now();
  const expression = buildCallSdkExpression(name, args);
  const result = await connection.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  const callEnd = Date.now();

  if (result.exceptionDetails) {
    // Surface only the engine error string — never name, args, or result value.
    const msg =
      result.exceptionDetails.exception?.description ??
      result.exceptionDetails.text ??
      'Runtime.evaluate threw an exception';
    throw new Error(`call_sdk threw: ${msg}`);
  }

  const sdkResult = normalizeCallSdkResult(result.result.value);

  // Triage window: [callStart - 50ms, callEnd + 200ms].
  // -50ms: catches sync throws that fire just before the bridge call is sent.
  // +200ms: catches async throws resolved shortly after the bridge returns.
  const recentException = findRecentException(connection, callStart - 50, callEnd + 200);

  if (recentException !== undefined) {
    return { ...sdkResult, recentException };
  }
  return sdkResult;
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

/* -------------------------------------------------------------------------- */
/* get_diagnostics — single-call server status snapshot (#286)                */
/* -------------------------------------------------------------------------- */

/**
 * Represents a single redacted server-side error entry in the diagnostics
 * snapshot. PII / secrets are scrubbed before this is returned.
 */
export interface DiagnosticsError {
  /** ISO timestamp when the error was recorded. */
  timestamp: string;
  /** Error message with PII/secrets redacted (e.g. `at=<redacted>`). */
  message: string;
  /** Optional error category for quick triage. */
  category?: string;
}

/**
 * Tunnel state in the diagnostics snapshot. Same shape as `TunnelStatus` but
 * extended with the lock-file data (pid, startedAt) when available.
 */
export interface DiagnosticsTunnelInfo {
  /** Whether the cloudflared quick tunnel is currently up. */
  up: boolean;
  /** Public `wss://*.trycloudflare.com` relay URL, or `null`. */
  wssUrl: string | null;
  /**
   * PID of the MCP server process that owns the tunnel (from the lock file),
   * or `null` when no lock is present.
   */
  pid: number | null;
  /**
   * ISO timestamp when the owning server process started (from the lock file),
   * or `null`.
   */
  startedAt: string | null;
  /**
   * ISO timestamp when the tunnel permanently dropped (health probe exhausted
   * all reissue attempts). `null` when the tunnel has not permanently dropped.
   * When non-null, the MCP server must be restarted to recover.
   */
  droppedAt: string | null;
  /**
   * Number of automatic reissue attempts made before the permanent drop.
   * 0 when no drop has occurred.
   */
  reissueAttempts: number;
}

/**
 * Server-lock holder info from `~/.ait-devtools/server.lock`. `null` when
 * no lock file exists (server was cleanly shut down or never started).
 */
export interface DiagnosticsLockHolder {
  pid: number;
  startedAt: string;
  /** wssUrl recorded in the lock file — may be `null` when tunnel is still starting. */
  wssUrl: string | null;
}

/**
 * The next recommended tool for the agent to call, based on the current server
 * state snapshot. `null` means the session looks healthy — no specific action needed.
 */
export interface NextRecommendedAction {
  /** MCP tool name to call next (e.g. `'build_attach_url'`, `'restart'`). */
  tool: string;
  /** Human-readable reason explaining why this action is recommended. */
  reason: string;
}

/**
 * Full server status snapshot returned by `get_diagnostics`.
 *
 * All fields are nullable — a missing value means "not yet known" (e.g. tunnel
 * not up yet) rather than an error. The schema is intentionally stable across
 * versions: new optional fields may be added but existing fields are not
 * removed or renamed.
 *
 * SECRET-HANDLING: No TOTP secret, cookie, deploy key, or `at=` code value
 * appears in this snapshot. `recentErrors` entries are redacted before inclusion.
 */
export interface DiagnosticsResult {
  /** `@modelcontextprotocol/sdk` package version string. */
  mcpVersion: string | null;
  /** `@ait-co/devtools` package version string. */
  devtoolsVersion: string | null;
  /** Tunnel state including lock-file pid/startedAt. */
  tunnel: DiagnosticsTunnelInfo;
  /** Current list_pages result (pages + crash info + singleAttachModel). */
  pages: ListPagesResult | null;
  /** ISO timestamp of the most recent page attach, or `null`. */
  lastAttachAt: string | null;
  /** ISO timestamp of the most recent page detach, or `null`. */
  lastDetachAt: string | null;
  /**
   * Recent server-side errors (up to `recent_errors_limit`, default 10).
   * Redacted: `at=<redacted>`, cookie headers stripped, AITCC_API_KEY masked.
   */
  recentErrors: DiagnosticsError[];
  /**
   * Resolved environment and the reason string.
   *
   * `kind` — the precise four-value environment (`mock` | `relay-dev` |
   *   `relay-live` | `relay-mobile`). Use this for new code.
   * `env`  — backward-compat two-value alias (`mock` | `relay`). Kept so
   *   existing callers that only distinguish mock vs relay continue to work.
   */
  environment: {
    kind: McpEnvironment;
    /** @deprecated Use `kind` instead. Kept for backward compatibility. */
    env: 'mock' | 'relay';
    reason: string;
    /** `true` when the LIVE side-effect guard is active (`kind === 'relay-live'`). */
    liveGuardActive: boolean;
  };
  /**
   * Contents of `~/.ait-devtools/server.lock`, or `null` when absent.
   * Useful for diagnosing stale-lock conflicts without running the full server.
   */
  serverLockHolder: DiagnosticsLockHolder | null;
  /**
   * Basic process identity for the running MCP server daemon.
   * Useful for diagnosing orphaned daemons and stale parent associations.
   */
  process: {
    /** PID of this MCP server process. */
    pid: number;
    /** Parent PID at the time `get_diagnostics` was called. */
    ppid: number;
    /** Whether the parent process is still alive at snapshot time. */
    parentAlive: boolean;
  };
  /**
   * Single next recommended action for the agent, or `null` when the session
   * looks healthy. Derived deterministically from the other snapshot fields —
   * the agent should call this tool next rather than inferring from raw fields.
   *
   * Branch rules (evaluated in priority order):
   *   0. tunnel.droppedAt non-null                   → restart (permanent tunnel drop)
   *   1. tunnel.up === false AND relay env            → restart
   *   1b. tunnel.up === false AND mock env, no pages  → wait_for_page (local target is tunnel-less)
   *   2. tunnel.up, pages empty, env === relay        → build_attach_url
   *   3. pages[0] exists + crashDetectedAt non-null   → build_attach_url (re-attach)
   *   4. otherwise                                    → null
   */
  nextRecommendedAction: NextRecommendedAction | null;
}

/**
 * Registry of server-side errors collected by `DiagnosticsCollector`.
 * Injected into `createDebugServer` so it is testable without a real process.
 */
export interface DiagnosticsCollector {
  /** Records a server-side error for later surfacing in `get_diagnostics`. */
  recordError(message: string, category?: string): void;
  /** Returns the most recent `limit` errors, oldest-first. */
  getRecentErrors(limit: number): DiagnosticsError[];
  /** Records an attach event (ISO timestamp stored). */
  recordAttach(): void;
  /** Records a detach event (ISO timestamp stored). */
  recordDetach(): void;
  /** Returns the ISO timestamp of the last attach, or `null`. */
  getLastAttachAt(): string | null;
  /** Returns the ISO timestamp of the last detach, or `null`. */
  getLastDetachAt(): string | null;
}

/** Secret-redaction patterns applied before error messages enter the buffer. */
const SECRET_REDACT_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  // TOTP at= code value.
  [/\bat=([^&\s"']+)/g, 'at=<redacted>'],
  // Cookie / Set-Cookie header values — replace everything after the colon.
  [/((?:set-)?cookie)\s*:\s*.+/gi, '$1: <redacted>'],
  // AITCC_API_KEY env-var-style references.
  [/AITCC_API_KEY\s*=\s*\S+/gi, 'AITCC_API_KEY=<redacted>'],
  // Authorization header (covers "Authorization: Bearer …" and bare "Bearer <token>").
  [/Authorization\s*:\s*.+/gi, 'Authorization: <redacted>'],
  [/\bBearer\s+\S+/g, 'Bearer <redacted>'],
];

/**
 * Applies all secret-redaction patterns to an error message string.
 * Used before storing errors in the `DiagnosticsCollector` ring buffer.
 *
 * SECRET-HANDLING: this is the single bottleneck for redaction — all error
 * strings must pass through here before reaching the buffer.
 */
export function redactErrorMessage(message: string): string {
  let result = message;
  for (const [pattern, replacement] of SECRET_REDACT_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/** Default max buffer size for the error ring buffer. */
const DEFAULT_ERROR_BUFFER_SIZE = 50;

/**
 * In-memory implementation of `DiagnosticsCollector`. Thread-safe in the
 * single-threaded Node.js sense (synchronous mutations only).
 */
export class InMemoryDiagnosticsCollector implements DiagnosticsCollector {
  private readonly buffer: DiagnosticsError[] = [];
  private readonly maxSize: number;
  private lastAttachAt: string | null = null;
  private lastDetachAt: string | null = null;

  constructor(maxSize = DEFAULT_ERROR_BUFFER_SIZE) {
    this.maxSize = maxSize;
  }

  recordError(message: string, category?: string): void {
    const entry: DiagnosticsError = {
      timestamp: new Date().toISOString(),
      message: redactErrorMessage(message),
      ...(category !== undefined ? { category } : {}),
    };
    this.buffer.push(entry);
    // Keep only the most recent `maxSize` entries.
    if (this.buffer.length > this.maxSize) {
      this.buffer.shift();
    }
  }

  getRecentErrors(limit: number): DiagnosticsError[] {
    const cap = Math.min(Math.max(1, limit), DEFAULT_ERROR_BUFFER_SIZE);
    const sliced =
      this.buffer.length > cap ? this.buffer.slice(this.buffer.length - cap) : [...this.buffer];
    return sliced;
  }

  recordAttach(): void {
    this.lastAttachAt = new Date().toISOString();
  }

  recordDetach(): void {
    this.lastDetachAt = new Date().toISOString();
  }

  getLastAttachAt(): string | null {
    return this.lastAttachAt;
  }

  getLastDetachAt(): string | null {
    return this.lastDetachAt;
  }
}

/**
 * Returns the `@modelcontextprotocol/sdk` version baked in at build time via
 * the `__MCP_SDK_VERSION__` define (see `tsdown.config.ts`). Returns `null`
 * when the define is absent (unbundled test runs) and the runtime fallback
 * below also fails — diagnostics must never throw.
 *
 * Earlier attempts resolved `@modelcontextprotocol/sdk/package.json` (not in
 * the SDK `exports` map → `ERR_PACKAGE_PATH_NOT_EXPORTED`) or the bare
 * `@modelcontextprotocol/sdk` main entry (also absent → `MODULE_NOT_FOUND`),
 * so both this fallback AND the build-time define silently produced `null` —
 * leaving `mcpVersion: null` in a real bundle (issue #361, observed live). The
 * fix resolves a subpath that IS exported (`./server/mcp.js`) and walks back to
 * the package root, in BOTH the build define and this fallback.
 *
 * Kept `async` for call-site compatibility (`Promise.all` at the caller); the
 * body is synchronous apart from the best-effort fallback.
 */
export async function readMcpSdkVersion(): Promise<string | null> {
  // Primary: build-time define (bare identifier, substituted by tsdown).
  if (typeof __MCP_SDK_VERSION__ === 'string' && __MCP_SDK_VERSION__.length > 0) {
    return __MCP_SDK_VERSION__;
  }
  // Fallback for unbundled runs (the define never ran): resolve an EXPORTED
  // subpath (`./server/mcp.js`) and read the sibling package.json by path —
  // bypassing the `exports` gate that blocks both the `/package.json` subpath
  // and the bare main entry.
  try {
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    const entry = req.resolve('@modelcontextprotocol/sdk/server/mcp.js');
    const marker = '@modelcontextprotocol/sdk';
    const root = entry.slice(0, entry.indexOf(marker) + marker.length);
    const { readFileSync } = await import('node:fs');
    const raw = readFileSync(`${root}/package.json`, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
}

/**
 * Returns the `@ait-co/devtools` package version injected at build time via
 * the `__VERSION__` define. Returns `null` when the global is absent (e.g. in
 * some test environments that skip the build step).
 */
export function readDevtoolsVersion(): string | null {
  // `__VERSION__` is a bare identifier replaced at build time by the tsdown
  // `define` (see `tsdown.config.ts`) — the SAME mechanism `debug-server.ts`
  // and `server.ts` use for the MCP server `version`. It must be referenced as
  // a bare identifier, not `globalThis.__VERSION__`: `define` only substitutes
  // the bare token, so the property access always read `undefined` and this
  // function always returned `null` in a real bundle (issue #361). The
  // `typeof` guard keeps it null-safe in unbundled test runs where the define
  // never ran.
  return typeof __VERSION__ === 'string' && __VERSION__.length > 0 ? __VERSION__ : null;
}

/**
 * Derives the next recommended action from a completed diagnostics snapshot.
 *
 * Branch rules (evaluated in priority order):
 *   0. tunnel.droppedAt non-null                  → restart (permanent tunnel drop — highest priority)
 *   1. tunnel.up === false AND env is relay       → restart (relay needs a live tunnel)
 *   1b. tunnel.up === false AND env is mock       → wait_for_page (local target: tunnel-less is normal)
 *   2. tunnel.up, pages empty, env === relay      → build_attach_url (start attach)
 *   3. pages has entry + crashDetectedAt non-null → build_attach_url (re-attach after crash)
 *   4. otherwise                                  → null (session looks healthy)
 *
 * Pure — does not throw; receives the final assembled snapshot fields.
 */
export function computeNextRecommendedAction(
  tunnel: DiagnosticsTunnelInfo,
  pages: ListPagesResult | null,
  env: McpEnvironment,
): NextRecommendedAction | null {
  // Rule 0: permanent tunnel drop — highest priority, beats crash / empty-pages rules.
  // droppedAt is set by the health probe after exhausting all reissue attempts.
  if (tunnel.droppedAt != null) {
    return {
      tool: 'restart',
      reason:
        `tunnel permanently dropped at ${tunnel.droppedAt} after ${tunnel.reissueAttempts} reissue attempt(s) — ` +
        'restart the MCP server (npx @ait-co/devtools devtools-mcp)',
    };
  }

  // Rule 1: tunnel is down.
  if (!tunnel.up) {
    // Rule 1b: local-target (mock env) runs without a relay tunnel by design —
    // tunnel.up === false is the expected steady state. Instead of recommending
    // a server restart, guide the agent to wait for the page to load.
    if (!isRelayEnv(env)) {
      // Only surface wait_for_page when no page is attached yet; once a page
      // attaches the session is healthy and null is the correct return value.
      if (pages !== null && pages.pages.length === 0 && !pages.crashDetectedAt) {
        return {
          tool: 'wait_for_page',
          reason:
            'local Chromium spawn 직후 — 페이지 로드를 기다리거나 list_pages를 재호출하세요 ' +
            '(local 모드는 tunnel이 없는 게 정상입니다)',
        };
      }
      // Page already attached or crash detected — fall through to other rules.
    } else {
      // Rule 1 (relay env): tunnel must be up for relay to work — restart.
      return {
        tool: 'restart',
        reason: 'tunnel not up — run `npx @ait-co/devtools devtools-mcp` to restart',
      };
    }
  }

  // Rule 2: tunnel up but no pages attached in relay env → start attach.
  if (isRelayEnv(env) && pages !== null && pages.pages.length === 0 && !pages.crashDetectedAt) {
    return {
      tool: 'build_attach_url',
      reason: 'tunnel ready, no pages attached — call build_attach_url to generate the attach QR',
    };
  }

  // Rule 3: crash detected — need to re-attach.
  if (pages !== null && pages.crashDetectedAt !== null) {
    return {
      tool: 'build_attach_url',
      reason: `page crashed at ${pages.crashDetectedAt} — call build_attach_url to re-attach`,
    };
  }

  // Rule 4: session looks healthy.
  return null;
}

/** Input for `getDiagnostics`. */
export interface GetDiagnosticsInput {
  /** Current tunnel status (from the server's live `getTunnelStatus()`). */
  tunnel: TunnelStatus;
  /**
   * CDP connection used to call `list_pages` — may be absent in edge cases
   * (e.g. called from the dev-mode server which has no CDP connection).
   */
  connection?: CdpConnection;
  /**
   * Resolved MCP environment (`mock` | `relay-dev` | `relay-live` |
   * `relay-mobile`). Caller obtains via `resolveEnvironment()`.
   */
  env: McpEnvironment;
  /** Human-readable reason for the env decision. */
  envReason: string;
  /** Diagnostics collector for errors / attach events. */
  collector: DiagnosticsCollector;
  /** Lock-file reader — injected so tests can override without touching the FS. */
  readLock: () => import('./server-lock.js').LockData | null;
  /** Maximum number of recent errors to include (default 10). */
  recentErrorsLimit?: number;
  /** Optional async resolver for the MCP SDK version. */
  getMcpVersion?: () => Promise<string | null>;
  /**
   * Injectable parent-alive check for testability.
   * Defaults to `() => isPidAlive(process.ppid)` in production.
   */
  checkParentAlive?: () => boolean;
}

/**
 * Builds the `get_diagnostics` response. Pure — does not throw; missing data
 * fields are `null`. Async because `readMcpSdkVersion` needs `import()`.
 *
 * SECRET-HANDLING:
 *   - `recentErrors` messages are already redacted by `recordError` (via
 *     `redactErrorMessage`). No additional redaction needed here.
 *   - `tunnel.wssUrl` is a public cloudflared hostname — not a secret.
 *   - Lock file data contains only pid + startedAt + wssUrl — no secrets.
 */
export async function getDiagnostics(input: GetDiagnosticsInput): Promise<DiagnosticsResult> {
  const {
    tunnel,
    connection,
    env,
    envReason,
    collector,
    readLock: readLockFn,
    recentErrorsLimit = 10,
    getMcpVersion = readMcpSdkVersion,
    checkParentAlive = () => isPidAlive(process.ppid),
  } = input;

  const [mcpVersion, devtoolsVersion] = await Promise.all([
    getMcpVersion(),
    Promise.resolve(readDevtoolsVersion()),
  ]);

  // Read lock file for serverLockHolder + tunnel pid/startedAt.
  const lockData = readLockFn();
  const serverLockHolder: DiagnosticsLockHolder | null = lockData
    ? { pid: lockData.pid, startedAt: lockData.startedAt, wssUrl: lockData.wssUrl }
    : null;

  const tunnelInfo: DiagnosticsTunnelInfo = {
    up: tunnel.up,
    wssUrl: tunnel.wssUrl,
    pid: lockData?.pid ?? null,
    startedAt: lockData?.startedAt ?? null,
    droppedAt: tunnel.droppedAt ?? null,
    reissueAttempts: tunnel.reissueAttempts ?? 0,
  };

  // list_pages — non-fatal; null on any error.
  let pages: ListPagesResult | null = null;
  if (connection !== undefined) {
    try {
      pages = listPages(connection, tunnel);
    } catch {
      // Ignore — pages stays null.
    }
  }

  const limit = Math.min(Math.max(1, recentErrorsLimit), 50);
  const recentErrors = collector.getRecentErrors(limit);

  const nextRecommendedAction = computeNextRecommendedAction(tunnelInfo, pages, env);

  return {
    mcpVersion,
    devtoolsVersion,
    tunnel: tunnelInfo,
    pages,
    lastAttachAt: collector.getLastAttachAt(),
    lastDetachAt: collector.getLastDetachAt(),
    recentErrors,
    environment: {
      kind: env,
      env: toLegacyEnv(env),
      reason: envReason,
      liveGuardActive: isLiveRelayEnv(env),
    },
    serverLockHolder,
    process: {
      pid: process.pid,
      ppid: process.ppid,
      parentAlive: checkParentAlive(),
    },
    nextRecommendedAction,
  };
}
