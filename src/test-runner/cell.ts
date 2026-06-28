/**
 * Cell injection helper for the test runner (issue #684 §4.1).
 *
 * A "cell" is an arbitrary key/value record that is injected into the page's
 * `globalThis` BEFORE the first test bundle is evaluated. The canonical
 * consumer is `sdk-example`'s `aitCapture.ts`, which reads
 * `globalThis.__AIT_CELL__` to pick the correct `sdkLine` / `platform` axis
 * for a test session.
 *
 * devtools does NOT know the sdk-example-specific shape of `__AIT_CELL__` —
 * it only provides the GENERAL mechanism for injecting any record into the
 * page's globalThis. The caller (run_tests handler, CLI) supplies the exact
 * object via `globals: Record<string, unknown>`.
 *
 * Inject BEFORE the first `bundleTestFile` evaluate call so that every
 * subsequent bundle sees the values as already present (the cell is a
 * session-global, so one inject covers all files in a run).
 *
 * SECRET-HANDLING: `globals` values are not secrets (cell axes are
 * informational — sdkLine, platform). Minimise logging of the values to
 * avoid leaking anything the caller passes unexpectedly; the log emitted here
 * records only the key names, not the values.
 *
 * react-free — only depends on `CdpConnection` (Node-only CDP transport).
 * No React import, no browser-side bundle.
 *
 * Node-only.
 */

import type { CdpConnection } from '../mcp/cdp-connection.js';

/**
 * Injects each key in `globals` into `globalThis` on the attached page via a
 * single `Runtime.evaluate` call. All keys are assigned atomically in one
 * IIFE so a partial-inject cannot leave the page in a torn state.
 *
 * Must be called AFTER the page is attached and BEFORE the first test bundle
 * is injected.
 *
 * @param conn    - An active CDP connection with at least one attached target.
 * @param globals - Key/value pairs to assign on `globalThis`. Values must be
 *                  JSON-serialisable (they are passed through
 *                  `JSON.stringify`). Non-serialisable values (functions,
 *                  undefined, circular refs) will be silently coerced by
 *                  `JSON.stringify`.
 */
export async function injectGlobals(
  conn: CdpConnection,
  globals: Record<string, unknown>,
): Promise<void> {
  if (Object.keys(globals).length === 0) return;

  // SECRET-HANDLING: log key names only, never values (caller may pass
  // sensitive data through globals inadvertently in future usage).
  const keys = Object.keys(globals);

  // Build a single IIFE that atomically assigns all keys to globalThis.
  // Using Object.assign keeps this to one Runtime.evaluate round-trip.
  // JSON.stringify encodes the values for safe cross-CDP transport
  // (returnByValue: true is reliable for booleans; using an expression
  // is more portable for arbitrary objects).
  const expr = `(() => { Object.assign(globalThis, ${JSON.stringify(globals)}); return ${JSON.stringify(keys)}; })()`;

  await conn.send('Runtime.evaluate', {
    expression: expr,
    returnByValue: true,
  });
}
