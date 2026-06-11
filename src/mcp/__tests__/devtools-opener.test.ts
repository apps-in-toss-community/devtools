/**
 * Tests for devtools-opener: Chii self-hosted inspector URL assembly,
 * opt-out guard, and AutoDevtoolsOpener session-once semantics.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AutoDevtoolsOpener,
  buildChiiInspectorUrl,
  isAutoDevtoolsDisabled,
} from '../devtools-opener.js';

// ---------------------------------------------------------------------------
// Fixture TOTP secret (hex, 32 bytes) — never a real secret value.
// ---------------------------------------------------------------------------
const FIXTURE_SECRET = 'deadbeef'.repeat(8); // 64 hex chars = 32 bytes
const fixtureMintTotp = () => '123456';

// ---------------------------------------------------------------------------
// buildChiiInspectorUrl
// ---------------------------------------------------------------------------

describe('buildChiiInspectorUrl', () => {
  it('returns a URL pointing at the relay front_end/chii_app.html', () => {
    const url = buildChiiInspectorUrl('http://127.0.0.1:9100', 'target-abc');
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:9100\/front_end\/chii_app\.html\?/);
  });

  it('includes the default console panel', () => {
    const url = buildChiiInspectorUrl('http://127.0.0.1:9100', 'target-abc');
    expect(url).toContain('panel=console');
  });

  it('accepts a custom panel', () => {
    const url = buildChiiInspectorUrl('http://127.0.0.1:9100', 'target-abc', undefined, 'elements');
    expect(url).toContain('panel=elements');
  });

  it('embeds target id in the wss= path', () => {
    const url = buildChiiInspectorUrl('http://127.0.0.1:9100', 'my-target-id');
    // The wss= value is URL-encoded, so decode it to inspect the inner value.
    const parsed = new URL(url);
    const wssParam = decodeURIComponent(
      parsed.searchParams.get('ws') ?? parsed.searchParams.get('wss') ?? '',
    );
    expect(wssParam).toContain('target=my-target-id');
  });

  it('routes through /client/ path (chii relay client endpoint)', () => {
    const url = buildChiiInspectorUrl('http://127.0.0.1:9100', 'target-abc');
    const parsed = new URL(url);
    const wssParam = decodeURIComponent(
      parsed.searchParams.get('ws') ?? parsed.searchParams.get('wss') ?? '',
    );
    expect(wssParam).toContain('/client/');
  });

  it('includes at= TOTP code when mintTotp is provided', () => {
    const url = buildChiiInspectorUrl('http://127.0.0.1:9100', 'target-abc', fixtureMintTotp);
    const parsed = new URL(url);
    const wssParam = decodeURIComponent(
      parsed.searchParams.get('ws') ?? parsed.searchParams.get('wss') ?? '',
    );
    expect(wssParam).toContain('at=123456');
  });

  it('omits at= when mintTotp is undefined', () => {
    const url = buildChiiInspectorUrl('http://127.0.0.1:9100', 'target-abc', undefined);
    const parsed = new URL(url);
    const wssParam = decodeURIComponent(
      parsed.searchParams.get('ws') ?? parsed.searchParams.get('wss') ?? '',
    );
    expect(wssParam).not.toContain('at=');
  });

  it('uses the relay host (not scheme) in the ws= value', () => {
    const url = buildChiiInspectorUrl('http://127.0.0.1:9100', 'target-abc');
    const parsed = new URL(url);
    const wssParam = decodeURIComponent(
      parsed.searchParams.get('ws') ?? parsed.searchParams.get('wss') ?? '',
    );
    // Should start with the host, not with http://
    expect(wssParam).toMatch(/^127\.0\.0\.1:9100/);
  });

  it('uses ws= (plain dial) for an http relay base — env 3/4 local relay', () => {
    const url = buildChiiInspectorUrl('http://127.0.0.1:9100', 'target-abc');
    const parsed = new URL(url);
    // wss= against a plain-HTTP relay would make the frontend attempt TLS and fail.
    expect(parsed.searchParams.get('ws')).toBeTruthy();
    expect(parsed.searchParams.get('wss')).toBeNull();
  });

  it('uses wss= (TLS dial) for an https relay base — env 2 tunnel', () => {
    const url = buildChiiInspectorUrl('https://abc.trycloudflare.com', 'target-abc');
    const parsed = new URL(url);
    expect(parsed.searchParams.get('wss')).toBeTruthy();
    expect(parsed.searchParams.get('ws')).toBeNull();
  });

  it('works with an external cloudflare tunnel base URL', () => {
    const url = buildChiiInspectorUrl(
      'https://abc.trycloudflare.com',
      'phone-target',
      fixtureMintTotp,
    );
    expect(url).toMatch(/^https:\/\/abc\.trycloudflare\.com\/front_end\/chii_app\.html\?/);
    const parsed = new URL(url);
    const wssParam = decodeURIComponent(
      parsed.searchParams.get('ws') ?? parsed.searchParams.get('wss') ?? '',
    );
    expect(wssParam).toContain('target=phone-target');
    expect(wssParam).toContain('at=123456');
  });

  it('tolerates a trailing slash on the relay base URL', () => {
    const urlWithSlash = buildChiiInspectorUrl('http://127.0.0.1:9100/', 'tgt');
    const urlWithout = buildChiiInspectorUrl('http://127.0.0.1:9100', 'tgt');
    // Both should produce the same structure (no double slash in the path).
    expect(urlWithSlash).not.toContain('//front_end');
    expect(urlWithout).not.toContain('//front_end');
  });

  it('does not embed the TOTP secret — only the code', () => {
    const mintWithSecret = () => {
      // Simulate a mintTotp that uses a real secret internally.
      // The function must return only the code.
      return fixtureMintTotp();
    };
    const url = buildChiiInspectorUrl('http://127.0.0.1:9100', 'tgt', mintWithSecret);
    // The fixture secret must never appear in the URL.
    expect(url).not.toContain(FIXTURE_SECRET);
    // The code (returned value) must appear.
    expect(url).toContain('123456');
  });
});

// ---------------------------------------------------------------------------
// isAutoDevtoolsDisabled
// ---------------------------------------------------------------------------

describe('isAutoDevtoolsDisabled', () => {
  const originalEnv = process.env.AIT_AUTO_DEVTOOLS;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.AIT_AUTO_DEVTOOLS;
    } else {
      process.env.AIT_AUTO_DEVTOOLS = originalEnv;
    }
  });

  it('returns false when env var is absent', () => {
    delete process.env.AIT_AUTO_DEVTOOLS;
    expect(isAutoDevtoolsDisabled()).toBe(false);
  });

  it('returns true when AIT_AUTO_DEVTOOLS=0', () => {
    process.env.AIT_AUTO_DEVTOOLS = '0';
    expect(isAutoDevtoolsDisabled()).toBe(true);
  });

  it('returns false when AIT_AUTO_DEVTOOLS=1', () => {
    process.env.AIT_AUTO_DEVTOOLS = '1';
    expect(isAutoDevtoolsDisabled()).toBe(false);
  });

  it('returns false when AIT_AUTO_DEVTOOLS=false (string)', () => {
    process.env.AIT_AUTO_DEVTOOLS = 'false';
    expect(isAutoDevtoolsDisabled()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// openUrlInBrowser — actual spawn is a side-effect; integration path is manual/E2E only.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// AutoDevtoolsOpener
// ---------------------------------------------------------------------------

describe('AutoDevtoolsOpener', () => {
  let stderrOutput: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrOutput = '';
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrOutput += String(chunk);
      return true;
    });
    delete process.env.AIT_AUTO_DEVTOOLS;
    process.env.AIT_AUTO_DEVTOOLS_TEST_SKIP_SPAWN = '1';
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    delete process.env.AIT_AUTO_DEVTOOLS;
    delete process.env.AIT_AUTO_DEVTOOLS_TEST_SKIP_SPAWN;
  });

  it('opens once and marks opened=true', () => {
    const opener = new AutoDevtoolsOpener();
    opener.open({
      relayHttpBaseUrl: 'http://127.0.0.1:9100',
      targetId: 'target-abc',
      mintTotp: fixtureMintTotp,
      env: 'relay-dev',
    });
    expect(opener.opened).toBe(true);
    expect(stderrOutput).toContain('DevTools URL');
    expect(stderrOutput).toContain('127.0.0.1:9100');
  });

  it('is a no-op on second call (duplicate guard)', () => {
    const opener = new AutoDevtoolsOpener();
    opener.open({
      relayHttpBaseUrl: 'http://127.0.0.1:9100',
      targetId: 'target-abc',
      mintTotp: fixtureMintTotp,
      env: 'relay-dev',
    });
    stderrOutput = '';
    opener.open({
      relayHttpBaseUrl: 'http://127.0.0.1:9100',
      targetId: 'target-abc',
      mintTotp: fixtureMintTotp,
      env: 'relay-dev',
    });
    // Second call should not write to stderr.
    expect(stderrOutput).toBe('');
    expect(opener.opened).toBe(true);
  });

  it('is a no-op when env is mock', () => {
    const opener = new AutoDevtoolsOpener();
    opener.open({
      relayHttpBaseUrl: 'http://127.0.0.1:9100',
      targetId: 'target-abc',
      env: 'mock',
    });
    expect(opener.opened).toBe(false);
    expect(stderrOutput).toBe('');
  });

  it('is a no-op when relayHttpBaseUrl is null', () => {
    const opener = new AutoDevtoolsOpener();
    opener.open({
      relayHttpBaseUrl: null,
      targetId: 'target-abc',
      env: 'relay-dev',
    });
    expect(opener.opened).toBe(false);
    expect(stderrOutput).toBe('');
  });

  it('is a no-op when relayHttpBaseUrl is empty string', () => {
    const opener = new AutoDevtoolsOpener();
    opener.open({
      relayHttpBaseUrl: '',
      targetId: 'target-abc',
      env: 'relay-dev',
    });
    expect(opener.opened).toBe(false);
    expect(stderrOutput).toBe('');
  });

  it('is a no-op when targetId is null', () => {
    const opener = new AutoDevtoolsOpener();
    opener.open({
      relayHttpBaseUrl: 'http://127.0.0.1:9100',
      targetId: null,
      env: 'relay-dev',
    });
    expect(opener.opened).toBe(false);
    expect(stderrOutput).toBe('');
  });

  it('is a no-op when targetId is empty string', () => {
    const opener = new AutoDevtoolsOpener();
    opener.open({
      relayHttpBaseUrl: 'http://127.0.0.1:9100',
      targetId: '',
      env: 'relay-dev',
    });
    expect(opener.opened).toBe(false);
    expect(stderrOutput).toBe('');
  });

  it('is a no-op when AIT_AUTO_DEVTOOLS=0', () => {
    process.env.AIT_AUTO_DEVTOOLS = '0';
    const opener = new AutoDevtoolsOpener();
    opener.open({
      relayHttpBaseUrl: 'http://127.0.0.1:9100',
      targetId: 'target-abc',
      mintTotp: fixtureMintTotp,
      env: 'relay-dev',
    });
    expect(opener.opened).toBe(false);
    expect(stderrOutput).toBe('');
  });

  it('writes the Chii inspector URL to stderr before attempting browser open', () => {
    const opener = new AutoDevtoolsOpener();
    opener.open({
      relayHttpBaseUrl: 'https://tunnel.trycloudflare.com',
      targetId: 'phone-target',
      mintTotp: fixtureMintTotp,
      env: 'relay-dev',
    });
    expect(stderrOutput).toContain('DevTools URL');
    expect(stderrOutput).toContain('tunnel.trycloudflare.com');
    expect(stderrOutput).toContain('front_end/chii_app.html');
  });

  it('embeds the TOTP code (not the secret) in the stderr URL', () => {
    const opener = new AutoDevtoolsOpener();
    opener.open({
      relayHttpBaseUrl: 'http://127.0.0.1:9100',
      targetId: 'tgt',
      mintTotp: fixtureMintTotp,
      env: 'relay-dev',
    });
    // Code value should appear (it is in the URL, which is written to stderr).
    expect(stderrOutput).toContain('123456');
    // Raw secret must never appear.
    expect(stderrOutput).not.toContain(FIXTURE_SECRET);
  });

  it('works without mintTotp (TOTP disabled) — no at= in the wss URL', () => {
    const opener = new AutoDevtoolsOpener();
    opener.open({
      relayHttpBaseUrl: 'http://127.0.0.1:9100',
      targetId: 'tgt',
      env: 'relay-dev',
    });
    expect(opener.opened).toBe(true);
    expect(stderrOutput).toContain('front_end/chii_app.html');
    // Extract the URL line from stderr to check only the URL, not the static caveat text.
    const urlLine = stderrOutput.split('\n').find((line) => line.includes('DevTools URL:')) ?? '';
    const urlMatch = urlLine.match(/DevTools URL: (.+)$/);
    const urlStr = urlMatch?.[1] ?? '';
    const parsedUrl = new URL(urlStr);
    const wssParam = decodeURIComponent(
      parsedUrl.searchParams.get('ws') ?? parsedUrl.searchParams.get('wss') ?? '',
    );
    expect(wssParam).not.toContain('at=');
  });

  it('includes the TOTP expiry notice in stderr output', () => {
    const opener = new AutoDevtoolsOpener();
    opener.open({
      relayHttpBaseUrl: 'http://127.0.0.1:9100',
      targetId: 'tgt',
      mintTotp: fixtureMintTotp,
      env: 'relay-dev',
    });
    expect(stderrOutput).toContain('at=');
    // The expiry caveat must be communicated to the developer (#490: updated to ~3분).
    expect(stderrOutput).toContain('3분');
  });
});
