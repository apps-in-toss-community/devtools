/**
 * Unit tests for the relay-side TOTP auth gate in startChiiRelay.
 *
 * We test `buildRelayVerifyAuth` (from debug-server.ts) directly — it is the
 * closure factory that wraps `verifyTotp` around `process.env.AIT_DEBUG_TOTP_SECRET`.
 *
 * We also test the upgrade listener branching logic by constructing minimal fake
 * `IncomingMessage`-shaped objects and verifying the 401/destroy vs. pass-through
 * behaviour. This avoids spawning a real HTTP server or loading the `chii` module.
 *
 * Note on SECRET-HANDLING: no secret value or TOTP code is logged in these tests.
 * Assertions use only boolean pass/fail and the fact that socket methods were called.
 */

import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { rewriteAtPathPrefix } from '../chii-relay.js';
import { buildRelayVerifyAuth } from '../debug-server.js';
import { generateTotp } from '../totp.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shared test secret — hex-encoded 32-byte value (arbitrary). */
const TEST_SECRET = 'deadbeef'.repeat(8); // 64 hex chars = 32 bytes

/** Build a minimal fake IncomingMessage with the given url. */
function fakeReq(url: string): IncomingMessage {
  const emitter = new EventEmitter() as IncomingMessage;
  emitter.url = url;
  return emitter;
}

/** Build a minimal fake socket with `write` and `destroy` spies. */
function fakeSocket() {
  return {
    write: vi.fn(),
    destroy: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// buildRelayVerifyAuth — returns undefined when secret is absent
// ---------------------------------------------------------------------------

describe('buildRelayVerifyAuth — no secret', () => {
  beforeEach(() => {
    delete process.env.AIT_DEBUG_TOTP_SECRET;
  });

  it('returns undefined when AIT_DEBUG_TOTP_SECRET is not set', () => {
    expect(buildRelayVerifyAuth()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildRelayVerifyAuth — returns predicate when secret is present
// ---------------------------------------------------------------------------

describe('buildRelayVerifyAuth — with secret', () => {
  beforeEach(() => {
    process.env.AIT_DEBUG_TOTP_SECRET = TEST_SECRET;
  });
  afterEach(() => {
    delete process.env.AIT_DEBUG_TOTP_SECRET;
  });

  it('returns a function when secret is set', () => {
    const verifyAuth = buildRelayVerifyAuth();
    expect(typeof verifyAuth).toBe('function');
  });

  it('returns true for a request carrying the current TOTP code in `at`', () => {
    const verifyAuth = buildRelayVerifyAuth()!;
    const now = Date.now();
    const code = generateTotp(TEST_SECRET, now);
    const req = fakeReq(`/client/id?target=t&at=${code}`);
    expect(verifyAuth(req)).toBe(true);
  });

  it('returns false for a request with a wrong `at` code', () => {
    const verifyAuth = buildRelayVerifyAuth()!;
    const req = fakeReq('/client/id?target=t&at=000000');
    // There is a 1-in-1_000_000 chance 000000 is currently valid; acceptable.
    // If it happens to be valid by coincidence, the test flakes once per million runs.
    const now = Date.now();
    const actualCode = generateTotp(TEST_SECRET, now);
    if (actualCode !== '000000') {
      expect(verifyAuth(req)).toBe(false);
    }
  });

  it('returns false when `at` param is absent', () => {
    const verifyAuth = buildRelayVerifyAuth()!;
    const req = fakeReq('/client/id?target=t');
    expect(verifyAuth(req)).toBe(false);
  });

  it('returns false when `at` param is empty', () => {
    const verifyAuth = buildRelayVerifyAuth()!;
    const req = fakeReq('/client/id?target=t&at=');
    expect(verifyAuth(req)).toBe(false);
  });

  it('returns false when req.url is empty', () => {
    const verifyAuth = buildRelayVerifyAuth()!;
    const req = fakeReq('');
    expect(verifyAuth(req)).toBe(false);
  });

  it('returns false when req.url has no query string', () => {
    const verifyAuth = buildRelayVerifyAuth()!;
    const req = fakeReq('/client/id');
    expect(verifyAuth(req)).toBe(false);
  });

  it('accepts a code from the adjacent time step (skew=1)', () => {
    const verifyAuth = buildRelayVerifyAuth()!;
    const now = Date.now();
    // Previous step code should still pass within ±1 skew.
    const prevStepCode = generateTotp(TEST_SECRET, now - 30_000);
    const req = fakeReq(`/target?at=${prevStepCode}`);
    expect(verifyAuth(req)).toBe(true);
  });

  it('accepts a code two steps old (within RELAY_VERIFY_SKEW_STEPS=6 window, #490)', () => {
    // The gate now uses skew=6, so a 2-step old code is still within the
    // acceptance window (~3-minute validity).
    const verifyAuth = buildRelayVerifyAuth()!;
    const now = Date.now();
    const twoStepsAgoCode = generateTotp(TEST_SECRET, now - 60_000);
    const req = fakeReq(`/target?at=${twoStepsAgoCode}`);
    expect(verifyAuth(req)).toBe(true);
  });

  it('rejects a code eight steps old (outside RELAY_VERIFY_SKEW_STEPS=6 window, #490)', () => {
    // 8 steps = 240 s > 6 steps acceptance limit → rejected.
    const verifyAuth = buildRelayVerifyAuth()!;
    const now = Date.now();
    const eightStepsAgoCode = generateTotp(TEST_SECRET, now - 240_000);
    const req = fakeReq(`/target?at=${eightStepsAgoCode}`);
    expect(verifyAuth(req)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Upgrade listener branching — 401/destroy on invalid, pass-through on valid
//
// We simulate the upgrade listener behaviour directly without starting a real
// HTTP server. The listener is the closure registered in startChiiRelay:
//   if (!verifyAuth(req)) { socket.write('HTTP/1.1 401 …'); socket.destroy(); return; }
// Valid → no side-effect (chii handles it downstream).
// ---------------------------------------------------------------------------

describe('upgrade listener branching', () => {
  beforeEach(() => {
    process.env.AIT_DEBUG_TOTP_SECRET = TEST_SECRET;
  });
  afterEach(() => {
    delete process.env.AIT_DEBUG_TOTP_SECRET;
  });

  /**
   * Simulate what startChiiRelay's upgrade listener does.
   * Returns whether the socket was destroyed (→ invalid auth).
   */
  function simulateUpgrade(
    verifyAuth: (req: IncomingMessage) => boolean,
    req: IncomingMessage,
  ): { destroyed: boolean; write401: boolean } {
    const socket = fakeSocket();
    if (!verifyAuth(req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
      return { destroyed: true, write401: true };
    }
    // Valid: no socket side-effect. Chii's handler would take over here.
    return { destroyed: false, write401: false };
  }

  it('destroys socket + sends 401 when auth fails (invalid code)', () => {
    const verifyAuth = buildRelayVerifyAuth()!;
    const req = fakeReq('/client/id?target=t&at=000000');
    const now = Date.now();
    const actual = generateTotp(TEST_SECRET, now);
    if (actual !== '000000') {
      const result = simulateUpgrade(verifyAuth, req);
      expect(result.destroyed).toBe(true);
      expect(result.write401).toBe(true);
    }
  });

  it('destroys socket + sends 401 when `at` param is absent', () => {
    const verifyAuth = buildRelayVerifyAuth()!;
    const req = fakeReq('/client/id?target=t');
    const result = simulateUpgrade(verifyAuth, req);
    expect(result.destroyed).toBe(true);
    expect(result.write401).toBe(true);
  });

  it('does NOT destroy socket when auth passes (valid code)', () => {
    const verifyAuth = buildRelayVerifyAuth()!;
    const now = Date.now();
    const code = generateTotp(TEST_SECRET, now);
    const req = fakeReq(`/client/id?target=t&at=${code}`);
    const result = simulateUpgrade(verifyAuth, req);
    expect(result.destroyed).toBe(false);
    expect(result.write401).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// rewriteAtPathPrefix — path-prefix → query rewrite (issue #466)
//
// The phone target's only TOTP transport is the URL path: the in-app attach
// injects `/at/<code>/target.js`, so the derived WS dial carries
// `/at/<code>/target/<id>`. The relay listener rewrites that prefix into the
// query form (mutating req.url) so the query-only verifyAuth covers both
// transports and chii only ever sees the stripped URL.
// ---------------------------------------------------------------------------

describe('rewriteAtPathPrefix', () => {
  it('rewrites the target.js fetch path', () => {
    expect(rewriteAtPathPrefix('/at/123456/target.js')).toBe('/target.js?at=123456');
  });

  it('rewrites a target WS upgrade path and appends to the existing query', () => {
    expect(rewriteAtPathPrefix('/at/123456/target/abc?url=u&title=t')).toBe(
      '/target/abc?url=u&title=t&at=123456',
    );
  });

  it('rewrites a bare prefixed root path', () => {
    expect(rewriteAtPathPrefix('/at/123456/')).toBe('/?at=123456');
  });

  it('rewrites a prefix without trailing slash to the root path', () => {
    expect(rewriteAtPathPrefix('/at/123456')).toBe('/?at=123456');
  });

  it('returns null for non-prefixed paths (daemon client query transport)', () => {
    expect(rewriteAtPathPrefix('/client/id?target=t&at=123456')).toBeNull();
    expect(rewriteAtPathPrefix('/target.js')).toBeNull();
    expect(rewriteAtPathPrefix('/targets')).toBeNull();
  });

  it('returns null for an empty code segment', () => {
    expect(rewriteAtPathPrefix('/at//target.js')).toBeNull();
  });

  it('returns null for empty and root URLs', () => {
    expect(rewriteAtPathPrefix('')).toBeNull();
    expect(rewriteAtPathPrefix('/')).toBeNull();
    expect(rewriteAtPathPrefix('/at')).toBeNull();
  });

  it('does not treat deeper /at/ segments as a prefix', () => {
    expect(rewriteAtPathPrefix('/client/at/123456')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// verifyAuth × transport matrix (issue #466)
//
// The relay listener composes rewriteAtPathPrefix + verifyAuth. This matrix
// pins the combined behaviour for both transports without a real server.
// ---------------------------------------------------------------------------

describe('verifyAuth — path-prefix transport matrix', () => {
  beforeEach(() => {
    process.env.AIT_DEBUG_TOTP_SECRET = TEST_SECRET;
  });
  afterEach(() => {
    delete process.env.AIT_DEBUG_TOTP_SECRET;
  });

  /** Compose the relay listener's rewrite + verify steps on a raw URL. */
  function verifyWithRewrite(rawUrl: string): { pass: boolean; seenUrl: string } {
    const verifyAuth = buildRelayVerifyAuth()!;
    const req = fakeReq(rawUrl);
    const rewritten = rewriteAtPathPrefix(req.url ?? '');
    if (rewritten !== null) {
      req.url = rewritten;
    }
    return { pass: verifyAuth(req), seenUrl: req.url ?? '' };
  }

  it('accepts a valid code carried in the path prefix (WS upgrade shape)', () => {
    const code = generateTotp(TEST_SECRET);
    const result = verifyWithRewrite(`/at/${code}/target/abc?url=u`);
    expect(result.pass).toBe(true);
    // chii sees the stripped URL — the /at/<code>/ prefix is gone.
    expect(result.seenUrl.startsWith('/target/abc')).toBe(true);
  });

  it('accepts a valid code carried in the path prefix (target.js fetch shape)', () => {
    const code = generateTotp(TEST_SECRET);
    expect(verifyWithRewrite(`/at/${code}/target.js`).pass).toBe(true);
  });

  it('accepts a previous-step code in the path prefix (skew=1)', () => {
    const prevStepCode = generateTotp(TEST_SECRET, Date.now() - 30_000);
    expect(verifyWithRewrite(`/at/${prevStepCode}/target/abc`).pass).toBe(true);
  });

  it('rejects a wrong code in the path prefix', () => {
    const actual = generateTotp(TEST_SECRET);
    if (actual !== '000000') {
      expect(verifyWithRewrite('/at/000000/target/abc?url=u').pass).toBe(false);
    }
  });

  it('accepts a two-steps-old code in the path prefix (within RELAY_VERIFY_SKEW_STEPS=6, #490)', () => {
    const twoStepsAgoCode = generateTotp(TEST_SECRET, Date.now() - 60_000);
    expect(verifyWithRewrite(`/at/${twoStepsAgoCode}/target/abc`).pass).toBe(true);
  });

  it('rejects an eight-steps-old code in the path prefix (outside RELAY_VERIFY_SKEW_STEPS=6, #490)', () => {
    const eightStepsAgoCode = generateTotp(TEST_SECRET, Date.now() - 240_000);
    expect(verifyWithRewrite(`/at/${eightStepsAgoCode}/target/abc`).pass).toBe(false);
  });

  it('rejects a prefix-less target upgrade with no query code (stock chii dial)', () => {
    expect(verifyWithRewrite('/target/abc?url=u&title=t').pass).toBe(false);
  });

  it('query transport keeps working unchanged (back-compat, daemon client)', () => {
    const code = generateTotp(TEST_SECRET);
    const result = verifyWithRewrite(`/client/id?target=t&at=${code}`);
    expect(result.pass).toBe(true);
    expect(result.seenUrl).toBe(`/client/id?target=t&at=${code}`);
  });
});
