/**
 * cloudflared quick tunnel + attach banner for the debug-mode MCP server.
 *
 * On spawn, the debug server opens an accountless `*.trycloudflare.com` quick
 * tunnel to the local Chii relay so the phone can attach over a public wss URL,
 * then prints that URL + an attach token + an ASCII QR to the terminal. The
 * phone scans the QR (or pastes the URL) to attach; the in-app side passes the
 * token back. The token is generated + displayed as a pairing hint; relay-side
 * validation (ACL enforcement) is a later phase.
 *
 * Node-only: spawns the cloudflared binary and writes to stdout/stderr.
 */

import { randomBytes } from 'node:crypto';
import { bin, install, Tunnel } from 'cloudflared';
import qrcode from 'qrcode-terminal';

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
  token: string;
}

/** Renders the attach banner (URL + token + ASCII QR) as a string. */
export async function renderAttachBanner(input: AttachBannerInput): Promise<string> {
  // Encode the attach payload as a URL so a QR scan opens directly.
  const payload = `${input.wssUrl}?token=${input.token}`;
  const qr = await new Promise<string>((resolve) => {
    qrcode.generate(payload, { small: true }, (rendered) => resolve(rendered));
  });
  return [
    '',
    'AIT debug — attach a mini-app to this session',
    '',
    `  relay (wss):   ${input.wssUrl}`,
    `  attach token:  ${input.token}`,
    `  (token is a pairing hint — relay-side validation lands in a later phase)`,
    '',
    '  Open the dogfood mini-app with ?debug=1, then scan the QR',
    '  (or paste the relay URL + token in the in-app attach form):',
    '',
    qr,
  ].join('\n');
}

/** Prints the attach banner to stderr (stdout is the MCP stdio channel). */
export async function printAttachBanner(input: AttachBannerInput): Promise<void> {
  const banner = await renderAttachBanner(input);
  process.stderr.write(`${banner}\n`);
}
