/**
 * Auto-opens Chrome DevTools when a page attaches over the Chii relay.
 *
 * When a real device attaches (env 2 / 3 / 4 in the 4-environments fidelity
 * ladder), the Chii relay exposes a standard CDP WebSocket endpoint. The
 * Chrome DevTools frontend can connect to any such endpoint via:
 *
 *   https://chrome-devtools-frontend.appspot.com/serve_file/@/inspector.html
 *     ?wss=<host>[/<path>]
 *     &panel=console
 *
 * Where `<host>` is the public WSS relay URL without the `wss://` scheme prefix
 * (the DevTools frontend adds it). This module assembles that URL and opens it
 * in the OS default browser so the developer immediately gets a full Chrome
 * DevTools UI.
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
// Chrome DevTools frontend URL
// ---------------------------------------------------------------------------

/**
 * Base URL for the Chrome DevTools inspector hosted on appspot.
 *
 * The `@` path segment is the "latest / bleeding edge" alias which tracks the
 * current Chrome stable CDP protocol version — compatible with the chobitsu-
 * based CDP that Chii injects. A specific commit hash may be pinned here if
 * a regression is observed.
 */
const DEVTOOLS_FRONTEND_BASE =
  'https://chrome-devtools-frontend.appspot.com/serve_file/@/inspector.html';

// ---------------------------------------------------------------------------
// URL assembly
// ---------------------------------------------------------------------------

/**
 * Assembles the Chrome DevTools inspector URL that connects to a Chii relay
 * WebSocket.
 *
 * The `wss=` parameter expects a host-and-path string without the `wss://`
 * scheme prefix — the DevTools frontend prepends it automatically.
 *
 * @param wssRelayUrl - Full `wss://` URL of the Chii relay (public tunnel).
 *   Example: `wss://abc.trycloudflare.com`
 * @param panel - Initial panel. Defaults to `"console"`.
 *
 * @example
 * buildChromeDevtoolsUrl('wss://abc.trycloudflare.com')
 * // → 'https://chrome-devtools-frontend.appspot.com/serve_file/@/inspector.html?wss=abc.trycloudflare.com&panel=console'
 */
export function buildChromeDevtoolsUrl(
  wssRelayUrl: string,
  panel: 'elements' | 'console' | 'sources' | 'network' = 'console',
): string {
  // Strip `wss://` prefix — the DevTools frontend expects host[/path] only.
  const wssParam = wssRelayUrl.replace(/^wss:\/\//i, '');
  const params = new URLSearchParams({ wss: wssParam, panel });
  return `${DEVTOOLS_FRONTEND_BASE}?${params.toString()}`;
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
   * Attempts to auto-open Chrome DevTools.
   *
   * No-op when any of the following conditions hold:
   *   1. Already opened this session (`_opened` is true).
   *   2. `AIT_AUTO_DEVTOOLS=0` opt-out is set.
   *   3. Environment is `mock` (env 1 — F12 is already available).
   *   4. `wssRelayUrl` is null/undefined/empty (tunnel not yet up).
   *
   * Always writes the DevTools URL to stderr so the developer can copy it
   * if the browser open fails or the popup is blocked.
   *
   * @param wssRelayUrl - The public `wss://` relay URL (from tunnel status).
   * @param env - Current MCP environment (`mock` | `relay`).
   */
  open(wssRelayUrl: string | null | undefined, env: McpEnvironment): void {
    if (this._opened) return;
    if (isAutoDevtoolsDisabled()) return;
    if (env === 'mock') return;
    if (!wssRelayUrl) return;

    this._opened = true;

    const devtoolsUrl = buildChromeDevtoolsUrl(wssRelayUrl);

    process.stderr.write(
      '[ait-debug] 기기가 연결됐습니다 — Chrome DevTools를 자동으로 엽니다.\n' +
        `[ait-debug] Chrome DevTools URL: ${devtoolsUrl}\n` +
        '[ait-debug] (AIT_AUTO_DEVTOOLS=0 으로 자동 열기를 끌 수 있습니다)\n',
    );

    const opened = openUrlInBrowser(devtoolsUrl);
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
