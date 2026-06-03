import { describe, expect, it, vi } from 'vitest';
import {
  buildLauncherDeepLink,
  parseTrycloudflareUrl,
  printTunnelBanner,
} from '../unplugin/tunnel.js';

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

describe('buildLauncherDeepLink', () => {
  it('appends the tunnel URL as a percent-encoded ?url= param', () => {
    expect(buildLauncherDeepLink('https://abc-def.trycloudflare.com')).toBe(
      'https://devtools.aitc.dev/launcher/?url=https%3A%2F%2Fabc-def.trycloudflare.com',
    );
  });

  it('round-trips through URLSearchParams without losing the original URL', () => {
    const tunnel = 'https://chunky-purple-frog.trycloudflare.com/some/path?x=1&y=2';
    const deepLink = buildLauncherDeepLink(tunnel);
    const parsed = new URL(deepLink);
    expect(parsed.searchParams.get('url')).toBe(tunnel);
  });

  it('omits debug/relay params when no relay URL is given (env-2 screen-only)', () => {
    const deepLink = buildLauncherDeepLink('https://abc-def.trycloudflare.com');
    const parsed = new URL(deepLink);
    expect(parsed.searchParams.has('debug')).toBe(false);
    expect(parsed.searchParams.has('relay')).toBe(false);
  });

  it('appends &debug=1&relay=<wss> when a relay URL is given (env-2 CDP)', () => {
    const relay = 'wss://relay-abc.trycloudflare.com';
    const deepLink = buildLauncherDeepLink('https://abc-def.trycloudflare.com', relay);
    const parsed = new URL(deepLink);
    expect(parsed.searchParams.get('url')).toBe('https://abc-def.trycloudflare.com');
    expect(parsed.searchParams.get('debug')).toBe('1');
    expect(parsed.searchParams.get('relay')).toBe(relay);
  });
});

describe('printTunnelBanner', () => {
  it('shows the raw tunnel URL as text and encodes a launcher deep-link in the QR', async () => {
    const out: string[] = [];
    await printTunnelBanner('https://abc-def.trycloudflare.com', {
      log: (m) => out.push(m),
    });
    const joined = out.join('\n');
    // Human-readable line still shows the raw tunnel URL (so users can also
    // paste it).
    expect(joined).toContain('https://abc-def.trycloudflare.com');
    expect(joined).toContain('devtools.aitc.dev/launcher/');
    // QR encodes the deep-link, not the raw tunnel URL — that's what the PWA
    // gating + auto-entry depends on.
    expect(joined).toContain(
      '<QR for https://devtools.aitc.dev/launcher/?url=https%3A%2F%2Fabc-def.trycloudflare.com>',
    );
    expect(joined).not.toContain('<QR for https://abc-def.trycloudflare.com>');
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

  it('encodes the &debug=1&relay= deep-link in the QR when relayWssUrl is given', async () => {
    const out: string[] = [];
    await printTunnelBanner('https://abc-def.trycloudflare.com', {
      relayWssUrl: 'wss://relay-abc.trycloudflare.com',
      log: (m) => out.push(m),
    });
    const joined = out.join('\n');
    // QR carries the CDP gate params so the framed PWA passes Layer C.
    expect(joined).toContain('debug=1');
    expect(joined).toContain('relay=wss%3A%2F%2Frelay-abc.trycloudflare.com');
    // Banner mentions on-device CDP only when relay is wired.
    expect(joined).toContain('CDP');
  });

  it('does not mention CDP when no relay is wired (screen preview only)', async () => {
    const out: string[] = [];
    await printTunnelBanner('https://abc-def.trycloudflare.com', {
      log: (m) => out.push(m),
    });
    expect(out.join('\n')).not.toContain('CDP');
  });
});
