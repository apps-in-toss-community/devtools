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
