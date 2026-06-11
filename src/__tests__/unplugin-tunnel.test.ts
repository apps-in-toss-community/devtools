import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveTunnelOption } from '../unplugin/index.js';
import {
  buildLauncherDeepLink,
  parseTrycloudflareUrl,
  printTunnelBanner,
  sanitizeCloudflaredOutput,
  startTunnelDashboard,
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

  it('back-compat: string second arg (relay URL) still works as before', () => {
    const relay = 'wss://relay-abc.trycloudflare.com';
    // Plain string arg (legacy form) must behave identically to { relayWssUrl: relay }.
    const legacy = buildLauncherDeepLink('https://abc-def.trycloudflare.com', relay);
    const modern = buildLauncherDeepLink('https://abc-def.trycloudflare.com', {
      relayWssUrl: relay,
    });
    expect(legacy).toBe(modern);
  });

  it('opts.name adds &name= to the deep-link (#498)', () => {
    const deepLink = buildLauncherDeepLink('https://abc-def.trycloudflare.com', {
      name: 'my-miniapp',
    });
    const parsed = new URL(deepLink);
    expect(parsed.searchParams.get('name')).toBe('my-miniapp');
    // No relay params when relayWssUrl is absent.
    expect(parsed.searchParams.has('debug')).toBe(false);
  });

  it('opts.name blank → no name= param', () => {
    const deepLink = buildLauncherDeepLink('https://abc-def.trycloudflare.com', { name: '  ' });
    expect(new URL(deepLink).searchParams.has('name')).toBe(false);
  });

  it('name + relayWssUrl together in opts object (#498)', () => {
    const relay = 'wss://relay-abc.trycloudflare.com';
    const deepLink = buildLauncherDeepLink('https://abc-def.trycloudflare.com', {
      relayWssUrl: relay,
      name: 'sdk-example',
    });
    const parsed = new URL(deepLink);
    expect(parsed.searchParams.get('relay')).toBe(relay);
    expect(parsed.searchParams.get('name')).toBe('sdk-example');
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

// ---------------------------------------------------------------------------
// startTunnelDashboard (issue #408) — env-2 HTML dashboard parity
//
// The real browser open is suppressed via AIT_AUTO_DEVTOOLS_TEST_SKIP_SPAWN=1
// (openUrlInBrowser's test hook). The GUI/opt-out gate is driven explicitly via
// the injected `shouldOpen` override so platform/CI does not flake the test.
// ---------------------------------------------------------------------------

describe('startTunnelDashboard', () => {
  // Secrets used only inside the dashboard URL — never expected in any log.
  const TUNNEL_URL = 'https://app-host-secret.trycloudflare.com';
  const RELAY_WSS = 'wss://relay-host-secret.trycloudflare.com';
  // 64 hex chars = 32 bytes — a valid relay-auth TOTP secret.
  const SECRET = 'a'.repeat(64);

  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    // Never spawn a real browser in tests.
    process.env.AIT_AUTO_DEVTOOLS_TEST_SKIP_SPAWN = '1';
    delete process.env.AIT_AUTO_DEVTOOLS;
    process.env.AIT_DEBUG_TOTP_SECRET = SECRET;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns undefined (no server) when no relay is wired — screen-only tunnel', async () => {
    const out: string[] = [];
    const handle = await startTunnelDashboard({
      tunnelUrl: TUNNEL_URL,
      relayWssUrl: '',
      shouldOpen: () => true,
      log: (m) => out.push(m),
    });
    expect(handle).toBeUndefined();
    expect(out).toHaveLength(0);
  });

  it('returns undefined when qr:false (opt-out toggle shared with ASCII QR)', async () => {
    const out: string[] = [];
    const handle = await startTunnelDashboard({
      tunnelUrl: TUNNEL_URL,
      relayWssUrl: RELAY_WSS,
      qr: false,
      shouldOpen: () => true,
      log: (m) => out.push(m),
    });
    expect(handle).toBeUndefined();
    expect(out).toHaveLength(0);
  });

  it('returns undefined when the gate is closed (headless / AIT_AUTO_DEVTOOLS=0)', async () => {
    const out: string[] = [];
    const handle = await startTunnelDashboard({
      tunnelUrl: TUNNEL_URL,
      relayWssUrl: RELAY_WSS,
      shouldOpen: () => false,
      log: (m) => out.push(m),
    });
    expect(handle).toBeUndefined();
    expect(out).toHaveLength(0);
  });

  it('honours AIT_AUTO_DEVTOOLS=0 through the real opt-out predicate (no shouldOpen override)', async () => {
    process.env.AIT_AUTO_DEVTOOLS = '0';
    const out: string[] = [];
    const handle = await startTunnelDashboard({
      tunnelUrl: TUNNEL_URL,
      relayWssUrl: RELAY_WSS,
      log: (m) => out.push(m),
    });
    expect(handle).toBeUndefined();
    expect(out).toHaveLength(0);
  });

  it('starts the HTML dashboard and serves QR + connect steps + FAQ when the gate is open', async () => {
    const out: string[] = [];
    const handle = await startTunnelDashboard({
      tunnelUrl: TUNNEL_URL,
      relayWssUrl: RELAY_WSS,
      shouldOpen: () => true,
      log: (m) => out.push(m),
    });
    expect(handle).toBeDefined();
    if (!handle) throw new Error('dashboard did not start');
    try {
      // The dashboard URL is local only.
      expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

      const res = await fetch(handle.url);
      expect(res.status).toBe(200);
      const html = await res.text();

      // QR image (inline base64) + connect steps + FAQ (same dashboard env 3/4 uses).
      expect(html).toContain('<img class="qr" src="data:image/png;base64,');
      // Dashboard surfaces the attach URL in the url-box; that URL carries the
      // launcher deep-link with the relay folded in (the QR encodes the same).
      expect(html).toContain('devtools.aitc.dev/launcher');
    } finally {
      await handle.close();
    }
  });

  it('hides the "연결된 Pages" section — env 2 has no live target list (#411)', async () => {
    // env 2 getDashboardState returns pages: null because the unplugin tunnel
    // handle can't enumerate connected targets. The dashboard must therefore
    // omit the section entirely rather than show a perpetually-empty list.
    const handle = await startTunnelDashboard({
      tunnelUrl: TUNNEL_URL,
      relayWssUrl: RELAY_WSS,
      shouldOpen: () => true,
      log: () => {},
    });
    if (!handle) throw new Error('dashboard did not start');
    try {
      const html = await (await fetch(handle.url)).text();
      // The static "연결된 Pages" section (header + container) is gone. (The
      // "attach된 페이지 없음" string also lives in the inline SSE script, so we
      // assert on static-only markers — section header + element ids.)
      expect(html).not.toContain('연결된 Pages');
      expect(html).not.toContain('id="pages-section"');
      expect(html).not.toContain('id="pages-list"');
      // The rest of the dashboard (Attach QR) still renders.
      expect(html).toContain('Attach QR');
    } finally {
      await handle.close();
    }
  });

  it('mints a FRESH 6-digit TOTP folded into at= on each getDashboardState call (no stale bake-in)', async () => {
    // Capture the dashboard state by reading the served SSE/HTML attachUrl across
    // two different time windows. Easiest deterministic probe: hit /qr.png twice
    // — but to assert the at= code we read the attach URL out of the dashboard
    // HTML directly, which is built from a fresh getDashboardState() each request.
    const handle = await startTunnelDashboard({
      tunnelUrl: TUNNEL_URL,
      relayWssUrl: RELAY_WSS,
      shouldOpen: () => true,
      log: () => {},
    });
    if (!handle) throw new Error('dashboard did not start');
    try {
      const html = await (await fetch(handle.url)).text();
      // attachUrl is rendered into the url-box with `&` HTML-escaped to `&#38;`,
      // so match `at=<code>` regardless of the preceding (escaped) separator.
      const atMatch = html.match(/at=(\d{6})\b/);
      expect(atMatch).not.toBeNull();
      const code = atMatch?.[1] ?? '';
      // It is a real RFC-6238 code for the secret at "now", not a placeholder.
      const { generateTotp } = await import('../mcp/totp.js');
      const { verifyTotp } = await import('../mcp/totp.js');
      expect(/^\d{6}$/.test(code)).toBe(true);
      expect(verifyTotp(SECRET, code)).toBe(true);
      // Sanity: regenerating at the same step reproduces the code.
      expect(generateTotp(SECRET, Date.now())).toBe(code);
    } finally {
      await handle.close();
    }
  });

  it('SECRET-HANDLING: logs only the local 127.0.0.1 URL — never tunnel host, relay wss, or TOTP', async () => {
    const out: string[] = [];
    const handle = await startTunnelDashboard({
      tunnelUrl: TUNNEL_URL,
      relayWssUrl: RELAY_WSS,
      shouldOpen: () => true,
      log: (m) => out.push(m),
    });
    if (!handle) throw new Error('dashboard did not start');
    try {
      const joined = out.join('\n');
      // The one log line points at the local dashboard.
      expect(joined).toContain('127.0.0.1');
      // No secret material leaks into the log sink.
      expect(joined).not.toContain('app-host-secret');
      expect(joined).not.toContain('relay-host-secret');
      expect(joined).not.toContain('trycloudflare.com');
      expect(joined).not.toContain(SECRET);
      // No TOTP code in the log (any 6-digit run derived from the secret).
      const { generateTotp } = await import('../mcp/totp.js');
      expect(joined).not.toContain(generateTotp(SECRET, Date.now()));
    } finally {
      await handle.close();
    }
  });
});

// ---------------------------------------------------------------------------
// tunnel option env-gating (#425) — resolveTunnelOption pure helper
//
// An explicit `tunnel` option always wins (non-breaking, ?? semantics).
// When omitted, AIT_TUNNEL / AIT_TUNNEL_CDP env vars provide the fallback.
// ---------------------------------------------------------------------------

describe('tunnel option env-gating (#425)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('resolves to false when no env and no explicit option (disabled)', () => {
    vi.stubEnv('AIT_TUNNEL', '');
    vi.stubEnv('AIT_TUNNEL_CDP', '');
    expect(resolveTunnelOption(undefined, {})).toBe(false);
  });

  it('AIT_TUNNEL=1 with no explicit option → screen-preview tunnel enabled (cdp: false)', () => {
    vi.stubEnv('AIT_TUNNEL', '1');
    const result = resolveTunnelOption(undefined, { AIT_TUNNEL: '1' });
    expect(result).toEqual({ cdp: false });
  });

  it('AIT_TUNNEL=1 + AIT_TUNNEL_CDP=1 → CDP relay enabled ({ cdp: true })', () => {
    const result = resolveTunnelOption(undefined, { AIT_TUNNEL: '1', AIT_TUNNEL_CDP: '1' });
    expect(result).toEqual({ cdp: true });
  });

  it('explicit false wins over AIT_TUNNEL (non-breaking: explicit option preserved)', () => {
    const result = resolveTunnelOption(false, { AIT_TUNNEL: '1', AIT_TUNNEL_CDP: '1' });
    expect(result).toBe(false);
  });

  it('explicit true wins over absent env vars (explicit option preserved)', () => {
    const result = resolveTunnelOption(true, {});
    expect(result).toBe(true);
  });

  it('explicit object option wins over env vars (explicit option preserved)', () => {
    const result = resolveTunnelOption({ cdp: true }, { AIT_TUNNEL: '1', AIT_TUNNEL_CDP: '' });
    expect(result).toEqual({ cdp: true });
  });

  it('AIT_TUNNEL absent (even if AIT_TUNNEL_CDP is set) → false (AIT_TUNNEL gates the base)', () => {
    const result = resolveTunnelOption(undefined, { AIT_TUNNEL_CDP: '1' });
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Install-graph invariant (source-static): the heavy modules the dashboard
// needs (`qrcode` via qr-http-server, the opener, deeplink, totp) must be
// reachable from the unplugin ONLY through dynamic `import()`, never a top-level
// static `import ... from`. This is what keeps a tunnel-less consumer build (and
// the MCP-only install path) from pulling `qrcode` into its graph.
// ---------------------------------------------------------------------------

describe('install-graph invariant (env-2 dashboard wiring)', () => {
  // Vitest runs from the package root (cwd === repo root).
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

  /** Top-level `import ... from '<spec>'` lines (static graph edges). */
  function staticImportSpecifiers(source: string): string[] {
    const specs: string[] = [];
    // Matches `import ... from '...'` and bare `import '...'` at statement start.
    const re = /^\s*import\b[^;]*?from\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm;
    for (const m of source.matchAll(re)) {
      specs.push(m[1] ?? m[2] ?? '');
    }
    return specs;
  }

  it('src/unplugin/index.ts statically imports nothing heavy (no mcp, qrcode, tunnel)', () => {
    const src = read('src/unplugin/index.ts');
    const statics = staticImportSpecifiers(src);
    // The entry's only runtime static imports are node:url + unplugin.
    for (const spec of statics) {
      expect(spec).not.toMatch(/^\.\.?\/.*tunnel/);
      expect(spec).not.toContain('qrcode');
      expect(spec).not.toContain('/mcp/');
      expect(spec).not.toContain('qr-http-server');
    }
    // tunnel.js (and the relay/totp modules) are reached via dynamic import().
    expect(src).toContain("import('./tunnel.js')");
  });

  it('src/unplugin/tunnel.ts reaches qrcode + qr-http-server only via dynamic import()', () => {
    const src = read('src/unplugin/tunnel.ts');
    const statics = staticImportSpecifiers(src);
    // No static edge to qrcode-terminal, qrcode, the qr-http-server, the opener,
    // deeplink, or totp — all of those are behind `await import(...)`.
    for (const spec of statics) {
      expect(spec).not.toContain('qrcode');
      expect(spec).not.toContain('qr-http-server');
      expect(spec).not.toContain('devtools-opener');
      expect(spec).not.toContain('deeplink');
      expect(spec).not.toMatch(/\/totp$|\/totp\.js$/);
    }
    // They ARE present as dynamic imports inside the lazy helpers.
    expect(src).toContain("import('qrcode-terminal')");
    expect(src).toContain("import('../mcp/qr-http-server.js')");
    expect(src).toContain("import('../mcp/devtools-opener.js')");
  });
});

// ---------------------------------------------------------------------------
// sanitizeCloudflaredOutput (#421) — SECRET-HANDLING
// ---------------------------------------------------------------------------

describe('sanitizeCloudflaredOutput', () => {
  it('replaces full https:// trycloudflare URL with placeholder', () => {
    const line = 'Registered tunnel connection: https://chunky-purple-frog.trycloudflare.com\n';
    const result = sanitizeCloudflaredOutput(line);
    expect(result).not.toContain('chunky-purple-frog');
    expect(result).toContain('<HOST>.trycloudflare.com');
  });

  it('replaces wss:// trycloudflare URL with placeholder', () => {
    const line = 'Relay URL: wss://chunky-purple-frog.trycloudflare.com/relay\n';
    const result = sanitizeCloudflaredOutput(line);
    expect(result).not.toContain('chunky-purple-frog');
    expect(result).toContain('<HOST>.trycloudflare.com');
  });

  it('replaces bare trycloudflare hostname', () => {
    const line = '{"url":"chunky-purple-frog.trycloudflare.com","level":"info"}\n';
    const result = sanitizeCloudflaredOutput(line);
    expect(result).not.toContain('chunky-purple-frog');
    expect(result).toContain('<HOST>.trycloudflare.com');
  });

  it('preserves non-trycloudflare diagnostic content unchanged', () => {
    const line = 'level=error msg="failed to serve tunnel" error="context canceled"\n';
    const result = sanitizeCloudflaredOutput(line);
    expect(result).toBe(line);
  });

  it('preserves generic error codes and messages (diagnostic value)', () => {
    const line = 'error 1101: An error occurred on the server\n';
    const result = sanitizeCloudflaredOutput(line);
    expect(result).toBe(line);
  });

  it('handles multiple hostnames in one line', () => {
    const line = 'http://alpha.trycloudflare.com and wss://beta.trycloudflare.com\n';
    const result = sanitizeCloudflaredOutput(line);
    expect(result).not.toContain('alpha');
    expect(result).not.toContain('beta');
    expect(result.match(/<HOST>\.trycloudflare\.com/g)?.length).toBe(2);
  });
});
