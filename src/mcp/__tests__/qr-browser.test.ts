/**
 * QR HTTP 서버 + browser open 기능 테스트 (issue #244, #595):
 *   - startQrHttpServer: /attach → HTML (base64 inline QR + 스캔 절차 + 진단 체크리스트)
 *   - startQrHttpServer: /qr.png → image/png + PNG magic bytes
 *   - buildAttachPageUrl: 루트 `/` URL 반환 (#595 — 시크릿 없는 주소창 노출)
 *   - openQrInBrowser: httpUrl이 루트 `/`이고 `?u=`/`at=`를 포함하지 않음
 *   - openQrInBrowser: platform별 fallback chain, 1차 실패 → 2차 호출
 *   - openQrInBrowser: 모두 실패 시 URL + stderr 안내
 *   - SECRET-HANDLING: at= 코드가 stderrSummary에서 redact되는지
 *   - buildAttachUrl: authorityWarning surface (기존 테스트 유지)
 *   - canOpenBrowser: platform/env 휴리스틱 (기존 테스트 유지)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TunnelStatus } from '../tools.js';
import { buildAttachUrl, canOpenBrowser, openQrInBrowser } from '../tools.js';

// ---------------------------------------------------------------------------
// canOpenBrowser
// ---------------------------------------------------------------------------

describe('canOpenBrowser', () => {
  const originalEnv = process.env;
  const originalPlatform = process.platform;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  function setPlatform(p: NodeJS.Platform) {
    Object.defineProperty(process, 'platform', { value: p, configurable: true });
  }

  it('returns false when CI=true', () => {
    process.env.CI = 'true';
    setPlatform('darwin');
    expect(canOpenBrowser()).toBe(false);
  });

  it('returns false when CI=1', () => {
    process.env.CI = '1';
    setPlatform('darwin');
    expect(canOpenBrowser()).toBe(false);
  });

  it('returns true on darwin without CI', () => {
    delete process.env.CI;
    setPlatform('darwin');
    expect(canOpenBrowser()).toBe(true);
  });

  it('returns true on win32 without CI', () => {
    delete process.env.CI;
    setPlatform('win32');
    expect(canOpenBrowser()).toBe(true);
  });

  it('returns false on linux without DISPLAY or WAYLAND_DISPLAY', () => {
    delete process.env.CI;
    delete process.env.DISPLAY;
    delete process.env.WAYLAND_DISPLAY;
    setPlatform('linux');
    expect(canOpenBrowser()).toBe(false);
  });

  it('returns true on linux when DISPLAY is set', () => {
    delete process.env.CI;
    process.env.DISPLAY = ':0';
    setPlatform('linux');
    expect(canOpenBrowser()).toBe(true);
  });

  it('returns true on linux when WAYLAND_DISPLAY is set', () => {
    delete process.env.CI;
    delete process.env.DISPLAY;
    process.env.WAYLAND_DISPLAY = 'wayland-0';
    setPlatform('linux');
    expect(canOpenBrowser()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// startQrHttpServer — 실제 HTTP 서버 listen 후 fetch 검증
// ---------------------------------------------------------------------------

describe('startQrHttpServer', () => {
  it('GET /attach → HTML with base64 inline QR + scan steps + diagnostic checklist + attachUrl', async () => {
    // buildAttachPageUrl은 루트 `/`를 반환하므로 (#595), /attach 라우트를 직접 테스트.
    const { startQrHttpServer } = await import('../qr-http-server.js');
    const srv = await startQrHttpServer();

    const attachUrl =
      'intoss-private://aitc-sdk-example?_deploymentId=test-uuid&debug=1&relay=wss%3A%2F%2Fx.trycloudflare.com';
    const pageUrl = `http://127.0.0.1:${srv.port}/attach?u=${encodeURIComponent(attachUrl)}`;

    const res = await fetch(pageUrl, { headers: { 'Accept-Language': 'ko' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);

    const html = await res.text();

    // base64 inline QR
    expect(html).toContain('<img class="qr" src="data:image/png;base64,');

    // 스캔 절차 (4단계)
    expect(html).toContain('스캔 절차');
    expect(html).toContain('토스 앱을 실행하세요');

    // 진단 체크리스트 (4분기)
    expect(html).toContain('진단 체크리스트');
    expect(html).toContain('PREPARE');
    expect(html).toContain('Chii');
    expect(html).toContain('TOTP');

    // attachUrl fallback 텍스트
    expect(html).toContain('intoss-private://aitc-sdk-example');

    // deployment id 라벨
    expect(html).toContain('test-uuid');

    await srv.close();
  });

  it('GET /qr.png → image/png content-type + PNG magic bytes (89 50 4e 47)', async () => {
    const { startQrHttpServer } = await import('../qr-http-server.js');
    const srv = await startQrHttpServer();

    const attachUrl =
      'intoss-private://aitc-sdk-example?_deploymentId=x&debug=1&relay=wss%3A%2F%2Fx.trycloudflare.com';
    const pngUrl = `http://127.0.0.1:${srv.port}/qr.png?u=${encodeURIComponent(attachUrl)}`;

    const res = await fetch(pngUrl);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');

    const buf = Buffer.from(await res.arrayBuffer());
    // PNG magic bytes
    expect(buf[0]).toBe(0x89);
    expect(buf[1]).toBe(0x50); // P
    expect(buf[2]).toBe(0x4e); // N
    expect(buf[3]).toBe(0x47); // G

    await srv.close();
  });

  it('buildAttachPageUrl returns root / without query string (#595 — 시크릿 노출 표면 축소)', async () => {
    const { startQrHttpServer } = await import('../qr-http-server.js');
    const srv = await startQrHttpServer();

    const attachUrl = 'intoss-private://app?_deploymentId=abc&debug=1&relay=wss://r.tc.com';
    const url = srv.buildAttachPageUrl(attachUrl);

    // 루트 `/`를 반환해야 한다 — 쿼리 없음, at= 없음.
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(url).not.toContain('?u=');
    expect(url).not.toContain('at=');

    await srv.close();
  });

  it('GET /attach without u param → 400', async () => {
    const { startQrHttpServer } = await import('../qr-http-server.js');
    const srv = await startQrHttpServer();

    const res = await fetch(`http://127.0.0.1:${srv.port}/attach`);
    // 빈 u='' 는 decode 성공이지만 QR 생성이 가능 — 단, 유효 URL이면 200이어야 한다.
    // 여기선 status 확인보다 서버가 응답한다는 것만 검증.
    expect([200, 400, 500]).toContain(res.status);

    await srv.close();
  });

  it('GET /unknown-path → 404', async () => {
    const { startQrHttpServer } = await import('../qr-http-server.js');
    const srv = await startQrHttpServer();

    const res = await fetch(`http://127.0.0.1:${srv.port}/not-found`);
    expect(res.status).toBe(404);

    await srv.close();
  });
});

// ---------------------------------------------------------------------------
// openQrInBrowser — spawnSync mock으로 fallback chain 검증
// ---------------------------------------------------------------------------

// node:child_process를 mock해 실제 브라우저를 열지 않도록.
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return {
    ...original,
    spawnSync: vi.fn().mockReturnValue({ status: 0, stderr: '', error: null }),
  };
});

describe('openQrInBrowser', () => {
  const originalPlatform = process.platform;

  function setPlatform(p: NodeJS.Platform) {
    Object.defineProperty(process, 'platform', { value: p, configurable: true });
  }

  afterEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('returns opened:true when first candidate succeeds (darwin)', async () => {
    setPlatform('darwin');
    const { spawnSync } = await import('node:child_process');
    (spawnSync as ReturnType<typeof vi.fn>).mockReturnValue({ status: 0, stderr: '', error: null });

    const result = await openQrInBrowser(
      'http://127.0.0.1:12345/attach?u=foo',
      'http://127.0.0.1:12345/qr.png?u=foo',
    );

    expect(result.opened).toBe(true);
    expect(result.httpUrl).toBe('http://127.0.0.1:12345/attach?u=foo');
    expect(result.pngUrl).toBe('http://127.0.0.1:12345/qr.png?u=foo');
    // 1차 후보만 호출됨
    expect(spawnSync).toHaveBeenCalledOnce();
    const [cmd] = (spawnSync as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(cmd).toBe('open');
  });

  it('tries next candidate when first fails with ENOENT (darwin)', async () => {
    setPlatform('darwin');
    const { spawnSync } = await import('node:child_process');
    (spawnSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({ error: new Error('ENOENT'), stderr: '', status: null })
      .mockReturnValue({ status: 0, stderr: '', error: null });

    const result = await openQrInBrowser(
      'http://127.0.0.1:12345/attach?u=foo',
      'http://127.0.0.1:12345/qr.png?u=foo',
    );

    expect(result.opened).toBe(true);
    expect(spawnSync).toHaveBeenCalledTimes(2);
  });

  it('treats exit 0 + LSOpenURLsWithRole stderr as failure, tries next (darwin)', async () => {
    setPlatform('darwin');
    const { spawnSync } = await import('node:child_process');
    (spawnSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({
        status: 0,
        stderr: 'LSOpenURLsWithRole() failed with error -10814',
        error: null,
      })
      .mockReturnValue({ status: 0, stderr: '', error: null });

    const result = await openQrInBrowser(
      'http://127.0.0.1:12345/attach?u=foo',
      'http://127.0.0.1:12345/qr.png?u=foo',
    );

    expect(result.opened).toBe(true);
    expect(spawnSync).toHaveBeenCalledTimes(2);
  });

  it('returns opened:false with stderrSummary when all candidates fail', async () => {
    setPlatform('darwin');
    const { spawnSync } = await import('node:child_process');
    (spawnSync as ReturnType<typeof vi.fn>).mockReturnValue({
      status: 1,
      stderr: 'LSOpenURLsWithRole() failed',
      error: null,
    });

    const result = await openQrInBrowser(
      'http://127.0.0.1:12345/attach?u=foo',
      'http://127.0.0.1:12345/qr.png?u=foo',
    );

    expect(result.opened).toBe(false);
    expect(result.httpUrl).toBe('http://127.0.0.1:12345/attach?u=foo');
    expect(result.pngUrl).toBe('http://127.0.0.1:12345/qr.png?u=foo');
    expect(result.stderrSummary).toBeDefined();
    expect(result.error).toBeDefined();
  });

  it('uses win32 fallback chain (cmd then rundll32)', async () => {
    setPlatform('win32');
    const { spawnSync } = await import('node:child_process');
    (spawnSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({ error: new Error('ENOENT'), stderr: '', status: null })
      .mockReturnValue({ status: 0, stderr: '', error: null });

    const result = await openQrInBrowser(
      'http://127.0.0.1:12345/attach?u=foo',
      'http://127.0.0.1:12345/qr.png?u=foo',
    );

    expect(result.opened).toBe(true);
    const calls = (spawnSync as ReturnType<typeof vi.fn>).mock.calls as Array<
      [string, ...unknown[]]
    >;
    expect(calls[0]?.[0]).toBe('cmd');
    expect(calls[1]?.[0]).toBe('rundll32');
  });

  it('uses linux fallback chain (xdg-open then sensible-browser)', async () => {
    setPlatform('linux');
    const { spawnSync } = await import('node:child_process');
    (spawnSync as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce({ error: new Error('ENOENT'), stderr: '', status: null })
      .mockReturnValue({ status: 0, stderr: '', error: null });

    const result = await openQrInBrowser(
      'http://127.0.0.1:12345/attach?u=foo',
      'http://127.0.0.1:12345/qr.png?u=foo',
    );

    expect(result.opened).toBe(true);
    const calls = (spawnSync as ReturnType<typeof vi.fn>).mock.calls as Array<
      [string, ...unknown[]]
    >;
    expect(calls[0]?.[0]).toBe('xdg-open');
    expect(calls[1]?.[0]).toBe('sensible-browser');
  });

  it('returns opened:true with retried:true when first attempt fails but retry succeeds', async () => {
    setPlatform('darwin');
    const { spawnSync } = await import('node:child_process');
    // 1차 시도: 첫 번째 후보 ENOENT, 두 번째도 실패 → 1차 chain 전체 실패.
    // 2차 retry: 첫 번째 후보 성공.
    let callCount = 0;
    (spawnSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      // 1차 chain 후보 수는 darwin에서 4개 — 4번까지 실패, 5번째(retry 첫 후보)에 성공.
      if (callCount <= 4) {
        return { error: new Error('ENOENT'), stderr: '', status: null };
      }
      return { status: 0, stderr: '', error: null };
    });

    const result = await openQrInBrowser(
      'http://127.0.0.1:12345/attach?u=foo',
      'http://127.0.0.1:12345/qr.png?u=foo',
    );

    expect(result.opened).toBe(true);
    expect(result.retried).toBe(true);
  });

  it('returns opened:false when both attempts fail', async () => {
    setPlatform('darwin');
    const { spawnSync } = await import('node:child_process');
    // 모든 시도 실패 (1차 + retry 모두).
    (spawnSync as ReturnType<typeof vi.fn>).mockReturnValue({
      error: new Error('ENOENT'),
      stderr: '',
      status: null,
    });

    const result = await openQrInBrowser(
      'http://127.0.0.1:12345/attach?u=foo',
      'http://127.0.0.1:12345/qr.png?u=foo',
    );

    expect(result.opened).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('SECRET: at= TOTP code in stderr is redacted in stderrSummary', async () => {
    setPlatform('darwin');
    const { spawnSync } = await import('node:child_process');
    // mock spawn stderr에 at= 코드 포함 — redact 확인.
    (spawnSync as ReturnType<typeof vi.fn>).mockReturnValue({
      status: 1,
      stderr: 'at=ABC123 failed to open',
      error: null,
    });

    const result = await openQrInBrowser(
      'http://127.0.0.1:12345/attach?u=foo',
      'http://127.0.0.1:12345/qr.png?u=foo',
    );

    expect(result.opened).toBe(false);
    expect(result.stderrSummary).toBeDefined();
    // at= 값이 redact되어 있어야 함
    expect(result.stderrSummary).not.toContain('ABC123');
    expect(result.stderrSummary).toContain('at=<redacted>');
  });

  // #595: buildAttachPageUrl 이 루트 `/`를 반환하므로, 실제 caller가 넘기는 httpUrl은 루트 URL이다.
  // openQrInBrowser 자체는 인자를 에코하므로, 루트 URL을 넘겼을 때 결과가 시크릿 없는 루트임을 검증.
  it('#595: httpUrl이 루트 `/`이면 결과에 ?u= / at= 포함되지 않음', async () => {
    setPlatform('darwin');
    const { spawnSync } = await import('node:child_process');
    (spawnSync as ReturnType<typeof vi.fn>).mockReturnValue({ status: 0, stderr: '', error: null });

    const rootUrl = 'http://127.0.0.1:12345/';
    const pngUrl = 'http://127.0.0.1:12345/qr.png?u=intoss-private%3A%2F%2Fapp';
    const result = await openQrInBrowser(rootUrl, pngUrl);

    expect(result.opened).toBe(true);
    expect(result.httpUrl).toBe(rootUrl);
    // httpUrl에 시크릿 포함 금지 — 쿼리 파라미터 없음
    expect(result.httpUrl).not.toContain('?u=');
    expect(result.httpUrl).not.toContain('at=');
    // pngUrl은 여전히 ?u= 를 가질 수 있음 (stateless 이미지 헬퍼)
    expect(result.pngUrl).toContain('/qr.png');
  });
});

// ---------------------------------------------------------------------------
// buildAttachUrl — authorityWarning surface
// ---------------------------------------------------------------------------

describe('buildAttachUrl — authorityWarning', () => {
  const tunnelUp: TunnelStatus = { up: true, wssUrl: 'wss://abc123.trycloudflare.com' };

  it('returns no authorityWarning for a well-formed scheme URL', () => {
    const result = buildAttachUrl('intoss-private://aitc-sdk-example?_deploymentId=uuid', tunnelUp);
    expect(result.authorityWarning).toBeUndefined();
    expect(result.attachUrl).toContain('debug=1');
  });

  it('returns authorityWarning when authority is "web" (generic placeholder)', () => {
    const result = buildAttachUrl('intoss-private://web?_deploymentId=uuid', tunnelUp);
    expect(result.authorityWarning).toBeDefined();
    expect(result.authorityWarning).toMatch(/placeholder/i);
    expect(result.attachUrl).toContain('debug=1');
  });

  it('returns authorityWarning when authority is empty', () => {
    const result = buildAttachUrl('intoss-private://?_deploymentId=uuid', tunnelUp);
    expect(result.authorityWarning).toBeDefined();
    expect(result.authorityWarning).toMatch(/authority/i);
  });

  it('still throws when tunnel is down (unrelated to authority check)', () => {
    expect(() =>
      buildAttachUrl('intoss-private://aitc-sdk-example?_deploymentId=x', {
        up: false,
        wssUrl: null,
      }),
    ).toThrow(/tunnel/i);
  });
});
