/** Injected by tsdown at build time from package.json version */
declare const __VERSION__: string;

// Note: no `__DEBUG_BUILD__` global is declared here. That is a CONSUMER-build
// constant — the consumer guards `import('@ait-co/devtools/in-app')` with
// `if (__DEBUG_BUILD__)`. This package's own source never references it; the
// in-app gate evaluates only the runtime layers (see src/in-app/gate.ts).

interface Window {
  __ait?: import('./mock/state.js').AitStateManager;
}
