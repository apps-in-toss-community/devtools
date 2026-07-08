/**
 * Runtime activation gate for the in-app debug surface.
 *
 * Spec: docs/superpowers/specs/2026-05-18-in-app-debug-mcp.md
 * "3-layer activation gate". This is the pure gate decision; the Chii client,
 * WebSocket transport, MCP server, and CLI that consume it live in src/mcp/.
 *
 * This function evaluates the two RUNTIME layers, B and C. Layer A — the
 * build-time gate — is NOT evaluated here, and deliberately so: it is enforced
 * entirely by the consumer's `if (__DEBUG_BUILD__) { … }` guard around the
 * import site (see sdk-example `src/main.tsx`). `__DEBUG_BUILD__` is a
 * consumer-build-time constant; a release consumer build folds it to `false`
 * and dead-code-eliminates the whole import of `@ait-co/devtools/in-app`, so
 * this code is simply absent from release bundles. A pre-built npm package
 * cannot re-check that flag — it was already baked at devtools' own publish
 * time — so any `isDebugBuild` check inside this function would be permanently
 * `false` and could never pass. Layer A is the consumer guard; B and C are
 * here.
 *
 * Layer B has two parts:
 *   B1 — host allowlist: `hostname` must be a `*.private-apps.tossmini.com`
 *        subdomain (Toss dogfood entry) OR a `*.trycloudflare.com` host (env 2
 *        PWA dev tunnel). The Toss app serves dogfood / private mini-apps from
 *        a separate `private-apps` host; a production (`intoss://`) entry is
 *        served from `*.apps.tossmini.com` WITHOUT the `private-apps` segment.
 *        This is the security gate against a dogfood build that somehow lands
 *        on a production entry — see the comment on {@link isPrivateAppsHost}.
 *        The env 2 tunnel host is allowed because it has no production runtime
 *        (mock SDK, the developer's own dev server) — see {@link
 *        isTrycloudflareHost}.
 *   B2 — entry query: `_deploymentId` must be present and non-empty. Applies to
 *        the Toss path only; the env 2 tunnel has no deployed bundle, so B2 is
 *        skipped for `*.trycloudflare.com` hosts.
 *
 * Layer C — opt-in + relay + optional TOTP auth:
 *   C1 — opt-in:       `debug=1` must be present.
 *   C2 — relay URL:    `relay=<wss-url>` must be a valid `wss:` URL.
 *   C3 — TOTP auth:    When `verifyTotpCode` is provided (consumer injected the
 *                      baked secret at build time via `__DEBUG_TOTP_SECRET__`),
 *                      `at=<code>` is checked. Invalid or absent code → BLOCKED.
 *                      When no verifier is provided (TOTP disabled), `at` is
 *                      ignored (backward compatible).
 *
 * Security note on baked secrets:
 *   The TOTP secret baked in via `__DEBUG_TOTP_SECRET__` is present in the
 *   dogfood bundle and is extractable by a determined reverse engineer.
 *   The practical bar raised is: "URL leak" (Slack paste, QR screenshot) →
 *   blocked; "URL + bundle extraction + live TOTP code" → not blocked.
 *   This is the intended threat model. Do not overpromise on this guarantee.
 *
 * SECRET-HANDLING: `verifyTotpCode` is a black-box predicate. This module
 *   does NOT log the secret, any code value, or pass/fail details beyond the
 *   `'auth'` reason enum.
 *
 * Decision matrix (gate only runs in a debug build — Layer A already passed):
 *
 *   host        | _deploymentId | debug=1 | relay ok | TOTP ok* | result
 *   neither     | (any)         | (any)   | (any)    | (any)    | BLOCKED (host)
 *   private-apps| absent        | (any)   | (any)    | (any)    | BLOCKED (entry)
 *   private-apps| present       | absent  | (any)    | (any)    | BLOCKED (opt-in)
 *   private-apps| present       | present | invalid  | (any)    | BLOCKED (invalid-relay)
 *   private-apps| present       | present | valid    | fail*    | BLOCKED (auth)
 *   private-apps| present       | present | valid    | pass/n/a | ATTACH
 *   trycloudflare| (skipped)    | absent  | (any)    | (any)    | BLOCKED (opt-in)
 *   trycloudflare| (skipped)    | present | invalid  | (any)    | BLOCKED (invalid-relay)
 *   trycloudflare| (skipped)    | present | valid    | fail*    | BLOCKED (auth)
 *   trycloudflare| (skipped)    | present | valid    | pass/n/a | ATTACH
 *   tossmini(3.0)| (reported)   | absent  | (any)    | (any)    | BLOCKED (opt-in)
 *   tossmini(3.0)| (reported)   | present | invalid  | (any)    | BLOCKED (invalid-relay)
 *   tossmini(3.0)| (reported)   | present | valid    | at absent| BLOCKED (auth — TOTP mandatory, #760)
 *   tossmini(3.0)| (reported)   | present | valid    | pass/at present | ATTACH
 *
 *   * "TOTP ok" column only applies when `verifyTotpCode` is provided.
 *     When no verifier is injected, TOTP check is skipped entirely — EXCEPT
 *     on tossmini(3.0) hosts (non-private-apps), where a missing `at=` code
 *     blocks with 'auth' even without a verifier (devtools#760; the relay
 *     side remains the authoritative verifier).
 *
 *   tossmini(3.0) = `*.tossmini.com` hosts that are not
 *   `*.private-apps.tossmini.com` — the 3.0 unified serving family. The 3.0
 *   loader consumes `_deploymentId` natively, so B2 reports it when present
 *   but never requires it there (devtools#760).
 *   For trycloudflare (env 2 tunnel) hosts B1 is bypassed and B2 is skipped;
 *   C1/C2/C3 still apply identically. The ATTACH result carries
 *   `deploymentId: ''` for tunnel hosts.
 */

/** Shape returned when the gate allows attachment. */
export interface GateResultAttach {
  readonly attach: true;
  /** The validated `wss:` relay URL from the `relay` query param. */
  readonly relayUrl: string;
  /** The deployment ID extracted from the `_deploymentId` query param. */
  readonly deploymentId: string;
}

/** Shape returned when the gate blocks attachment, with a reason code. */
export interface GateResultBlocked {
  readonly attach: false;
  /**
   * - `'host'`          Layer B1: `hostname` is not a `*.private-apps.tossmini.com` host.
   * - `'entry'`         Layer B2: `_deploymentId` param is absent or empty.
   * - `'opt-in'`        Layer C1: `debug=1` param is absent.
   * - `'invalid-relay'` Layer C2: `relay` param is absent, empty, or not a `wss:` URL.
   * - `'auth'`          Layer C3: TOTP `at=` code is absent, invalid, or expired
   *                     (only when a `verifyTotpCode` predicate is injected).
   *
   * There is no `'build'` reason: Layer A is enforced by the consumer's
   * `if (__DEBUG_BUILD__)` guard, not by this function.
   *
   * SECRET-HANDLING: `'auth'` is the only value surfaced for auth failures —
   * no code value, expected value, or secret fragment is ever exposed.
   */
  readonly reason: 'host' | 'entry' | 'opt-in' | 'invalid-relay' | 'auth';
}

export type GateResult = GateResultAttach | GateResultBlocked;

/**
 * Input for {@link evaluateDebugGate}.
 *
 * All fields are explicit so the function is trivially testable without
 * touching `window`.
 */
export interface GateInput {
  /**
   * The host the page is served from — `window.location.hostname`.
   *
   * This is the Layer B1 security signal. Why hostname and not the entry
   * scheme: the Toss SDK normalises `intoss-private://` to `intoss://` in
   * `getSchemeUri()`, and `getOperationalEnvironment()` / `getWebViewType()`
   * return the same value (`"toss"` / `"partner"`) for both dogfood and
   * production entries — none of them distinguish a dogfood entry. The host
   * does: a dogfood / private-apps entry is served from
   * `*.private-apps.tossmini.com`, a production entry is not. This was
   * confirmed live over CDP against mini-app 31146 (see spec open question 2).
   */
  readonly hostname: string;

  /**
   * The URL search params to inspect for gate signals (Layers B2 and C).
   *
   * Prefer `URLSearchParams` so callers can pass `new URLSearchParams(location.search)`
   * without coupling the pure function to `window`.
   */
  readonly searchParams: URLSearchParams;

  /**
   * Optional TOTP code verifier for Layer C3 auth gate.
   *
   * When provided, `evaluateDebugGate` reads the `at` query param and passes
   * it to this predicate. Return `true` to allow, `false` to block with
   * `reason: 'auth'`.
   *
   * Inject via the consumer's build define, e.g.:
   * ```ts
   * // dogfood build entry — consumer's build injects __DEBUG_TOTP_SECRET__
   * declare const __DEBUG_TOTP_SECRET__: string | undefined;
   * const verifyTotpCode = typeof __DEBUG_TOTP_SECRET__ !== 'undefined'
   *   ? (code: string) => verifyTotp(__DEBUG_TOTP_SECRET__, code)
   *   : undefined;
   * maybeAttach(evaluateDebugGate({ ...params, verifyTotpCode }));
   * ```
   *
   * Security note: this predicate is a black-box from the gate's perspective.
   * The gate only surfaces pass/fail and the `'auth'` reason code — no code
   * value or secret fragment is ever logged or returned.
   *
   * When `undefined` (TOTP disabled), `at=` is silently ignored and the gate
   * proceeds to ATTACH if all other layers pass.
   */
  readonly verifyTotpCode?: (code: string) => boolean;
}

/**
 * The host suffix the Toss app uses to serve dogfood / private mini-apps.
 *
 * A `intoss-private://` (dogfood) entry maps to a host such as
 * `aitc-sdk-example.private-apps.tossmini.com`. A production `intoss://`
 * entry is served from `*.apps.tossmini.com` — the `.private-apps.` segment
 * is absent. Confirmed live over CDP for mini-app 31146; the exact production
 * host is to be re-confirmed once 31146 passes review (spec open question 2).
 */
const PRIVATE_APPS_HOST_SUFFIX = '.private-apps.tossmini.com';

/**
 * The host suffix Cloudflare quick-tunnels serve from — the env 2 (PWA) entry.
 * See {@link isTrycloudflareHost} for why this host kind bypasses Layer B1.
 */
const TRYCLOUDFLARE_HOST_SUFFIX = '.trycloudflare.com';

/**
 * Returns whether `hostname` is a `*.private-apps.tossmini.com` subdomain —
 * the host the Toss app reserves for dogfood / private mini-app entries.
 *
 * The match is an exact suffix check, not a substring `.includes()`: a
 * substring test would also accept an attacker-controlled host like
 * `private-apps.tossmini.com.evil.example`, which ends in `.example`, not in
 * `.tossmini.com`. Requiring the string to END with the suffix closes that.
 * The leading `.` in the suffix also forces a real subdomain label, so a
 * bare `private-apps.tossmini.com` (no mini-app subdomain) does not match.
 */
export function isPrivateAppsHost(hostname: string): boolean {
  return hostname.endsWith(PRIVATE_APPS_HOST_SUFFIX);
}

/**
 * The parent host suffix for the whole Toss mini-app serving family.
 *
 * The 3.0 runtime loader serves mini-app pages from tossmini.com hosts that
 * are NOT `*.private-apps.tossmini.com` (observed live 2026-07-08 on mini-app
 * 31146 with a 3.0-beta bundle: a 4-label host ending in `.tossmini.com`
 * whose middle label is not `private-apps`, with `_deploymentId` consumed by
 * the native loader and not propagated to the page URL — devtools#760).
 *
 * Under 3.0 the hostname therefore no longer distinguishes a dogfood
 * candidate from a production entry, so for these hosts Layer B is demoted
 * from a stage discriminator (#665) to a "Toss-owned host family" filter,
 * and the effective boundary moves to Layer C: explicit `debug=1`, a valid
 * `wss:` relay, and a MANDATORY `at=` TOTP code (see Layer C3 in
 * {@link evaluateDebugGate}). A production user's entry URL carries none of
 * those params, so an accidentally-shipped debug build stays dormant exactly
 * as #665 intended; what changes is that a deliberate operator holding the
 * TOTP secret can now attach on a 3.0-family host.
 *
 * The match is the same exact-suffix `endsWith` check as
 * {@link isPrivateAppsHost} — never a substring `.includes()`, which would
 * accept an attacker-controlled `x.tossmini.com.evil.example`. The leading
 * `.` forces at least one subdomain label, so a bare `tossmini.com` does not
 * match.
 */
const TOSSMINI_HOST_SUFFIX = '.tossmini.com';

/**
 * Returns whether `hostname` is any `*.tossmini.com` subdomain — the host
 * family the Toss app serves mini-app pages from. Includes the 2.x
 * `*.private-apps.tossmini.com` dogfood hosts and the 3.0 unified serving
 * hosts (devtools#760).
 */
export function isTossminiHost(hostname: string): boolean {
  return hostname.endsWith(TOSSMINI_HOST_SUFFIX);
}

/**
 * The host suffix Cloudflare quick-tunnels use — the env 2 (PWA) entry.
 *
 * Env 2 serves the local Vite dev server through a `*.trycloudflare.com` quick
 * tunnel (`src/unplugin/tunnel.ts`). It has no Toss app, no `intoss-private://`
 * scheme, and — critically — no production runtime: the SDK is the devtools
 * mock, and the page is the developer's own dev build. The Layer B1 safety net
 * (which stops a dogfood build that lands on a Toss *production* host from
 * attaching) has nothing to protect against here, because env 2 has no
 * production host. So a trycloudflare host is allowed past B1 — but ONLY past
 * B1: the remaining layers (C1 opt-in, C2 relay, C3 TOTP) still apply, so a
 * leaked tunnel URL is still blocked by TOTP exactly as on the Toss path.
 *
 * The match is the same exact-suffix `endsWith` check as
 * {@link isPrivateAppsHost} — never a substring `.includes()`, which would
 * accept an attacker-controlled `evil.trycloudflare.com.example.com`. The
 * leading `.` forces a real subdomain label, so a bare `trycloudflare.com`
 * (no tunnel subdomain) does not match.
 */
export function isTrycloudflareHost(hostname: string): boolean {
  return hostname.endsWith(TRYCLOUDFLARE_HOST_SUFFIX);
}

/**
 * Returns true when the hostname is a localhost/loopback address.
 * Allowed: `localhost`, `127.x.x.x` (full RFC 5735 loopback block), `[::1]`,
 * `0.0.0.0`, `*.localhost`.
 *
 * Security note: `hostname.startsWith('127.')` is intentionally NOT used —
 * that pattern would accept `127.evil.com`, which starts with "127." but is an
 * attacker-controlled hostname, not a loopback address. Instead, the 127/8
 * loopback block is matched with a strict numeric-quad regex so only valid
 * dotted-decimal IPv4 in the 127.x.x.x range pass (#665 작업 A fix).
 */
export function isLocalhostHost(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '0.0.0.0') return true;
  if (hostname === '[::1]') return true;
  // Match the entire 127/8 loopback block (127.0.0.0 – 127.255.255.255).
  // Each octet is one or more digits — no hostname label can look like this, so
  // the regex unambiguously selects IPv4 loopback addresses only.
  if (/^127\.\d+\.\d+\.\d+$/.test(hostname)) return true;
  if (hostname.endsWith('.localhost')) return true;
  return false;
}

/**
 * Positive-allowlist kill-switch (#665): returns true when the hostname is a
 * known debug-allowed host. The debug surface is ONLY active on:
 *   - localhost / loopback (env 1 desktop dev)
 *   - *.trycloudflare.com (env 2 PWA tunnel)
 *   - *.tossmini.com (env 3 dog-food — 2.x private-apps hosts AND the 3.0
 *     unified serving family, devtools#760)
 *
 * Any other host is silently blocked. This is a positive allowlist —
 * unlisted hosts never had debug surface regardless, but this function makes
 * it explicit and auditable in a single place.
 *
 * #760 note on the #665 boundary: the former env 4 LIVE host family
 * (`*.apps.tossmini.com`) now passes this coarse filter because the 3.0
 * loader serves dogfood candidates and production entries from the same
 * host family — the hostname alone can no longer separate them. The #665
 * invariant ("no naked attach on a production-family host") is preserved
 * one layer down: on tossmini hosts that are not `*.private-apps.*`, Layer
 * C3 makes the TOTP `at=` code MANDATORY, and production entry URLs carry
 * no debug/relay/at params at all.
 *
 * SECRET-HANDLING: the hostname value MUST NOT be logged or included in any
 * error reason string — only benign labels ('host not in allowlist') are safe.
 */
export function isDebugAllowedHost(hostname: string): boolean {
  return isLocalhostHost(hostname) || isTrycloudflareHost(hostname) || isTossminiHost(hostname);
}

/**
 * Pure function that evaluates the runtime debug activation layers (B and C).
 *
 * Has no side effects. The input is explicit. Returns a discriminated union
 * so callers can pattern-match on `result.attach`.
 *
 * Layer A (build-time) is intentionally not evaluated here — see the file-level
 * comment. By the time this function runs, the consumer's `if (__DEBUG_BUILD__)`
 * guard has already passed; this function only decides B and C.
 *
 * @example
 * ```ts
 * const result = evaluateDebugGate({
 *   hostname: window.location.hostname,
 *   searchParams: new URLSearchParams(window.location.search),
 * });
 * if (result.attach) {
 *   // Proceed to load Chii client
 * }
 * ```
 */
export function evaluateDebugGate(input: GateInput): GateResult {
  // Layer B1 — host allowlist (the security gate).
  // Three host kinds are allowed past B1:
  //   - Toss dogfood: `*.private-apps.tossmini.com`. A production `intoss://`
  //     entry is served from `*.apps.tossmini.com` and is rejected here. This
  //     is what stops a dogfood build that somehow reaches a production entry
  //     from attaching: Layer A keeps debug code out of release bundles, and
  //     this layer keeps a dogfood bundle that lands on a production host from
  //     attaching even though its code is present.
  //   - Env 2 PWA tunnel: `*.trycloudflare.com`. This is the developer's own
  //     local dev server (mock SDK, no production runtime), so the
  //     production-entry hazard B1 guards against cannot occur. It bypasses B1
  //     but NOT the remaining layers — C1/C2/C3 (incl. TOTP) still apply, so a
  //     leaked tunnel URL is blocked exactly as on the Toss path. See
  //     {@link isTrycloudflareHost}.
  //   - Localhost/loopback: env 1 desktop dev (127.x.x.x, [::1], localhost,
  //     *.localhost, 0.0.0.0). Positive-allowlist kill-switch (#665).
  const isTunnel = isTrycloudflareHost(input.hostname);
  const isLocal = isLocalhostHost(input.hostname);
  if (!isDebugAllowedHost(input.hostname)) {
    return { attach: false, reason: 'host' };
  }

  // Layer B2 — runtime entry query gate (2.x private-apps path only).
  // `_deploymentId` must be present and non-empty. The `intoss-private://`
  // scheme used for dogfood entries includes this param and the 2.x runtime
  // propagates it to the page URL; general user entry paths do not. The env 2
  // tunnel and localhost have no deployed bundle and therefore no
  // `_deploymentId` — B2 is skipped for them, and `deploymentId` is reported
  // as the empty string on such attaches (no consumer reads it; see
  // attach.ts). The 3.0 unified serving hosts are also skipped: the 3.0
  // loader consumes `_deploymentId` natively and does NOT propagate it to
  // the page URL (devtools#760) — requiring it there would block every 3.0
  // entry. When it does appear it is still reported.
  let deploymentId = '';
  if (isPrivateAppsHost(input.hostname)) {
    deploymentId = input.searchParams.get('_deploymentId') ?? '';
    if (deploymentId === '') {
      return { attach: false, reason: 'entry' };
    }
  } else if (!isTunnel && !isLocal) {
    deploymentId = input.searchParams.get('_deploymentId') ?? '';
  }

  // Layer C — explicit opt-in gate.
  // Require `debug=1` so that an operator who opens a dogfood URL by accident
  // does not inadvertently trigger the debug surface.
  const debugParam = input.searchParams.get('debug');
  if (debugParam !== '1') {
    return { attach: false, reason: 'opt-in' };
  }

  // Layer C continued — relay URL validation.
  // `relay=<wss-url>` must be present and must use the `wss:` scheme.
  // Plain `ws:` is rejected (no TLS). `http:`/`https:` are rejected.
  const relayRaw = input.searchParams.get('relay') ?? '';
  if (relayRaw === '') {
    return { attach: false, reason: 'invalid-relay' };
  }

  let relayUrl: URL;
  try {
    relayUrl = new URL(relayRaw);
  } catch {
    return { attach: false, reason: 'invalid-relay' };
  }

  if (relayUrl.protocol !== 'wss:') {
    return { attach: false, reason: 'invalid-relay' };
  }

  // Layer C3 — TOTP auth gate (fail-fast; the relay side stays authoritative).
  // The `at` query param carries the current TOTP code. When a verifier is
  // injected, an absent or invalid code → BLOCKED. When no verifier is
  // provided (the in-app path — the page has no secret and cannot verify),
  // the check is skipped for backward compatibility EXCEPT on a 3.0
  // tossmini-family host: there the hostname no longer proves a dogfood
  // context (devtools#760), so a missing `at=` code is refused outright to
  // keep the #665 invariant ("no naked attach on a production-family host").
  // Real verification of the code value still happens relay-side (4401
  // accept-then-close on mismatch) — this is only the fail-fast half.
  //
  // SECRET-HANDLING: we do NOT log `code`, the verifier's result, or anything
  // derived from the secret. Only the `'auth'` enum is surfaced on failure.
  const atCode = input.searchParams.get('at') ?? '';
  if (input.verifyTotpCode !== undefined) {
    if (!input.verifyTotpCode(atCode)) {
      return { attach: false, reason: 'auth' };
    }
  } else if (
    isTossminiHost(input.hostname) &&
    !isPrivateAppsHost(input.hostname) &&
    atCode === ''
  ) {
    return { attach: false, reason: 'auth' };
  }

  return { attach: true, relayUrl: relayUrl.href, deploymentId };
}
