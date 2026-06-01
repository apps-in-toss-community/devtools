/** Injected by tsdown at build time from package.json version */
declare const __VERSION__: string;

/**
 * Injected by tsdown at build time from the installed `@modelcontextprotocol/sdk`
 * version. `null` when build-time resolution failed. Referenced as a bare
 * identifier (the `define` substitution target) — never via `globalThis`.
 */
declare const __MCP_SDK_VERSION__: string | null;

// Note: no `__DEBUG_BUILD__` global is declared here. That is a CONSUMER-build
// constant — the consumer guards `import('@ait-co/devtools/in-app')` with
// `if (__DEBUG_BUILD__)`. This package's own source never references it; the
// in-app gate evaluates only the runtime layers (see src/in-app/gate.ts).

interface Window {
  __ait?: import('./mock/state.js').AitStateManager;
}
