/**
 * Cell injection utility for the `devtools-test` CLI (issue #684 §4.1).
 *
 * Injects arbitrary globals into the page via `Runtime.evaluate` BEFORE the
 * first test bundle is injected. The injected values are session-global — one
 * call covers all files in the run.
 *
 * The primary use-case is injecting `__AIT_CELL__` (sdkLine/platform) so
 * sdk-example's `aitCapture.ts` picks up the correct test-axis values instead
 * of falling back to `'2.x'`/`'mock'`.
 *
 * devtools does NOT know the shape of `__AIT_CELL__` — it only provides the
 * general injection mechanism. The caller (CLI or MCP auto-attach path) is
 * responsible for constructing the cell object.
 *
 * SECRET-HANDLING: cell values (sdkLine/platform) are not secrets and may be
 * logged at the caller's discretion. This module does NOT log them itself.
 *
 * Node-only. react-free. CdpConnection only.
 */

import { buildIndicatorExpression } from '../mcp/attach-orchestrator.js';
import type { CdpConnection } from '../mcp/cdp-connection.js';

/**
 * Injects each key of `globals` into `globalThis` in the page via a single
 * `Runtime.evaluate` call. Must be called BEFORE the first `bundleTestFile`
 * inject — the cell is session-global and applies to all subsequent files.
 *
 * Throws if the CDP evaluate returns an exception.
 *
 * @param conn    - The live CDP connection (relay-attached page).
 * @param globals - Plain-JSON-serialisable key→value map to assign onto `globalThis`.
 */
export async function injectGlobals(
  conn: CdpConnection,
  globals: Record<string, unknown>,
): Promise<void> {
  // JSON.stringify is safe here: globals values are plain data (sdkLine/platform
  // strings or simple objects). If a value is not JSON-serialisable this throws
  // at call time, which surfaces the error early and clearly.
  const expr = `(() => { Object.assign(globalThis, ${JSON.stringify(globals)}); return true; })()`;
  const result = await conn.send('Runtime.evaluate', { expression: expr, returnByValue: true });
  if (result.exceptionDetails) {
    const msg =
      result.exceptionDetails.exception?.description ??
      result.exceptionDetails.text ??
      'unknown error';
    throw new Error(`injectGlobals: Runtime.evaluate threw: ${msg}`);
  }
}

/**
 * Injects the "Debugger Connected" on-phone indicator via `Runtime.evaluate`.
 *
 * Uses the same CDP mechanism as {@link injectGlobals} — a single
 * `Runtime.evaluate` round-trip with the expression built by
 * {@link buildIndicatorExpression}. The indicator is a dismissible red badge
 * rendered at the bottom-left of the page (position:fixed, safe-area-aware).
 *
 * **Isolation**: unlike {@link injectGlobals}, this function NEVER throws to
 * its caller. Injection failure (e.g. page detached during inject, CSS not
 * supported) is swallowed and logged as `console.debug` — the badge is
 * informational UI and must never block attach success or test execution.
 * This is the same fire-and-forget spirit as the eruda mount in
 * `src/in-app/attach.ts`.
 *
 * Call this ONLY on the manual debug paths (start_attach MCP, devtools-test
 * CLI). Do NOT call on the `run_tests` auto-attach path — the red badge
 * would contaminate screenshots, measure_safe_area probes, and DOM snapshots
 * taken during automated measurement runs.
 *
 * SECRET-HANDLING: the injected expression contains no secrets, relay URLs,
 * wss addresses, or TOTP codes — it is pure DOM UI text built by
 * {@link buildIndicatorExpression}.
 *
 * @param conn - The live CDP connection (relay-attached page).
 * @param opts - Optional overrides forwarded to {@link buildIndicatorExpression}.
 */
export async function injectDebugIndicator(
  conn: CdpConnection,
  opts?: { label?: string },
): Promise<void> {
  try {
    await conn.send('Runtime.evaluate', {
      expression: buildIndicatorExpression(opts),
      returnByValue: true,
    });
  } catch (err) {
    // Badge injection is informational UI — swallow and log; never propagate.
    console.debug('[@ait-co/devtools] debug indicator inject skipped:', err);
  }
}
