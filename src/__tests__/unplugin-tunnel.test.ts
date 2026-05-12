import { describe, expect, it, vi } from 'vitest';
import { parseTrycloudflareUrl, printTunnelBanner } from '../unplugin/tunnel.js';

// `startQuickTunnel` spawns the `cloudflared` binary via child_process — that's
// out of jsdom unit-test scope (verified by hand / e2e, same spirit as the
// "web 모드는 e2e" rule in CLAUDE.md). The pure helpers are covered here.

vi.mock('qrcode-terminal', () => ({
  default: {
    generate: (input: string, _opts: unknown, cb?: (out: string) => void) => {
      cb?.(`<QR for ${input}>`);
    },
  },
}));

describe('parseTrycloudflareUrl', () => {
  it('extracts the URL from a typical cloudflared log line', () => {
    const line = '2024-01-01T00:00:00Z INF |  https://chunky-purple-frog.trycloudflare.com  |';
    expect(parseTrycloudflareUrl(line)).toBe('https://chunky-purple-frog.trycloudflare.com');
  });

  it('returns null for an unrelated noise line', () => {
    expect(parseTrycloudflareUrl('INF Registered tunnel connection conn=0')).toBeNull();
  });

  it('returns null when there is no match', () => {
    expect(parseTrycloudflareUrl('https://example.com/not-a-tunnel')).toBeNull();
  });
});

describe('printTunnelBanner', () => {
  it('includes the tunnel URL in the banner and emits a QR for it', async () => {
    const out: string[] = [];
    await printTunnelBanner('https://abc-def.trycloudflare.com', {
      log: (m) => out.push(m),
    });
    const joined = out.join('\n');
    expect(joined).toContain('https://abc-def.trycloudflare.com');
    expect(joined).toContain('<QR for https://abc-def.trycloudflare.com>');
    expect(joined).toContain('devtools.aitc.dev/launcher/');
  });

  it('skips the QR when qr:false', async () => {
    const out: string[] = [];
    await printTunnelBanner('https://abc-def.trycloudflare.com', {
      qr: false,
      log: (m) => out.push(m),
    });
    const joined = out.join('\n');
    expect(joined).toContain('https://abc-def.trycloudflare.com');
    expect(joined).not.toContain('<QR for');
  });
});
