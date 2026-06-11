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
 * DEV detection uses two complementary signals:
 *  1. `import.meta.env.DEV` — resolved by the consumer's bundler at their
 *     build time (Vite/Webpack/Rspack inject the value via top-level source
 *     transforms). Works when the consumer's source code (not node_modules)
 *     is processed — same pattern used by the polyfill's `auto` entry.
 *  2. `process.env.NODE_ENV === 'development'` — resolved by the consumer's
 *     bundler via esbuild `define` (Vite dep-prebundle) or DefinePlugin
 *     (webpack/Rspack). This token IS substituted in dep code inside
 *     node_modules (how React's own dev/prod branching works), fixing the
 *     env-1 regression where signal (1) was never injected into dep code
 *     (sdk-example#180 / issue #520).
 *     IMPORTANT: the `process.env.NODE_ENV` token must be written verbatim
 *     — bundler define substitution is a textual token match. A `typeof
 *     process` guard would survive substitution as-is and always evaluate to
 *     `false` in a browser, killing the comparison. Instead we rely on
 *     try/catch: if `process` is not defined (raw ESM in a browser without
 *     bundler substitution) a ReferenceError is caught → fail-closed (dormant).
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
 * Detects whether the current build is a DEV build by consulting two signals.
 *
 * Signal A — `import.meta.env.DEV`:
 *   Substituted by Vite/Webpack/Rspack in the consumer's own source files.
 *   NOT substituted in node_modules dep code (esbuild prebundle does not
 *   apply Vite's define pass to deps) — this was the root cause of #520.
 *
 * Signal B — `process.env.NODE_ENV === 'development'`:
 *   Substituted by esbuild's dep-prebundle define pass (Vite) and by
 *   DefinePlugin (webpack/Rspack) even inside node_modules. This is how
 *   React itself gates its dev-only code paths. Writing the token verbatim
 *   ensures textual substitution works; a `typeof process` guard would not
 *   be substituted and would evaluate to `'undefined'` in the browser,
 *   killing the comparison. A try/catch catches the ReferenceError when
 *   `process` is genuinely absent (raw ESM without bundler, e.g. direct
 *   browser import or test runners that leave identifiers in place) →
 *   fail-closed (dormant).
 *
 * Exported for unit tests — pass an explicit `isDev` override to bypass
 * the environment detection in controlled test scenarios.
 */
export function detectDevSignal(): boolean {
  // Signal A: import.meta.env.DEV (consumer source / bundler top-level pass)
  try {
    const metaEnv = (import.meta as unknown as { env?: { DEV?: unknown } }).env;
    if (metaEnv?.DEV === true) return true;
  } catch {
    // Swallow — some environments throw on import.meta access.
  }
  // Signal B: process.env.NODE_ENV (dep-prebundle define / DefinePlugin)
  // Token written verbatim — bundler define substitution is a textual match.
  // A typeof guard must NOT be added: it would survive substitution unchanged
  // and evaluate to false in a browser, killing the comparison.
  try {
    if (process.env.NODE_ENV === 'development') return true;
  } catch {
    // ReferenceError: process is not defined — raw ESM without bundler
    // substitution → fail-closed (dormant). Do not surface the error.
  }
  return false;
}

/**
 * Pure predicate for the self-gate. Exported for unit tests.
 *
 * @param isDev - Whether the consumer's bundler signals a DEV build.
 *   Default: calls `detectDevSignal()` which consults both
 *   `import.meta.env.DEV` (consumer source pass) and
 *   `process.env.NODE_ENV === 'development'` (dep prebundle pass, fixing
 *   the env-1 regression in issue #520).
 *   Pass an explicit value in tests to control the DEV signal without
 *   depending on the Vite/vitest build environment.
 * @param searchStr - URL search string to inspect. Defaults to
 *   `window.location.search` when called in a browser context.
 */
export function shouldActivate(
  isDev: boolean = detectDevSignal(),
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
