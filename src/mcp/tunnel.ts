/**
 * cloudflared quick tunnel + attach banner for the debug-mode MCP server.
 *
 * On spawn, the debug server opens an accountless `*.trycloudflare.com` quick
 * tunnel to the local Chii relay so the phone can attach over a public wss URL,
 * then prints a unicode half-block QR + attach instructions. When TOTP auth is
 * enabled (`AIT_DEBUG_TOTP_SECRET` is set), the QR encodes only the base relay
 * URL — the TOTP code (`at=`) is NOT included because it rotates every 30 s
 * and would be stale by the time a human scans. The in-app deep-link builder
 * splices the live code at attach time.
 *
 * Tunnel health probe (`TunnelHealthProbe`):
 *   After the tunnel is up, a periodic HTTP HEAD probe hits the tunnel's
 *   `https://` URL every `probeIntervalMs` (default 60 s). Two consecutive
 *   failures trigger a reissue attempt (spawn a new cloudflared quick tunnel
 *   and redirect traffic). After `MAX_REISSUE_ATTEMPTS` (3) consecutive
 *   reissue failures, the probe gives up and marks the tunnel permanently
 *   dropped — `tunnelStatus.up` becomes false with `droppedAt` set. The caller
 *   should surface this to the agent so the user knows to restart the server.
 *
 * SECRET-HANDLING: The TOTP secret and computed code values MUST NOT appear
 * in any output from this module.
 *
 * Node-only: spawns the cloudflared binary and writes to stdout/stderr.
 */

import { randomBytes } from 'node:crypto';
import { bin, install, Tunnel } from 'cloudflared';
import type { TunnelStatus } from './tools.js';

/** Generates a 32-byte hex attach token shown as a pairing hint (relay-side validation is a later phase). */
export function generateAttachToken(): string {
  return randomBytes(32).toString('hex');
}

export interface QuickTunnel {
  /** Public `https://*.trycloudflare.com` URL the tunnel exposes. */
  url: string;
  /** Same host as `wss://` — the relay endpoint the phone attaches to. */
  wssUrl: string;
  stop(): void;
}

/** Ensures the cloudflared binary is installed (downloads + caches on first run). */
async function ensureCloudflaredBin(): Promise<void> {
  const { existsSync } = await import('node:fs');
  if (!existsSync(bin)) {
    await install(bin);
  }
}

/**
 * Opens a cloudflared quick tunnel to the local relay port and resolves once
 * the public URL is assigned.
 */
export async function startQuickTunnel(localPort: number): Promise<QuickTunnel> {
  await ensureCloudflaredBin();

  const tunnel = Tunnel.quick(`http://127.0.0.1:${localPort}`);

  const url = await new Promise<string>((resolve, reject) => {
    const onUrl = (assigned: string) => {
      cleanup();
      resolve(assigned);
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onExit = (code: number | null) => {
      cleanup();
      reject(new Error(`cloudflared exited before assigning a URL (code ${code})`));
    };
    const cleanup = () => {
      tunnel.off('url', onUrl);
      tunnel.off('error', onError);
      tunnel.off('exit', onExit);
    };
    tunnel.once('url', onUrl);
    tunnel.once('error', onError);
    tunnel.once('exit', onExit);
  });

  return {
    url,
    wssUrl: url.replace(/^https/, 'wss'),
    stop: () => {
      tunnel.stop();
    },
  };
}

export interface AttachBannerInput {
  wssUrl: string;
  /**
   * Whether TOTP auth is enabled on the relay (`AIT_DEBUG_TOTP_SECRET` is set).
   *
   * When `true`, the banner notes that a rotating code (`at=`) will be
   * appended to attach URLs at call time — the code is NOT printed here
   * because it rotates every 30 s and would be stale in seconds.
   */
  totpEnabled: boolean;
}

/**
 * Renders a pure unicode half-block QR string for the given text.
 *
 * Uses `qrcode` (Node full lib) to get the raw bit matrix, then encodes every
 * two vertical modules into a single half-block character:
 *   - both dark  → `█`
 *   - top only   → `▀`
 *   - bottom only → `▄`
 *   - both light → ` ` (space)
 *
 * The output contains **zero ANSI escape codes**, so it renders correctly in
 * every surface (terminal, VS Code, JetBrains, web) and can be scanned by a
 * phone camera when shown verbatim in an agent response.
 *
 * Shared by `renderAttachBanner` (relay wssUrl QR) and the `build_attach_url`
 * MCP tool response (attach deep-link QR).
 */
export async function renderQr(text: string): Promise<string> {
  // Dynamic import mirrors the cloudflared/qrcode-terminal precedent: keeps the
  // dependency out of the module graph when the function is not called.
  const { default: QRCode } = await import('qrcode');
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const size: number = qr.modules.size;
  const data: Uint8Array = qr.modules.data as Uint8Array;

  const isDark = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= size || y >= size) return false;
    return data[y * size + x] === 1;
  };

  const QUIET = 1;
  const lines: string[] = [];
  for (let y = -QUIET; y < size + QUIET; y += 2) {
    let line = '';
    for (let x = -QUIET; x < size + QUIET; x++) {
      const top = isDark(x, y);
      const bot = isDark(x, y + 1);
      line += top && bot ? '█' : top ? '▀' : bot ? '▄' : ' ';
    }
    lines.push(line);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Renders the attach banner (relay URL + ASCII QR) as a string.
 *
 * The QR encodes the base `wssUrl` only. When `totpEnabled` is true, a note
 * is added that attach URLs generated by `build_attach_url` will include a
 * live TOTP code (`at=`) appended at call time.
 *
 * SECRET-HANDLING: no secret value, TOTP code, or intermediate value is
 * included in this output.
 */
export async function renderAttachBanner(input: AttachBannerInput): Promise<string> {
  // The QR encodes only the relay wssUrl — no token or code. This is safe
  // because the relay gate enforces the code at WS upgrade time anyway; the
  // QR is just for locating the relay, not for bypassing auth.
  const qr = await renderQr(input.wssUrl);

  const authNote = input.totpEnabled
    ? '  auth:          TOTP enabled — attach URLs include a rotating code (at=).'
    : '  auth:          none (set AIT_DEBUG_TOTP_SECRET to enable TOTP).';

  return [
    '',
    'AIT debug — attach a mini-app to this session',
    '',
    `  relay (wss):   ${input.wssUrl}`,
    authNote,
    '',
    '  Use build_attach_url to generate a deep link with the current TOTP code.',
    '  Scan the QR to locate the relay (open the dogfood URL separately with',
    '  ?debug=1&relay=<wss>&at=<code> or use the build_attach_url tool):',
    '',
    qr,
  ].join('\n');
}

/** Prints the attach banner to stderr (stdout is the MCP stdio channel). */
export async function printAttachBanner(input: AttachBannerInput): Promise<void> {
  const banner = await renderAttachBanner(input);
  process.stderr.write(`${banner}\n`);
}

/* -------------------------------------------------------------------------- */
/* TunnelHealthProbe — periodic health check + auto-reissue                    */
/* -------------------------------------------------------------------------- */

/** Maximum consecutive reissue attempts before the probe gives up. */
export const MAX_REISSUE_ATTEMPTS = 3;

/**
 * Probes `https://` URL with an HTTP HEAD request.
 * Returns `true` when the server responds (any HTTP status), `false` on
 * network error or timeout.
 *
 * We treat any HTTP response (including 4xx/5xx) as "tunnel alive" because
 * cloudflared itself responds to the HEAD — if the tunnel process died, the
 * request fails at the network level rather than returning a status code.
 *
 * @param httpsUrl - The `https://` tunnel URL to probe.
 * @param timeoutMs - Abort timeout in ms. Default 10 000.
 */
export async function probeTunnel(httpsUrl: string, timeoutMs = 10_000): Promise<boolean> {
  const { default: https } = await import('node:https');
  return new Promise<boolean>((resolve) => {
    const url = new URL(httpsUrl);
    const timer = setTimeout(() => {
      req.destroy();
      resolve(false);
    }, timeoutMs);

    const req = https.request(
      { hostname: url.hostname, port: 443, path: url.pathname || '/', method: 'HEAD' },
      (_res) => {
        clearTimeout(timer);
        _res.resume(); // drain response body to free socket
        resolve(true);
      },
    );
    req.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    req.end();
  });
}

export interface TunnelHealthProbeOptions {
  /**
   * Interval in ms between health probes. Default 60 000 (60 s).
   * Use a smaller value in tests.
   */
  probeIntervalMs?: number;
  /**
   * How many consecutive probe failures to tolerate before triggering a
   * reissue. Default 2 (so one transient network hiccup is forgiven).
   */
  failuresBeforeReissue?: number;
  /**
   * Callback invoked after a successful reissue. The caller (debug-server)
   * uses this to update `tunnelStatus` and reprint the attach banner with the
   * new `wssUrl`.
   */
  onReissue: (newTunnel: QuickTunnel) => void;
  /**
   * Callback invoked when the probe permanently gives up (all reissue attempts
   * exhausted). The caller should mark `tunnelStatus.up = false` and surface
   * the error to the agent / user.
   */
  onPermanentDrop: (droppedAt: string) => void;
  /**
   * Optional stderr-compatible logger. Default `process.stderr.write`.
   * Injected in tests to avoid real I/O.
   */
  log?: (msg: string) => void;
  /**
   * Optional probe function override (for tests — avoids real HTTP requests).
   */
  probe?: (httpsUrl: string) => Promise<boolean>;
  /**
   * Optional tunnel spawner override (for tests — avoids real cloudflared).
   */
  spawnTunnel?: (localPort: number) => Promise<QuickTunnel>;
}

/**
 * Starts a periodic health probe for a cloudflared quick tunnel.
 *
 * Every `probeIntervalMs` the probe sends an HTTP HEAD request to the tunnel's
 * `https://` URL. When `failuresBeforeReissue` consecutive failures are
 * detected, it attempts to spawn a new tunnel (up to `MAX_REISSUE_ATTEMPTS`
 * times). On success the caller is notified via `onReissue`; on permanent
 * failure via `onPermanentDrop`.
 *
 * @returns `stop` — call during server shutdown to clear the probe interval.
 */
export function startTunnelHealthProbe(
  initialTunnel: QuickTunnel,
  localPort: number,
  options: TunnelHealthProbeOptions,
): { stop(): void } {
  const {
    probeIntervalMs = 60_000,
    failuresBeforeReissue = 2,
    onReissue,
    onPermanentDrop,
    log = (msg: string) => process.stderr.write(msg),
    probe = probeTunnel,
    spawnTunnel = startQuickTunnel,
  } = options;

  let currentTunnel = initialTunnel;
  let consecutiveFailures = 0;
  let reissueAttempts = 0;
  let stopped = false;

  const handle = setInterval(() => {
    void (async () => {
      if (stopped) return;

      const httpsUrl = currentTunnel.url;
      const alive = await probe(httpsUrl);

      if (alive) {
        // Tunnel responded — reset failure counter.
        if (consecutiveFailures > 0) {
          log('[ait-debug] tunnel health probe: tunnel recovered\n');
        }
        consecutiveFailures = 0;
        reissueAttempts = 0;
        return;
      }

      consecutiveFailures += 1;
      log(
        `[ait-debug] tunnel health probe: failure ${consecutiveFailures}/${failuresBeforeReissue} (url=${httpsUrl})\n`,
      );

      if (consecutiveFailures < failuresBeforeReissue) {
        // Tolerate transient failures — wait for the next interval.
        return;
      }

      // Threshold reached — attempt reissue.
      reissueAttempts += 1;
      if (reissueAttempts > MAX_REISSUE_ATTEMPTS) {
        // Already exhausted — do not log again.
        return;
      }

      log(
        `[ait-debug] tunnel drop detected — reissuing (attempt ${reissueAttempts}/${MAX_REISSUE_ATTEMPTS})\n`,
      );

      try {
        const newTunnel = await spawnTunnel(localPort);
        // Stop the old tunnel process to free system resources.
        try {
          currentTunnel.stop();
        } catch {
          // Ignore stop errors — the process may already be dead.
        }
        currentTunnel = newTunnel;
        consecutiveFailures = 0;
        log(`[ait-debug] tunnel reissued — new relay: ${newTunnel.wssUrl}\n`);
        onReissue(newTunnel);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log(`[ait-debug] tunnel reissue attempt ${reissueAttempts} failed: ${message}\n`);

        if (reissueAttempts >= MAX_REISSUE_ATTEMPTS) {
          clearInterval(handle);
          stopped = true;
          const droppedAt = new Date().toISOString();
          log(
            `[ait-debug] tunnel permanently dropped after ${MAX_REISSUE_ATTEMPTS} reissue attempts — ` +
              'restart the debug server to continue (npx @ait-co/devtools devtools-mcp).\n',
          );
          onPermanentDrop(droppedAt);
        }
      }
    })();
  }, probeIntervalMs);

  return {
    stop() {
      stopped = true;
      clearInterval(handle);
    },
  };
}

/**
 * Builds a `TunnelStatus` snapshot that includes drop state.
 *
 * Convenience helper for callers (debug-server) that maintain a mutable
 * `tunnelStatus` object — keeps the shape construction in one place.
 */
export function makeTunnelStatus(
  up: boolean,
  wssUrl: string | null,
  droppedAt: string | null = null,
  reissueAttempts = 0,
): TunnelStatus {
  return { up, wssUrl, droppedAt, reissueAttempts };
}
