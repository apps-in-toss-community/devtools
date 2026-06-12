// Unit tests for launcher self-target (issue #531) — pure-function coverage.
//
// Collected by vitest via the `*.vitest.ts` include in vitest.config.ts (same
// pattern as entry.vitest.ts / letterbox.vitest.ts / navbar.vitest.ts).
// No DOM access — only `parseSelfDebugParams` and `deriveSelfTargetScriptUrl`
// are exercised here (pure functions). `injectSelfTarget` and `maybeAttachSelf`
// require `document` and are covered by comments in e2e/launcher-cdp.test.ts.

import { describe, expect, it } from 'vitest';
import { deriveSelfTargetScriptUrl, parseSelfDebugParams } from './selfdebug.js';

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
