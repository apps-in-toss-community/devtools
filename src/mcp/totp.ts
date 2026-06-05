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

/**
 * Minimum length (in hex characters) accepted for `AIT_DEBUG_TOTP_SECRET`.
 *
 * The secret is hex-encoded (see {@link generateTotp} — `Buffer.from(secret,
 * 'hex')`). 32 hex chars = 16 bytes = 128 bits, the floor for an HMAC-SHA1 key
 * we are willing to gate a public relay behind. `generateAttachToken()` emits
 * 64 hex chars (32 bytes), comfortably above this bar.
 */
const MIN_SECRET_HEX_CHARS = 32;

/** Hex string: one or more hex digits, case-insensitive (RFC 4648 base16). */
const HEX_RE = /^[0-9a-fA-F]+$/;

/**
 * Human-facing guidance printed when {@link assertRelayAuthConfigured} fails.
 *
 * SECRET-HANDLING: this message states only the REQUIREMENT (≥32 hex chars) and
 * how to mint one. It NEVER echoes the configured value, its length, or any
 * fragment derived from it — see {@link assertRelayAuthConfigured}.
 *
 * Note on encoding: the secret is hex (base16), not base32 — `generateTotp`
 * decodes it with `Buffer.from(secret, 'hex')`. A base32 string would be
 * silently mis-decoded and every TOTP code would fail to match, so the minting
 * command emits hex.
 */
export const RELAY_AUTH_SECRET_MISSING_MESSAGE = [
  '[ait-debug] AIT_DEBUG_TOTP_SECRET이 필수입니다. 32자 이상 16진수(hex) 문자열을 설정하세요.',
  '발급: openssl rand -hex 32',
  '데몬은 start_debug의 projectRoot 인자로 받은 디렉토리에서 .ait_relay 파일을 읽어 이 시크릿을 채웁니다.',
  '프로젝트에서 pnpm dev를 한 번 띄우면 unplugin이 .ait_relay를 자동 생성하니, projectRoot를 전달하세요.',
  '자세히: https://docs.aitc.dev/guides/relay-auth-totp',
].join('\n');

/**
 * Whether `secret` is a well-formed relay-auth TOTP secret: a hex string of at
 * least {@link MIN_SECRET_HEX_CHARS} characters with an even length (an odd
 * length would have its trailing nibble silently dropped by `Buffer.from(...,
 * 'hex')`, weakening the key without warning).
 *
 * Pure predicate so callers can test the validation independently of the
 * fail-fast side effect in {@link assertRelayAuthConfigured}.
 *
 * SECRET-HANDLING: returns only a boolean — the input value is never returned,
 * logged, or echoed.
 */
export function isValidRelayAuthSecret(secret: string | undefined): secret is string {
  if (secret === undefined || secret === '') return false;
  if (secret.length < MIN_SECRET_HEX_CHARS) return false;
  if (secret.length % 2 !== 0) return false;
  return HEX_RE.test(secret);
}

/**
 * Fail-fast guard enforcing that a relay-auth TOTP secret is configured before
 * a public-internet-exposed relay is booted (issue #250).
 *
 * Relay-auth (the §4 Layer C TOTP gate) is the only fail-fast layer that closes
 * the real gap: a leaked `wss://…trycloudflare.com` URL otherwise lets a third
 * party attach a debugger to a dogfood/live mini-app. Without a secret the relay
 * comes up unauthenticated, so this guard is called at every relay-boot site —
 * `bootRelayFamily` (intoss env 3/4) and `bootExternalRelayFamily` (env-2 PWA),
 * both eager and lazy. Local-only sessions never boot a relay and so never reach
 * this guard, matching the issue's exemption for non-relay debugging.
 *
 * Throws when the secret is unset, empty, too short, or not a valid hex string.
 * The thrown message is the bin entry's fatal stderr (see `cli.ts` `main().catch`)
 * — the same fatal model as the missing-`AIT_RELAY_BASE_URL` path.
 *
 * SECRET-HANDLING: the env value is read once, passed ONLY to the boolean
 * predicate, and never logged. The thrown message names the requirement, never
 * the value, its length, or any derived fragment.
 *
 * @param env - Environment to read from. Defaults to `process.env`; injectable
 *   for tests so they never mutate the real process environment.
 */
export function assertRelayAuthConfigured(env: NodeJS.ProcessEnv = process.env): void {
  if (!isValidRelayAuthSecret(env.AIT_DEBUG_TOTP_SECRET)) {
    throw new Error(RELAY_AUTH_SECRET_MISSING_MESSAGE);
  }
}

/**
 * Reads `AIT_DEBUG_TOTP_SECRET` from `process.env` at runtime and builds a
 * `verifyAuth` predicate for the Chii relay's WebSocket upgrade gate.
 *
 * The predicate checks the `at` query parameter against the current and
 * adjacent TOTP time steps (±1 skew) using {@link verifyTotp}.
 *
 * Returns `undefined` when the env var is not set — callers treat that as
 * "auth disabled" (no predicate registered on the relay). Note that since
 * issue #250 the secret is MANDATORY at every relay-boot site (enforced by
 * {@link assertRelayAuthConfigured} BEFORE the relay starts), so in production
 * this never returns `undefined` for a relay that actually boots; the
 * `undefined` branch only matters for the no-relay local path and tests.
 *
 * Lives here (not in the MCP server) so the unplugin's env-2 relay can wire the
 * same gate without importing the heavy MCP server module graph. Re-exported
 * from `debug-server.ts` for back-compat.
 *
 * SECRET-HANDLING: The secret value read from env is captured in a closure and
 * is NEVER written to any log, error message, or process output.
 */
export function buildRelayVerifyAuth(
  env: NodeJS.ProcessEnv = process.env,
): ((req: import('node:http').IncomingMessage) => boolean) | undefined {
  const secret = env.AIT_DEBUG_TOTP_SECRET;
  if (!secret) return undefined;

  return (req) => {
    // Parse the `at` query param from the upgrade request URL.
    // req.url is the raw request path + query, e.g. `/client/id?target=…&at=123456`
    const rawUrl = req.url ?? '';
    const qIndex = rawUrl.indexOf('?');
    const queryStr = qIndex === -1 ? '' : rawUrl.slice(qIndex + 1);
    const params = new URLSearchParams(queryStr);
    const code = params.get('at') ?? '';

    // Do NOT log `code`, `secret`, or any derived value here.
    return verifyTotp(secret, code);
  };
}
