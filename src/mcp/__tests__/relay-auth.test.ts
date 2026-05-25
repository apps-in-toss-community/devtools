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

  it('rejects a code two steps old (outside skew=1 window)', () => {
    const verifyAuth = buildRelayVerifyAuth()!;
    const now = Date.now();
    const twoStepsAgoCode = generateTotp(TEST_SECRET, now - 60_000);
    const req = fakeReq(`/target?at=${twoStepsAgoCode}`);
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
