/**
 * @ait-co/devtools/in-app entry point.
 *
 * Spec: docs/superpowers/specs/2026-05-18-in-app-debug-mcp.md
 *
 * Phase 1 — gate + browser-side Chii target injection.
 * WebSocket relay, QR/paste UI, and AI-host MCP bin are later phases that
 * require real-device validation and are not included here.
 *
 * This thin entry reads `window.location` and calls the pure
 * {@link evaluateDebugGate} function. All testable logic lives in `./gate.ts`
 * and `./attach.ts`, not here.
 *
 * Layer A of the activation gate (build-time) is NOT enforced in this module.
 * It is the consumer's responsibility: the consumer wraps its
 * `import('@ait-co/devtools/in-app')` call site in `if (__DEBUG_BUILD__) { … }`
 * (see sdk-example `src/main.tsx`), where `__DEBUG_BUILD__` is a
 * consumer-build-time constant. A release consumer build folds that constant
 * to `false` and dead-code-eliminates this whole module. This package is
 * pre-built and ships with `__DEBUG_BUILD__` already resolved at devtools'
 * publish time, so it could never re-evaluate the consumer's build channel —
 * which is exactly why Layer A lives at the consumer guard, not here.
 */

import { evaluateDebugGate, type GateResult } from './gate.js';

export {
  deriveTargetScriptUrl,
  detachDebugSurface,
  maybeAttach,
  reportWebViewType,
} from './attach.js';
export {
  BRIDGE_CALL_EVENT,
  type BridgeLastCall,
  type BridgeObserverState,
  type BridgePendingCall,
  installBridgeObserver,
  uninstallBridgeObserver,
} from './bridge-observer.js';
export { mountEruda, unmountEruda } from './eruda-overlay.js';
export type { GateInput, GateResult, GateResultAttach, GateResultBlocked } from './gate.js';
export {
  evaluateDebugGate,
  isPrivateAppsHost,
  isTossminiHost,
  isTrycloudflareHost,
} from './gate.js';

/**
 * Evaluates the runtime debug activation layers (B and C) against the current
 * page URL.
 *
 * Returns the gate result. Callers can check `result.attach` to decide whether
 * to proceed with debug surface attachment.
 *
 * This function reads `window.location` only — both the hostname (Layer B1
 * host allowlist) and the search params (Layers B2 and C). Layer A
 * (build-time) is enforced by the consumer's `if (__DEBUG_BUILD__)` guard
 * around the import site, not here — see the file-level comment. Consumers
 * call this with no arguments, so the Layer B1 host check is picked up with
 * no change at the call site.
 */
export function checkDebugGate(): GateResult {
  return evaluateDebugGate({
    hostname: window.location.hostname,
    searchParams: new URLSearchParams(window.location.search),
  });
}
