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
 * Layer B has two parts. Both must pass:
 *   B1 — host allowlist: `hostname` must be a `*.private-apps.tossmini.com`
 *        subdomain. The Toss app serves dogfood / private mini-apps from a
 *        separate `private-apps` host; a production (`intoss://`) entry is
 *        served from `*.apps.tossmini.com` WITHOUT the `private-apps` segment.
 *        This is the security gate against a dogfood build that somehow lands
 *        on a production entry — see the comment on {@link isPrivateAppsHost}.
 *   B2 — entry query: `_deploymentId` must be present and non-empty.
 *
 * Decision matrix (the gate only ever runs in a debug build — Layer A already
 * passed by the time this code is reachable):
 *
 *   private-apps host | _deploymentId | debug=1 | result
 *   no                | (any)         | (any)   | BLOCKED  (Layer B1 — host)
 *   yes               | absent        | (any)   | BLOCKED  (Layer B2 — entry)
 *   yes               | present       | absent  | BLOCKED  (Layer C  — opt-in)
 *   yes               | present       | present | ATTACH
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
   * - `'host'`         Layer B1: `hostname` is not a `*.private-apps.tossmini.com` host.
   * - `'entry'`        Layer B2: `_deploymentId` param is absent or empty.
   * - `'opt-in'`       Layer C: `debug=1` param is absent.
   * - `'invalid-relay'` Layer C: `relay` param is absent, empty, or not a `wss:` URL.
   *
   * There is no `'build'` reason: Layer A is enforced by the consumer's
   * `if (__DEBUG_BUILD__)` guard, not by this function.
   */
  readonly reason: 'host' | 'entry' | 'opt-in' | 'invalid-relay';
}

export type GateResult = GateResultAttach | GateResultBlocked;

/**
 * Input for {@link evaluateDebugGate}.
 *
 * Both fields are explicit so the function is trivially testable without
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
  // The page must be served from a `*.private-apps.tossmini.com` host. A
  // production `intoss://` entry is served from `*.apps.tossmini.com` and is
  // rejected here. This is what stops a dogfood build that somehow reaches a
  // production entry from attaching: Layer A keeps debug code out of release
  // bundles, and this layer keeps a dogfood bundle that lands on a production
  // host from attaching even though its code is present.
  if (!isPrivateAppsHost(input.hostname)) {
    return { attach: false, reason: 'host' };
  }

  // Layer B2 — runtime entry query gate.
  // `_deploymentId` must be present and non-empty. The `intoss-private://`
  // scheme used for dogfood entries includes this param; general user entry
  // paths do not.
  const deploymentId = input.searchParams.get('_deploymentId') ?? '';
  if (deploymentId === '') {
    return { attach: false, reason: 'entry' };
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

  return { attach: true, relayUrl: relayUrl.href, deploymentId };
}
