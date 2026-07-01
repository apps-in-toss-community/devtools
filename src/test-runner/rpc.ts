/**
 * Node-side RPC helpers for injecting and collecting test execution over CDP.
 *
 * Uses the same IIFE + JSON.stringify envelope pattern as `buildCallSdkExpression`
 * in `src/mcp/tools.ts` to reliably shuttle structured results through
 * `Runtime.evaluate`'s `returnByValue: true` boundary.
 *
 * SECRET-HANDLING: bundle code, relay URLs, and result values are NOT logged.
 */

import type { CdpConnection } from '../mcp/cdp-connection.js';
import type { RunReport } from './runtime.js';

/** Maximum milliseconds to wait for a single evaluate round-trip. */
const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Wraps bundle code in a self-executing IIFE that:
 *   1. Evaluates the bundle (registering describe/it/test).
 *   2. Calls `__testBundle.runTestModule(...)` — the entry the runtime exports.
 *   3. Returns a JSON-serialised `RunReport` string.
 *
 * The double-serialisation (RunReport → JSON string → returnByValue string)
 * is intentional: CDP `returnByValue` reliably transports strings; deeply
 * nested objects can lose fidelity across the Chii relay.
 *
 * SECRET-HANDLING: `bundleCode` MUST NOT be logged by callers.
 */
export function buildRunTestsExpression(bundleCode: string): string {
  // We trust bundleCode is already a self-contained IIFE that installs
  // `window.__testBundle` (or `globalThis.__testBundle`).
  // We then call `__testBundle.runTestModule()` and return a JSON string.
  return (
    `(async () => {` +
    // Step 1: evaluate the bundle to register tests
    `  try { ${bundleCode} } catch(e) {` +
    `    return JSON.stringify({ok:false,error:'bundle-eval: ' + String(e && e.message || e)});` +
    `  }` +
    // Step 2: check that the expected exports are present
    `  if (typeof globalThis.__testBundle !== 'object' || typeof globalThis.__testBundle.runTestModule !== 'function' || typeof globalThis.__testBundle.__userFactory !== 'function') {` +
    `    return JSON.stringify({ok:false,error:'bundle-missing-export: __testBundle.runTestModule or __userFactory is not a function'});` +
    `  }` +
    // Step 3: run tests — pass the factory so runTestModule installs globals
    // first, then invokes the factory to register describe/it/test blocks.
    `  try {` +
    `    const report = await globalThis.__testBundle.runTestModule(globalThis.__testBundle.__userFactory);` +
    `    return JSON.stringify({ok:true,value:report});` +
    `  } catch(e) {` +
    `    return JSON.stringify({ok:false,error:'test-run: ' + String(e && e.message || e)});` +
    `  }` +
    `})()`
  );
}

/**
 * Result of `injectAndRunBundle`.
 */
export type RpcRunResult = { ok: true; report: RunReport } | { ok: false; error: string };

/**
 * Parses the raw CDP `returnByValue` result from a `buildRunTestsExpression`
 * evaluate call into a typed `RpcRunResult`.
 *
 * Throws only on parse failure — an `ok:false` envelope is a normal result.
 *
 * SECRET-HANDLING: `rawValue` is not included in error messages.
 */
export function parseRunTestsResult(rawValue: unknown): RpcRunResult {
  if (typeof rawValue !== 'string') {
    throw new Error(
      `rpc.parseRunTestsResult: unexpected return type "${typeof rawValue}" — expected JSON string`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    // Do NOT include rawValue — could contain secrets.
    throw new Error('rpc.parseRunTestsResult: bridge returned non-JSON string');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('rpc.parseRunTestsResult: parsed result is not an object');
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.ok === true) {
    return { ok: true, report: obj.value as RunReport };
  }
  if (obj.ok === false) {
    return {
      ok: false,
      error: typeof obj.error === 'string' ? obj.error : String(obj.error),
    };
  }
  throw new Error('rpc.parseRunTestsResult: result missing "ok" field');
}

/**
 * Injects `bundleCode` into the attached page and awaits test execution.
 *
 * Uses `Runtime.evaluate` with `awaitPromise: true` to wait for the
 * async IIFE to settle.  The 30-second CDP command timeout covers even
 * long-running test suites; split into smaller files if you hit it.
 *
 * @param connection   - Active CDP connection (relay or local).
 * @param bundleCode   - IIFE bundle string from `bundleTestFile`.
 * @param timeoutMs    - Override the default 30 s timeout.
 *
 * SECRET-HANDLING: `bundleCode` and the raw CDP result value are never logged.
 */
export async function injectAndRunBundle(
  connection: CdpConnection,
  bundleCode: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<RpcRunResult> {
  const expression = buildRunTestsExpression(bundleCode);

  // Use a tagged race so we can distinguish "timeout won" from "evaluate won"
  // without relying on exception identity.  The timeout arm RETURNS a typed
  // RpcRunResult (ok:false + EVALUATE_TIMEOUT_MARKER) so the caller (relay-
  // worker's attempt()) can detect it via `.error.includes(EVALUATE_TIMEOUT_MARKER)`
  // and trigger the one-retry path.
  //
  // Genuine CDP `exceptionDetails` (engine exceptions thrown inside the page)
  // still THROW — those are deterministic failures that a retry cannot fix and
  // relay-worker's catch block finalises them correctly.
  //
  // DO NOT change the literal string below — relay-worker.ts imports
  // EVALUATE_TIMEOUT_MARKER = 'rpc: evaluate timed out after' and uses
  // `.includes()` to recognise this exact prefix.
  const TIMEOUT_SENTINEL = Symbol('timeout');
  const timeoutPromise = new Promise<typeof TIMEOUT_SENTINEL>((resolve) =>
    setTimeout(() => resolve(TIMEOUT_SENTINEL), timeoutMs),
  );

  const evalPromise = connection.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });

  const raceResult = await Promise.race([
    evalPromise.then((v) => ({ tag: 'eval' as const, v })),
    timeoutPromise.then(() => ({ tag: 'timeout' as const })),
  ]);

  if (raceResult.tag === 'timeout') {
    return { ok: false, error: `rpc: evaluate timed out after ${timeoutMs}ms` };
  }

  const cdpResult = raceResult.v;

  if (cdpResult.exceptionDetails) {
    // Surface only the engine error string — not the expression or value.
    const msg =
      cdpResult.exceptionDetails.exception?.description ??
      cdpResult.exceptionDetails.text ??
      'Runtime.evaluate threw an exception';
    throw new Error(`rpc.injectAndRunBundle: ${msg}`);
  }

  return parseRunTestsResult(cdpResult.result.value);
}
