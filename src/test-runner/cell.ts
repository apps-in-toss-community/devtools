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

/**
 * `__AIT_PERMS__` key → SDK function name whose `.getPermission()` is probed
 * (devtools#739). This is the exact contract sdk-example#265 consumes — do
 * not rename keys without a coordinated sdk-example update.
 *
 * Each SDK function is reached via `window.__sdk` — the SAME page-global
 * bridge `src/in-app/auto.ts` installs for `call_sdk`/`__sdkCall` (see
 * `src/test-runner/bundle.ts`'s `sdkRedirectPlugin`, which redirects bundled
 * `@apps-in-toss/web-framework` imports to this same object at runtime). The
 * test-runner bundle owns no independent SDK import — `window.__sdk` is a
 * page global regardless of whether a bundle has been injected yet, so this
 * preflight runs standalone via `injectGlobals`'s `Runtime.evaluate`
 * mechanism BEFORE the first bundle, rather than being prepended into
 * `rpc.ts#buildRunTestsExpression`. (Design choice documented in PR #739 —
 * bundle-prepend was the fallback plan if the SDK were only reachable from
 * inside bundle scope, which reality ruled out.)
 */
const PERMISSION_PROBE_MAP: Record<string, string> = {
  clipboardRead: 'getClipboardText',
  clipboardWrite: 'setClipboardText',
  album: 'fetchAlbumPhotos',
  camera: 'openCamera',
  contacts: 'fetchContacts',
  location: 'getCurrentLocation',
};

/** Non-fatal bound for the permission preflight `Runtime.evaluate` round-trip. */
export const PERMISSION_PREFLIGHT_TIMEOUT_MS = 10_000;

/**
 * Builds the `Runtime.evaluate` expression for the permission-state preflight
 * (devtools#739). Evaluated ONCE per relay session, before the first test
 * bundle is injected (see `relay-worker.ts#runTestFilesOverRelay`).
 *
 * For each entry in {@link PERMISSION_PROBE_MAP}, probes
 * `window.__sdk.<fn>.getPermission()` — a NON-blocking query (never
 * `openPermissionDialog`/`requestPermission`, which open native UI) — and
 * assigns the resolved `'allowed'|'denied'|'notDetermined'` status to
 * `globalThis.__AIT_PERMS__[<key>]`. A probe that is absent, throws, or
 * rejects resolves to `'unavailable'` — this expression never throws to its
 * caller, and a single slow/broken permission must not fail the others (each
 * probe is awaited independently, not short-circuited).
 *
 * Tests (sdk-example#265) read `globalThis.__AIT_PERMS__` to branch
 * deterministically per permission state instead of blanket outcome-branching.
 *
 * Returns a JSON-serialised string (the same double-serialisation pattern
 * `rpc.ts#buildRunTestsExpression` uses) rather than relying on CDP
 * `returnByValue` structural fidelity for a plain object across the Chii
 * relay — the Node side re-parses via `JSON.parse`.
 *
 * Pure function — no I/O, no CDP call. Callers pass the returned string to
 * `Runtime.evaluate`.
 */
export function buildPermissionPreflightExpression(): string {
  const probeEntries = Object.entries(PERMISSION_PROBE_MAP)
    .map(
      ([key, fnName]) =>
        `    result[${JSON.stringify(key)}] = await probe(${JSON.stringify(fnName)});`,
    )
    .join('\n');

  return (
    `(async () => {` +
    `  const probe = async (fnName) => {` +
    `    try {` +
    `      const fn = globalThis.__sdk && globalThis.__sdk[fnName];` +
    `      if (!fn || typeof fn.getPermission !== 'function') return 'unavailable';` +
    `      const status = await fn.getPermission();` +
    `      if (status === 'allowed' || status === 'denied' || status === 'notDetermined') return status;` +
    `      return 'unavailable';` +
    `    } catch (e) {` +
    `      return 'unavailable';` +
    `    }` +
    `  };` +
    `  const result = {};` +
    `${probeEntries}\n` +
    `  globalThis.__AIT_PERMS__ = result;` +
    `  return JSON.stringify(result);` +
    `})()`
  );
}

/**
 * Runs the permission-state preflight (devtools#739) via `Runtime.evaluate`
 * and returns the collected `__AIT_PERMS__` map, or `undefined` when the
 * preflight itself failed or timed out.
 *
 * NON-FATAL by design: any failure (CDP exception, timeout, page-side throw)
 * is caught here, logged as ONE stderr line, and swallowed — the whole test
 * run must proceed even when the preflight cannot complete (e.g. `window.__sdk`
 * not yet installed, or a page navigation mid-attach). Callers that want the
 * result for report provenance (`RelayRunReport.preflight`) get `undefined`
 * in that case, which downstream code treats the same as "not run".
 *
 * SECRET-HANDLING: no relay/wss/secret values are read or logged; only
 * permission-state strings cross this boundary.
 *
 * @param conn      - The live CDP connection (relay-attached page).
 * @param timeoutMs - Round-trip bound. Defaults to {@link PERMISSION_PREFLIGHT_TIMEOUT_MS}.
 */
export async function runPermissionPreflight(
  conn: CdpConnection,
  timeoutMs = PERMISSION_PREFLIGHT_TIMEOUT_MS,
): Promise<Record<string, string> | undefined> {
  const TIMEOUT_SENTINEL = Symbol('permission-preflight-timeout');
  const timeoutPromise = new Promise<typeof TIMEOUT_SENTINEL>((resolve) =>
    setTimeout(() => resolve(TIMEOUT_SENTINEL), timeoutMs),
  );

  try {
    const evalPromise = conn.send('Runtime.evaluate', {
      expression: buildPermissionPreflightExpression(),
      returnByValue: true,
      awaitPromise: true,
    });

    const raceResult = await Promise.race([
      evalPromise.then((v) => ({ tag: 'eval' as const, v })),
      timeoutPromise.then(() => ({ tag: 'timeout' as const })),
    ]);

    if (raceResult.tag === 'timeout') {
      process.stderr.write(
        `test-runner: permission preflight timed out after ${timeoutMs}ms — proceeding with __AIT_PERMS__ unset\n`,
      );
      return undefined;
    }

    if (raceResult.v.exceptionDetails) {
      process.stderr.write(
        'test-runner: permission preflight threw — proceeding with __AIT_PERMS__ unset\n',
      );
      return undefined;
    }

    const rawValue = raceResult.v.result.value;
    if (typeof rawValue !== 'string') return undefined;
    const parsed: unknown = JSON.parse(rawValue);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    return parsed as Record<string, string>;
  } catch (e) {
    process.stderr.write(
      `test-runner: permission preflight failed (${
        e instanceof Error ? e.message : String(e)
      }) — proceeding with __AIT_PERMS__ unset\n`,
    );
    return undefined;
  }
}

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
 * Injects (or updates) the "Debugger Connected"/"Debugger Disconnected"
 * on-phone indicator via `Runtime.evaluate` (#730).
 *
 * Uses the same CDP mechanism as {@link injectGlobals} — a single
 * `Runtime.evaluate` round-trip with the expression built by
 * {@link buildIndicatorExpression}. The indicator is a LIVE badge rendered at
 * the bottom-left of the page (position:fixed, safe-area-aware): the badge's
 * controller is idempotent, so calling this again (e.g. right before
 * `close()` with `{ state: 'disconnected' }`) UPDATES the existing badge in
 * place instead of injecting a duplicate.
 *
 * **Isolation**: unlike {@link injectGlobals}, this function NEVER throws to
 * its caller. Injection failure (e.g. page detached during inject, CSS not
 * supported) is swallowed and logged as `console.debug` — the badge is
 * informational UI and must never block attach success or test execution.
 * This is the same fire-and-forget spirit as the in-page console mount in
 * `src/in-app/attach.ts`.
 *
 * Call this ONLY on the manual debug paths (start_attach MCP, devtools-test
 * CLI). Do NOT call on the `run_tests` auto-attach path — the badge
 * would contaminate screenshots, measure_safe_area probes, and DOM snapshots
 * taken during automated measurement runs.
 *
 * SECRET-HANDLING: the injected expression contains no secrets, relay URLs,
 * wss addresses, or TOTP codes — it is pure DOM UI text + enum state built by
 * {@link buildIndicatorExpression}.
 *
 * @param conn - The live CDP connection (relay-attached page).
 * @param opts - Optional overrides forwarded to {@link buildIndicatorExpression}.
 */
export async function injectDebugIndicator(
  conn: CdpConnection,
  opts?: { label?: string; disconnectedLabel?: string; state?: 'attached' | 'disconnected' },
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
