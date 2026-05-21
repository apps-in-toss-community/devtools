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
}

const LAUNCHER_URL = 'https://devtools.aitc.dev/launcher/';

/**
 * Build the deep-link URL that QR codes encode: when the launcher PWA is
 * already on the phone's home screen, scanning this opens it directly into the
 * live view for `tunnelUrl` (the launcher consumes `?url=` and clears it).
 * Plain-text raw URL is no longer enough — the launcher gates its setup UI to
 * the installed PWA, so a raw tunnel URL opened in a normal browser tab would
 * land on a "please install" screen.
 */
export function buildLauncherDeepLink(tunnelUrl: string): string {
  return `${LAUNCHER_URL}?url=${encodeURIComponent(tunnelUrl)}`;
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
  const deepLink = buildLauncherDeepLink(url);
  const lines: string[] = [
    '',
    '  ┌─ @ait-co/devtools · live tunnel ────────────────────────────',
    `  │  ${url}`,
    '  │',
    `  │  Install the launcher PWA once:  ${LAUNCHER_URL}`,
    '  │  Then scan the QR below — it opens the launcher directly',
    '  │  into this tunnel URL (no manual paste needed).',
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

export interface QuickTunnel {
  /** The public `https://*.trycloudflare.com` URL. */
  url: string;
  /** Stop the underlying `cloudflared` process. Idempotent. */
  stop: () => void;
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
    const timer = setTimeout(() => {
      cleanup();
      stop();
      reject(
        new Error(
          `[@ait-co/devtools] cloudflared did not report a tunnel URL within ${
            URL_TIMEOUT_MS / 1000
          }s. Check your network connection, or run \`cloudflared tunnel --url http://localhost:${port}\` manually.`,
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

    const cleanup = () => {
      tunnel.off('stdout', onUrl);
      tunnel.off('stderr', onUrl);
    };

    // The library emits a parsed `url` event; we also scan raw stdout/stderr in
    // case the output format shifts.
    tunnel.once('url', onUrl);
    tunnel.on('stdout', onUrl);
    tunnel.on('stderr', onUrl);
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
          `[@ait-co/devtools] cloudflared exited (code ${code ?? 'null'}) before reporting a tunnel URL.`,
        ),
      );
    });
  });
}
