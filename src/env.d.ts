/** Injected by tsdown at build time from package.json version */
declare const __VERSION__: string;

/**
 * Injected by tsdown at build time. `true` for dogfood builds, `false` for
 * release builds. When `false`, all code that branches on this constant is
 * dead-code-eliminated by the bundler so the in-app debug surface is never
 * included in release bundles.
 *
 * Set via tsdown `define: { __DEBUG_BUILD__: 'true' | 'false' }`.
 * Vitest overrides it in `vitest.config.ts` for unit tests.
 */
declare const __DEBUG_BUILD__: boolean;

interface Window {
  __ait?: import('./mock/state.js').AitStateManager;
}
