// Unit tests for launcher self-target (issue #531, #535) — pure-function and
// jsdom DOM injection coverage.
//
// Collected by vitest via the `*.vitest.ts` include in vitest.config.ts (same
// pattern as entry.vitest.ts / letterbox.vitest.ts / navbar.vitest.ts).
//
// Pure functions (parseSelfDebugParams, deriveSelfTargetScriptUrl) are tested
// without any DOM. The in-app scan path (issue #535) feeds showLive's
// launcherSearch (extractLauncherSearch output) into parseSelfDebugParams —
// launcher-style URL extraction is covered by navbar.vitest.ts.
//
// injectSelfTarget runs under jsdom (document is available) and is tested here
// for the selfAttached guard (issue #535: double-scan single-inject invariant).

import { afterEach, describe, expect, it } from 'vitest';
import {
  _resetSelfAttachedForTest,
  deriveSelfTargetScriptUrl,
  injectSelfTarget,
  parseSelfDebugParams,
} from './selfdebug.js';

const RELAY_WSS = 'wss://abc-def.trycloudflare.com/relay';

// ---------------------------------------------------------------------------
// parseSelfDebugParams
// ---------------------------------------------------------------------------

describe('parseSelfDebugParams — opt-in gating', () => {
  it('no params → disabled', () => {
    expect(parseSelfDebugParams('')).toEqual({ enabled: false });
  });

  it('selfdebug absent, relay present → disabled (opt-in required)', () => {
    expect(parseSelfDebugParams(`?relay=${encodeURIComponent(RELAY_WSS)}`)).toEqual({
      enabled: false,
    });
  });

  it('selfdebug=0 → disabled', () => {
    expect(parseSelfDebugParams(`?selfdebug=0&relay=${encodeURIComponent(RELAY_WSS)}`)).toEqual({
      enabled: false,
    });
  });

  it('selfdebug=1, relay absent → disabled (relay required)', () => {
    expect(parseSelfDebugParams('?selfdebug=1')).toEqual({ enabled: false });
  });

  it('selfdebug=1, relay empty → disabled', () => {
    expect(parseSelfDebugParams('?selfdebug=1&relay=')).toEqual({ enabled: false });
  });

  it('selfdebug=1, relay not wss: (https:) → disabled', () => {
    expect(parseSelfDebugParams('?selfdebug=1&relay=https://abc.trycloudflare.com/relay')).toEqual({
      enabled: false,
    });
  });

  it('selfdebug=1, relay malformed → disabled', () => {
    expect(parseSelfDebugParams('?selfdebug=1&relay=not-a-url')).toEqual({ enabled: false });
  });
});

describe('parseSelfDebugParams — enabled paths', () => {
  it('selfdebug=1, valid wss relay, no at → enabled, atCode empty', () => {
    const result = parseSelfDebugParams(`?selfdebug=1&relay=${encodeURIComponent(RELAY_WSS)}`);
    expect(result).toEqual({
      enabled: true,
      params: { relayUrl: RELAY_WSS, atCode: '' },
    });
  });

  it('selfdebug=1, valid wss relay, at present → enabled, atCode forwarded', () => {
    const result = parseSelfDebugParams(
      `?selfdebug=1&relay=${encodeURIComponent(RELAY_WSS)}&at=123456`,
    );
    expect(result).toEqual({
      enabled: true,
      params: { relayUrl: RELAY_WSS, atCode: '123456' },
    });
  });

  it('extra params (debug=1, url=) do not affect the result', () => {
    const result = parseSelfDebugParams(
      `?selfdebug=1&debug=1&relay=${encodeURIComponent(RELAY_WSS)}&url=https://example.com&at=999000`,
    );
    expect(result).toEqual({
      enabled: true,
      params: { relayUrl: RELAY_WSS, atCode: '999000' },
    });
  });
});

// ---------------------------------------------------------------------------
// deriveSelfTargetScriptUrl
// ---------------------------------------------------------------------------

describe('deriveSelfTargetScriptUrl', () => {
  it('wss: → https:, path /target.js, search/hash stripped', () => {
    expect(deriveSelfTargetScriptUrl('wss://abc.trycloudflare.com/relay?foo=bar#h', '')).toBe(
      'https://abc.trycloudflare.com/target.js',
    );
  });

  it('with atCode → /at/<code>/target.js', () => {
    expect(deriveSelfTargetScriptUrl('wss://abc.trycloudflare.com/', '123456')).toBe(
      'https://abc.trycloudflare.com/at/123456/target.js',
    );
  });

  it('atCode URL-encodes special chars', () => {
    expect(deriveSelfTargetScriptUrl('wss://abc.trycloudflare.com/', 'a/b=c')).toBe(
      'https://abc.trycloudflare.com/at/a%2Fb%3Dc/target.js',
    );
  });

  it('host and port are preserved', () => {
    expect(deriveSelfTargetScriptUrl('wss://host.example.com:9100/relay', '')).toBe(
      'https://host.example.com:9100/target.js',
    );
  });
});

// ---------------------------------------------------------------------------
// injectSelfTarget — selfAttached guard (issue #535)
// Runs under jsdom (document is available in vitest environment).
// ---------------------------------------------------------------------------

describe('injectSelfTarget — selfAttached guard', () => {
  afterEach(() => {
    // Clean up injected scripts and reset the module-level guard so each test
    // starts from a clean slate. Remove all <script> elements from head to undo
    // any injections performed during the test.
    for (const el of Array.from(document.head.querySelectorAll('script'))) {
      el.remove();
    }
    _resetSelfAttachedForTest();
  });

  const PARAMS = { relayUrl: RELAY_WSS, atCode: '' };

  it('injects a <script> tag on first call', () => {
    injectSelfTarget(PARAMS);
    const expectedSrc = `https://abc-def.trycloudflare.com/target.js`;
    const scripts = document.querySelectorAll<HTMLScriptElement>(`script[src="${expectedSrc}"]`);
    expect(scripts.length).toBe(1);
  });

  it('does NOT inject a second <script> on duplicate call (selfAttached guard)', () => {
    injectSelfTarget(PARAMS);
    injectSelfTarget(PARAMS);
    const expectedSrc = `https://abc-def.trycloudflare.com/target.js`;
    const scripts = document.querySelectorAll<HTMLScriptElement>(`script[src="${expectedSrc}"]`);
    expect(scripts.length).toBe(1);
  });

  it('does NOT inject after a second selfdebug QR scan (simulate double-scan)', () => {
    // First scan
    injectSelfTarget(PARAMS);
    // Second scan — would happen when user rescans a selfdebug QR while one
    // is already active. The selfAttached guard must block the second inject.
    const PARAMS2 = { relayUrl: 'wss://other-relay.trycloudflare.com/r', atCode: '111111' };
    injectSelfTarget(PARAMS2);

    // Only the first script should exist
    const src1 = `https://abc-def.trycloudflare.com/target.js`;
    const src2 = `https://other-relay.trycloudflare.com/at/111111/target.js`;
    expect(document.querySelectorAll(`script[src="${src1}"]`).length).toBe(1);
    expect(document.querySelectorAll(`script[src="${src2}"]`).length).toBe(0);
  });

  it('injects with atCode when provided', () => {
    injectSelfTarget({ relayUrl: RELAY_WSS, atCode: '654321' });
    const expectedSrc = `https://abc-def.trycloudflare.com/at/654321/target.js`;
    expect(
      document.querySelectorAll<HTMLScriptElement>(`script[src="${expectedSrc}"]`).length,
    ).toBe(1);
  });
});
