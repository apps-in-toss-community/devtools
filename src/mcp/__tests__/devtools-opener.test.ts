/**
 * Tests for devtools-opener: Chii self-hosted inspector URL assembly,
 * opt-out guard, and AutoDevtoolsOpener per-target dedupe semantics (issue #530).
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

// isAutoDevtoolsDisabled — 기본값 OFF (opt-in) 모델 (#544)
// 기본(미설정): disabled=true (창 자동 열기 안 함)
// AIT_AUTO_DEVTOOLS=1: disabled=false (opt-in 자동 열기)
// AIT_AUTO_DEVTOOLS=0: disabled=true (명시적 opt-out, 기존 의미 호환)
// AIT_AUTO_DEVTOOLS=기타(false 등): disabled=true ('1'이 아닌 모든 값)
describe('isAutoDevtoolsDisabled', () => {
  const originalEnv = process.env.AIT_AUTO_DEVTOOLS;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.AIT_AUTO_DEVTOOLS;
    } else {
      process.env.AIT_AUTO_DEVTOOLS = originalEnv;
    }
  });

  it('returns true when env var is absent (default OFF — opt-in model, #544)', () => {
    delete process.env.AIT_AUTO_DEVTOOLS;
    expect(isAutoDevtoolsDisabled()).toBe(true);
  });

  it('returns true when AIT_AUTO_DEVTOOLS=0 (explicit opt-out, backward compat)', () => {
    process.env.AIT_AUTO_DEVTOOLS = '0';
    expect(isAutoDevtoolsDisabled()).toBe(true);
  });

  it('returns false when AIT_AUTO_DEVTOOLS=1 (opt-in enables auto-open)', () => {
    process.env.AIT_AUTO_DEVTOOLS = '1';
    expect(isAutoDevtoolsDisabled()).toBe(false);
  });

  it('returns true when AIT_AUTO_DEVTOOLS=false (string) — only "1" opts in', () => {
    process.env.AIT_AUTO_DEVTOOLS = 'false';
    expect(isAutoDevtoolsDisabled()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// openUrlInBrowser — actual spawn is a side-effect; integration path is manual/E2E only.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// AutoDevtoolsOpener
// ---------------------------------------------------------------------------

// AutoDevtoolsOpener — #544 기본값 OFF 적용 후 테스트
// "열려야 하는" 케이스는 AIT_AUTO_DEVTOOLS=1 (opt-in) 설정 후 확인.
// "안 열려야 하는" 케이스는 미설정(default OFF) 또는 =0(명시적 opt-out).
describe('AutoDevtoolsOpener', () => {
  let stderrOutput: string;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrOutput = '';
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrOutput += String(chunk);
      return true;
    });
    // 기본은 미설정(기본 OFF) — 개별 테스트에서 =1로 opt-in.
    delete process.env.AIT_AUTO_DEVTOOLS;
    process.env.AIT_AUTO_DEVTOOLS_TEST_SKIP_SPAWN = '1';
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    delete process.env.AIT_AUTO_DEVTOOLS;
    delete process.env.AIT_AUTO_DEVTOOLS_TEST_SKIP_SPAWN;
  });

  // ── 기본값 OFF — 미설정 시 no-op 확인 (#544) ─────────────────────────────
  it('is a no-op by default (AIT_AUTO_DEVTOOLS not set — default OFF, #544)', () => {
    delete process.env.AIT_AUTO_DEVTOOLS;
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

  // ── opt-in (AIT_AUTO_DEVTOOLS=1) ─────────────────────────────────────────
  it('opens once and marks opened=true when AIT_AUTO_DEVTOOLS=1 (opt-in)', () => {
    process.env.AIT_AUTO_DEVTOOLS = '1';
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

  it('is a no-op on second call for the same targetId (per-target dedupe)', () => {
    process.env.AIT_AUTO_DEVTOOLS = '1';
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
    // Second call for the same target should not write to stderr.
    expect(stderrOutput).toBe('');
    expect(opener.opened).toBe(true);
  });

  it('fires again for a new targetId (per-target dedupe, issue #530)', () => {
    process.env.AIT_AUTO_DEVTOOLS = '1';
    // A page reload on the phone yields a new targetId — should auto-open again.
    const opener = new AutoDevtoolsOpener();
    opener.open({
      relayHttpBaseUrl: 'http://127.0.0.1:9100',
      targetId: 'target-first',
      mintTotp: fixtureMintTotp,
      env: 'relay-dev',
    });
    stderrOutput = '';
    opener.open({
      relayHttpBaseUrl: 'http://127.0.0.1:9100',
      targetId: 'target-second',
      mintTotp: fixtureMintTotp,
      env: 'relay-dev',
    });
    // Second call with a NEW target should write to stderr.
    expect(stderrOutput).toContain('DevTools URL');
    expect(opener.openedTargets.size).toBe(2);
  });

  it('is a no-op when env is mock', () => {
    process.env.AIT_AUTO_DEVTOOLS = '1';
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
    process.env.AIT_AUTO_DEVTOOLS = '1';
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
    process.env.AIT_AUTO_DEVTOOLS = '1';
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
    process.env.AIT_AUTO_DEVTOOLS = '1';
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
    process.env.AIT_AUTO_DEVTOOLS = '1';
    const opener = new AutoDevtoolsOpener();
    opener.open({
      relayHttpBaseUrl: 'http://127.0.0.1:9100',
      targetId: '',
      env: 'relay-dev',
    });
    expect(opener.opened).toBe(false);
    expect(stderrOutput).toBe('');
  });

  it('is a no-op when AIT_AUTO_DEVTOOLS=0 (explicit opt-out, backward compat)', () => {
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

  it('writes the Chii inspector URL to stderr before attempting browser open (opt-in)', () => {
    process.env.AIT_AUTO_DEVTOOLS = '1';
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

  it('embeds the TOTP code (not the secret) in the stderr URL (opt-in)', () => {
    process.env.AIT_AUTO_DEVTOOLS = '1';
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
    process.env.AIT_AUTO_DEVTOOLS = '1';
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

  it('includes the TOTP expiry notice in stderr output (opt-in)', () => {
    process.env.AIT_AUTO_DEVTOOLS = '1';
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

  // ── inspectorStableUrl 경로 (issue #530 stable /inspector URL) ──────────
  it('uses inspectorStableUrl when provided — no tunnel host or TOTP code in stderr', () => {
    process.env.AIT_AUTO_DEVTOOLS = '1';
    const opener = new AutoDevtoolsOpener();
    opener.open({
      inspectorStableUrl: 'http://127.0.0.1:19000/inspector',
      relayHttpBaseUrl: 'https://tunnel.trycloudflare.com',
      targetId: 'tgt',
      mintTotp: fixtureMintTotp,
      env: 'relay-dev',
    });
    expect(opener.opened).toBe(true);
    // Stable URL written to stderr (dashboard URL only, no inspector path).
    expect(stderrOutput).toContain('http://127.0.0.1:19000');
    // Tunnel host must NOT appear in stderr (SECRET-HANDLING).
    expect(stderrOutput).not.toContain('tunnel.trycloudflare.com');
    // TOTP code must NOT appear in stderr (stable URL has no TOTP).
    expect(stderrOutput).not.toContain('123456');
    // No expiry notice when using the stable URL.
    expect(stderrOutput).not.toContain('3분');
  });

  it('inspectorStableUrl path: is a no-op on second call for same targetId', () => {
    process.env.AIT_AUTO_DEVTOOLS = '1';
    const opener = new AutoDevtoolsOpener();
    const stableUrl = 'http://127.0.0.1:19000/inspector';
    opener.open({
      inspectorStableUrl: stableUrl,
      relayHttpBaseUrl: null,
      targetId: 'tgt',
      env: 'relay-dev',
    });
    stderrOutput = '';
    opener.open({
      inspectorStableUrl: stableUrl,
      relayHttpBaseUrl: null,
      targetId: 'tgt',
      env: 'relay-dev',
    });
    expect(stderrOutput).toBe('');
    expect(opener.opened).toBe(true);
  });

  it('inspectorStableUrl path: fires again for a new targetId', () => {
    process.env.AIT_AUTO_DEVTOOLS = '1';
    const opener = new AutoDevtoolsOpener();
    const stableUrl = 'http://127.0.0.1:19000/inspector';
    opener.open({
      inspectorStableUrl: stableUrl,
      relayHttpBaseUrl: null,
      targetId: 'tgt-first',
      env: 'relay-dev',
    });
    stderrOutput = '';
    opener.open({
      inspectorStableUrl: stableUrl,
      relayHttpBaseUrl: null,
      targetId: 'tgt-second',
      env: 'relay-dev',
    });
    expect(stderrOutput).toContain('http://127.0.0.1:19000');
    expect(opener.openedTargets.size).toBe(2);
  });
});
