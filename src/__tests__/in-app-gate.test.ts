/**
 * Unit tests for the runtime debug activation gate (Layers B and C).
 *
 * Covers every row of the decision matrix from
 * docs/superpowers/specs/2026-05-18-in-app-debug-mcp.md plus edge cases.
 * No real device, no Chii, no WebSocket — pure logic only.
 *
 * Layer A (build-time) is intentionally NOT tested here: it is enforced by the
 * consumer's `if (__DEBUG_BUILD__)` guard around the import site, not by
 * `evaluateDebugGate`. See src/in-app/gate.ts for the rationale.
 */

import { describe, expect, it } from 'vitest';
import { evaluateDebugGate, isPrivateAppsHost, isTrycloudflareHost } from '../in-app/gate.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

/**
 * A valid dogfood host — a `*.private-apps.tossmini.com` subdomain. Layer B1
 * passes for this host. Tests that are exercising Layers B2 / C use this as
 * the default host so they isolate the layer under test; the Layer B1 block
 * below varies the host explicitly.
 */
const VALID_HOST = 'aitc-sdk-example.private-apps.tossmini.com';

/** A valid dogfood gate-passing set of query params. */
const VALID_PARAMS = params(
  '_deploymentId=019e3b40-abcd-1234-efgh-000000000001&debug=1&relay=wss%3A%2F%2Fabc.trycloudflare.com%2F',
);

/**
 * A valid env 2 (PWA) tunnel host — a `*.trycloudflare.com` quick-tunnel. Layer
 * B1 passes via the tunnel branch; B2 (`_deploymentId`) is skipped for it.
 */
const VALID_TC_HOST = 'abc-def-ghi.trycloudflare.com';

/**
 * A valid env 2 tunnel gate-passing set of query params — note: NO
 * `_deploymentId` (the tunnel has no deployed bundle).
 */
const VALID_TC_PARAMS = params('debug=1&relay=wss%3A%2F%2Fabc-def-ghi.trycloudflare.com%2F');

/**
 * Evaluate the gate with the valid dogfood host by default, so a test that
 * only varies query params does not have to restate the host every time.
 * Pass an explicit `hostname` to exercise Layer B1.
 */
function gate(searchParams: URLSearchParams, hostname: string = VALID_HOST) {
  return evaluateDebugGate({ hostname, searchParams });
}

// ---------------------------------------------------------------------------
// Layer B1 — host allowlist (the security gate)
// ---------------------------------------------------------------------------

describe('Layer B1 — host allowlist', () => {
  it('blocks a production host (no .private-apps. segment)', () => {
    const result = gate(VALID_PARAMS, 'aitc-sdk-example.apps.tossmini.com');
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('host');
  });

  it('blocks an arbitrary unrelated host', () => {
    const result = gate(VALID_PARAMS, 'example.com');
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('host');
  });

  it('blocks an empty hostname', () => {
    const result = gate(VALID_PARAMS, '');
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('host');
  });

  it('blocks a spoofed host where the suffix is not a real subdomain segment', () => {
    // `.includes()` would wrongly accept this; the suffix check does not.
    const result = gate(VALID_PARAMS, 'private-apps.tossmini.com.evil.example');
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('host');
  });

  it('blocks a bare private-apps.tossmini.com with no mini-app subdomain', () => {
    const result = gate(VALID_PARAMS, 'private-apps.tossmini.com');
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('host');
  });

  it('passes a *.private-apps.tossmini.com dogfood host', () => {
    const result = gate(VALID_PARAMS, 'aitc-sdk-example.private-apps.tossmini.com');
    expect(result.attach).toBe(true);
  });

  it('is checked before the entry gate — a bad host blocks even with no _deploymentId', () => {
    const result = gate(params('debug=1&relay=wss://r.example.com/'), 'apps.tossmini.com');
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('host');
  });
});

describe('isPrivateAppsHost', () => {
  it('accepts a *.private-apps.tossmini.com subdomain', () => {
    expect(isPrivateAppsHost('aitc-sdk-example.private-apps.tossmini.com')).toBe(true);
  });

  it('rejects a production *.apps.tossmini.com host', () => {
    expect(isPrivateAppsHost('aitc-sdk-example.apps.tossmini.com')).toBe(false);
  });

  it('rejects a suffix-spoofing host', () => {
    expect(isPrivateAppsHost('x.private-apps.tossmini.com.evil.example')).toBe(false);
  });

  it('rejects a bare private-apps.tossmini.com', () => {
    expect(isPrivateAppsHost('private-apps.tossmini.com')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isPrivateAppsHost('')).toBe(false);
  });
});

describe('isTrycloudflareHost', () => {
  it('accepts a *.trycloudflare.com subdomain (env 2 tunnel)', () => {
    expect(isTrycloudflareHost('abc-def-ghi.trycloudflare.com')).toBe(true);
  });

  it('rejects a suffix-spoofing host', () => {
    expect(isTrycloudflareHost('evil.trycloudflare.com.example.com')).toBe(false);
  });

  it('rejects a bare trycloudflare.com with no tunnel subdomain', () => {
    expect(isTrycloudflareHost('trycloudflare.com')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isTrycloudflareHost('')).toBe(false);
  });

  it('rejects a private-apps host (not a tunnel)', () => {
    expect(isTrycloudflareHost('aitc-sdk-example.private-apps.tossmini.com')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Layer B1/B2 — env 2 (PWA) trycloudflare host bypass
//
// A *.trycloudflare.com host bypasses B1 (it has no production runtime — mock
// SDK, the developer's own dev server) and skips B2 (no deployed bundle, so no
// _deploymentId). C1/C2/C3 still apply identically to the Toss path, so a
// leaked tunnel URL is still blocked by TOTP.
// ---------------------------------------------------------------------------

describe('Layer B1/B2 — trycloudflare (env 2 PWA) host bypass', () => {
  it('passes B1 for a *.trycloudflare.com host even with no _deploymentId', () => {
    const result = gate(VALID_TC_PARAMS, VALID_TC_HOST);
    expect(result.attach).toBe(true);
  });

  it('skips B2 — not blocked on entry when _deploymentId is absent', () => {
    const result = gate(params('debug=1&relay=wss://r.example.com/'), VALID_TC_HOST);
    // Must NOT be blocked with reason 'entry' — B2 does not apply to tunnels.
    if (!result.attach) expect(result.reason).not.toBe('entry');
    expect(result.attach).toBe(true);
  });

  it('returns deploymentId: "" on a tunnel attach', () => {
    const result = gate(VALID_TC_PARAMS, VALID_TC_HOST);
    expect(result.attach).toBe(true);
    if (result.attach) expect(result.deploymentId).toBe('');
  });

  it('still requires debug=1 (C1) on a tunnel host', () => {
    const result = gate(params('relay=wss://r.example.com/'), VALID_TC_HOST);
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('opt-in');
  });

  it('still requires a valid wss relay (C2) on a tunnel host', () => {
    const result = gate(params('debug=1&relay=https://r.example.com/'), VALID_TC_HOST);
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('still applies TOTP (C3) on a tunnel host when a verifier is injected', () => {
    const pass = evaluateDebugGate({
      hostname: VALID_TC_HOST,
      searchParams: params('debug=1&relay=wss://r.example.com/&at=123456'),
      verifyTotpCode: (code) => code === '123456',
    });
    expect(pass.attach).toBe(true);

    const fail = evaluateDebugGate({
      hostname: VALID_TC_HOST,
      searchParams: params('debug=1&relay=wss://r.example.com/&at=000000'),
      verifyTotpCode: (code) => code === '123456',
    });
    expect(fail.attach).toBe(false);
    if (!fail.attach) expect(fail.reason).toBe('auth');
  });

  it('blocks a suffix-spoofed trycloudflare host as host (not bypassed)', () => {
    const result = gate(VALID_TC_PARAMS, 'evil.trycloudflare.com.example.com');
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('host');
  });
});

// ---------------------------------------------------------------------------
// Layer B2 — runtime entry gate (_deploymentId)
// ---------------------------------------------------------------------------

describe('Layer B2 — runtime entry gate (_deploymentId)', () => {
  it('blocks when _deploymentId is absent', () => {
    const result = gate(params('debug=1&relay=wss://relay.example.com/'));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('entry');
  });

  it('blocks when _deploymentId is an empty string', () => {
    const result = gate(params('_deploymentId=&debug=1&relay=wss://relay.example.com/'));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('entry');
  });

  it('blocks when query string is entirely empty', () => {
    const result = gate(params(''));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('entry');
  });

  it('passes when _deploymentId is a UUID-style value', () => {
    const result = gate(
      params(
        '_deploymentId=019e3b40-abcd-1234-efgh-000000000001&debug=1&relay=wss://r.example.com/',
      ),
    );
    expect(result.attach).toBe(true);
  });

  it('passes the canonical valid param set', () => {
    const result = gate(VALID_PARAMS);
    expect(result.attach).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Layer C — explicit opt-in gate (debug=1 + relay)
// ---------------------------------------------------------------------------

describe('Layer C — opt-in gate (debug=1)', () => {
  it('blocks when debug param is absent', () => {
    const result = gate(params('_deploymentId=uuid&relay=wss://relay.example.com/'));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('opt-in');
  });

  it('blocks when debug=0', () => {
    const result = gate(params('_deploymentId=uuid&debug=0&relay=wss://relay.example.com/'));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('opt-in');
  });

  it('blocks when debug is an empty string', () => {
    const result = gate(params('_deploymentId=uuid&debug=&relay=wss://relay.example.com/'));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('opt-in');
  });

  it('blocks when debug=true (string, not "1")', () => {
    const result = gate(params('_deploymentId=uuid&debug=true&relay=wss://relay.example.com/'));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('opt-in');
  });
});

// ---------------------------------------------------------------------------
// Layer C — relay URL validation
// ---------------------------------------------------------------------------

describe('Layer C — relay URL validation', () => {
  it('blocks when relay param is absent', () => {
    const result = gate(params('_deploymentId=uuid&debug=1'));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('blocks when relay is an empty string', () => {
    const result = gate(params('_deploymentId=uuid&debug=1&relay='));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('blocks when relay is not a valid URL', () => {
    const result = gate(params('_deploymentId=uuid&debug=1&relay=not-a-url'));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('blocks when relay uses http: scheme', () => {
    const result = gate(params('_deploymentId=uuid&debug=1&relay=http://relay.example.com/'));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('blocks when relay uses https: scheme', () => {
    const result = gate(params('_deploymentId=uuid&debug=1&relay=https://relay.example.com/'));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('blocks when relay uses plain ws: (no TLS)', () => {
    const result = gate(params('_deploymentId=uuid&debug=1&relay=ws://relay.example.com/'));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('blocks when relay is a random word', () => {
    const result = gate(params('_deploymentId=uuid&debug=1&relay=foobar'));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('passes when relay uses wss: scheme', () => {
    const result = gate(params('_deploymentId=uuid&debug=1&relay=wss://relay.example.com/'));
    expect(result.attach).toBe(true);
  });

  it('accepts a trycloudflare wss URL (typical Phase 1 value)', () => {
    const result = gate(
      params('_deploymentId=019e3b40&debug=1&relay=wss://abc-def.trycloudflare.com/'),
    );
    expect(result.attach).toBe(true);
    if (result.attach) {
      expect(result.relayUrl).toBe('wss://abc-def.trycloudflare.com/');
    }
  });
});

// ---------------------------------------------------------------------------
// Attach result — field values
// ---------------------------------------------------------------------------

describe('GateResultAttach field values', () => {
  it('exposes relayUrl as the normalised wss URL', () => {
    const result = gate(
      params('_deploymentId=deploy-123&debug=1&relay=wss%3A%2F%2Frelay.example.com%2Fpath'),
    );
    expect(result.attach).toBe(true);
    if (result.attach) {
      expect(result.relayUrl).toBe('wss://relay.example.com/path');
    }
  });

  it('exposes deploymentId from the _deploymentId param', () => {
    const result = gate(
      params('_deploymentId=019e3b40-the-real-id&debug=1&relay=wss://r.example.com/'),
    );
    expect(result.attach).toBe(true);
    if (result.attach) {
      expect(result.deploymentId).toBe('019e3b40-the-real-id');
    }
  });

  it('tolerates extra unrelated query params', () => {
    const result = gate(
      params('_deploymentId=uuid&debug=1&relay=wss://r.example.com/&foo=bar&extra=123'),
    );
    expect(result.attach).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Layer C3 — TOTP auth gate (verifyTotpCode injected)
// ---------------------------------------------------------------------------

describe('Layer C3 — TOTP auth gate', () => {
  /** A verifier that always passes (TOTP disabled / always accept). */
  const alwaysPass = (_code: string) => true;
  /** A verifier that always fails (simulates invalid/expired code). */
  const alwaysFail = (_code: string) => false;
  /** A verifier that only accepts the literal string '123456'. */
  const acceptsOnly123456 = (code: string) => code === '123456';

  it('passes when verifyTotpCode is undefined (TOTP disabled)', () => {
    const result = gate(VALID_PARAMS);
    expect(result.attach).toBe(true);
  });

  it('passes when verifyTotpCode accepts the code', () => {
    const params_ = new URLSearchParams(
      '_deploymentId=uuid&debug=1&relay=wss://r.example.com/&at=123456',
    );
    const result = evaluateDebugGate({
      hostname: VALID_HOST,
      searchParams: params_,
      verifyTotpCode: acceptsOnly123456,
    });
    expect(result.attach).toBe(true);
  });

  it('blocks when verifyTotpCode rejects the code (reason: auth)', () => {
    const params_ = new URLSearchParams(
      '_deploymentId=uuid&debug=1&relay=wss://r.example.com/&at=000000',
    );
    const result = evaluateDebugGate({
      hostname: VALID_HOST,
      searchParams: params_,
      verifyTotpCode: acceptsOnly123456,
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('auth');
  });

  it('blocks when `at` param is absent and verifyTotpCode is provided', () => {
    // alwaysFail returns false for '' — same as any invalid code.
    const params_ = new URLSearchParams('_deploymentId=uuid&debug=1&relay=wss://r.example.com/');
    const result = evaluateDebugGate({
      hostname: VALID_HOST,
      searchParams: params_,
      verifyTotpCode: alwaysFail,
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('auth');
  });

  it('blocks when verifyTotpCode always fails (simulates expired code)', () => {
    const params_ = new URLSearchParams(
      '_deploymentId=uuid&debug=1&relay=wss://r.example.com/&at=999999',
    );
    const result = evaluateDebugGate({
      hostname: VALID_HOST,
      searchParams: params_,
      verifyTotpCode: alwaysFail,
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('auth');
  });

  it('auth check runs AFTER relay URL validation (invalid-relay still wins)', () => {
    const params_ = new URLSearchParams(
      '_deploymentId=uuid&debug=1&relay=http://r.example.com/&at=123456',
    );
    const result = evaluateDebugGate({
      hostname: VALID_HOST,
      searchParams: params_,
      verifyTotpCode: alwaysPass,
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('auth check runs AFTER opt-in check (opt-in still wins when debug absent)', () => {
    const params_ = new URLSearchParams('_deploymentId=uuid&relay=wss://r.example.com/&at=123456');
    const result = evaluateDebugGate({
      hostname: VALID_HOST,
      searchParams: params_,
      verifyTotpCode: alwaysPass,
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('opt-in');
  });

  it('does not surface the code value in any property of the blocked result', () => {
    const params_ = new URLSearchParams(
      '_deploymentId=uuid&debug=1&relay=wss://r.example.com/&at=SECRET_CODE',
    );
    const result = evaluateDebugGate({
      hostname: VALID_HOST,
      searchParams: params_,
      verifyTotpCode: alwaysFail,
    });
    expect(result.attach).toBe(false);
    // The reason must be an enum value, not contain any code fragment.
    if (!result.attach) {
      expect(result.reason).toBe('auth');
      expect(JSON.stringify(result)).not.toContain('SECRET_CODE');
    }
  });
});

// ---------------------------------------------------------------------------
// Full decision-matrix rows (explicit coverage)
// ---------------------------------------------------------------------------

describe('Full decision matrix', () => {
  // The `release / any / any → code absent` row is Layer A. It is not a row
  // of this function — `evaluateDebugGate` only ever runs in a debug build,
  // because the consumer's `if (__DEBUG_BUILD__)` guard DCEs the import out of
  // release bundles. There is nothing to assert about it here; the guarantee
  // is the absence of code, verified by the consumer's bundle output.

  it('row: production host / any / any → BLOCKED (host)', () => {
    const result = gate(VALID_PARAMS, 'aitc-sdk-example.apps.tossmini.com');
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('host');
  });

  it('row: private-apps host / _deploymentId absent / any → BLOCKED (entry)', () => {
    const result = gate(params('debug=1&relay=wss://r.example.com/'));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('entry');
  });

  it('row: private-apps host / _deploymentId present / debug absent → BLOCKED (opt-in)', () => {
    const result = gate(params('_deploymentId=uuid&relay=wss://r.example.com/'));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('opt-in');
  });

  it('row: private-apps host / debug=1 / relay absent → BLOCKED (invalid-relay)', () => {
    const result = gate(params('_deploymentId=uuid&debug=1'));
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('row: private-apps host / _deploymentId present / debug=1 / valid wss relay → ATTACH', () => {
    const result = gate(params('_deploymentId=uuid&debug=1&relay=wss://r.example.com/'));
    expect(result.attach).toBe(true);
  });

  it('row: trycloudflare host / _deploymentId (skipped) / debug=1 / valid wss relay → ATTACH', () => {
    const result = gate(params('debug=1&relay=wss://r.example.com/'), VALID_TC_HOST);
    expect(result.attach).toBe(true);
    if (result.attach) expect(result.deploymentId).toBe('');
  });

  it('row: trycloudflare host / debug absent → BLOCKED (opt-in), not entry', () => {
    const result = gate(params('relay=wss://r.example.com/'), VALID_TC_HOST);
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('opt-in');
  });
});
