/**
 * Tests for devtools-opener: Chrome DevTools URL assembly, opt-out guard,
 * and AutoDevtoolsOpener session-once semantics.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AutoDevtoolsOpener,
  buildChromeDevtoolsUrl,
  isAutoDevtoolsDisabled,
} from '../devtools-opener.js';

// ---------------------------------------------------------------------------
// buildChromeDevtoolsUrl
// ---------------------------------------------------------------------------

describe('buildChromeDevtoolsUrl', () => {
  it('strips wss:// prefix and assembles inspector URL with default panel', () => {
    const url = buildChromeDevtoolsUrl('wss://abc.trycloudflare.com');
    expect(url).toContain('chrome-devtools-frontend.appspot.com');
    expect(url).toContain('wss=abc.trycloudflare.com');
    expect(url).toContain('panel=console');
    expect(url).not.toContain('wss://');
  });

  it('accepts a custom panel', () => {
    const url = buildChromeDevtoolsUrl('wss://abc.trycloudflare.com', 'sources');
    expect(url).toContain('panel=sources');
  });

  it('handles wss:// with a path segment', () => {
    const url = buildChromeDevtoolsUrl('wss://abc.trycloudflare.com/client/x?target=y');
    expect(url).toContain('wss=abc.trycloudflare.com');
  });

  it('is case-insensitive on the wss:// prefix', () => {
    const url = buildChromeDevtoolsUrl('WSS://abc.trycloudflare.com');
    expect(url).not.toContain('WSS://');
    expect(url).toContain('wss=abc.trycloudflare.com');
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
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    delete process.env.AIT_AUTO_DEVTOOLS;
  });

  it('opens once and marks _opened=true', () => {
    const opener = new AutoDevtoolsOpener();
    // We don't actually open a browser in tests; we just verify the guard logic.
    // Patch openUrlInBrowser to a no-op by calling open() with a relay env
    // and checking stderr output (which is the observable side-effect in tests).
    opener.open('wss://abc.trycloudflare.com', 'relay');
    expect(opener.opened).toBe(true);
    expect(stderrOutput).toContain('Chrome DevTools URL');
    expect(stderrOutput).toContain('abc.trycloudflare.com');
  });

  it('is a no-op on second call (duplicate guard)', () => {
    const opener = new AutoDevtoolsOpener();
    opener.open('wss://abc.trycloudflare.com', 'relay');
    stderrOutput = '';
    opener.open('wss://abc.trycloudflare.com', 'relay');
    // Second call should not write to stderr.
    expect(stderrOutput).toBe('');
    expect(opener.opened).toBe(true);
  });

  it('is a no-op when env is mock', () => {
    const opener = new AutoDevtoolsOpener();
    opener.open('wss://abc.trycloudflare.com', 'mock');
    expect(opener.opened).toBe(false);
    expect(stderrOutput).toBe('');
  });

  it('is a no-op when wssRelayUrl is null', () => {
    const opener = new AutoDevtoolsOpener();
    opener.open(null, 'relay');
    expect(opener.opened).toBe(false);
    expect(stderrOutput).toBe('');
  });

  it('is a no-op when wssRelayUrl is empty string', () => {
    const opener = new AutoDevtoolsOpener();
    opener.open('', 'relay');
    expect(opener.opened).toBe(false);
    expect(stderrOutput).toBe('');
  });

  it('is a no-op when AIT_AUTO_DEVTOOLS=0', () => {
    process.env.AIT_AUTO_DEVTOOLS = '0';
    const opener = new AutoDevtoolsOpener();
    opener.open('wss://abc.trycloudflare.com', 'relay');
    expect(opener.opened).toBe(false);
    expect(stderrOutput).toBe('');
  });

  it('writes the DevTools URL to stderr before attempting browser open', () => {
    const opener = new AutoDevtoolsOpener();
    opener.open('wss://tunnel.trycloudflare.com', 'relay');
    expect(stderrOutput).toContain('chrome-devtools-frontend.appspot.com');
    expect(stderrOutput).toContain('tunnel.trycloudflare.com');
  });
});
