/**
 * 3-layer activation gate for the in-app debug surface.
 *
 * Spec: docs/superpowers/specs/2026-05-18-in-app-debug-mcp.md
 * "3-layer activation gate". This is the pure gate decision; the Chii client,
 * WebSocket transport, MCP server, and CLI that consume it live in src/mcp/.
 *
 * Decision matrix:
 *
 *   build channel | _deploymentId | debug=1 | result
 *   release       | (any)         | (any)   | BLOCKED  (Layer A — code absent via DCE)
 *   dogfood       | absent        | (any)   | BLOCKED  (Layer B — entry gate)
 *   dogfood       | present       | absent  | BLOCKED  (Layer C — opt-in gate)
 *   dogfood       | present       | present | ATTACH
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
   * - `'build'`        Layer A: `__DEBUG_BUILD__` is false (release build).
   * - `'entry'`        Layer B: `_deploymentId` param is absent or empty.
   * - `'opt-in'`       Layer C: `debug=1` param is absent.
   * - `'invalid-relay'` Layer C: `relay` param is absent, empty, or not a `wss:` URL.
   */
  readonly reason: 'build' | 'entry' | 'opt-in' | 'invalid-relay';
}

export type GateResult = GateResultAttach | GateResultBlocked;

/**
 * Input for {@link evaluateDebugGate}.
 *
 * Keeping each field explicit makes the function trivially testable without
 * needing to manipulate `window.location`.
 */
export interface GateInput {
  /**
   * Whether this is a debug build. Corresponds to the `__DEBUG_BUILD__`
   * compile-time constant injected by tsdown.
   *
   * In source code consumed via `@ait-co/devtools/in-app`, the thin
   * `src/in-app/index.ts` entry reads `__DEBUG_BUILD__` and passes it here.
   * Tests supply it directly.
   */
  readonly isDebugBuild: boolean;

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
 * Pure function that evaluates the 3-layer debug activation gate.
 *
 * Has no side effects. All inputs are explicit. Returns a discriminated union
 * so callers can pattern-match on `result.attach`.
 *
 * @example
 * ```ts
 * const result = evaluateDebugGate({
 *   isDebugBuild: __DEBUG_BUILD__,
 *   searchParams: new URLSearchParams(window.location.search),
 * });
 * if (result.attach) {
 *   // Proceed to load Chii client
 * }
 * ```
 */
export function evaluateDebugGate(input: GateInput): GateResult {
  // Layer A — build-time gate.
  // When false, the entire in-app entry + Chii imports are dead-code-eliminated
  // by the bundler (tsdown/Rolldown constant folding). Release builds never
  // contain this branch at all.
  if (!input.isDebugBuild) {
    return { attach: false, reason: 'build' };
  }

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
