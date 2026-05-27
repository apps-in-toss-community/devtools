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
      'Lists the mini-app page(s) the Chii relay currently sees attached, plus whether the ' +
      'cloudflared tunnel is up and the public wss relay URL the phone uses to attach. ' +
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

/** Result of `list_pages`: attach status + tunnel state. */
export interface ListPagesResult {
  pages: ReturnType<CdpConnection['listTargets']>;
  tunnel: TunnelStatus;
}

export function listPages(connection: CdpConnection, tunnel: TunnelStatus): ListPagesResult {
  return { pages: connection.listTargets(), tunnel };
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
 * SECRET-HANDLING: `htmlPath` and `pngPath` are local filesystem paths — they
 * do NOT contain the `at=` TOTP code value. The attach URL (which may contain
 * `at=`) is embedded inside the HTML file, but the path itself is safe.
 */
export interface OpenQrInBrowserResult {
  /** `true` if the browser was successfully opened. */
  opened: boolean;
  /** Absolute path to the written HTML file. */
  htmlPath: string;
  /** Absolute path to the written PNG file. */
  pngPath: string;
  /** Error message if `opened` is false (browser spawn failed). */
  error?: string;
}

/**
 * Writes the attach URL as a QR PNG + a wrapper HTML page to the OS temp
 * directory, then opens the HTML in the OS default browser.
 *
 * SECRET-HANDLING:
 *   - File names are derived from a short timestamp, NOT from the attach URL or
 *     any token/code value. The `at=` code is NOT in the file name.
 *   - The attach URL (which may carry `at=`) is embedded inside the HTML page
 *     body — that is the intended delivery channel for the QR.
 *   - This function must NOT write the attach URL, deploymentId, or any
 *     TOTP code to stdout, stderr, or any log.
 *
 * @param attachUrl - The deep link to encode as a QR. May contain `at=<code>`.
 * @param deploymentId - Optional human-readable label for the HTML page (e.g. UUID substring).
 *   Must NOT be derived from the `at=` code value.
 * @returns `OpenQrInBrowserResult` — never throws (errors are returned in `.error`).
 */
export async function openQrInBrowser(
  attachUrl: string,
  deploymentId?: string,
): Promise<OpenQrInBrowserResult> {
  const { tmpdir } = await import('node:os');
  const { writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const { default: QRCode } = await import('qrcode');

  // Use a timestamp-based name, NOT anything derived from the attach URL.
  const stamp = Date.now();
  const pngPath = join(tmpdir(), `ait-qr-${stamp}.png`);
  const htmlPath = join(tmpdir(), `ait-qr-${stamp}.html`);

  // Write the QR PNG.
  try {
    await QRCode.toFile(pngPath, attachUrl, { type: 'png', errorCorrectionLevel: 'M' });
  } catch (err) {
    return {
      opened: false,
      htmlPath,
      pngPath,
      error: `QR PNG write failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Write the HTML wrapper.
  // SECRET: attachUrl is placed in the HTML as a text node and QR image src,
  // which is the intended delivery channel. It must NOT be in the file name.
  const safeLabel = deploymentId
    ? deploymentId.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`)
    : 'attach';
  const htmlContent = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AIT Debug — QR</title>
  <style>
    body { font-family: monospace; background: #111; color: #eee; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; gap: 1.5rem; padding: 2rem; box-sizing: border-box; }
    img { width: min(90vw, 400px); height: auto; image-rendering: pixelated; background: #fff; padding: 1rem; border-radius: 8px; }
    .label { font-size: 0.85rem; opacity: 0.6; }
    .url { font-size: 0.75rem; word-break: break-all; max-width: 60ch; opacity: 0.5; }
  </style>
</head>
<body>
  <img src="${pngPath}" alt="QR code" />
  <p class="label">deployment: ${safeLabel}</p>
</body>
</html>`;

  try {
    writeFileSync(htmlPath, htmlContent, 'utf8');
  } catch (err) {
    return {
      opened: false,
      htmlPath,
      pngPath,
      error: `HTML write failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Open in OS default browser.
  const platform = process.platform;
  let openCmd: string;
  let openArgs: string[];
  if (platform === 'darwin') {
    openCmd = 'open';
    openArgs = [htmlPath];
  } else if (platform === 'win32') {
    openCmd = 'cmd';
    openArgs = ['/c', 'start', '', htmlPath];
  } else {
    openCmd = 'xdg-open';
    openArgs = [htmlPath];
  }

  // Use spawnSync with a short timeout — we don't need to wait for the browser
  // to finish loading, just for the launcher to start.
  const spawnResult = spawnSync(openCmd, openArgs, { timeout: 5000 });
  if (spawnResult.error) {
    return {
      opened: false,
      htmlPath,
      pngPath,
      error: `Browser open failed (${openCmd}): ${spawnResult.error.message}`,
    };
  }

  return { opened: true, htmlPath, pngPath };
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
 *   2. `SafeAreaInsets.get()` if the native SDK object is available.
 *   3. nav bar geometry (first `.ait-navbar` element height, if present).
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
  try {
    if (typeof SafeAreaInsets !== 'undefined' && SafeAreaInsets && typeof SafeAreaInsets.get === 'function') {
      sdkInsets = SafeAreaInsets.get();
    }
  } catch(_) {}
  var navBarHeight = null;
  try {
    var nb = document.querySelector('.ait-navbar');
    if (nb) navBarHeight = nb.getBoundingClientRect().height;
  } catch(_) {}
  return JSON.stringify({
    cssEnv: cssEnv,
    sdkInsets: sdkInsets,
    navBarHeight: navBarHeight,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    userAgent: navigator.userAgent
  });
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
   * `SafeAreaInsets.get()` result from the native SDK, if available.
   * In the Toss host this carries the nav bar height as `top` and the
   * home-indicator height as `bottom`. `null` when the SDK object is absent
   * (e.g. outside a Toss WebView).
   */
  sdkInsets: { top: number; right: number; bottom: number; left: number } | null;
  /**
   * Height of the `.ait-navbar` element (px) if present, else `null`.
   * Useful to cross-validate `sdkInsets.top` against the rendered nav bar.
   */
  navBarHeight: number | null;
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
  const navBarHeight = typeof obj.navBarHeight === 'number' ? obj.navBarHeight : null;
  const innerWidth = typeof obj.innerWidth === 'number' ? obj.innerWidth : 0;
  const innerHeight = typeof obj.innerHeight === 'number' ? obj.innerHeight : 0;
  const devicePixelRatio = typeof obj.devicePixelRatio === 'number' ? obj.devicePixelRatio : 1;
  const userAgent = typeof obj.userAgent === 'string' ? obj.userAgent : '';

  return { cssEnv, sdkInsets, navBarHeight, innerWidth, innerHeight, devicePixelRatio, userAgent };
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
