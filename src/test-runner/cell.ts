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

import { THROTTLED_ERROR_CODE, THROTTLED_MESSAGE_SUBSTRING } from './throttle.js';

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

/**
 * Inter-probe spacing (ms) applied BEFORE every probe after the first
 * (devtools#767). The native per-method bridge rate limit observed
 * 2026-07-10 rejects a SECOND call to the same method within a short window
 * with `APP_BRIDGE_THROTTLED` — the permission preflight's un-paced burst
 * (6 probes fired back-to-back) was the FIRST trigger of that limiter in the
 * wild (only the first probe passed; the remaining 5 came back throttled →
 * `unavailable`, cascading into skipped `__AIT_PERMS__`-branching tests).
 * Sequential-with-spacing is cheap insurance even though each probe targets a
 * DIFFERENT method — the limiter's exact scope (per-method vs. a shared
 * bridge-wide window) was not reverse-engineered (explicitly out of scope,
 * devtools#767) so spacing every probe is the conservative choice.
 */
const PROBE_INTER_CALL_DELAY_MS = 250;

/**
 * Backoff delays (ms) between retry attempts when a probe is throttled. Its
 * `.length` IS the max retry count (devtools#767: "최대 2회 재시도") — the
 * generated page-side expression below derives `attempt < backoff.length`
 * from this same array (via `backoffArray`), so there is a single source for
 * both the delay ladder and the retry count; no separate max-retries
 * constant is kept in this module (unlike `runtime.ts`'s `TEST_MAX_RETRIES`,
 * which IS consumed directly by a Node-side loop condition).
 */
const PROBE_RETRY_BACKOFF_MS = [500, 1000] as const;

/**
 * Non-fatal bound for the permission preflight `Runtime.evaluate` round-trip
 * (devtools#767: raised from the pre-pacing 10s to cover the new sequential +
 * backoff time budget).
 *
 * Worst-case budget with 6 probes, each requiring the full retry ladder:
 *   - inter-probe spacing: only BEFORE probes 2‑6 (none before the first) =
 *     5 × {@link PROBE_INTER_CALL_DELAY_MS} = 1 250ms
 *   - per-probe backoff (both retries taken): 6 × (500 + 1000) = 9 000ms
 *   - probe round-trips themselves (headroom, not just the sleeps): ~4 500ms
 *   total ≈ 14 750ms, rounded up to a clean 20 000ms for headroom.
 */
export const PERMISSION_PREFLIGHT_TIMEOUT_MS = 20_000;

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
 * devtools#767: probes run SEQUENTIALLY (not a parallel burst) with a
 * {@link PROBE_INTER_CALL_DELAY_MS} gap before each probe after the first, and
 * a probe that comes back `APP_BRIDGE_THROTTLED` (native per-method bridge
 * rate limit) is retried up to {@link PROBE_RETRY_BACKOFF_MS}`.length` times
 * with the same {@link PROBE_RETRY_BACKOFF_MS} ladder before falling back to
 * `'unavailable'`.
 * The THROTTLED detection mirrors `throttle.ts#isThrottledError` inline (this
 * expression is raw JS text evaluated via CDP, not an esbuild-bundled module,
 * so it cannot statically `import` that helper) — kept in sync by checking
 * BOTH `e.code === 'APP_BRIDGE_THROTTLED'` and a message substring match, the
 * same two signals `isThrottledError` checks.
 *
 * devtools#767 acceptance criteria 2 ("3.x run duration은 유의미하게 늘지 않음,
 * pacing은 opt-in 또는 throttle-adaptive") requires this NOT be an unconditional
 * cost — `pace` (default `true`, matching the pre-existing sequential+spacing
 * behavior for 2.x/unknown cells) lets a 3.x caller skip BOTH the inter-probe
 * `sleep(250)` AND the retry backoff ladder, since `APP_BRIDGE_THROTTLED` is a
 * 2.x-bridge-only limiter (see `--pace`'s own doc in `cli.ts`: "3.x cells are
 * unaffected by that limiter"). When `pace` is `false`, probes still run
 * sequentially (never a parallel burst) but back-to-back with no added delay,
 * and a THROTTLED result resolves to `'unavailable'` immediately (no retry) —
 * this matches the 3.x runtime, which never emits `APP_BRIDGE_THROTTLED`.
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
 *
 * @param pace - Defaults to `true` (today's sequential+spacing+backoff
 *   behavior). Pass `false` for a 3.x cell to skip the inter-probe delay and
 *   the THROTTLED retry ladder entirely.
 */
export function buildPermissionPreflightExpression(pace = true): string {
  const probeKeys = Object.keys(PERMISSION_PROBE_MAP);
  const probeCalls = probeKeys
    .map((key, i) => {
      const fnName = PERMISSION_PROBE_MAP[key];
      // Every probe after the first waits PROBE_INTER_CALL_DELAY_MS first —
      // sequential execution with spacing, never a parallel burst. Skipped
      // entirely when `pace` is false (3.x cell — no native limiter to dodge).
      const spacing = i === 0 || !pace ? '' : `    await sleep(${PROBE_INTER_CALL_DELAY_MS});\n`;
      return (
        `${spacing}` +
        `    result[${JSON.stringify(key)}] = await probeWithRetry(${JSON.stringify(fnName)});`
      );
    })
    .join('\n');

  // 3.x cells never emit APP_BRIDGE_THROTTLED (it's a 2.x-bridge-only native
  // limiter) — an empty backoff ladder makes `probeWithRetry` resolve any
  // throw (throttled or not) to 'unavailable' on the FIRST attempt, with zero
  // retry sleeps, satisfying devtools#767 acceptance criteria 2.
  const backoffArray = pace ? `[${PROBE_RETRY_BACKOFF_MS.join(',')}]` : '[]';

  return (
    `(async () => {` +
    `  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));` +
    `  const isThrottled = (e) => {` +
    `    if (!e) return false;` +
    `    if (e.code === ${JSON.stringify(THROTTLED_ERROR_CODE)}) return true;` +
    `    const msg = typeof e.message === 'string' ? e.message : '';` +
    `    return msg.indexOf(${JSON.stringify(THROTTLED_MESSAGE_SUBSTRING)}) !== -1;` +
    `  };` +
    `  const probe = async (fnName) => {` +
    `    const fn = globalThis.__sdk && globalThis.__sdk[fnName];` +
    `    if (!fn || typeof fn.getPermission !== 'function') return { ok: true, value: 'unavailable' };` +
    `    const status = await fn.getPermission();` +
    `    if (status === 'allowed' || status === 'denied' || status === 'notDetermined') return { ok: true, value: status };` +
    `    return { ok: true, value: 'unavailable' };` +
    `  };` +
    // probeWithRetry: up to PROBE_RETRY_BACKOFF_MS.length retries on THROTTLED,
    // backing off per PROBE_RETRY_BACKOFF_MS. Any OTHER throw (or a
    // non-throttled outcome) resolves to 'unavailable' immediately — only
    // THROTTLED gets a retry.
    `  const backoff = ${backoffArray};` +
    `  const probeWithRetry = async (fnName) => {` +
    `    for (let attempt = 0; attempt <= backoff.length; attempt++) {` +
    `      try {` +
    `        const r = await probe(fnName);` +
    `        return r.value;` +
    `      } catch (e) {` +
    `        if (isThrottled(e) && attempt < backoff.length) {` +
    `          await sleep(backoff[attempt]);` +
    `          continue;` +
    `        }` +
    `        return 'unavailable';` +
    `      }` +
    `    }` +
    `    return 'unavailable';` +
    `  };` +
    `  const result = {};` +
    `${probeCalls}\n` +
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
 * @param pace      - Forwarded to {@link buildPermissionPreflightExpression}.
 *   Defaults to `true` (today's sequential+spacing+backoff behavior, correct
 *   for 2.x/unknown cells). Callers that know the cell is 3.x should pass
 *   `false` — devtools#767 acceptance criteria 2 requires 3.x run duration not
 *   grow from this preflight, and 3.x never hits the 2.x-only
 *   `APP_BRIDGE_THROTTLED` limiter this pacing exists to dodge.
 */
export async function runPermissionPreflight(
  conn: CdpConnection,
  timeoutMs = PERMISSION_PREFLIGHT_TIMEOUT_MS,
  pace = true,
): Promise<Record<string, string> | undefined> {
  const TIMEOUT_SENTINEL = Symbol('permission-preflight-timeout');
  const timeoutPromise = new Promise<typeof TIMEOUT_SENTINEL>((resolve) =>
    setTimeout(() => resolve(TIMEOUT_SENTINEL), timeoutMs),
  );

  try {
    const evalPromise = conn.send('Runtime.evaluate', {
      expression: buildPermissionPreflightExpression(pace),
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
