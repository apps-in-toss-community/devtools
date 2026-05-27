/**
 * Tests for QR PNG + browser open functionality (issue #221):
 *   - canOpenBrowser: platform/env heuristic
 *   - openQrInBrowser: file writes (mocked) + child_process spawn (mocked)
 *   - SECRET-HANDLING: at= code must not appear in file paths or result text
 *   - buildAttachUrl: authorityWarning surface
 */
import { tmpdir } from 'node:os';
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
    // Clone env so we can mutate it safely.
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    // Restore platform via Object.defineProperty
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
// openQrInBrowser — file writes + spawn (mocked)
// ---------------------------------------------------------------------------

// Mock qrcode so we don't need a real QR matrix.
vi.mock('qrcode', () => ({
  default: {
    create: (_input: string) => ({
      modules: { size: 1, data: new Uint8Array([1]) },
    }),
    toFile: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock node:fs so we can inspect writeFileSync calls without touching disk.
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return { ...original, writeFileSync: vi.fn() };
});

// Mock node:child_process to intercept spawnSync without opening a real browser.
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return { ...original, spawnSync: vi.fn().mockReturnValue({ error: null }) };
});

describe('openQrInBrowser', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls QRCode.toFile with the attach URL and returns opened:true', async () => {
    const { default: QRCode } = await import('qrcode');
    const { spawnSync } = await import('node:child_process');

    const url =
      'intoss-private://aitc-sdk-example?_deploymentId=test-uuid&debug=1&relay=wss%3A%2F%2Fx.trycloudflare.com';
    const result = await openQrInBrowser(url, 'test-uuid');

    expect(result.opened).toBe(true);
    expect(result.pngPath).toMatch(/ait-qr-\d+\.png$/);
    expect(result.htmlPath).toMatch(/ait-qr-\d+\.html$/);
    expect(result.error).toBeUndefined();

    // QRCode.toFile must have been called with the attach URL.
    expect(QRCode.toFile).toHaveBeenCalledOnce();
    const [calledPath, calledText] = (QRCode.toFile as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(calledPath).toBe(result.pngPath);
    expect(calledText).toBe(url);

    // spawnSync must have been called (browser opener).
    expect(spawnSync).toHaveBeenCalledOnce();
  });

  it('file names are derived from timestamp, NOT from the attach URL (SECRET guard)', async () => {
    // The attach URL may contain `at=<totp-code>`. The file name must NOT include
    // any fragment of the code.
    const urlWithAt =
      'intoss-private://aitc-sdk-example?_deploymentId=uuid&debug=1&relay=wss%3A%2F%2Fx.trycloudflare.com&at=123456';

    const result = await openQrInBrowser(urlWithAt, 'uuid');

    // File names must not contain the TOTP code "123456" or "at=" fragment.
    expect(result.pngPath).not.toContain('123456');
    expect(result.pngPath).not.toContain('at=');
    expect(result.htmlPath).not.toContain('123456');
    expect(result.htmlPath).not.toContain('at=');
  });

  it('HTML file contains the PNG path as image src (so browser can render it)', async () => {
    const { writeFileSync } = await import('node:fs');

    const url =
      'intoss-private://aitc-sdk-example?_deploymentId=test-uuid&debug=1&relay=wss%3A%2F%2Fx.trycloudflare.com';
    const result = await openQrInBrowser(url, 'test-uuid');

    expect(writeFileSync).toHaveBeenCalledOnce();
    const [calledPath, htmlContent] = (writeFileSync as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(calledPath).toBe(result.htmlPath);
    expect(typeof htmlContent).toBe('string');
    // HTML must reference the PNG so the browser can display it.
    expect(htmlContent).toContain(result.pngPath);
  });

  it('files are written under os.tmpdir()', async () => {
    const url =
      'intoss-private://aitc-sdk-example?_deploymentId=x&debug=1&relay=wss%3A%2F%2Fx.trycloudflare.com';
    const result = await openQrInBrowser(url);

    const tmp = tmpdir();
    expect(result.pngPath.startsWith(tmp)).toBe(true);
    expect(result.htmlPath.startsWith(tmp)).toBe(true);
  });

  it('returns opened:false with error when QRCode.toFile rejects', async () => {
    const { default: QRCode } = await import('qrcode');
    (QRCode.toFile as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('disk full'));

    const url =
      'intoss-private://aitc-sdk-example?_deploymentId=x&debug=1&relay=wss%3A%2F%2Fx.trycloudflare.com';
    const result = await openQrInBrowser(url);

    expect(result.opened).toBe(false);
    expect(result.error).toMatch(/disk full/);
  });

  it('returns opened:false with error when spawnSync returns an error', async () => {
    const { spawnSync } = await import('node:child_process');
    (spawnSync as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      error: new Error('ENOENT'),
    });

    const url =
      'intoss-private://aitc-sdk-example?_deploymentId=x&debug=1&relay=wss%3A%2F%2Fx.trycloudflare.com';
    const result = await openQrInBrowser(url);

    expect(result.opened).toBe(false);
    expect(result.error).toMatch(/ENOENT/);
  });

  it('pngPath and htmlPath share the same timestamp prefix', async () => {
    const url =
      'intoss-private://aitc-sdk-example?_deploymentId=x&debug=1&relay=wss%3A%2F%2Fx.trycloudflare.com';
    const result = await openQrInBrowser(url);

    // Both files should have the same timestamp stamp in their name.
    const pngStamp = result.pngPath.match(/ait-qr-(\d+)\.png$/)?.[1];
    const htmlStamp = result.htmlPath.match(/ait-qr-(\d+)\.html$/)?.[1];
    expect(pngStamp).toBeDefined();
    expect(htmlStamp).toBeDefined();
    expect(pngStamp).toBe(htmlStamp);
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
    // Still produces an attachUrl (non-fatal).
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
