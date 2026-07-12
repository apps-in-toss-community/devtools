/**
 * Per-method minimum-interval pacing for SDK calls (devtools#769).
 *
 * #767's `--pace` inserts delays BETWEEN test files / test-to-test — it has no
 * effect on a burst of same-method calls WITHIN a single test body (e.g. a
 * clipboard happy-path loop calling `setClipboardText`/`getClipboardText`
 * eight times back to back). Real-device observation (sdk-example#293,
 * 2.x×iOS) showed that burst alone is enough to saturate the native
 * per-method bridge rate limit (`APP_BRIDGE_THROTTLED`, devtools#767/throttle.ts)
 * even though `--pace`'s file/test spacing was already in effect — the
 * limiter reacts to burst cadence within a method name, not just across test
 * boundaries.
 *
 * This module wraps `window.__sdk` (the same bridge object `bundle.ts`'s
 * `sdkRedirectPlugin` redirects SDK imports to) so that every call to the
 * SAME named function waits out a minimum gap since that function's PREVIOUS
 * invocation before the real call proceeds. Preflight (`cell.ts`) proved the
 * inverse case empirically: a steady 250ms sequential cadence passes cleanly
 * where an unpaced burst does not — sequential-with-spacing is the fix this
 * module generalizes to every SDK call, not just the six permission probes.
 *
 * Runs entirely on the PAGE side (browser-compatible, no Node APIs) — bundled
 * into the injected IIFE by `bundle.ts`'s `sdkRedirectPlugin`, the same way
 * `bridge-stub.ts` and `runtime.ts` are. Imported ONLY from the test-runner
 * (never from `sdk-example/src` — boilerplate cleanliness, umbrella §1.4).
 *
 * SECRET-HANDLING: this module carries no secrets — only method names and
 * millisecond timestamps/durations.
 */

/**
 * Page-global registry of per-method last-invocation timestamps
 * (`performance.now()`-relative, monotonic). One registry per page — shared
 * across every wrapped SDK object so repeated `wrapWithMethodPacing` calls
 * (e.g. the sdk-redirect virtual module re-evaluated per test file bundle)
 * still see the true last-invoke time of a given method name, not a fresh
 * per-bundle registry that would silently reset pacing at every file
 * boundary.
 */
type MethodPaceState = Map<string, number>;

const REGISTRY_KEY = '__AIT_METHOD_PACE_STATE__';

/** Reads (or lazily creates) the page-global per-method pacing registry. */
function getRegistry(): MethodPaceState {
  const g = globalThis as { [REGISTRY_KEY]?: MethodPaceState };
  let state = g[REGISTRY_KEY];
  if (!(state instanceof Map)) {
    state = new Map<string, number>();
    g[REGISTRY_KEY] = state;
  }
  return state;
}

/** `setTimeout`-based sleep — no Node APIs, safe on the page side. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * True when `value` is a `class` declaration rather than a plain callable
 * function. The SDK export surface includes at least one class (`PermissionError`,
 * `src/__typecheck.ts`/`bridge-stub.ts` both reference it) — wrapping a class
 * in an async arrow function would silently break `new PermissionError()`
 * (arrow functions are not constructible), so classes must pass through
 * `wrapWithMethodPacing` unwrapped exactly like any other non-callable
 * export. Detected via `Function.prototype.toString` starting with
 * `"class "` — the standard, spec-guaranteed way to distinguish a class from
 * an ordinary function at runtime (no Babel/TS transform in this bundle
 * target — `target: 'es2022'` in `bundle.ts` — down-compiles `class` to a
 * function, so this check remains reliable for esbuild's es2022 output).
 */
function isClass(value: (...args: unknown[]) => unknown): boolean {
  return Function.prototype.toString.call(value).startsWith('class ');
}

/**
 * Reads the page-global `__AIT_PACE_METHOD_MS__` gap value (devtools#769),
 * injected by `relay-factory.ts` the same way `__AIT_PACE_MS__`/`__AIT_CELL__`
 * are (`cell.ts#injectGlobals`). Absent/non-positive resolves to `0` — the
 * same "treat absence as zero" contract `runtime.ts`'s `__AIT_PACE_MS__` read
 * uses.
 */
export function getPaceMethodMs(): number {
  const raw = (globalThis as { __AIT_PACE_METHOD_MS__?: unknown }).__AIT_PACE_METHOD_MS__;
  return typeof raw === 'number' && raw > 0 ? raw : 0;
}

/**
 * Wraps a single named SDK function so that calls to it wait out `gapMs`
 * since the function's own previous invocation (tracked in the shared
 * `getRegistry()` map, keyed by `name`) before the real `fn` runs. The
 * result/rejection of `fn` passes through completely unchanged — pacing
 * never alters contract-observed behavior, only its timing.
 */
function buildPacedFunction(
  name: string,
  fn: (...args: unknown[]) => unknown,
  gapMs: number,
): (...args: unknown[]) => unknown {
  return async (...args: unknown[]) => {
    const registry = getRegistry();
    const now = performance.now();
    const lastInvokeAt = registry.get(name);
    if (lastInvokeAt !== undefined) {
      const elapsed = now - lastInvokeAt;
      if (elapsed < gapMs) {
        await sleep(gapMs - elapsed);
      }
    }
    // Record the timestamp AFTER any wait but BEFORE the real call — this is
    // "last invoke attempt", matching the preflight's own "sequential with
    // spacing before each call" model rather than "last completion", so two
    // long-running calls in flight cannot both slip under the gap.
    registry.set(name, performance.now());
    return fn(...args);
  };
}

/**
 * Wraps an SDK-shaped bridge object (`window.__sdk`, or the already
 * stub-wrapped result of `bridge-stub.ts#wrapSdkWithStub`) so that every
 * function-valued export is paced to a minimum `gapMs` interval between
 * calls to the SAME name (devtools#769). Non-function exports (constants,
 * etc.) and classes (`PermissionError`, etc. — wrapping a class would break
 * `new`, see `isClass`) pass through completely untouched.
 *
 * **Composition with bridge-stub (devtools#740)**: this wrapper is applied to
 * the RAW `window.__sdk` object, and `wrapSdkWithStub` is applied on TOP of
 * the paced result (`wrapSdkWithStub(wrapWithMethodPacing(rawSdk, gapMs),
 * stubEnabled)` — see `bundle.ts`'s sdk-redirect virtual module). This means
 * pacing sits BEHIND the stub interception: a stubbed name
 * (`STUB_REGISTRY` — `openPermissionDialog`, `requestPermission`,
 * `saveBase64Data`, `showFullScreenAd`) resolves instantly from the fixture
 * with no added delay, because `wrapSdkWithStub`'s Proxy intercepts the
 * property access before the paced function is ever reached. Only calls that
 * fall through to the REAL bridge — the ones that actually risk
 * `APP_BRIDGE_THROTTLED` — pay the pacing cost. Fixed by this ordering, not
 * incidental: swapping it (pacing outside the stub) would pace fixture
 * look-ups that can never hit the native rate limiter, for no benefit.
 *
 * `gapMs <= 0` (the default, no `--pace-method` / non-2.x cell) returns `sdk`
 * itself, untouched — the exact object identity is preserved so the
 * zero-diff-when-off contract holds under strict-equality checks, matching
 * `wrapSdkWithStub`'s own `enabled === false` fast path.
 *
 * **Memoization**: wrapper functions are cached per name in a `Map` local to
 * this call's `Proxy` (`wrapperCache` below), so repeated property access on
 * the SAME `sdk` object within a single `wrapWithMethodPacing` call returns
 * the SAME wrapper reference. This cache does NOT persist across separate
 * `wrapWithMethodPacing` calls — each call (e.g. the sdk-redirect virtual
 * module re-evaluated per test file bundle) gets its own fresh `Map` and
 * therefore its own wrapper function instances, even for the same method
 * name. That's fine for pacing correctness: the actual timing state lives in
 * the page-global `getRegistry()` map (keyed by method name, not by wrapper
 * identity), so cross-bundle pacing still works. But callers should NOT
 * assume cross-call function identity — only "same wrapper within one call"
 * is guaranteed.
 */
export function wrapWithMethodPacing(
  sdk: Record<string, unknown>,
  gapMs: number,
): Record<string, unknown> {
  if (!(gapMs > 0)) return sdk;

  const wrapperCache = new Map<string, (...args: unknown[]) => unknown>();

  return new Proxy(sdk, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (
        typeof prop !== 'string' ||
        typeof value !== 'function' ||
        isClass(value as (...args: unknown[]) => unknown)
      ) {
        // Non-function export (constants, symbols) OR a class (e.g.
        // PermissionError) — pass through unchanged. Wrapping a class would
        // break `new`, and per-name pacing only makes sense for callable SDK
        // methods anyway.
        return value;
      }
      const cached = wrapperCache.get(prop);
      if (cached !== undefined) return cached;
      const wrapped = buildPacedFunction(prop, value as (...args: unknown[]) => unknown, gapMs);
      wrapperCache.set(prop, wrapped);
      return wrapped;
    },
  });
}
