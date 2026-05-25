/**
 * RFC 6238 TOTP implementation (Node.js, node:crypto only).
 *
 * External TOTP libraries (otplib, speakeasy, …) are intentionally NOT used
 * to keep the dependency surface minimal. This hand-roll is ~30 lines and
 * covers exactly what relay-side auth needs.
 *
 * Algorithm summary (RFC 6238 + RFC 4226):
 *   T  = floor(now / 30)          — 30-second time step counter
 *   K  = Buffer.from(secret, 'hex') — shared secret (raw bytes, hex-encoded)
 *   MAC = HMAC-SHA1(K, T as 8-byte big-endian uint64)
 *   offset = MAC[19] & 0x0f
 *   code = (MAC[offset..offset+4] & 0x7fffffff) % 10^6  — 6 digits
 *
 * Security note (keep this comment accurate):
 *   The baked-in secret in a dogfood build is extractable from the bundle by a
 *   determined reverse engineer. This mechanism raises the bar from
 *   "anyone with the URL" to "URL + bundle extraction + live TOTP calculation".
 *   Casual URL leaks (Slack paste, QR screenshot, shoulder-surfing) are
 *   blocked; deliberate reverse engineering is not. See threat model in
 *   src/mcp/chii-relay.ts and umbrella CLAUDE.md §4.
 *
 * SECRET-HANDLING: secret values and computed codes MUST NOT appear in any
 * log, error message, or string visible outside this module. Only boolean
 * pass/fail and reason enum values are safe to surface.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Time step window in seconds (RFC 6238 default). */
const TIME_STEP = 30;

/** Number of digits in the generated code. */
const DIGITS = 6;

/**
 * Derives a 6-digit TOTP code from a hex-encoded secret at the given wall-
 * clock time.
 *
 * @param secret - The shared secret as a hex string (e.g. 64 hex chars = 32
 *   bytes). Must be the output of `generateAttachToken()` or compatible.
 * @param when - Unix timestamp in milliseconds. Defaults to `Date.now()`.
 * @returns A zero-padded 6-digit decimal string, e.g. `"042193"`.
 */
export function generateTotp(secret: string, when: number = Date.now()): string {
  const key = Buffer.from(secret, 'hex');
  // Clamp to 0 so negative timestamps (e.g. in ±skew checks near epoch) do not
  // produce a negative counter, which would cause writeUInt32BE to throw.
  const counter = Math.max(0, Math.floor(when / 1000 / TIME_STEP));

  // Encode counter as 8-byte big-endian unsigned integer.
  const counterBuf = Buffer.alloc(8);
  // JavaScript numbers are safe integers up to 2^53; counter is ~7.5×10^10 at
  // year 9999 — well within safe range so standard bitwise ops are fine.
  const hi = Math.floor(counter / 0x100000000);
  const lo = counter >>> 0;
  counterBuf.writeUInt32BE(hi, 0);
  counterBuf.writeUInt32BE(lo, 4);

  const mac = createHmac('sha1', key).update(counterBuf).digest();

  // Dynamic truncation (RFC 4226 §5.4).
  const offset = mac[19] & 0x0f;
  const binCode =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);

  const otp = binCode % 10 ** DIGITS;
  return otp.toString().padStart(DIGITS, '0');
}

/**
 * Verifies a TOTP code against the secret, accepting ±`skew` time steps to
 * tolerate clock drift between the relay host and the client device.
 *
 * Uses `timingSafeEqual` for constant-time comparison to prevent timing
 * side-channel attacks.
 *
 * @param secret - Hex-encoded shared secret.
 * @param code - The 6-digit code to verify (string or numeric).
 * @param when - Unix timestamp in milliseconds. Defaults to `Date.now()`.
 * @param skew - Number of adjacent steps to accept on either side. Default 1
 *   (accepts T-1, T, T+1 — a 90-second acceptance window).
 * @returns `true` if the code matches any accepted step, `false` otherwise.
 */
export function verifyTotp(
  secret: string,
  code: string,
  when: number = Date.now(),
  skew: number = 1,
): boolean {
  const normalised = String(code).padStart(DIGITS, '0');
  if (normalised.length !== DIGITS || !/^\d{6}$/.test(normalised)) {
    return false;
  }

  const candidateBuf = Buffer.from(normalised, 'utf8');

  for (let delta = -skew; delta <= skew; delta++) {
    const stepWhen = when + delta * TIME_STEP * 1000;
    const expected = generateTotp(secret, stepWhen);
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (timingSafeEqual(expectedBuf, candidateBuf)) {
      return true;
    }
  }

  return false;
}
