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
 * Decision matrix (the gate only ever runs in a debug build — Layer A already
 * passed by the time this code is reachable):
 *
 *   _deploymentId | debug=1 | result
 *   absent        | (any)   | BLOCKED  (Layer B — entry gate)
 *   present       | absent  | BLOCKED  (Layer C — opt-in gate)
 *   present       | present | ATTACH
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
   * - `'entry'`        Layer B: `_deploymentId` param is absent or empty.
   * - `'opt-in'`       Layer C: `debug=1` param is absent.
   * - `'invalid-relay'` Layer C: `relay` param is absent, empty, or not a `wss:` URL.
   *
   * There is no `'build'` reason: Layer A is enforced by the consumer's
   * `if (__DEBUG_BUILD__)` guard, not by this function.
   */
  readonly reason: 'entry' | 'opt-in' | 'invalid-relay';
}

export type GateResult = GateResultAttach | GateResultBlocked;

/**
 * Input for {@link evaluateDebugGate}.
 *
 * Keeping the field explicit makes the function trivially testable without
 * needing to manipulate `window.location`.
 */
export interface GateInput {
  /**
   * The URL search params to inspect for gate signals.
   *
   * Prefer `URLSearchParams` so callers can pass `new URLSearchParams(location.search)`
   * without coupling the pure function to `window`.
   *
   * Layer B open seam (spec open question 2): if the Toss SDK ever exposes
   * `getEntryScheme()` or a similar API that reliably signals a dogfood entry,
   * that signal should be checked before `_deploymentId` here. For now only the
   * `_deploymentId` query param fallback is implemented. Pass a custom
   * `URLSearchParams` to inject the SDK signal at the call site without
   * modifying this function.
   */
  readonly searchParams: URLSearchParams;
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
 *   searchParams: new URLSearchParams(window.location.search),
 * });
 * if (result.attach) {
 *   // Proceed to load Chii client
 * }
 * ```
 */
export function evaluateDebugGate(input: GateInput): GateResult {
  // Layer B — runtime entry scheme gate.
  // `_deploymentId` must be present and non-empty. The `intoss-private://`
  // scheme used for dogfood entries includes this param; general user entry
  // paths do not.
  //
  // Open seam (spec open question 2): if the Toss SDK exposes getEntryScheme()
  // or similar, that should be the 1st-priority signal checked here, with
  // `_deploymentId` as fallback. Extend this check at the call site by
  // pre-populating `searchParams` with the SDK signal, or add an optional
  // `entryScheme` field to `GateInput` in a later phase.
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
