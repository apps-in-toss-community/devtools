/**
 * Shared `APP_BRIDGE_THROTTLED` detection (devtools#767).
 *
 * 2026-07-10 real-device observation: the Toss app native side added a
 * per-method rate limit to the 2.x bridge — calling the SAME bridge method
 * twice within a short window rejects the second call immediately with a
 * 2.x native envelope (`{name, code, userInfo, moduleName, __isError}`) whose
 * `code` is `'APP_BRIDGE_THROTTLED'` and whose `message` reads
 * `"Too many app bridge calls from <method>."`. The 3.x bridge path is
 * unaffected (devtools#767 issue body, sdk-example#284 2026-07-10 comment).
 *
 * This module is the SINGLE source of the detection predicate. Today's only
 * consumer is `runtime.ts` (in-page, per-test retry loop) — a plain static
 * import; esbuild inlines this file into the same IIFE bundle (same
 * mechanism as `bridge-stub.ts`, see `bundle.ts#getPageSideModulePath`). It
 * is exported from this standalone, dependency-free module (rather than
 * defined inline in `runtime.ts`) so a Node-side consumer could import the
 * exact same predicate in future if whole-FILE throttle-aware retry is ever
 * added on top of the per-test retry `runtime.ts` already performs — no such
 * Node-side caller exists yet (whole-file retry today only triggers on an
 * `injectAndRunBundle`-level timeout/exception, a distinct failure mode from
 * a `RunReport` that completed normally but contains a THROTTLED-failed
 * test — see `relay-worker.ts`'s `EVALUATE_TIMEOUT_MARKER` gate).
 *
 * Browser-compatible, dependency-free (no Node APIs) — safe to import from
 * either side of the CDP boundary, mirroring `runtime.ts`'s own constraint.
 */

/** The native error code the Toss app bridge returns when rate-limited. */
export const THROTTLED_ERROR_CODE = 'APP_BRIDGE_THROTTLED';

/** The message substring the native envelope carries when rate-limited. */
export const THROTTLED_MESSAGE_SUBSTRING = 'Too many app bridge calls';

/**
 * True when `err` looks like a native `APP_BRIDGE_THROTTLED` rejection —
 * either the 2.x native envelope's `code` field equals
 * {@link THROTTLED_ERROR_CODE}, or the error's message contains
 * {@link THROTTLED_MESSAGE_SUBSTRING}. Either signal alone is sufficient: the
 * `code` field is the precise native signal, but a caller may only have a
 * stringified message (e.g. `Error#message` after the native envelope was
 * flattened) — checking both keeps detection robust across both shapes.
 *
 * Accepts `unknown` because callers may pass a caught page-side exception
 * (whose shape is not statically known), a `TestResult.error` string, or a
 * `FileResult` error string — never throws.
 */
export function isThrottledError(err: unknown): boolean {
  if (err === null || err === undefined) return false;

  if (typeof err === 'string') {
    return err.includes(THROTTLED_MESSAGE_SUBSTRING);
  }

  if (typeof err === 'object') {
    const rec = err as { code?: unknown; message?: unknown };
    if (rec.code === THROTTLED_ERROR_CODE) return true;
    if (typeof rec.message === 'string' && rec.message.includes(THROTTLED_MESSAGE_SUBSTRING)) {
      return true;
    }
  }

  return false;
}
