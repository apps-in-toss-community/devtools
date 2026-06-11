/**
 * Auto-opens Chrome DevTools when a page attaches over the Chii relay.
 *
 * When a real device attaches (env 2 / 3 / 4 in the 4-environments fidelity
 * ladder), the Chii relay exposes a standard CDP WebSocket endpoint.  Chii
 * also self-hosts its DevTools frontend at:
 *
 *   <relay-base>/front_end/chii_app.html
 *     ?ws|wss=<encodeURIComponent("<relay-host>/client/<uuid>?target=<targetId>&at=<totp>")>
 *
 * The param name follows the relay base scheme — `ws=` for plain HTTP
 * (env 3/4 local relay), `wss=` for HTTPS (env 2 tunnel) — matching the
 * scheme branch in chii/public/index.js.
 *
 * This is the same URL format that Chii's own index-page inspect-links use
 * (derived from `chii/public/index.js` — the JS that powers the target list
 * page at `<relay-base>/`).  Opening this URL in the developer's local browser
 * gives a full Chrome DevTools UI connected to the phone via the relay.
 *
 * IMPORTANT — environment guard:
 *   Auto-open only fires in relay environments (env 2 / 3 / 4). In env 1
 *   (local browser + mock SDK) the developer already has F12 available; opening
 *   a DevTools window pointing at the mock relay would be confusing and useless.
 *   The caller (`startAttachWatcher` in `debug-server.ts`) passes the current
 *   environment and this module bails out when it is `mock`.
 *
 * Opt-out: set `AIT_AUTO_DEVTOOLS=0` in the environment to suppress auto-open
 *   entirely. Any other value (or absent) enables the default behaviour.
 *
 * Duplicate-open guard:
 *   `AutoDevtoolsOpener` tracks whether open was already triggered for the
 *   current session. The open fires at most once per instance — typically one
 *   per `runDebugServer` call.
 *
 * TOTP expiry caveat:
 *   The `at=` TOTP code embedded in the `wss=` parameter is minted fresh at the
 *   moment `open()` is called. The code is valid for ~3 minutes (the relay gate
 *   accepts ±RELAY_VERIFY_SKEW_STEPS=6 steps = 180–210 s). If the developer
 *   does not open the URL within that window the WebSocket upgrade will be
 *   rejected with 4401. In practice the browser opens immediately after the OS
 *   `open` command; if needed the developer can copy the wss= param, replace
 *   `at=`, and reload. This is documented in the JSDoc below.
 *
 * PWA (WebKit) caveat:
 *   The Chii relay injects a chobitsu CDP shim into WebKit-based runtimes (env 2
 *   AITC Sandbox PWA). The DevTools frontend will connect and most panels work.
 *   However, WebKit does not expose the full CDP domain set that V8/Blink does,
 *   so some panels (Network, Layers) may appear empty or show limited data.
 *   This is a WebKit runtime constraint, not a relay or devtools-opener issue.
 *
 * Node-only: uses `child_process.spawnSync` to invoke the OS open command.
 */

import type { McpEnvironment } from './environment.js';

// ---------------------------------------------------------------------------
// Chii self-hosted DevTools frontend URL
// ---------------------------------------------------------------------------

/**
 * Assembles the Chii self-hosted DevTools inspector URL for a given relay
 * and target.
 *
 * Chii serves its own DevTools frontend at
 * `<relayHttpBaseUrl>/front_end/chii_app.html`. The `ws=` (plain HTTP relay)
 * or `wss=` (HTTPS relay) query parameter is a URL-encoded string of the form
 * `<relay-host>/client/<uuid>?target=<id>` (and optionally `&at=<totp>`) —
 * the same format used by Chii's own target list page (derived from
 * `chii/public/index.js`).
 *
 * The `at=` TOTP code is minted at call time via `mintTotp()`.  It is valid
 * for ~3 minutes (relay gate accepts ±RELAY_VERIFY_SKEW_STEPS=6 steps =
 * 180–210 s).  The developer must open the returned URL within that window.
 * If the window expires before the browser connects, the relay will reject the
 * WebSocket upgrade with close code 4401.
 *
 * SECRET-HANDLING: `mintTotp` returns a code, not a secret. The code is
 * embedded in the `wss=` parameter (inside the `at=` param) of the returned
 * URL. Callers MUST NOT log the returned URL to stdout (stderr is OK — it is
 * the intended fallback surface for the developer to copy the URL).
 *
 * @param relayHttpBaseUrl - Local HTTP base URL of the Chii relay, e.g.
 *   `http://127.0.0.1:9100`. No trailing slash.
 * @param targetId - Chii target id (from `GET <relay>/targets`).
 * @param mintTotp - Optional function that returns a fresh 6-digit TOTP code
 *   string. Called at most once. When omitted (TOTP disabled) no `at=` param
 *   is added.
 * @param panel - Initial panel. Defaults to `"console"`.
 *
 * @example
 * buildChiiInspectorUrl(
 *   'http://127.0.0.1:9100',
 *   'abc123',
 *   () => generateTotp(secret),
 * )
 * // → 'http://127.0.0.1:9100/front_end/chii_app.html?ws=127.0.0.1%3A9100%2Fclient%2F<uuid>%3Ftarget%3Dabc123%26at%3D<code>'
 */
export function buildChiiInspectorUrl(
  relayHttpBaseUrl: string,
  targetId: string,
  mintTotp?: () => string,
  panel: 'elements' | 'console' | 'sources' | 'network' = 'console',
): string {
  // Extract the host (and port) from the relay HTTP base URL, and pick the
  // query param name chii_app.html expects: `ws=` dials `ws://` (plain-HTTP
  // relay — env 3/4 local 127.0.0.1) while `wss=` dials `wss://` (HTTPS
  // tunnel — env 2). chii/public/index.js does the same scheme branch:
  // `location.protocol === 'https:' ? 'wss' : 'ws'`. Always sending `wss=`
  // would make the frontend attempt TLS against the plain-HTTP local relay.
  let relayHost: string;
  let wsParamName: 'ws' | 'wss';
  try {
    const parsed = new URL(relayHttpBaseUrl);
    relayHost = parsed.host; // e.g. "127.0.0.1:9100"
    wsParamName = parsed.protocol === 'https:' ? 'wss' : 'ws';
  } catch {
    // Fallback: strip the scheme prefix manually if URL parsing fails.
    relayHost = relayHttpBaseUrl.replace(/^https?:\/\//i, '');
    wsParamName = /^https:/i.test(relayHttpBaseUrl) ? 'wss' : 'ws';
  }

  // Generate a client UUID that matches the format Chii's index.js uses
  // (6 random alphanumeric characters).
  const clientId = `devtools-opener-${Date.now().toString(36)}`;

  // Build the ws=/wss= value: "<relay-host>/client/<uuid>?target=<id>[&at=<code>]"
  // This mirrors the format from chii/public/index.js:
  //   `${domain}${basePath}client/${randomId(6)}?target=${targetId}`
  let wsPath = `${relayHost}/client/${clientId}?target=${encodeURIComponent(targetId)}`;

  if (mintTotp) {
    // SECRET-HANDLING: mintTotp() returns a code (not a secret). The code
    // rides only in the URL's at= param. Callers must not log the URL.
    const code = mintTotp();
    wsPath += `&at=${encodeURIComponent(code)}`;
  }

  const params = new URLSearchParams({ [wsParamName]: wsPath, panel });
  return `${relayHttpBaseUrl.replace(/\/$/, '')}/front_end/chii_app.html?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Opt-out check
// ---------------------------------------------------------------------------

/**
 * Returns `true` when auto-open is **disabled** via the `AIT_AUTO_DEVTOOLS`
 * env var. Only the explicit `"0"` value disables it; anything else (including
 * absent) leaves auto-open enabled.
 */
export function isAutoDevtoolsDisabled(): boolean {
  return process.env.AIT_AUTO_DEVTOOLS === '0';
}

// ---------------------------------------------------------------------------
// Browser open (Node-only, sync)
// ---------------------------------------------------------------------------

/**
 * Opens the given URL in the OS default browser using a platform-appropriate
 * command. Returns `true` on success.
 *
 * Failures are silent from the caller's perspective — the caller should log
 * the URL to stderr as a fallback before calling this function.
 */
export function openUrlInBrowser(url: string): boolean {
  // Test hook: skip actual spawn when running in vitest / CI where the OS open
  // command may hang or be absent. Production code never sets this.
  if (process.env.AIT_AUTO_DEVTOOLS_TEST_SKIP_SPAWN === '1') return false;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
  const platform = process.platform;

  type Candidate = { cmd: string; args: string[] };
  let candidates: Candidate[];
  if (platform === 'darwin') {
    candidates = [{ cmd: 'open', args: [url] }];
  } else if (platform === 'win32') {
    candidates = [{ cmd: 'cmd', args: ['/c', 'start', '', url] }];
  } else {
    // Linux + fallback
    candidates = [
      { cmd: 'xdg-open', args: [url] },
      { cmd: 'sensible-browser', args: [url] },
      { cmd: 'x-www-browser', args: [url] },
    ];
  }

  for (const { cmd, args } of candidates) {
    try {
      const result = spawnSync(cmd, args, { encoding: 'utf8', timeout: 5_000 });
      if (!result.error && result.status === 0) return true;
    } catch {
      // Try next candidate.
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// AutoDevtoolsOpener — stateful once-per-session open guard
// ---------------------------------------------------------------------------

/**
 * Options for {@link AutoDevtoolsOpener.open}.
 *
 * The `relayHttpBaseUrl` and `targetId` fields are required to build a working
 * Chii self-hosted inspector URL. When `relayHttpBaseUrl` is absent the open
 * is skipped (no relay available yet).
 */
export interface DevtoolsOpenOptions {
  /**
   * Local HTTP base URL of the Chii relay, e.g. `http://127.0.0.1:9100`.
   * Used to build the `<relay-base>/front_end/chii_app.html?wss=…` URL.
   *
   * For env 3/4 (intoss relay) this is `http://127.0.0.1:<port>`.
   * For env 2 (external PWA relay) this is the relay's external HTTP URL
   * (e.g. `https://<host>.trycloudflare.com`).
   *
   * When absent or empty, `open()` is a no-op.
   *
   * SECRET-HANDLING: this value contains the relay host. Callers MUST NOT
   * log it to stdout; stderr is the intended surface.
   */
  relayHttpBaseUrl: string | null | undefined;
  /**
   * Chii target id of the attached page, from `listTargets()[0].id`.
   * When absent or empty, `open()` is a no-op.
   */
  targetId: string | null | undefined;
  /**
   * Function that mints a fresh TOTP code when called. Called at most once per
   * `open()` invocation, immediately before building the inspector URL.
   *
   * Pass `undefined` when TOTP is disabled (no `at=` param is added).
   *
   * SECRET-HANDLING: the function MUST return only the code (6 digits), not
   * the secret. The code rides in the URL's `at=` param only.
   */
  mintTotp?: () => string;
  /** Current MCP environment (`mock` | `relay`). `open()` no-ops on `mock`. */
  env: McpEnvironment;
}

/**
 * Manages auto-opening Chrome DevTools exactly once per relay attach session.
 *
 * Create one instance per `runDebugServer` call and pass its `open()` method
 * as the `onFirstAttach` callback to `startAttachWatcher`.
 *
 * The open fires at most once. Subsequent `open()` calls are no-ops.
 * Opt-out and mock-environment guard are checked at call time.
 */
export class AutoDevtoolsOpener {
  private _opened = false;

  /**
   * Attempts to auto-open Chii DevTools in the developer's browser.
   *
   * Builds a `<relay-base>/front_end/chii_app.html?wss=…` URL pointing at the
   * attached target. A fresh TOTP `at=` code is minted at call time so the
   * relay's WebSocket upgrade gate accepts the connection.
   *
   * No-op when any of the following conditions hold:
   *   1. Already opened this session (`_opened` is true).
   *   2. `AIT_AUTO_DEVTOOLS=0` opt-out is set.
   *   3. `options.env` is `mock` (env 1 — F12 is already available).
   *   4. `options.relayHttpBaseUrl` is null/undefined/empty (relay not up yet).
   *   5. `options.targetId` is null/undefined/empty (no page attached yet).
   *
   * Always writes the DevTools URL to stderr so the developer can copy it
   * if the browser open fails or the popup is blocked.
   *
   * TOTP expiry caveat: the `at=` code embedded in the URL is valid for ~3
   * minutes (relay gate ±RELAY_VERIFY_SKEW_STEPS=6 steps = 180–210 s). The
   * developer must open the URL within that window; if they miss it, reload
   * the page or re-run `open()` (though the once-per-session guard prevents
   * that — restart the MCP server if needed).
   *
   * SECRET-HANDLING: the inspector URL (written to stderr) contains the relay
   * host and a short-lived TOTP code. Do NOT write it to stdout or any
   * persistent log.
   */
  open(options: DevtoolsOpenOptions): void {
    if (this._opened) return;
    if (isAutoDevtoolsDisabled()) return;
    if (options.env === 'mock') return;
    if (!options.relayHttpBaseUrl) return;
    if (!options.targetId) return;

    this._opened = true;

    const inspectorUrl = buildChiiInspectorUrl(
      options.relayHttpBaseUrl,
      options.targetId,
      options.mintTotp,
    );

    process.stderr.write(
      '[ait-debug] 기기가 연결됐습니다 — Chii DevTools를 자동으로 엽니다.\n' +
        `[ait-debug] DevTools URL: ${inspectorUrl}\n` +
        '[ait-debug] (AIT_AUTO_DEVTOOLS=0 으로 자동 열기를 끌 수 있습니다)\n' +
        '[ait-debug] 주의: URL의 at= 코드는 ~3분 안에서만 유효합니다.\n',
    );

    const opened = openUrlInBrowser(inspectorUrl);
    if (!opened) {
      process.stderr.write(
        '[ait-debug] 브라우저 자동 열기 실패 — 위 URL을 브라우저에서 직접 여세요.\n',
      );
    }
  }

  /** Returns `true` if `open()` has passed all guards and fired once. */
  get opened(): boolean {
    return this._opened;
  }
}
