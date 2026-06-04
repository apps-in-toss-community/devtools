/**
 * Unit tests for the relay-auth baseline guard (issue #250).
 *
 * `assertRelayAuthConfigured()` is the fail-fast gate that makes
 * `AIT_DEBUG_TOTP_SECRET` MANDATORY before any public-internet-exposed relay is
 * booted (`bootRelayFamily` / `bootExternalRelayFamily`). Before #250 the TOTP
 * gate (§4 Layer C) was only active when the secret happened to be set; a relay
 * booted without it exposed an unauthenticated `wss://…trycloudflare.com` URL
 * that a third party could attach to. This suite pins the new contract:
 *   - missing / empty / short / non-hex secret → throw (relay boot refused).
 *   - valid ≥32-char hex secret → pass (no throw).
 *   - the fail-fast message never carries the secret value or its length.
 *   - a local-only path (no relay boot) is unaffected — the guard is only ever
 *     reached through a relay-boot site, so not calling it = exempt.
 *
 * SECRET-HANDLING: the only secret-shaped strings here are deliberately INVALID
 * placeholders (or a fixed test hex). No real secret, code, or derived value is
 * ever logged or asserted against the message body beyond its absence.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  assertRelayAuthConfigured,
  isValidRelayAuthSecret,
  RELAY_AUTH_SECRET_MISSING_MESSAGE,
} from '../totp.js';

// A well-formed secret: 64 hex chars = 32 bytes (what generateAttachToken emits).
const VALID_HEX_SECRET = 'deadbeef'.repeat(8);
// Exactly at the 32-hex-char floor (16 bytes).
const VALID_MIN_SECRET = 'a'.repeat(32);

// ---------------------------------------------------------------------------
// isValidRelayAuthSecret — the pure predicate
// ---------------------------------------------------------------------------

describe('isValidRelayAuthSecret', () => {
  it('rejects undefined', () => {
    expect(isValidRelayAuthSecret(undefined)).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(isValidRelayAuthSecret('')).toBe(false);
  });

  it('rejects a hex string shorter than 32 chars', () => {
    expect(isValidRelayAuthSecret('abcdef0123')).toBe(false); // 10 chars
    expect(isValidRelayAuthSecret('a'.repeat(31))).toBe(false); // 31, just under
  });

  it('rejects an odd-length hex string (trailing nibble would be dropped)', () => {
    expect(isValidRelayAuthSecret('a'.repeat(33))).toBe(false);
  });

  it('rejects a string containing non-hex characters', () => {
    // base32 alphabet (A-Z2-7) is NOT hex — a base32 secret would be silently
    // mis-decoded by Buffer.from(secret, 'hex'), so it must be rejected here.
    expect(isValidRelayAuthSecret('Z'.repeat(32))).toBe(false);
    expect(isValidRelayAuthSecret(`${'a'.repeat(31)}g`)).toBe(false); // 'g' not hex
    expect(isValidRelayAuthSecret(`${'a'.repeat(30)}!!`)).toBe(false);
  });

  it('accepts a valid 64-char hex secret', () => {
    expect(isValidRelayAuthSecret(VALID_HEX_SECRET)).toBe(true);
  });

  it('accepts a valid secret exactly at the 32-char floor', () => {
    expect(isValidRelayAuthSecret(VALID_MIN_SECRET)).toBe(true);
  });

  it('accepts uppercase hex (case-insensitive)', () => {
    expect(isValidRelayAuthSecret('DEADBEEF'.repeat(8))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// assertRelayAuthConfigured — the fail-fast guard
//
// Pass an explicit `env` object so the real process environment is never
// mutated and tests are order-independent.
// ---------------------------------------------------------------------------

describe('assertRelayAuthConfigured — relay boot is refused without a valid secret', () => {
  it('throws when the secret is unset (undefined)', () => {
    expect(() => assertRelayAuthConfigured({})).toThrow(RELAY_AUTH_SECRET_MISSING_MESSAGE);
  });

  it('throws when the secret is the empty string', () => {
    expect(() => assertRelayAuthConfigured({ AIT_DEBUG_TOTP_SECRET: '' })).toThrow(
      RELAY_AUTH_SECRET_MISSING_MESSAGE,
    );
  });

  it('throws when the secret is shorter than 32 chars', () => {
    expect(() => assertRelayAuthConfigured({ AIT_DEBUG_TOTP_SECRET: 'a'.repeat(16) })).toThrow(
      RELAY_AUTH_SECRET_MISSING_MESSAGE,
    );
  });

  it('throws when the secret contains non-hex characters', () => {
    expect(() => assertRelayAuthConfigured({ AIT_DEBUG_TOTP_SECRET: 'Z'.repeat(40) })).toThrow(
      RELAY_AUTH_SECRET_MISSING_MESSAGE,
    );
  });

  it('does NOT throw for a valid ≥32-char hex secret', () => {
    expect(() =>
      assertRelayAuthConfigured({ AIT_DEBUG_TOTP_SECRET: VALID_HEX_SECRET }),
    ).not.toThrow();
  });

  it('does NOT throw for a secret exactly at the 32-char floor', () => {
    expect(() =>
      assertRelayAuthConfigured({ AIT_DEBUG_TOTP_SECRET: VALID_MIN_SECRET }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Default-env behaviour (process.env) — the production read path.
// ---------------------------------------------------------------------------

describe('assertRelayAuthConfigured — reads process.env by default', () => {
  afterEach(() => {
    delete process.env.AIT_DEBUG_TOTP_SECRET;
  });

  it('throws when process.env.AIT_DEBUG_TOTP_SECRET is unset', () => {
    delete process.env.AIT_DEBUG_TOTP_SECRET;
    expect(() => assertRelayAuthConfigured()).toThrow(RELAY_AUTH_SECRET_MISSING_MESSAGE);
  });

  it('passes when process.env.AIT_DEBUG_TOTP_SECRET is a valid hex secret', () => {
    process.env.AIT_DEBUG_TOTP_SECRET = VALID_HEX_SECRET;
    expect(() => assertRelayAuthConfigured()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// SECRET-HANDLING — the fail-fast message leaks nothing.
// ---------------------------------------------------------------------------

describe('RELAY_AUTH_SECRET_MISSING_MESSAGE — leaks no secret', () => {
  it('names the requirement and a mint command, not a value', () => {
    expect(RELAY_AUTH_SECRET_MISSING_MESSAGE).toContain('AIT_DEBUG_TOTP_SECRET');
    expect(RELAY_AUTH_SECRET_MISSING_MESSAGE).toContain('openssl rand -hex');
  });

  it('does not echo any configured secret value, even when one is set', () => {
    // Even when a (weak) secret IS present, the message must be a static
    // constant that never interpolates the value or its length.
    const weak = 'feedface';
    let caught: Error | undefined;
    try {
      assertRelayAuthConfigured({ AIT_DEBUG_TOTP_SECRET: weak });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught?.message).not.toContain(weak);
    // The message must not mention a length digit derived from the input either.
    expect(caught?.message).toBe(RELAY_AUTH_SECRET_MISSING_MESSAGE);
  });
});
