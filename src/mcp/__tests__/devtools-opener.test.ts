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
  // ── fail-closed: mintTotp 없으면 null 반환 (issue #509) ─────────────────
  it('returns null when mintTotp is undefined (fail-closed)', () => {
    // relay WS 게이트는 at= 없는 모든 업그레이드를 거부하므로, mintTotp 없이
    // URL을 만들면 항상 WS 4401이 된다 — null을 반환해 caller가 waiting hint를 표시하게 한다.
    expect(buildChiiInspectorUrl('http://127.0.0.1:9100', 'target-abc', undefined)).toBeNull();
  });

  it('returns null when mintTotp is omitted (fail-closed)', () => {
    expect(buildChiiInspectorUrl('http://127.0.0.1:9100', 'target-abc')).toBeNull();
  });

  it('returns null for HTTPS tunnel relay when mintTotp is omitted (env 2, fail-closed)', () => {
    // relay-mobile(env 2) HTTPS tunnel URL에서도 mintTotp 없으면 null.
    expect(buildChiiInspectorUrl('https://abc.trycloudflare.com', 'target-abc')).toBeNull();
  });

  // ── URL 생성: mintTotp 있을 때만 string 반환 ──────────────────────────
  it('returns a URL pointing at the relay front_end/chii_app.html', () => {
    const url = buildChiiInspectorUrl('http://127.0.0.1:9100', 'target-abc', fixtureMintTotp);
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:9100\/front_end\/chii_app\.html\?/);
  });

  it('includes the default console panel', () => {
    const url = buildChiiInspectorUrl('http://127.0.0.1:9100', 'target-abc', fixtureMintTotp);
    expect(url).toContain('panel=console');
  });

  it('accepts a custom panel', () => {
    const url = buildChiiInspectorUrl(
      'http://127.0.0.1:9100',
      'target-abc',
      fixtureMintTotp,
      'elements',
    );
    expect(url).toContain('panel=elements');
  });

  it('embeds target id in the ws= path', () => {
    const url = buildChiiInspectorUrl('http://127.0.0.1:9100', 'my-target-id', fixtureMintTotp);
    expect(url).not.toBeNull();
    // The ws= value is URL-encoded, so decode it to inspect the inner value.
    const parsed = new URL(url as string);
    const wssParam = decodeURIComponent(
      parsed.searchParams.get('ws') ?? parsed.searchParams.get('wss') ?? '',
    );
    expect(wssParam).toContain('target=my-target-id');
  });

  it('routes through /client/ path (chii relay client endpoint)', () => {
    const url = buildChiiInspectorUrl('http://127.0.0.1:9100', 'target-abc', fixtureMintTotp);
    expect(url).not.toBeNull();
    const parsed = new URL(url as string);
    const wssParam = decodeURIComponent(
      parsed.searchParams.get('ws') ?? parsed.searchParams.get('wss') ?? '',
    );
    expect(wssParam).toContain('/client/');
  });

  it('includes at= TOTP code when mintTotp is provided', () => {
    const url = buildChiiInspectorUrl('http://127.0.0.1:9100', 'target-abc', fixtureMintTotp);
    expect(url).not.toBeNull();
    const parsed = new URL(url as string);
    const wssParam = decodeURIComponent(
      parsed.searchParams.get('ws') ?? parsed.searchParams.get('wss') ?? '',
    );
    expect(wssParam).toContain('at=123456');
  });

  it('uses the relay host (not scheme) in the ws= value', () => {
    const url = buildChiiInspectorUrl('http://127.0.0.1:9100', 'target-abc', fixtureMintTotp);
    expect(url).not.toBeNull();
    const parsed = new URL(url as string);
    const wssParam = decodeURIComponent(
      parsed.searchParams.get('ws') ?? parsed.searchParams.get('wss') ?? '',
    );
    // Should start with the host, not with http://
    expect(wssParam).toMatch(/^127\.0\.0\.1:9100/);
  });

  it('uses ws= (plain dial) for an http relay base — env 3/4 local relay', () => {
    const url = buildChiiInspectorUrl('http://127.0.0.1:9100', 'target-abc', fixtureMintTotp);
    expect(url).not.toBeNull();
    const parsed = new URL(url as string);
    // wss= against a plain-HTTP relay would make the frontend attempt TLS and fail.
    expect(parsed.searchParams.get('ws')).toBeTruthy();
    expect(parsed.searchParams.get('wss')).toBeNull();
  });

  it('uses wss= (TLS dial) for an https relay base — env 2 tunnel', () => {
    const url = buildChiiInspectorUrl(
      'https://abc.trycloudflare.com',
      'target-abc',
      fixtureMintTotp,
    );
    expect(url).not.toBeNull();
    const parsed = new URL(url as string);
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
    const parsed = new URL(url as string);
    const wssParam = decodeURIComponent(
      parsed.searchParams.get('ws') ?? parsed.searchParams.get('wss') ?? '',
    );
    expect(wssParam).toContain('target=phone-target');
    expect(wssParam).toContain('at=123456');
  });

  it('tolerates a trailing slash on the relay base URL', () => {
    const urlWithSlash = buildChiiInspectorUrl('http://127.0.0.1:9100/', 'tgt', fixtureMintTotp);
    const urlWithout = buildChiiInspectorUrl('http://127.0.0.1:9100', 'tgt', fixtureMintTotp);
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

  it('fail-closed when mintTotp is absent — marks opened but skips browser open (issue #509)', () => {
    // relay 게이트는 at= 없는 WS를 4401로 거부하므로 URL을 만들지 않는다.
    // _opened=true를 유지해 once-per-session 가드가 동작하고, TOTP 미설정 안내를 stderr에 출력.
    const opener = new AutoDevtoolsOpener();
    opener.open({
      relayHttpBaseUrl: 'http://127.0.0.1:9100',
      targetId: 'tgt',
      env: 'relay-dev',
    });
    expect(opener.opened).toBe(true);
    // URL이 없으므로 DevTools URL 줄이 없어야 한다.
    expect(stderrOutput).not.toContain('DevTools URL');
    expect(stderrOutput).not.toContain('front_end/chii_app.html');
    // TOTP 미설정 안내 메시지가 있어야 한다.
    expect(stderrOutput).toContain('TOTP');
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
