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

/**
 * The connection-label child span (#749). The badge is no longer a single
 * textContent — it holds a pulse dot, this label, a heartbeat token, and a
 * pending/last detail block — so attached-state text is asserted here, not on
 * the badge root (whose textContent now also includes the `♥<beats>` token).
 */
function label(): HTMLElement | null {
  return document.getElementById('__ait_indicator_label');
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
    expect(label()?.textContent).toBe('Debugger Connected');
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
    expect(label()?.textContent).toBe('Debugger Connected');
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

// ---------------------------------------------------------------------------
// Freeze/spinner triage signals (#749)
//
// The badge renders three debug-only signals so a real-device spinner is
// attributable: a JS-driven heartbeat (♥<beats>) beside a compositor pulse dot,
// the in-flight native-call list (⏳ name + live elapsed) read from
// window.__ait_bridge, and a last-call stamp (name + wall-clock). These tests
// exercise that rendering in jsdom with fake timers, and the teardown contract
// (the 1 Hz interval stops on stop() and on node removal — no timer leaks).
// ---------------------------------------------------------------------------

type BridgeSnapshot = {
  pending: Record<string, { method: string; startedAt: number }>;
  last: { method: string; at: number; status: string } | null;
};
type IndicatorController = { stop?: () => void; beats?: number; hb?: number };

function setBridge(snapshot: BridgeSnapshot | undefined): void {
  (window as unknown as { __ait_bridge?: BridgeSnapshot }).__ait_bridge = snapshot;
}
function controller(): IndicatorController | undefined {
  return (window as unknown as { __ait_indicator?: IndicatorController }).__ait_indicator;
}

describe('buildIndicatorExpression — freeze/spinner triage signals (#749)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    (window as unknown as Record<string, unknown>).__ait_relay_ws_observed = true;
    delete (window as unknown as Record<string, unknown>).__ait_indicator;
    delete (window as unknown as Record<string, unknown>).__ait_bridge;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    delete (window as unknown as Record<string, unknown>).__ait_relay_ws_observed;
    delete (window as unknown as Record<string, unknown>).__ait_indicator;
    delete (window as unknown as Record<string, unknown>).__ait_bridge;
  });

  it('renders the badge as child nodes: pulse dot + label + heartbeat + detail', () => {
    evalExpression();
    const el = badge();
    expect(el?.children).toHaveLength(4);
    expect(label()).not.toBeNull();
    // The heartbeat token is present from the first render (♥0).
    expect(el?.textContent).toContain('♥0');
  });

  it('JS heartbeat token advances on the 1 Hz tick (main-thread liveness)', () => {
    evalExpression();
    expect(badge()?.textContent).toContain('♥0');
    vi.advanceTimersByTime(1000);
    expect(badge()?.textContent).toContain('♥1');
    vi.advanceTimersByTime(2000);
    expect(badge()?.textContent).toContain('♥3');
  });

  it('renders a pending native call as ⏳ <name> <elapsed>s (native-spinner signal)', () => {
    setBridge({ pending: { c1: { method: 'getServerTime', startedAt: Date.now() } }, last: null });
    evalExpression();
    expect(badge()?.textContent).toContain('⏳ getServerTime 0s');
  });

  it('the pending elapsed time advances on the heartbeat tick', () => {
    setBridge({ pending: { c1: { method: 'appLogin', startedAt: Date.now() } }, last: null });
    evalExpression();
    expect(badge()?.textContent).toContain('⏳ appLogin 0s');
    vi.advanceTimersByTime(3000);
    expect(badge()?.textContent).toContain('⏳ appLogin 3s');
  });

  it('caps the pending list at 3 rows and shows a +N overflow', () => {
    const now = Date.now();
    setBridge({
      pending: {
        a: { method: 'm1', startedAt: now },
        b: { method: 'm2', startedAt: now },
        c: { method: 'm3', startedAt: now },
        d: { method: 'm4', startedAt: now },
        e: { method: 'm5', startedAt: now },
      },
      last: null,
    });
    evalExpression();
    const text = badge()?.textContent ?? '';
    expect(text).toContain('+2 more');
    // Exactly three ⏳ rows are rendered (the rest collapse into the counter).
    expect((text.match(/⏳/g) ?? []).length).toBe(3);
  });

  it('renders the last-call stamp as last: <name> <wall-clock> (app-UI signal)', () => {
    setBridge({ pending: {}, last: { method: 'appLogin', at: Date.now(), status: 'resolved' } });
    evalExpression();
    expect(badge()?.textContent).toMatch(/last: appLogin \d{2}:\d{2}:\d{2}/);
  });

  it('reactively re-renders when a call settles (⏳ row clears on ait:bridge-call)', () => {
    const snap: BridgeSnapshot = {
      pending: { c1: { method: 'getServerTime', startedAt: Date.now() } },
      last: null,
    };
    setBridge(snap);
    evalExpression();
    expect(badge()?.textContent).toContain('⏳ getServerTime');

    // Settle: drop the pending row + stamp last, then notify (as the observer does).
    delete snap.pending.c1;
    snap.last = { method: 'getServerTime', at: Date.now(), status: 'resolved' };
    window.dispatchEvent(new CustomEvent('ait:bridge-call'));

    expect(badge()?.textContent).not.toContain('⏳');
    expect(badge()?.textContent).toContain('last: getServerTime');
  });

  it('ignores a pending call older than the display staleness guard', () => {
    setBridge({
      pending: { stale: { method: 'ghost', startedAt: Date.now() - 200_000 } },
      last: null,
    });
    evalExpression();
    expect(badge()?.textContent).not.toContain('ghost');
  });

  it('no-bridge context is graceful — heartbeat only, no pending/last, no throw', () => {
    // window.__ait_bridge is undefined (env 2 mock / no bridge).
    expect(() => evalExpression()).not.toThrow();
    const text = badge()?.textContent ?? '';
    expect(text).toContain('Debugger Connected');
    expect(text).toContain('♥0');
    expect(text).not.toContain('⏳');
    expect(text).not.toContain('last:');
  });

  it('the disconnected badge clears the heartbeat/detail (collapses to the notice)', () => {
    setBridge({ pending: { c1: { method: 'getServerTime', startedAt: Date.now() } }, last: null });
    evalExpression();
    evalExpression({ state: 'disconnected' });
    // Disconnected → the badge is just the ko notice; no ♥/⏳ text lingers.
    expect(badge()?.textContent).toBe('디버거 연결 끊김');
  });

  it('stop() halts the heartbeat interval — beats freeze (teardown contract)', () => {
    evalExpression();
    vi.advanceTimersByTime(1000);
    expect(badge()?.textContent).toContain('♥1');

    controller()?.stop?.();
    vi.advanceTimersByTime(5000);

    // The token is frozen at ♥1 — the interval was cleared.
    expect(badge()?.textContent).toContain('♥1');
    expect(badge()?.textContent).not.toContain('♥6');
    expect(controller()?.hb).toBe(0);
  });

  it('removing the badge node self-clears the interval on the next tick (no leak)', () => {
    evalExpression();
    badge()?.remove();
    // The next tick sees the detached node and clears its own interval.
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
    expect(controller()?.hb).toBe(0);
  });

  it('SECRET-HANDLING: the expression never reads call arguments or results', () => {
    // The badge reads method NAMES + timings only. A grep for arg/result field
    // reads pins that no value-bearing field is ever rendered.
    const expr = buildIndicatorExpression();
    expect(expr).not.toMatch(/\.params\b/);
    expect(expr).not.toMatch(/\.args\b/);
    expect(expr).not.toMatch(/\.result\b/);
    expect(expr).not.toMatch(/wss:\/\//);
  });
});
