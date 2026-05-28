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
  CdpConnection,
  CdpRemoteObject,
  ConsoleApiCalledEvent,
  DomGetDocumentResult,
  DomSnapshotResult,
  NetworkRequestWillBeSentEvent,
  NetworkResponseReceivedEvent,
} from './cdp-connection.js';
import { buildDeepLinkAttachUrl, validateSchemeAuthority } from './deeplink.js';

/** Tunnel state surfaced by `list_pages`. */
export interface TunnelStatus {
  /** Whether the cloudflared quick tunnel is up. */
  up: boolean;
  /** Public `wss://*.trycloudflare.com` relay URL the phone attaches to. */
  wssUrl: string | null;
}

/** Static MCP tool descriptors (name + JSONSchema) for the full debug tool surface. */
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
      'Returns the single active page (at most one) the relay sees attached. ' +
      'When a second page attaches, the previous one is evicted (last-attach wins — ' +
      'single-attach model). The result includes `singleAttachModel: true` so the agent ' +
      'knows the array is always 0 or 1 entries. ' +
      'Also returns whether the cloudflared tunnel is up and the public wss relay URL. ' +
      'Each page entry includes a `lastSeenAt` ISO timestamp (last inbound CDP message from ' +
      'that target — useful to detect stale entries when the phone app backgrounded). ' +
      'The result also includes `crashDetectedAt` (ISO timestamp or null): when non-null, ' +
      'a page crash was detected via Inspector.targetCrashed / Target.targetDestroyed since ' +
      'the last attach, the pages list will be empty, and `crashWarning` shows a Korean hint ' +
      'to re-attach. ' +
      'Call this first to confirm a page is attached before reading console/network.',
    inputSchema: { type: 'object', properties: {}, required: [] },
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
      'list_pages first. Set wait_for_attach=true to block until the phone scans and a page ' +
      'attaches (polls listTargets up to 90 s), then returns the attached page info too. ' +
      'When open_in_browser=true (default), saves the QR as a PNG and opens it in the OS default ' +
      'browser — only works when the MCP server runs on a local GUI machine (not headless/remote containers).',
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
            'listTargets ~1 s interval, timeout 90 s). On attach, the response includes the ' +
            'attached page list. On timeout, returns an error with a list_pages retry hint.',
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
    name: 'measure_safe_area',
    description:
      'Runs a safe-area probe on the attached mini-app page via Runtime.evaluate and returns ' +
      'normalized safe-area insets, viewport geometry, device pixel ratio, and User-Agent. ' +
      'Read-only — does not modify page state. ' +
      'Use in a relay session (phone attached) to get ground-truth values for upgrading a ' +
      'viewport preset from extrapolated/placeholder to measured. ' +
      'Requires the relay to be attached — call list_pages first.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'evaluate',
    description:
      'Evaluates an arbitrary JavaScript expression on the attached mini-app page via ' +
      'CDP Runtime.evaluate (returnByValue: true) and returns the result. ' +
      'NOT read-only — the expression can have side effects (DOM mutations, SDK calls, ' +
      'state changes). Requires the relay to be attached — call list_pages first. ' +
      'Throws if the evaluation throws an exception on the page.',
    inputSchema: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'JavaScript expression to evaluate in the page context.',
        },
      },
      required: ['expression'],
    },
  },
  {
    name: 'call_sdk',
    description:
      'Calls a dogfood SDK method via the window.__sdkCall bridge ' +
      '(exported by @apps-in-toss/web-framework only in __DEBUG_BUILD__ bundles). ' +
      'NOT read-only — SDK calls have side effects (navigation, payments, permissions, etc.). ' +
      'On env 2/3 (real device relay) this hits the real SDK; on env 1 (local mock) it hits ' +
      'the mock SDK. Requires the relay to be attached — call list_pages first. ' +
      'Returns {ok: true, value} on success or {ok: false, error} on failure. ' +
      'Returns a clear error if window.__sdkCall is not available (non-dogfood bundle).',
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
      },
      required: ['name'],
    },
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
  'list_pages',
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
  /** The scheme URL with `debug=1&relay=<wss>` spliced in. */
  attachUrl: string;
  /** The relay URL that was spliced in (this session's quick tunnel). */
  relayUrl: string;
  /**
   * Non-fatal warning about the scheme URL's authority being missing or
   * suspicious (e.g. "web", "localhost"). Callers should surface this to
   * help the user catch a malformed URL early.
   */
  authorityWarning?: string;
}

/**
 * Builds a self-attaching dogfood deep link from an `ait deploy --scheme-only`
 * URL plus this session's live relay. Throws if the tunnel is not up yet (no
 * relay URL to splice in) — the caller surfaces that as a tool error.
 *
 * Also validates the scheme URL's authority. A suspicious authority (empty,
 * "web", "localhost", etc.) is surfaced as a non-fatal `authorityWarning` on
 * the result so the caller can show a helpful hint without blocking the link
 * generation (the warning is consistent with how other validation in
 * `buildDeepLinkAttachUrl` works — hard errors for relay, soft warning for
 * the scheme authority which is in the caller's input, not ours to own).
 */
export function buildAttachUrl(schemeUrl: string, tunnel: TunnelStatus): BuildAttachUrlResult {
  if (!tunnel.up || tunnel.wssUrl === null) {
    throw new Error(
      'No relay URL yet — the cloudflared quick tunnel is not up. ' +
        'Call list_pages to check tunnel status.',
    );
  }
  const authorityWarning = validateSchemeAuthority(schemeUrl) ?? undefined;
  return {
    attachUrl: buildDeepLinkAttachUrl(schemeUrl, tunnel.wssUrl),
    relayUrl: tunnel.wssUrl,
    ...(authorityWarning !== undefined ? { authorityWarning } : {}),
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
 * platform별 fallback chain으로 시도하며, 모두 실패해도 `opened: false` + `httpUrl`을
 * 반환해 사용자가 직접 브라우저에 붙여넣을 수 있게 한다.
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

  const candidates = getBrowserCandidates(httpUrl);
  const stderrLines: string[] = [];

  for (const { cmd, args } of candidates) {
    const result = spawnSync(cmd, args, { encoding: 'utf8', timeout: 5000 });

    if (result.error) {
      // 명령 자체를 실행하지 못한 경우 (ENOENT 등) — 다음 후보로.
      stderrLines.push(`${cmd}: ${result.error.message}`);
      continue;
    }

    const stderr = typeof result.stderr === 'string' ? result.stderr : '';
    if (stderr) {
      stderrLines.push(`${cmd}: ${redactSecrets(stderr.trim())}`);
    }

    // exit 0이어도 stderr에 launch 실패 패턴이 있으면 실패로 취급.
    if (result.status === 0 && !isLaunchFailureStderr(stderr)) {
      return { opened: true, httpUrl, pngUrl };
    }
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
 *   2. `window.__sdk.SafeAreaInsets.get()` (1st priority) or
 *      `window.__sdk.getSafeAreaInsets()` (2nd priority) — both surfaces
 *      confirmed live on iPhone 15 Pro relay. `window.__sdk` is only present
 *      in dogfood (__DEBUG_BUILD__) bundles; outside those it is undefined.
 *      If both paths fail the result carries `sdkInsetsError` explaining why.
 *   3. nav bar geometry: the SDK does not expose navBar height as a standalone
 *      API — `.ait-navbar` DOM height is read as a cross-check, and
 *      `navBarHeightSource` records where it came from.
 *   4. `innerWidth`, `innerHeight`, `devicePixelRatio`, `navigator.userAgent`.
 *
 * Returns a plain JSON-serialisable object so `returnByValue: true` works.
 *
 * NOTE: This expression is evaluated in the page context on the real device.
 * It does not mutate any page state — the temporary element is removed after
 * reading. No secret or auth token is read or returned.
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
  var sdkInsetsError = undefined;
  try {
    var sdk = window.__sdk;
    if (sdk && sdk.SafeAreaInsets && typeof sdk.SafeAreaInsets.get === 'function') {
      sdkInsets = sdk.SafeAreaInsets.get();
    } else if (sdk && typeof sdk.getSafeAreaInsets === 'function') {
      sdkInsets = sdk.getSafeAreaInsets();
    } else if (!sdk) {
      sdkInsetsError = 'window.__sdk not available (non-dogfood bundle)';
    } else {
      sdkInsetsError = 'neither SafeAreaInsets.get nor getSafeAreaInsets found on window.__sdk';
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
 * Normalized result returned by `measure_safe_area`.
 *
 * All inset values are in CSS pixels as reported by the real device.
 * `userAgent` is included for device identification; it never contains
 * authentication secrets or session tokens.
 */
export interface SafeAreaMeasurement {
  /**
   * `env(safe-area-inset-*)` values read via `getComputedStyle` on the device.
   * On iOS inside the Toss host WebView this is typically all-zero because the
   * WebView viewport is placed below the physical notch by the host app.
   */
  cssEnv: { top: number; right: number; bottom: number; left: number };
  /**
   * `window.__sdk.SafeAreaInsets.get()` (1st priority) or
   * `window.__sdk.getSafeAreaInsets()` (2nd priority) result from the native
   * SDK. `null` when both paths fail — see `sdkInsetsError` for the reason.
   * In the Toss host WebView `top` is the nav bar height and `bottom` is the
   * home-indicator height.
   */
  sdkInsets: { top: number; right: number; bottom: number; left: number } | null;
  /**
   * Populated when the SDK inset lookup failed (both paths absent or threw).
   * `undefined` when `sdkInsets` is non-null (i.e. the lookup succeeded).
   *
   * Example values:
   *   - `"window.__sdk not available (non-dogfood bundle)"`
   *   - `"neither SafeAreaInsets.get nor getSafeAreaInsets found on window.__sdk"`
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
 * Throws if the result is missing, contains an exception, or cannot be parsed.
 */
export function normalizeSafeAreaResult(rawValue: unknown): SafeAreaMeasurement {
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
  const sdkInsetsError = typeof obj.sdkInsetsError === 'string' ? obj.sdkInsetsError : undefined;
  const navBarHeight = typeof obj.navBarHeight === 'number' ? obj.navBarHeight : null;
  const navBarHeightSource =
    typeof obj.navBarHeightSource === 'string' ? obj.navBarHeightSource : 'not-exposed-by-sdk';
  const innerWidth = typeof obj.innerWidth === 'number' ? obj.innerWidth : 0;
  const innerHeight = typeof obj.innerHeight === 'number' ? obj.innerHeight : 0;
  const devicePixelRatio = typeof obj.devicePixelRatio === 'number' ? obj.devicePixelRatio : 1;
  const userAgent = typeof obj.userAgent === 'string' ? obj.userAgent : '';

  return {
    cssEnv,
    sdkInsets,
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
 * Throws on CDP error, probe exception, or result parse failure.
 */
export async function measureSafeArea(connection: CdpConnection): Promise<SafeAreaMeasurement> {
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
  return normalizeSafeAreaResult(result.result.value);
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
 */
export type CallSdkResult = { ok: true; value: unknown } | { ok: false; error: string };

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
    `  return JSON.stringify({ok:false,error:'window.__sdkCall is not available — is this a dogfood (__DEBUG_BUILD__) bundle?'});` +
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
 * Calls a dogfood SDK method via `window.__sdkCall` on the attached page.
 * NOT read-only — SDK calls may have side effects.
 *
 * On env 2/3 (real device relay) this hits the real SDK; on env 1 (local
 * mock) it hits the mock SDK.
 *
 * Throws on CDP error or result parse failure. Returns `{ok:false, error}`
 * for bridge-level errors (method not found, SDK threw, bridge absent).
 *
 * SECRET-HANDLING: name, args, and the result value are NOT written to any log.
 */
export async function callSdk(
  connection: CdpConnection,
  name: string,
  args: unknown[],
): Promise<CallSdkResult> {
  const expression = buildCallSdkExpression(name, args);
  const result = await connection.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    // Surface only the engine error string — never name, args, or result value.
    const msg =
      result.exceptionDetails.exception?.description ??
      result.exceptionDetails.text ??
      'Runtime.evaluate threw an exception';
    throw new Error(`call_sdk threw: ${msg}`);
  }
  return normalizeCallSdkResult(result.result.value);
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
