/**
 * Cloudflare quick-tunnel helper for the devtools unplugin.
 *
 * Loaded lazily (`await import('./tunnel.js')`) only when the `tunnel` option is
 * on, so `cloudflared` / `qrcode-terminal` are never pulled in for the common
 * case. This is the one place in `@ait-co/devtools` that depends on Node-only
 * APIs (`child_process` via the `cloudflared` wrapper) — keep it thin and out of
 * jsdom unit tests; the spawn path is verified by hand / e2e (same spirit as the
 * "web 모드는 e2e" rule in CLAUDE.md). The pure helpers below
 * (`parseTrycloudflareUrl`, `printTunnelBanner`) are unit-tested.
 */

import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Matches the public URL cloudflared prints for an unauthenticated quick tunnel. */
const TRYCLOUDFLARE_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

/**
 * Extract the `https://<sub>.trycloudflare.com` URL from a line of cloudflared
 * output, or `null` if the line doesn't contain one. Pulled out as a pure
 * function so it can be unit-tested without spawning anything.
 */
export function parseTrycloudflareUrl(line: string): string | null {
  const m = line.match(TRYCLOUDFLARE_RE);
  return m ? m[0] : null;
}

export interface PrintTunnelBannerOptions {
  /** Print an ASCII QR encoding the tunnel URL (default: true). */
  qr?: boolean;
  /** Sink for the banner text (default: `console.log`). Injected for testing. */
  log?: (msg: string) => void;
  /**
   * The `wss://` relay URL of the env-2 CDP tunnel, if `tunnel.cdp` is on. When
   * present the QR deep-link additionally carries `&debug=1&relay=<wss>` so the
   * framed PWA passes the in-app debug gate and attaches a Chii target — the
   * same single scan opens screen preview *and* CDP debugging.
   */
  relayWssUrl?: string;
  /**
   * Human-readable app name to embed as `name=` in the launcher deep-link (#498).
   * When provided (non-blank), the launcher partner bar shows this name instead of
   * the generic default.
   */
  name?: string;
  /**
   * The miniapp's webViewType. When `'game'`, the deep-link carries `&navBarType=game`
   * so the launcher enters game nav chrome automatically on scan (#584).
   * `'partner'` (the default) is the launcher's implicit default — not added to
   * keep the URL clean.
   */
  webViewType?: 'partner' | 'game';
}

const LAUNCHER_URL = 'https://devtools.aitc.dev/launcher/';

/**
 * Options for {@link buildLauncherDeepLink}.
 */
export interface BuildLauncherDeepLinkOptions {
  /**
   * `wss://` relay URL for env-2 CDP wiring. When present the deep-link carries
   * `&debug=1&relay=<wss>`.
   */
  relayWssUrl?: string;
  /**
   * Human-readable app name shown in the partner nav bar (`name=` param, #498).
   * Blank / whitespace-only values are not added.
   */
  name?: string;
  /**
   * The miniapp's webViewType. When `'game'`, adds `&navBarType=game` to the
   * deep-link so the launcher enters game nav chrome automatically on scan (#584).
   * `'partner'` (the launcher's implicit default) is not added to keep the URL
   * clean.
   */
  webViewType?: 'partner' | 'game';
}

/**
 * Build the deep-link URL that QR codes encode: when the launcher PWA is
 * already on the phone's home screen, scanning this opens it directly into the
 * live view for `tunnelUrl` (the launcher consumes `?url=` and clears it).
 * Plain-text raw URL is no longer enough — the launcher gates its setup UI to
 * the installed PWA, so a raw tunnel URL opened in a normal browser tab would
 * land on a "please install" screen.
 *
 * When `opts.relayWssUrl` is given (env-2 CDP wiring), the deep-link also carries
 * `&debug=1&relay=<wss>`; the launcher folds those onto the framed tunnel URL so
 * the in-app debug gate's Layer C (`debug=1` opt-in + `relay=<wss>`) is met and
 * a Chii target.js is injected into the live view.
 *
 * When `opts.name` is given (non-blank), it is added as `&name=` so the launcher
 * partner bar shows the app name instead of the generic default (#498).
 *
 * When `opts.webViewType` is `'game'`, `&navBarType=game` is appended so the
 * launcher enters game nav chrome (floating capsule, no full bar) automatically
 * on scan. `'partner'` is the launcher's implicit default and is not added to
 * keep the URL clean (#584).
 *
 * Back-compat: the second argument may also be a plain string (`relayWssUrl`)
 * for callers that haven't migrated to the options object yet.
 */
export function buildLauncherDeepLink(
  tunnelUrl: string,
  optsOrRelay?: string | BuildLauncherDeepLinkOptions,
): string {
  // Normalise the overloaded second argument.
  const opts: BuildLauncherDeepLinkOptions =
    typeof optsOrRelay === 'string' ? { relayWssUrl: optsOrRelay } : (optsOrRelay ?? {});

  const base = `${LAUNCHER_URL}?url=${encodeURIComponent(tunnelUrl)}`;
  let url = base;
  if (opts.relayWssUrl) {
    url += `&debug=1&relay=${encodeURIComponent(opts.relayWssUrl)}`;
  }
  if (opts.name !== undefined && opts.name.trim() !== '') {
    url += `&name=${encodeURIComponent(opts.name.trim())}`;
  }
  if (opts.webViewType === 'game') {
    url += '&navBarType=game';
  }
  return url;
}

/**
 * Print the terminal banner announcing the live tunnel: the public URL, an ASCII
 * QR encoding a launcher deep-link, and a one-line note that quick tunnels are
 * ephemeral, unauthenticated and not for production. Pure w.r.t. side effects
 * other than the injected `log` sink and `qrcode-terminal` — unit-tested.
 */
export async function printTunnelBanner(
  url: string,
  opts: PrintTunnelBannerOptions = {},
): Promise<void> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const deepLink = buildLauncherDeepLink(url, {
    relayWssUrl: opts.relayWssUrl,
    name: opts.name,
    webViewType: opts.webViewType,
  });
  const lines: string[] = [
    '',
    '  ┌─ @ait-co/devtools · live tunnel ────────────────────────────',
    `  │  ${url}`,
    '  │',
    `  │  Install the launcher PWA once:  ${LAUNCHER_URL}`,
    '  │  Then scan the QR below — it opens the launcher directly',
    '  │  into this tunnel URL (no manual paste needed).',
    ...(opts.relayWssUrl
      ? [
          '  │  The same scan also attaches CDP — connect your AI host',
          '  │  to the relay and debug the live view on-device.',
        ]
      : []),
    '  │  Quick tunnels are unauthenticated, change every run, and are',
    '  │  not for production use.',
    '  └──────────────────────────────────────────────────────────────',
    '',
  ];
  log(lines.join('\n'));

  if (opts.qr !== false) {
    // qrcode-terminal is only pulled in on this code path (ambient types live
    // in src/qrcode-terminal.d.ts).
    const qrcode = (await import('qrcode-terminal')).default;
    await new Promise<void>((resolve) => {
      qrcode.generate(deepLink, { small: true }, (out) => {
        log(out);
        resolve();
      });
    });
  }
}

/**
 * Heuristic: can this process open a GUI browser? Mirrors `canOpenBrowser` in
 * `src/mcp/tools.ts` but is re-declared here (not imported) so the tunnel path
 * does not statically pull the heavy MCP `tools.ts` module graph into the lazy
 * `import('./tunnel.js')` chunk. Kept in sync with the MCP copy.
 *
 *   - macOS / Windows → assume yes (env-2 dev normally runs on the user's Mac).
 *   - Linux → require `DISPLAY` or `WAYLAND_DISPLAY`.
 *   - CI (`CI=true`/`CI=1`) → no.
 */
function canOpenBrowser(): boolean {
  if (process.env.CI === 'true' || process.env.CI === '1') return false;
  const platform = process.platform;
  if (platform === 'darwin' || platform === 'win32') return true;
  if (platform === 'linux') {
    return Boolean(process.env.DISPLAY ?? process.env.WAYLAND_DISPLAY);
  }
  return false;
}

/** Handle returned by {@link startTunnelDashboard}. */
export interface TunnelDashboard {
  /** `http://127.0.0.1:<port>` — the local dashboard URL opened in the browser. */
  url: string;
  /** Tear down the local HTTP server. Idempotent via the underlying server. */
  close: () => Promise<void>;
}

export interface StartTunnelDashboardOptions {
  /** The public `https://*.trycloudflare.com` app tunnel URL the launcher frames. */
  tunnelUrl: string;
  /** The `wss://` relay URL of the env-2 CDP tunnel. REQUIRED — the dashboard is a CDP-only UX. */
  relayWssUrl: string;
  /** Mirror of `tunnel.qr` — when `false` the dashboard is skipped (no browser open). */
  qr?: boolean;
  /**
   * Override the GUI/opt-out gate (testing only). When omitted the real
   * `canOpenBrowser()` + `AIT_AUTO_DEVTOOLS` checks decide.
   */
  shouldOpen?: () => boolean;
  /** Sink for the one-line "opened in browser" note (default: `console.log`). Injected for testing. */
  log?: (msg: string) => void;
  /**
   * Human-readable app name to embed as `name=` in the launcher deep-link (#498).
   * When provided (non-blank), the launcher partner bar shows this name instead of
   * the generic default.
   */
  name?: string;
}

/**
 * Env-2 UX parity with env 3/4 (issue #408): when CDP wiring is on and a GUI is
 * available, start the SAME `127.0.0.1` HTML dashboard (QR image + connect steps
 * + FAQ) that the MCP `build_attach_url` path serves, and auto-open it in the
 * browser. headless / opt-out falls back to the terminal ASCII QR (printed
 * separately by {@link printTunnelBanner}).
 *
 * Every part the install-graph invariant depends on (`qrcode`, the MCP HTTP
 * server, the opener) is reached only through dynamic `import()` here, inside
 * the already-lazy `tunnel.js` chunk — nothing is added to the common build
 * graph or the MCP-only install graph.
 *
 * TOTP encapsulation: the dashboard's `getDashboardState` closure mints a FRESH
 * TOTP `at=` code on every call via `generateTotp(secret, Date.now())` and folds
 * it into a fresh `buildLauncherAttachUrl(...)`. Because the QR is re-rendered on
 * each SSE push / page reload from this closure, the code a phone scans is always
 * within its 30 s window — no stale code is baked into static HTML.
 *
 * SECRET-HANDLING: the tunnel host, relay wssUrl, TOTP code, and `.ait_relay`
 * value/path are NEVER written to stdout/stderr/logs here. They live only inside
 * the attach URL (HTML body + `/qr.png` query, per qr-http-server's invariant).
 * The only thing opened/logged is `http://127.0.0.1:<port>` (local, safe).
 *
 * @returns the dashboard handle when it started (caller wires `close()` into the
 *   tunnel cleanup), or `undefined` when skipped (no relay, `qr:false`, headless,
 *   opt-out, or a start failure) — in which case ASCII QR fallback stands alone.
 */
export async function startTunnelDashboard(
  opts: StartTunnelDashboardOptions,
): Promise<TunnelDashboard | undefined> {
  const log = opts.log ?? ((m: string) => console.log(m));

  // Gate: dashboard is a CDP-only UX (needs a relay to attach to).
  if (!opts.relayWssUrl) return undefined;
  // Opt-out via `tunnel.qr:false` (same toggle that suppresses the ASCII QR).
  if (opts.qr === false) return undefined;

  // GUI + AIT_AUTO_DEVTOOLS gate. Reuse the MCP opener's opt-out predicate so
  // the env-2 path honours the same `AIT_AUTO_DEVTOOLS=0` switch as env 3/4.
  const { isAutoDevtoolsDisabled } = await import('../mcp/devtools-opener.js');
  const gateOpen = opts.shouldOpen ?? (() => !isAutoDevtoolsDisabled() && canOpenBrowser());
  if (!gateOpen()) return undefined;

  const { startQrHttpServer } = await import('../mcp/qr-http-server.js');
  const { buildLauncherAttachUrl } = await import('../mcp/deeplink.js');
  const { generateTotp } = await import('../mcp/totp.js');

  // getDashboardState — mints a fresh TOTP + attach URL on every call so the QR
  // the dashboard renders (on load and on each SSE push) is never expired.
  // SECRET-HANDLING: the secret is read from env AT CALL TIME (it was injected
  // by ensureRelaySecret in the same CDP block) and is used only to compute the
  // at= code folded into attachUrl. tunnel.up is always true here — the relay
  // tunnel is already up by the time this runs.
  const getDashboardState = () => {
    const secret = process.env.AIT_DEBUG_TOTP_SECRET;
    const totpCode = secret ? generateTotp(secret, Date.now()) : undefined;
    const attachUrl = buildLauncherAttachUrl(opts.tunnelUrl, opts.relayWssUrl, totpCode, {
      name: opts.name,
    });
    // pages: null — env 2(unplugin)는 데몬이 아니라 vite 플러그인 안이라
    // startChiiRelay 핸들이 connected target을 노출하지 않는다. 라이브 page 목록을
    // 알 수 없으므로 거짓 빈 목록 대신 "연결된 Pages" 섹션 자체를 숨긴다(#411).
    // env 3/4(debug-server.ts)는 router.active.listTargets()로 실제 목록을 채운다.
    // mode: 'relay-mobile' — 이 대시보드는 항상 환경 2(AITC Sandbox PWA) 전용이므로
    // /attach 카피가 launcher PWA 절차(sandbox family)로 분기된다(#468).
    // inspectorUrl: null — env 2에서는 unplugin relay가 connected target ID를 노출하지
    // 않아 buildChiiInspectorUrl에 필요한 targetId를 알 수 없다. target attach 후
    // target ID가 필요하므로 env 3/4에서만 non-null이 된다(#503).
    return {
      tunnel: { up: true, wssUrl: opts.relayWssUrl },
      pages: null,
      attachUrl,
      inspectorUrl: null,
      mode: 'relay-mobile' as const,
    };
  };

  let server: Awaited<ReturnType<typeof startQrHttpServer>>;
  try {
    server = await startQrHttpServer(getDashboardState);
  } catch {
    // SECRET-HANDLING: do not surface the error (could embed paths/hosts). The
    // ASCII QR printed by printTunnelBanner stays as the fallback.
    return undefined;
  }

  // TOTP periodic refresh timer — pushes a fresh at= code to SSE clients every
  // 20 s so a page left open never stales past the 90 s acceptance window (#448).
  // tunnel.ts always has relayWssUrl available here (gated above), so no
  // lastAttachParts guard is needed — getDashboardState mints a fresh TOTP on
  // every call unconditionally.
  // SECRET-HANDLING: callback is a plain trigger only — TOTP value and at= code
  // must never be logged or written to stdout.
  const TOTP_REFRESH_INTERVAL_MS = 20_000;
  let totpRefreshHandle: ReturnType<typeof setInterval> | null = setInterval(() => {
    server.notifyStateChange();
  }, TOTP_REFRESH_INTERVAL_MS);
  totpRefreshHandle.unref();

  const dashboardUrl = `http://127.0.0.1:${server.port}`;

  const { openUrlInBrowser } = await import('../mcp/devtools-opener.js');
  const opened = openUrlInBrowser(dashboardUrl);
  // SECRET-HANDLING: only the local 127.0.0.1 URL is logged — never the tunnel
  // host, relay wssUrl, or TOTP code.
  log(
    opened
      ? `  │  Opened a QR dashboard in your browser: ${dashboardUrl}`
      : `  │  Open this QR dashboard in your browser: ${dashboardUrl}`,
  );

  return {
    url: dashboardUrl,
    close: () => {
      if (totpRefreshHandle) {
        clearInterval(totpRefreshHandle);
        totpRefreshHandle = null;
      }
      return server.close();
    },
  };
}

export interface QuickTunnel {
  /** The public `https://*.trycloudflare.com` URL. */
  url: string;
  /** Stop the underlying `cloudflared` process. Idempotent. */
  stop: () => void;
}

/**
 * Sanitize cloudflared stderr output for error diagnostics (#421).
 *
 * Masks `*.trycloudflare.com` hostnames and full `https://` / `wss://` URLs
 * that carry those hostnames so tunnel host values never appear in error
 * messages. Diagnostic content (error codes, reasons, JSON blobs) is preserved.
 *
 * SECRET-HANDLING: tunnel host is SECRET-class per harness policy — only
 * placeholder text is emitted.
 */
export function sanitizeCloudflaredOutput(line: string): string {
  // Full URL forms: https://xxx.trycloudflare.com/… and wss://xxx.trycloudflare.com/…
  let s = line.replace(/(?:https?|wss?):\/\/[a-z0-9-]+\.trycloudflare\.com(?:\/[^\s]*)*/gi, (m) =>
    m.replace(/[a-z0-9-]+\.trycloudflare\.com/i, '<HOST>.trycloudflare.com'),
  );
  // Bare hostname without scheme (e.g. printed in cloudflared JSON logs)
  s = s.replace(/[a-z0-9-]+\.trycloudflare\.com/gi, '<HOST>.trycloudflare.com');
  return s;
}

const URL_TIMEOUT_MS = 20_000;

/**
 * Start an unauthenticated Cloudflare quick tunnel to `http://localhost:<port>`
 * and resolve once the public URL is known. Downloads the `cloudflared` binary
 * on first use if it is not already installed. Rejects with a friendly error if
 * no URL appears within {@link URL_TIMEOUT_MS}.
 */
export async function startQuickTunnel(port: number): Promise<QuickTunnel> {
  const cloudflared = await import('cloudflared');
  const { bin, install, Tunnel } = cloudflared;

  if (!existsSync(bin)) {
    await mkdir(dirname(bin), { recursive: true });
    await install(bin);
  }

  const tunnel = Tunnel.quick(`http://localhost:${port}`);
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      tunnel.stop();
    } catch {
      // process may already be gone
    }
  };

  return new Promise<QuickTunnel>((resolve, reject) => {
    // #421: accumulate stderr to attach as diagnostics on failure.
    // SECRET-HANDLING: lines are sanitized before inclusion in error messages.
    const stderrLines: string[] = [];

    /**
     * Format the last `n` sanitized stderr lines as a diagnostic appendix.
     * Returns an empty string when no lines have been collected.
     */
    const stderrTail = (n = 15): string => {
      if (stderrLines.length === 0) return '';
      const tail = stderrLines.slice(-n).map(sanitizeCloudflaredOutput).join('');
      return `\ncloudflared 출력 (마지막 ${Math.min(n, stderrLines.length)}줄):\n${tail}`;
    };

    const timer = setTimeout(() => {
      cleanup();
      stop();
      reject(
        new Error(
          `[@ait-co/devtools] cloudflared did not report a tunnel URL within ${
            URL_TIMEOUT_MS / 1000
          }s. Check your network connection, or run \`cloudflared tunnel --url http://localhost:${port}\` manually.${stderrTail()}`,
        ),
      );
    }, URL_TIMEOUT_MS);

    const onUrl = (line: string) => {
      const found = parseTrycloudflareUrl(line);
      if (!found) return;
      clearTimeout(timer);
      // Stop scanning further output once we have the URL.
      cleanup();
      resolve({ url: found, stop });
    };

    // Accumulate stderr lines for diagnostics (#421). Named so it can be
    // removed from the listener list when cleanup() runs.
    const pushStderr = (line: string) => {
      stderrLines.push(line);
    };

    const cleanup = () => {
      tunnel.off('stdout', onUrl);
      tunnel.off('stderr', onUrl);
      tunnel.off('stderr', pushStderr);
    };

    // The library emits a parsed `url` event; we also scan raw stdout/stderr in
    // case the output format shifts.
    tunnel.once('url', onUrl);
    tunnel.on('stdout', onUrl);
    tunnel.on('stderr', onUrl);
    // Second stderr listener: accumulate all lines for error diagnostics.
    tunnel.on('stderr', pushStderr);
    tunnel.once('error', (err: Error) => {
      clearTimeout(timer);
      cleanup();
      stop();
      reject(err);
    });
    tunnel.once('exit', (code: number | null) => {
      if (stopped) return;
      clearTimeout(timer);
      cleanup();
      reject(
        new Error(
          `[@ait-co/devtools] cloudflared exited (code ${code ?? 'null'}) before reporting a tunnel URL.${stderrTail()}`,
        ),
      );
    });
  });
}
