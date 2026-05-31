/**
 * Unit tests for `buildAttachUrl` in tools.ts.
 *
 * Covers:
 *   - TOTP disabled (no secret): `attachUrl` has no `at=`, no `totp` field.
 *   - TOTP enabled (secret provided): `attachUrl` contains `at=<code>`,
 *     `totp.enabled`, `totp.ttlSeconds`, and `totp.expiresAt` are set.
 *   - Tunnel-down path: throws with a clear message.
 *
 * SECRET-HANDLING: Tests use a dummy hex secret — no real secret value.
 * Assertions check only structure (field presence/type), not the actual
 * code value, to avoid hard-coding a derivable secret value in the test suite.
 */
import { describe, expect, it } from 'vitest';
import { buildAttachUrl, type TunnelStatus } from '../tools.js';

/** Dummy 32-byte hex secret — not a real secret. */
const DUMMY_SECRET = 'deadbeef'.repeat(8);

const LIVE_TUNNEL: TunnelStatus = {
  up: true,
  wssUrl: 'wss://abc-def.trycloudflare.com',
};

const DOWN_TUNNEL: TunnelStatus = {
  up: false,
  wssUrl: null,
};

const SCHEME_URL = 'intoss-private://aitc-sdk-example?_deploymentId=019e3b40-uuid';

// ---------------------------------------------------------------------------
// Tunnel-down guard
// ---------------------------------------------------------------------------

describe('buildAttachUrl — tunnel down', () => {
  it('throws when tunnel is not up', () => {
    expect(() => buildAttachUrl(SCHEME_URL, DOWN_TUNNEL)).toThrow(/tunnel-down/);
  });

  it('throws when tunnel.wssUrl is null even if up=true', () => {
    const weirdTunnel: TunnelStatus = { up: true, wssUrl: null };
    expect(() => buildAttachUrl(SCHEME_URL, weirdTunnel)).toThrow(/tunnel-down/);
  });
});

// ---------------------------------------------------------------------------
// TOTP disabled (no secret)
// ---------------------------------------------------------------------------

describe('buildAttachUrl — TOTP disabled', () => {
  it('returns attachUrl with debug=1 and relay spliced, no at= param', () => {
    const result = buildAttachUrl(SCHEME_URL, LIVE_TUNNEL);
    expect(result.attachUrl).toContain('debug=1');
    expect(result.attachUrl).toContain('relay=');
    expect(result.attachUrl).not.toContain('at=');
  });

  it('does not include a totp field', () => {
    const result = buildAttachUrl(SCHEME_URL, LIVE_TUNNEL);
    expect(result.totp).toBeUndefined();
  });

  it('returns relayUrl equal to the tunnel wssUrl', () => {
    const result = buildAttachUrl(SCHEME_URL, LIVE_TUNNEL);
    expect(result.relayUrl).toBe(LIVE_TUNNEL.wssUrl);
  });
});

// ---------------------------------------------------------------------------
// TOTP enabled (secret provided)
// ---------------------------------------------------------------------------

describe('buildAttachUrl — TOTP enabled', () => {
  it('splices at=<code> into attachUrl when totpSecret is provided', () => {
    const result = buildAttachUrl(SCHEME_URL, LIVE_TUNNEL, DUMMY_SECRET);
    // The `at=` param must be present and be a 6-digit string.
    const match = result.attachUrl.match(/[?&]at=(\d{6})(&|$)/);
    expect(match).not.toBeNull();
  });

  it('includes totp.enabled = true', () => {
    const result = buildAttachUrl(SCHEME_URL, LIVE_TUNNEL, DUMMY_SECRET);
    expect(result.totp?.enabled).toBe(true);
  });

  it('includes totp.ttlSeconds = 30', () => {
    const result = buildAttachUrl(SCHEME_URL, LIVE_TUNNEL, DUMMY_SECRET);
    expect(result.totp?.ttlSeconds).toBe(30);
  });

  it('includes totp.expiresAt as a future ISO timestamp', () => {
    const before = Date.now();
    const result = buildAttachUrl(SCHEME_URL, LIVE_TUNNEL, DUMMY_SECRET);
    const after = Date.now();

    const expiresAt = result.totp?.expiresAt;
    expect(typeof expiresAt).toBe('string');
    const expiresMs = new Date(expiresAt as string).getTime();
    // expiresAt must be > before (in the future relative to call time)
    expect(expiresMs).toBeGreaterThan(before);
    // expiresAt must be within the next two 30-second steps from `after`.
    expect(expiresMs).toBeLessThanOrEqual(after + 2 * 30_000);
  });

  it('does not duplicate at= when called twice on the same schemeUrl', () => {
    const first = buildAttachUrl(SCHEME_URL, LIVE_TUNNEL, DUMMY_SECRET);
    // Feed the first result's attachUrl back in as the scheme URL.
    const second = buildAttachUrl(first.attachUrl, LIVE_TUNNEL, DUMMY_SECRET);
    const atMatches = second.attachUrl.match(/(^|[?&])at=/g);
    expect(atMatches).toHaveLength(1);
  });

  it('still sets debug=1 and relay= alongside at=', () => {
    const result = buildAttachUrl(SCHEME_URL, LIVE_TUNNEL, DUMMY_SECRET);
    expect(result.attachUrl).toContain('debug=1');
    expect(result.attachUrl).toContain('relay=');
  });
});

// ---------------------------------------------------------------------------
// Empty / blank secret — treated as TOTP disabled
// ---------------------------------------------------------------------------

describe('buildAttachUrl — empty totpSecret', () => {
  it('treats empty string as no secret (no at= splice, no totp field)', () => {
    const result = buildAttachUrl(SCHEME_URL, LIVE_TUNNEL, '');
    expect(result.attachUrl).not.toContain('at=');
    expect(result.totp).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// authorityWarning passthrough
// ---------------------------------------------------------------------------

describe('buildAttachUrl — authority warning', () => {
  it('returns authorityWarning for a suspicious scheme host', () => {
    const suspiciousUrl = 'intoss-private://web?_deploymentId=x';
    const result = buildAttachUrl(suspiciousUrl, LIVE_TUNNEL);
    expect(result.authorityWarning).toBeTruthy();
  });

  it('does not set authorityWarning for a well-formed URL', () => {
    const result = buildAttachUrl(SCHEME_URL, LIVE_TUNNEL);
    expect(result.authorityWarning).toBeUndefined();
  });
});
