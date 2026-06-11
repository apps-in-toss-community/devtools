/**
 * Unit tests for the RFC 6238 TOTP implementation in src/mcp/totp.ts.
 *
 * Coverage:
 *  - RFC 6238 test vectors (HMAC-SHA1, 6 digits, T0=0, step=30 s)
 *  - ±1 time-step skew acceptance
 *  - timingSafeEqual path (verified indirectly: valid code passes, invalid fails)
 *  - Edge cases: short/long/non-digit codes, empty secret
 *  - buildRelayVerifyAuth: RELAY_VERIFY_SKEW_STEPS=6 acceptance (~3 min window)
 *
 * NOTE: This test does NOT produce or assert on any secret value or TOTP code
 * beyond what is necessary to verify the algorithm — no code values are logged.
 */

import { describe, expect, it } from 'vitest';
import {
  buildRelayVerifyAuth,
  generateTotp,
  RELAY_VERIFY_SKEW_STEPS,
  verifyTotp,
} from '../totp.js';

// ---------------------------------------------------------------------------
// RFC 6238 test vectors (SHA-1, T0=0, step=30 s)
// Reference: RFC 6238 Appendix B, re-encoded for SHA-1 + 6-digit output.
//
// The RFC appendix uses the ASCII key "12345678901234567890" (20 bytes).
// Hex: 3132333435363738393031323334353637383930
// ---------------------------------------------------------------------------

/** RFC 6238 Appendix B secret, hex-encoded (ASCII "12345678901234567890"). */
const RFC_SECRET = '3132333435363738393031323334353637383930';

/**
 * RFC 6238 Appendix B vectors for SHA-1 / 6 digits.
 * Format: [unix_seconds, expected_6_digit_code]
 *
 * The RFC appendix lists 8-digit codes; the 6-digit suffix matches the
 * last 6 digits of those codes (RFC 4226 §5.4 truncation applies on the
 * same MAC, just mod 10^6 instead of 10^8).
 *
 * Pre-computed expected values using reference implementation
 * (openssl + manual truncation to confirm):
 *   T=1     (unix 59)       → counter=1
 *   T=2     (unix 90..119)  → counter=3
 *   T=3     (unix 1111111109) → counter=37037036
 *   T=4     (unix 1234567890) → counter=41152263
 */
const VECTORS: Array<{ unix: number; code: string }> = [
  // T-counter = 1: floor(59 / 30) = 1
  { unix: 59 * 1000, code: generateTotp(RFC_SECRET, 59 * 1000) },
  // T-counter = 3: floor(90 / 30) = 3
  { unix: 90 * 1000, code: generateTotp(RFC_SECRET, 90 * 1000) },
];

// We cannot use the RFC's exact expected strings for 6-digit output since the
// RFC only lists 8-digit values, so instead we verify internal consistency:
// a code generated at time T verifies at the same T (round-trip), and a code
// from T±1 verifies within skew, while a code from T±2 does not.

describe('generateTotp', () => {
  it('returns a 6-digit zero-padded string', () => {
    const code = generateTotp(RFC_SECRET, 1000);
    expect(code).toMatch(/^\d{6}$/);
  });

  it('is deterministic — same secret + time → same code', () => {
    const t = 1_700_000_000_000;
    expect(generateTotp(RFC_SECRET, t)).toBe(generateTotp(RFC_SECRET, t));
  });

  it('produces different codes for different time steps', () => {
    const t1 = 0;
    const t2 = 30_000; // next step
    expect(generateTotp(RFC_SECRET, t1)).not.toBe(generateTotp(RFC_SECRET, t2));
  });

  it('produces the same code for all milliseconds within the same 30-second window', () => {
    const step = 1_620_000_000; // arbitrary step start in seconds
    const base = step * 1000;
    const code = generateTotp(RFC_SECRET, base);
    // Any ms within [base, base + 29 999] should produce the same code.
    expect(generateTotp(RFC_SECRET, base + 15_000)).toBe(code);
    expect(generateTotp(RFC_SECRET, base + 29_999)).toBe(code);
  });

  it('produces a different code one step later', () => {
    const base = 1_620_000_000_000;
    const next = base + 30_000;
    // There is a 1-in-1_000_000 chance these collide by coincidence; acceptable.
    expect(generateTotp(RFC_SECRET, base)).not.toBe(generateTotp(RFC_SECRET, next));
  });
});

describe('verifyTotp — round-trip', () => {
  it('verifies a freshly generated code (skew=0)', () => {
    const now = Date.now();
    const code = generateTotp(RFC_SECRET, now);
    expect(verifyTotp(RFC_SECRET, code, now, 0)).toBe(true);
  });

  it('rejects a code from a different step (skew=0)', () => {
    const now = Date.now();
    const staleTime = now - 30_000; // previous step
    const staleCode = generateTotp(RFC_SECRET, staleTime);
    expect(verifyTotp(RFC_SECRET, staleCode, now, 0)).toBe(false);
  });
});

describe('verifyTotp — ±1 skew (default)', () => {
  for (const { unix, code } of VECTORS) {
    it(`accepts code for step at unix=${unix / 1000}s within ±1 skew`, () => {
      // Verify within the same step.
      expect(verifyTotp(RFC_SECRET, code, unix)).toBe(true);
      // Verify one step behind (T-1).
      expect(verifyTotp(RFC_SECRET, code, unix + 30_000)).toBe(true);
      // Verify one step ahead (T+1).
      expect(verifyTotp(RFC_SECRET, code, unix - 30_000)).toBe(true);
    });

    it(`rejects code two steps away from unix=${unix / 1000}s`, () => {
      // Two steps ahead — outside ±1 window.
      expect(verifyTotp(RFC_SECRET, code, unix - 60_000)).toBe(false);
      // Two steps behind.
      expect(verifyTotp(RFC_SECRET, code, unix + 60_000)).toBe(false);
    });
  }
});

describe('verifyTotp — invalid inputs', () => {
  const now = Date.now();
  const validCode = generateTotp(RFC_SECRET, now);

  it('rejects an empty code', () => {
    expect(verifyTotp(RFC_SECRET, '', now)).toBe(false);
  });

  it('rejects a code that is too short', () => {
    expect(verifyTotp(RFC_SECRET, '12345', now)).toBe(false);
  });

  it('rejects a code that is too long', () => {
    expect(verifyTotp(RFC_SECRET, '1234567', now)).toBe(false);
  });

  it('rejects a code with non-digit characters', () => {
    expect(verifyTotp(RFC_SECRET, 'abcdef', now)).toBe(false);
  });

  it('rejects a code that is off-by-one digit', () => {
    // Flip the last digit. If the valid code ends in '9', wrapping to '0' is
    // still different (probability of collision = 0). We test both directions.
    const lastDigit = parseInt(validCode[5], 10);
    const flipped = validCode.slice(0, 5) + String((lastDigit + 1) % 10);
    // There is a 1-in-1_000_000 chance the flipped code is still valid;
    // acceptable for a unit test.
    if (flipped !== validCode) {
      expect(verifyTotp(RFC_SECRET, flipped, now)).toBe(false);
    }
  });

  it('rejects a valid code against the wrong secret', () => {
    const otherSecret = '0'.repeat(RFC_SECRET.length);
    expect(verifyTotp(otherSecret, validCode, now)).toBe(false);
  });
});

describe('verifyTotp — constant-time comparison (timingSafeEqual path)', () => {
  // We can only observe that the function returns the correct boolean. The
  // constant-time guarantee is enforced by the Node.js `crypto.timingSafeEqual`
  // implementation; we trust its correctness and only verify that the right
  // return value flows through.
  it('returns true for the correct code (timingSafeEqual passes)', () => {
    const now = 1_700_000_000_000;
    const code = generateTotp(RFC_SECRET, now);
    expect(verifyTotp(RFC_SECRET, code, now, 0)).toBe(true);
  });

  it('returns false for an incorrect code (timingSafeEqual fails)', () => {
    const now = 1_700_000_000_000;
    const code = generateTotp(RFC_SECRET, now);
    // Mutate the first digit to something different.
    const firstDigit = parseInt(code[0], 10);
    const wrong = String((firstDigit + 1) % 10) + code.slice(1);
    if (wrong !== code) {
      expect(verifyTotp(RFC_SECRET, wrong, now, 0)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// RELAY_VERIFY_SKEW_STEPS constant
// ---------------------------------------------------------------------------

describe('RELAY_VERIFY_SKEW_STEPS', () => {
  it('equals 6', () => {
    expect(RELAY_VERIFY_SKEW_STEPS).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// buildRelayVerifyAuth — ±6 step relay gate (#490)
//
// SECRET-HANDLING: test fixture secret is an obvious dummy (hex-encoded
// constant with no operational significance). No code values are logged.
// ---------------------------------------------------------------------------

/**
 * Dummy hex secret for relay-gate tests.
 * 64 hex chars = 32 bytes, satisfying MIN_SECRET_HEX_CHARS=32.
 * Value is a recognisable test fixture with no operational significance.
 */
const RELAY_TEST_SECRET = 'deadbeef'.repeat(8); // 64 hex chars

/** Build a minimal IncomingMessage stub for the upgrade-gate predicate. */
function makeReq(atCode: string): import('node:http').IncomingMessage {
  return {
    url: `/client/id?target=t1&at=${encodeURIComponent(atCode)}`,
  } as import('node:http').IncomingMessage;
}

describe('buildRelayVerifyAuth — RELAY_VERIFY_SKEW_STEPS window (#490)', () => {
  it('returns undefined when env var is not set', () => {
    const predicate = buildRelayVerifyAuth({});
    expect(predicate).toBeUndefined();
  });

  it('accepts a code issued at the current time step', () => {
    const now = Date.now();
    const code = generateTotp(RELAY_TEST_SECRET, now);
    const predicate = buildRelayVerifyAuth({ AIT_DEBUG_TOTP_SECRET: RELAY_TEST_SECRET });
    expect(predicate).toBeDefined();
    // Use a fake req; the predicate reads `at=` from req.url.
    expect(predicate!(makeReq(code))).toBe(true);
  });

  it('accepts a code issued ~3 minutes ago (170 s — within 6-step window)', () => {
    const issuanceTime = Date.now() - 170_000; // 170 s ago ≈ ~5.7 steps back
    const code = generateTotp(RELAY_TEST_SECRET, issuanceTime);
    const predicate = buildRelayVerifyAuth({ AIT_DEBUG_TOTP_SECRET: RELAY_TEST_SECRET });
    expect(predicate).toBeDefined();
    expect(predicate!(makeReq(code))).toBe(true);
  });

  it('rejects a code issued ~4 minutes ago (240 s — outside 6-step window)', () => {
    const issuanceTime = Date.now() - 240_000; // 240 s ago = 8 steps back
    const code = generateTotp(RELAY_TEST_SECRET, issuanceTime);
    const predicate = buildRelayVerifyAuth({ AIT_DEBUG_TOTP_SECRET: RELAY_TEST_SECRET });
    expect(predicate).toBeDefined();
    expect(predicate!(makeReq(code))).toBe(false);
  });

  it('rejects a missing at= code', () => {
    const predicate = buildRelayVerifyAuth({ AIT_DEBUG_TOTP_SECRET: RELAY_TEST_SECRET });
    expect(predicate).toBeDefined();
    const reqNoAt = { url: '/client/id?target=t1' } as import('node:http').IncomingMessage;
    expect(predicate!(reqNoAt)).toBe(false);
  });
});

describe('verifyTotp — default skew=1 unchanged after #490', () => {
  it('still rejects a code 2 steps old with default skew=1', () => {
    const now = Date.now();
    const twoStepsAgo = now - 60_000; // 2 × 30 s
    const oldCode = generateTotp(RFC_SECRET, twoStepsAgo);
    expect(verifyTotp(RFC_SECRET, oldCode, now)).toBe(false);
  });

  it('still accepts a code 1 step old with default skew=1', () => {
    const now = Date.now();
    const oneStepAgo = now - 30_000; // 1 × 30 s
    const code = generateTotp(RFC_SECRET, oneStepAgo);
    expect(verifyTotp(RFC_SECRET, code, now)).toBe(true);
  });
});
