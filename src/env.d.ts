/** Injected by tsup at build time from package.json version */
declare const __VERSION__: string;

interface Window {
  __ait?: import('./mock/state.js').AitStateManager;
}
