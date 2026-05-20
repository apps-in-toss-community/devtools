/**
 * @ait-co/devtools/in-app entry point.
 *
 * Spec: docs/superpowers/specs/2026-05-18-in-app-debug-mcp.md
 *
 * Phase 1 — gate only. Chii client, WebSocket relay, and QR/paste UI are
 * later phases that require real-device validation and are not included here.
 *
 * This thin entry reads `__DEBUG_BUILD__` and `window.location`, then calls
 * the pure {@link evaluateDebugGate} function. All testable logic lives in
 * `./gate.ts`, not here.
 */

import { evaluateDebugGate, type GateResult } from './gate.js';

export type { GateInput, GateResult, GateResultAttach, GateResultBlocked } from './gate.js';
export { evaluateDebugGate } from './gate.js';

/**
 * Evaluates the 3-layer debug activation gate against the current page URL.
 *
 * Returns the gate result. Callers can check `result.attach` to decide whether
 * to dynamically import the Chii client (later phase).
 *
 * This function reads `window.location` and the `__DEBUG_BUILD__` compile-time
 * constant. It has no other side effects.
 */
export function checkDebugGate(): GateResult {
  return evaluateDebugGate({
    isDebugBuild: __DEBUG_BUILD__,
    searchParams: new URLSearchParams(window.location.search),
  });
}
