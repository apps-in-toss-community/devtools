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
import { evaluateDebugGate } from '../in-app/gate.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

/** A valid dogfood gate-passing set of query params. */
const VALID_PARAMS = params(
  '_deploymentId=019e3b40-abcd-1234-efgh-000000000001&debug=1&relay=wss%3A%2F%2Fabc.trycloudflare.com%2F',
);

// ---------------------------------------------------------------------------
// Layer B — runtime entry gate (_deploymentId)
// ---------------------------------------------------------------------------

describe('Layer B — runtime entry gate (_deploymentId)', () => {
  it('blocks when _deploymentId is absent', () => {
    const result = evaluateDebugGate({
      searchParams: params('debug=1&relay=wss://relay.example.com/'),
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('entry');
  });

  it('blocks when _deploymentId is an empty string', () => {
    const result = evaluateDebugGate({
      searchParams: params('_deploymentId=&debug=1&relay=wss://relay.example.com/'),
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('entry');
  });

  it('blocks when query string is entirely empty', () => {
    const result = evaluateDebugGate({ searchParams: params('') });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('entry');
  });

  it('passes when _deploymentId is a UUID-style value', () => {
    const result = evaluateDebugGate({
      searchParams: params(
        '_deploymentId=019e3b40-abcd-1234-efgh-000000000001&debug=1&relay=wss://r.example.com/',
      ),
    });
    expect(result.attach).toBe(true);
  });

  it('passes the canonical valid param set', () => {
    const result = evaluateDebugGate({ searchParams: VALID_PARAMS });
    expect(result.attach).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Layer C — explicit opt-in gate (debug=1 + relay)
// ---------------------------------------------------------------------------

describe('Layer C — opt-in gate (debug=1)', () => {
  it('blocks when debug param is absent', () => {
    const result = evaluateDebugGate({
      searchParams: params('_deploymentId=uuid&relay=wss://relay.example.com/'),
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('opt-in');
  });

  it('blocks when debug=0', () => {
    const result = evaluateDebugGate({
      searchParams: params('_deploymentId=uuid&debug=0&relay=wss://relay.example.com/'),
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('opt-in');
  });

  it('blocks when debug is an empty string', () => {
    const result = evaluateDebugGate({
      searchParams: params('_deploymentId=uuid&debug=&relay=wss://relay.example.com/'),
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('opt-in');
  });

  it('blocks when debug=true (string, not "1")', () => {
    const result = evaluateDebugGate({
      searchParams: params('_deploymentId=uuid&debug=true&relay=wss://relay.example.com/'),
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('opt-in');
  });
});

// ---------------------------------------------------------------------------
// Layer C — relay URL validation
// ---------------------------------------------------------------------------

describe('Layer C — relay URL validation', () => {
  it('blocks when relay param is absent', () => {
    const result = evaluateDebugGate({
      searchParams: params('_deploymentId=uuid&debug=1'),
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('blocks when relay is an empty string', () => {
    const result = evaluateDebugGate({
      searchParams: params('_deploymentId=uuid&debug=1&relay='),
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('blocks when relay is not a valid URL', () => {
    const result = evaluateDebugGate({
      searchParams: params('_deploymentId=uuid&debug=1&relay=not-a-url'),
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('blocks when relay uses http: scheme', () => {
    const result = evaluateDebugGate({
      searchParams: params('_deploymentId=uuid&debug=1&relay=http://relay.example.com/'),
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('blocks when relay uses https: scheme', () => {
    const result = evaluateDebugGate({
      searchParams: params('_deploymentId=uuid&debug=1&relay=https://relay.example.com/'),
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('blocks when relay uses plain ws: (no TLS)', () => {
    const result = evaluateDebugGate({
      searchParams: params('_deploymentId=uuid&debug=1&relay=ws://relay.example.com/'),
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('blocks when relay is a random word', () => {
    const result = evaluateDebugGate({
      searchParams: params('_deploymentId=uuid&debug=1&relay=foobar'),
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('passes when relay uses wss: scheme', () => {
    const result = evaluateDebugGate({
      searchParams: params('_deploymentId=uuid&debug=1&relay=wss://relay.example.com/'),
    });
    expect(result.attach).toBe(true);
  });

  it('accepts a trycloudflare wss URL (typical Phase 1 value)', () => {
    const result = evaluateDebugGate({
      searchParams: params('_deploymentId=019e3b40&debug=1&relay=wss://abc-def.trycloudflare.com/'),
    });
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
    const result = evaluateDebugGate({
      searchParams: params(
        '_deploymentId=deploy-123&debug=1&relay=wss%3A%2F%2Frelay.example.com%2Fpath',
      ),
    });
    expect(result.attach).toBe(true);
    if (result.attach) {
      expect(result.relayUrl).toBe('wss://relay.example.com/path');
    }
  });

  it('exposes deploymentId from the _deploymentId param', () => {
    const result = evaluateDebugGate({
      searchParams: params('_deploymentId=019e3b40-the-real-id&debug=1&relay=wss://r.example.com/'),
    });
    expect(result.attach).toBe(true);
    if (result.attach) {
      expect(result.deploymentId).toBe('019e3b40-the-real-id');
    }
  });

  it('tolerates extra unrelated query params', () => {
    const result = evaluateDebugGate({
      searchParams: params(
        '_deploymentId=uuid&debug=1&relay=wss://r.example.com/&foo=bar&extra=123',
      ),
    });
    expect(result.attach).toBe(true);
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

  it('row: dogfood / _deploymentId absent / any → BLOCKED (entry)', () => {
    const result = evaluateDebugGate({
      searchParams: params('debug=1&relay=wss://r.example.com/'),
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('entry');
  });

  it('row: dogfood / _deploymentId present / debug absent → BLOCKED (opt-in)', () => {
    const result = evaluateDebugGate({
      searchParams: params('_deploymentId=uuid&relay=wss://r.example.com/'),
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('opt-in');
  });

  it('row: dogfood / _deploymentId present / debug=1 / relay absent → BLOCKED (invalid-relay)', () => {
    const result = evaluateDebugGate({
      searchParams: params('_deploymentId=uuid&debug=1'),
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('row: dogfood / _deploymentId present / debug=1 / valid wss relay → ATTACH', () => {
    const result = evaluateDebugGate({
      searchParams: params('_deploymentId=uuid&debug=1&relay=wss://r.example.com/'),
    });
    expect(result.attach).toBe(true);
  });
});
