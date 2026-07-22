/**
 * Unit tests for `buildIndicatorExpression` DOM behavior (#730 + #748).
 *
 * The function returns a self-contained IIFE string that a debug session
 * evaluates on the phone via `Runtime.evaluate`. Here we evaluate that string
 * in jsdom (indirect eval, same pattern as test-runner-bundle.test.ts) and
 * assert the rendered badge's behavior:
 *
 * - attached  → red badge, `pointer-events:auto`, tap-dismissable.
 * - #748 disconnected → NON-BLOCKING (`pointer-events:none`) + SELF-DISMISSING
 *   (fades and removes itself after the window), so a run that ends with
 *   `close()` injecting `{ state: 'disconnected' }` no longer leaves a permanent
 *   "Debugger Disconnected" element that intercepts taps on the phone.
 * - reconnect before the self-dismiss cancels it and restores the badge
 *   (transient tunnel blips do not flash-remove it).
 *
 * The relay-WS observer inside the expression takes its preferred branch when
 * `window.__ait_relay_ws_observed` is set, so no `window.WebSocket` Proxy is
 * installed (jsdom has no WebSocket) — state is driven via the enum-only
 * `ait:relay-ws-state` CustomEvent and via re-injection, exactly as in prod.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildIndicatorExpression } from '../attach-orchestrator.js';

const BADGE_ID = '__ait_debug_indicator';
// Kept in sync with attach-orchestrator.ts constants.
const SELF_DISMISS_MS = 5000;
const FADE_MS = 400;

/** Indirect eval so the IIFE runs in global scope with window/document. */
function evalExpression(opts?: Parameters<typeof buildIndicatorExpression>[0]): void {
  // biome-ignore lint/security/noGlobalEval: deliberately evaluating the injected badge IIFE to exercise its DOM behavior.
  const indirectEval = eval;
  indirectEval(buildIndicatorExpression(opts));
}

function badge(): HTMLElement | null {
  return document.getElementById(BADGE_ID);
}

describe('buildIndicatorExpression — badge DOM behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    // Preferred observer branch → no window.WebSocket Proxy in jsdom.
    (window as unknown as Record<string, unknown>).__ait_relay_ws_observed = true;
    delete (window as unknown as Record<string, unknown>).__ait_indicator;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    delete (window as unknown as Record<string, unknown>).__ait_relay_ws_observed;
    delete (window as unknown as Record<string, unknown>).__ait_indicator;
  });

  it('renders the attached badge — visible, red, pointer-events:auto', () => {
    evalExpression();
    const el = badge();
    expect(el).not.toBeNull();
    expect(el?.textContent).toBe('Debugger Connected');
    expect(el?.style.pointerEvents).toBe('auto');
    expect(el?.style.background).toBe('rgb(229, 72, 77)'); // #e5484d
    expect(el?.style.display).toBe('block');
  });

  it('disconnected badge is NON-BLOCKING (pointer-events:none) with the ko notice', () => {
    evalExpression();
    evalExpression({ state: 'disconnected' });
    const el = badge();
    expect(el).not.toBeNull();
    expect(el?.style.pointerEvents).toBe('none');
    expect(el?.textContent).toBe('디버거 연결 끊김');
  });

  it('disconnected badge SELF-DISMISSES — removed from the DOM after the window', () => {
    evalExpression();
    evalExpression({ state: 'disconnected' });
    expect(badge()).not.toBeNull();

    vi.advanceTimersByTime(SELF_DISMISS_MS + FADE_MS);

    expect(badge()).toBeNull();
  });

  it('a reconnect before the self-dismiss cancels it and restores the badge', () => {
    evalExpression();
    evalExpression({ state: 'disconnected' });

    // Reconnect (enum-only CustomEvent from the in-app observer) before dismiss.
    vi.advanceTimersByTime(1000);
    window.dispatchEvent(new CustomEvent('ait:relay-ws-state', { detail: { state: 'open' } }));

    // Past the original window, the badge is still present and interactive.
    vi.advanceTimersByTime(SELF_DISMISS_MS + FADE_MS);
    const el = badge();
    expect(el).not.toBeNull();
    expect(el?.style.pointerEvents).toBe('auto');
    expect(el?.textContent).toBe('Debugger Connected');
  });

  it('a reconnect AFTER a self-dismiss re-mounts the badge (durable controller)', () => {
    evalExpression();
    evalExpression({ state: 'disconnected' });
    vi.advanceTimersByTime(SELF_DISMISS_MS + FADE_MS);
    expect(badge()).toBeNull();

    // A genuine re-attach after the badge already detached.
    window.dispatchEvent(new CustomEvent('ait:relay-ws-state', { detail: { state: 'open' } }));
    const el = badge();
    expect(el).not.toBeNull();
    expect(el?.style.pointerEvents).toBe('auto');
  });

  it('re-injection does not duplicate the badge <div>', () => {
    evalExpression();
    evalExpression();
    evalExpression({ state: 'disconnected' });
    expect(document.querySelectorAll(`#${BADGE_ID}`)).toHaveLength(1);
  });

  it('a custom disconnectedLabel overrides the ko default', () => {
    evalExpression();
    evalExpression({ disconnectedLabel: 'X', state: 'disconnected' });
    expect(badge()?.textContent).toBe('X');
  });

  it('SECRET-HANDLING: the expression string carries no relay URL / host / TOTP token', () => {
    // Structural identifiers like `ait:relay-ws-state` are fine; what must
    // NEVER appear is a wss URL, a tunnel host, or a TOTP `/at/<code>/` segment.
    const expr = buildIndicatorExpression({ state: 'disconnected' });
    expect(expr).not.toMatch(/wss:\/\//);
    expect(expr).not.toMatch(/trycloudflare|\.ts\.net/i);
    expect(expr).not.toMatch(/\/at\/\d/);
  });
});
