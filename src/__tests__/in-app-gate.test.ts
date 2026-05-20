/**
 * Unit tests for the 3-layer debug activation gate.
 *
 * Covers every row of the decision matrix from
 * docs/superpowers/specs/2026-05-18-in-app-debug-mcp.md plus edge cases.
 * No real device, no Chii, no WebSocket — pure logic only.
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
// Layer A — build-time gate
// ---------------------------------------------------------------------------

describe('Layer A — build-time gate', () => {
  it('blocks when isDebugBuild=false, regardless of query params', () => {
    const result = evaluateDebugGate({ isDebugBuild: false, searchParams: VALID_PARAMS });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('build');
  });

  it('blocks even with all correct params if isDebugBuild=false', () => {
    const result = evaluateDebugGate({
      isDebugBuild: false,
      searchParams: params('_deploymentId=uuid&debug=1&relay=wss://relay.example.com/'),
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('build');
  });

  it('does not block when isDebugBuild=true and other layers pass', () => {
    const result = evaluateDebugGate({ isDebugBuild: true, searchParams: VALID_PARAMS });
    expect(result.attach).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Layer B — runtime entry gate (_deploymentId)
// ---------------------------------------------------------------------------

describe('Layer B — runtime entry gate (_deploymentId)', () => {
  it('blocks when _deploymentId is absent', () => {
    const result = evaluateDebugGate({
      isDebugBuild: true,
      searchParams: params('debug=1&relay=wss://relay.example.com/'),
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('entry');
  });

  it('blocks when _deploymentId is an empty string', () => {
    const result = evaluateDebugGate({
      isDebugBuild: true,
      searchParams: params('_deploymentId=&debug=1&relay=wss://relay.example.com/'),
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('entry');
  });

  it('blocks when query string is entirely empty', () => {
    const result = evaluateDebugGate({ isDebugBuild: true, searchParams: params('') });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('entry');
  });

  it('passes when _deploymentId is a UUID-style value', () => {
    const result = evaluateDebugGate({
      isDebugBuild: true,
      searchParams: params(
        '_deploymentId=019e3b40-abcd-1234-efgh-000000000001&debug=1&relay=wss://r.example.com/',
      ),
    });
    expect(result.attach).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Layer C — explicit opt-in gate (debug=1 + relay)
// ---------------------------------------------------------------------------

describe('Layer C — opt-in gate (debug=1)', () => {
  it('blocks when debug param is absent', () => {
    const result = evaluateDebugGate({
      isDebugBuild: true,
      searchParams: params('_deploymentId=uuid&relay=wss://relay.example.com/'),
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('opt-in');
  });

  it('blocks when debug=0', () => {
    const result = evaluateDebugGate({
      isDebugBuild: true,
      searchParams: params('_deploymentId=uuid&debug=0&relay=wss://relay.example.com/'),
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('opt-in');
  });

  it('blocks when debug is an empty string', () => {
    const result = evaluateDebugGate({
      isDebugBuild: true,
      searchParams: params('_deploymentId=uuid&debug=&relay=wss://relay.example.com/'),
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('opt-in');
  });

  it('blocks when debug=true (string, not "1")', () => {
    const result = evaluateDebugGate({
      isDebugBuild: true,
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
      isDebugBuild: true,
      searchParams: params('_deploymentId=uuid&debug=1'),
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('blocks when relay is an empty string', () => {
    const result = evaluateDebugGate({
      isDebugBuild: true,
      searchParams: params('_deploymentId=uuid&debug=1&relay='),
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('blocks when relay is not a valid URL', () => {
    const result = evaluateDebugGate({
      isDebugBuild: true,
      searchParams: params('_deploymentId=uuid&debug=1&relay=not-a-url'),
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('blocks when relay uses http: scheme', () => {
    const result = evaluateDebugGate({
      isDebugBuild: true,
      searchParams: params('_deploymentId=uuid&debug=1&relay=http://relay.example.com/'),
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('blocks when relay uses https: scheme', () => {
    const result = evaluateDebugGate({
      isDebugBuild: true,
      searchParams: params('_deploymentId=uuid&debug=1&relay=https://relay.example.com/'),
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('blocks when relay uses plain ws: (no TLS)', () => {
    const result = evaluateDebugGate({
      isDebugBuild: true,
      searchParams: params('_deploymentId=uuid&debug=1&relay=ws://relay.example.com/'),
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('blocks when relay is a random word', () => {
    const result = evaluateDebugGate({
      isDebugBuild: true,
      searchParams: params('_deploymentId=uuid&debug=1&relay=foobar'),
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('passes when relay uses wss: scheme', () => {
    const result = evaluateDebugGate({
      isDebugBuild: true,
      searchParams: params('_deploymentId=uuid&debug=1&relay=wss://relay.example.com/'),
    });
    expect(result.attach).toBe(true);
  });

  it('accepts a trycloudflare wss URL (typical Phase 1 value)', () => {
    const result = evaluateDebugGate({
      isDebugBuild: true,
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
      isDebugBuild: true,
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
      isDebugBuild: true,
      searchParams: params('_deploymentId=019e3b40-the-real-id&debug=1&relay=wss://r.example.com/'),
    });
    expect(result.attach).toBe(true);
    if (result.attach) {
      expect(result.deploymentId).toBe('019e3b40-the-real-id');
    }
  });

  it('tolerates extra unrelated query params', () => {
    const result = evaluateDebugGate({
      isDebugBuild: true,
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
  it('row: release / any / any → BLOCKED (build)', () => {
    const result = evaluateDebugGate({ isDebugBuild: false, searchParams: VALID_PARAMS });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('build');
  });

  it('row: dogfood / _deploymentId absent / any → BLOCKED (entry)', () => {
    const result = evaluateDebugGate({
      isDebugBuild: true,
      searchParams: params('debug=1&relay=wss://r.example.com/'),
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('entry');
  });

  it('row: dogfood / _deploymentId present / debug absent → BLOCKED (opt-in)', () => {
    const result = evaluateDebugGate({
      isDebugBuild: true,
      searchParams: params('_deploymentId=uuid&relay=wss://r.example.com/'),
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('opt-in');
  });

  it('row: dogfood / _deploymentId present / debug=1 / relay absent → BLOCKED (invalid-relay)', () => {
    const result = evaluateDebugGate({
      isDebugBuild: true,
      searchParams: params('_deploymentId=uuid&debug=1'),
    });
    expect(result.attach).toBe(false);
    if (!result.attach) expect(result.reason).toBe('invalid-relay');
  });

  it('row: dogfood / _deploymentId present / debug=1 / valid wss relay → ATTACH', () => {
    const result = evaluateDebugGate({
      isDebugBuild: true,
      searchParams: params('_deploymentId=uuid&debug=1&relay=wss://r.example.com/'),
    });
    expect(result.attach).toBe(true);
  });
});
