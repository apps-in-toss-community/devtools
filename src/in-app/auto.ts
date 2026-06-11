/**
 * @ait-co/devtools/in-app/auto — self-gating side-effect entry.
 *
 * Consumers add a single line to their mini-app entry:
 *
 *   import '@ait-co/devtools/in-app/auto';
 *
 * The entry self-gates: if none of the debug activation signals are present
 * (no `?debug=1`, no `?relay=`, and not a DEV build), it does nothing. The
 * imported chunk stays dormant and `window.__sdk` / `window.__sdkCall` are
 * never installed on a normal production load.
 *
 * When the gate passes it:
 *  1. Calls `maybeAttach()` — runs the full Layer B/C gate (host allowlist,
 *     opt-in params, relay URL, TOTP) and injects the Chii `target.js` script.
 *     Gate semantics are NOT changed — this is a thin self-gate wrapper.
 *  2. Installs the SDK bridge (`window.__sdk` / `window.__sdkCall`) so an AI
 *     agent can drive any SDK API over the CDP relay without hand-synthesising
 *     the Granite/ReactNative bridge envelope. SDK access uses a dynamic
 *     import of `@apps-in-toss/web-framework` — the peer is optional, so if
 *     the SDK is not installed the bridge install is silently skipped
 *     (fail-silent). The namespace mirror pattern (iterate `Object.keys`) is
 *     SDK version-neutral: 2.x and 3.x are both covered without any static
 *     import that would couple the entry to a specific SDK line.
 *
 * SECRET-HANDLING: no secret, TOTP code, relay URL, or host value is ever
 * logged or surfaced beyond the reason enum in `maybeAttach()`.
 *
 * Layer A (build-time DCE) is NOT enforced here — this entry IS the
 * consumer-facing alternative to `if (__DEBUG_BUILD__) { … }`. The self-gate
 * below performs the same dormancy guarantee via a URL param check, which is
 * safe in a side-effect import context (the gate runs at module evaluation
 * time, before any React tree mounts). Consumers who already manage their own
 * `__DEBUG_BUILD__` guard can keep using `@ait-co/devtools/in-app` directly.
 *
 * DEV detection: `import.meta.env.DEV` is resolved by the consumer's bundler
 * at their build time (Vite/Webpack/Rspack inject the value), not at this
 * package's publish time — same pattern used by the polyfill's `auto` entry.
 * When the consumer is NOT running a bundler that injects `import.meta.env`
 * (e.g. bare Node or a test runner that leaves the raw identifiers in place),
 * the `typeof` guard makes it safe: a missing `import.meta.env.DEV` resolves
 * to `undefined`, which is falsy — the DEV path is simply skipped.
 */

import { maybeAttach } from './attach.js';

// ---------------------------------------------------------------------------
// Global type augmentation
//
// Consumers who import '@ait-co/devtools/in-app/auto' get these Window types
// automatically — no separate globals.d.ts needed in their project.
// ---------------------------------------------------------------------------
declare global {
  interface Window {
    /**
     * Entire `@apps-in-toss/web-framework` export namespace mirrored onto a
     * plain writable object. Installed by the auto entry when `?debug=1` /
     * `?relay=` is present in the URL, or in DEV builds.
     *
     * Lets an AI agent call any SDK API over a CDP relay without
     * hand-synthesising the Granite/ReactNative bridge envelope:
     *   `window.__sdk.setDeviceOrientation({ type: 'landscape' })`
     */
    __sdk?: Record<string, unknown>;

    /**
     * Safe call wrapper for `window.__sdk`. Returns a JSON-serialisable
     * `{ ok: true, value }` or `{ ok: false, error }` tuple even for
     * throwing/async SDK functions — ideal for `Runtime.evaluate` results.
     *
     * @example
     * window.__sdkCall('setDeviceOrientation', { type: 'landscape' })
     */
    __sdkCall?: (
      name: string,
      ...args: unknown[]
    ) => Promise<{ ok: boolean; value?: unknown; error?: string }>;
  }
}

// ---------------------------------------------------------------------------
// Self-gate
//
// Mirrors the gate in sdk-example/src/main.tsx:
//   - import.meta.env.DEV  →  env 1 (plain `pnpm dev`)
//   - ?debug=1             →  on-device debug deep-link (env 3/4)
//   - ?relay=              →  on-device relay (env 2/3/4)
//
// A normal production load matches none of these and the module exits here,
// keeping the SDK bridge chunk dormant.
// ---------------------------------------------------------------------------

/**
 * Pure predicate for the self-gate. Exported for unit tests.
 *
 * @param isDev - Whether the consumer's bundler folded `import.meta.env.DEV`
 *   to `true`. Default: reads from `import.meta.env.DEV` at call time, which
 *   is what the consumer's bundler replaces with a literal at build time.
 *   Pass an explicit value in tests to control the DEV signal without
 *   depending on the Vite/vitest build environment.
 * @param searchStr - URL search string to inspect. Defaults to
 *   `window.location.search` when called in a browser context.
 */
export function shouldActivate(
  isDev: boolean = ((): boolean => {
    const metaEnv = (import.meta as unknown as Record<string, unknown>)?.env as
      | Record<string, unknown>
      | undefined;
    return metaEnv?.DEV === true;
  })(),
  searchStr: string = typeof window !== 'undefined' ? window.location.search : '',
): boolean {
  if (isDev) return true;
  const params = new URLSearchParams(searchStr);
  return params.get('debug') === '1' || params.has('relay');
}

if (!shouldActivate()) {
  // Dormant — no-op. Normal production load exits here.
} else {
  // ---------------------------------------------------------------------------
  // Step 1: attach (runs the full Layer B/C gate — zero semantics change).
  // ---------------------------------------------------------------------------
  maybeAttach();

  // ---------------------------------------------------------------------------
  // Step 2: SDK bridge — install window.__sdk / window.__sdkCall.
  //
  // Dynamic import keeps the SDK out of the top-level module graph so the
  // bridge chunk stays dormant when not needed. The namespace mirror pattern
  // (iterate Object.keys) works identically for SDK 2.x and 3.x without any
  // version-specific code path (version-agnostic, umbrella §5.1).
  //
  // `@apps-in-toss/web-framework` is an optional peer. If it is absent (e.g.
  // MCP-only consumers, test environments without the SDK), the dynamic import
  // rejects and we catch + swallow silently.
  //
  // SECRET-HANDLING: no host, relay URL, or auth code is logged here.
  // ---------------------------------------------------------------------------
  void import('@apps-in-toss/web-framework')
    .then((sdk) => {
      if (typeof window === 'undefined') return;

      // Enumerate all exports onto a plain writable object. A namespace import
      // is frozen/read-only, so callers need a plain enumerable surface.
      const bridge: Record<string, unknown> = {};
      for (const key of Object.keys(sdk)) {
        bridge[key] = (sdk as Record<string, unknown>)[key];
      }
      window.__sdk = bridge;

      // Convenience call helper: window.__sdkCall('apiName', arg1, arg2)
      // returns { ok: true, value } or { ok: false, error } — safe for any
      // CDP Runtime.evaluate result consumer.
      window.__sdkCall = async (name: string, ...args: unknown[]) => {
        const fn = bridge[name];
        if (typeof fn !== 'function') {
          return { ok: false, error: `__sdk.${name} is not a function` };
        }
        try {
          const value = await (fn as (...a: unknown[]) => unknown)(...args);
          return { ok: true, value };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      };
    })
    .catch(() => {
      // Optional peer absent or failed to resolve — fail silently.
      // Do not log: a missing SDK on MCP-only consumers or test environments
      // is expected and should not produce console noise.
    });
}
