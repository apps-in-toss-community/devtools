/**
 * Unit tests for the in-app native-bridge call observer (bridge-observer.ts, #749).
 *
 * The observer wraps the one place every real async bridge call funnels through
 * so the on-phone indicator can list in-flight native calls + a last-call stamp
 * (the mock's sdkCallLog does not see the real SDK in env 3). Two SDK lines:
 *
 *   - 3.0: `window.__appsInTossNativeBridge.callAsyncMethod(name, params)` — a
 *     single async dispatcher returning the native Promise (wrapped → full
 *     lifecycle from one hook).
 *   - 2.x: no single dispatcher — START observed at
 *     `window.ReactNativeWebView.postMessage(json)`, SETTLE at
 *     `window.__GRANITE_NATIVE_EMITTER.emit('<m>/resolve|reject/<eventId>')`.
 *
 * SECRET-HANDLING is a first-class assertion: the snapshot must carry API NAMES
 * + timings ONLY — never call arguments or results.
 *
 * Module-level install state is reset via vi.resetModules() + a fresh import in
 * beforeEach; the window globals the tests plant are deleted in afterEach.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BridgeObserverState,
  installBridgeObserver as InstallFn,
  uninstallBridgeObserver as UninstallFn,
} from '../in-app/bridge-observer.js';

let installBridgeObserver: typeof InstallFn;
let uninstallBridgeObserver: typeof UninstallFn;

/** Reads the live snapshot the observer publishes on window. */
function snapshot(): BridgeObserverState | undefined {
  return (window as unknown as { __ait_bridge?: BridgeObserverState }).__ait_bridge;
}

function pendingMethods(): string[] {
  const s = snapshot();
  return s ? Object.values(s.pending).map((p) => p.method) : [];
}

/** Typed window accessor for the bridge globals the tests plant. */
type BridgeWindow = {
  __appsInTossNativeBridge?: { callAsyncMethod?: (name: string, params?: unknown) => unknown };
  ReactNativeWebView?: { postMessage?: (message: string) => void };
  __GRANITE_NATIVE_EMITTER?: { emit?: (event: string, args?: unknown) => void };
  __ait_bridge?: unknown;
};
function w(): BridgeWindow {
  return window as unknown as BridgeWindow;
}

beforeEach(async () => {
  vi.resetModules();
  ({ installBridgeObserver, uninstallBridgeObserver } = await import(
    '../in-app/bridge-observer.js'
  ));
});

afterEach(() => {
  // Best-effort restore + wipe every global a test may have planted.
  try {
    uninstallBridgeObserver();
  } catch {
    // ignore
  }
  const win = w();
  win.__appsInTossNativeBridge = undefined;
  win.ReactNativeWebView = undefined;
  win.__GRANITE_NATIVE_EMITTER = undefined;
  win.__ait_bridge = undefined;
});

// ---------------------------------------------------------------------------
// 3.0 line — callAsyncMethod Promise wrap (full lifecycle)
// ---------------------------------------------------------------------------

describe('installBridgeObserver — 3.0 callAsyncMethod path', () => {
  it('records a pending call on dispatch (method + last=pending)', () => {
    let settle: ((v: unknown) => void) | undefined;
    w().__appsInTossNativeBridge = {
      callAsyncMethod: () => new Promise((res) => (settle = res)),
    };
    installBridgeObserver();

    void w().__appsInTossNativeBridge?.callAsyncMethod?.('getServerTime', { tz: 'KST' });

    expect(pendingMethods()).toEqual(['getServerTime']);
    expect(snapshot()?.last).toMatchObject({ method: 'getServerTime', status: 'pending' });
    expect(settle).toBeTypeOf('function');
  });

  it('clears the pending row and stamps last=resolved when the call resolves', async () => {
    let settle: ((v: unknown) => void) | undefined;
    w().__appsInTossNativeBridge = {
      callAsyncMethod: () => new Promise((res) => (settle = res)),
    };
    installBridgeObserver();
    const p = w().__appsInTossNativeBridge?.callAsyncMethod?.('getServerTime') as Promise<unknown>;

    settle?.({ time: 1 });
    await p;
    await Promise.resolve();

    expect(pendingMethods()).toEqual([]);
    expect(snapshot()?.last).toMatchObject({ method: 'getServerTime', status: 'resolved' });
  });

  it('stamps last=rejected on a rejected call and still propagates the rejection', async () => {
    let fail: ((e: unknown) => void) | undefined;
    w().__appsInTossNativeBridge = {
      callAsyncMethod: () => new Promise((_res, rej) => (fail = rej)),
    };
    installBridgeObserver();
    const p = w().__appsInTossNativeBridge?.callAsyncMethod?.('appLogin') as Promise<unknown>;

    fail?.(new Error('denied'));
    await expect(p).rejects.toThrow('denied');
    await Promise.resolve();

    expect(pendingMethods()).toEqual([]);
    expect(snapshot()?.last).toMatchObject({ method: 'appLogin', status: 'rejected' });
  });

  it('returns the ORIGINAL promise reference untouched (behavior-preserving)', () => {
    const sentinel = Promise.resolve('ok');
    w().__appsInTossNativeBridge = { callAsyncMethod: () => sentinel };
    installBridgeObserver();

    const returned = w().__appsInTossNativeBridge?.callAsyncMethod?.('m');

    expect(returned).toBe(sentinel);
    return sentinel; // settle the observation microtask so it does not leak
  });

  it('treats a synchronous (non-promise) return as immediately resolved', () => {
    w().__appsInTossNativeBridge = { callAsyncMethod: () => 42 };
    installBridgeObserver();

    const returned = w().__appsInTossNativeBridge?.callAsyncMethod?.('getConstant');

    expect(returned).toBe(42);
    expect(pendingMethods()).toEqual([]);
    expect(snapshot()?.last).toMatchObject({ method: 'getConstant', status: 'resolved' });
  });

  it('a synchronous throw settles rejected and rethrows to the caller', () => {
    w().__appsInTossNativeBridge = {
      callAsyncMethod: () => {
        throw new Error('boom');
      },
    };
    installBridgeObserver();

    expect(() => w().__appsInTossNativeBridge?.callAsyncMethod?.('m')).toThrow('boom');
    expect(pendingMethods()).toEqual([]);
    expect(snapshot()?.last).toMatchObject({ method: 'm', status: 'rejected' });
  });

  it('fires ait:bridge-call on both start and settle', async () => {
    let settle: ((v: unknown) => void) | undefined;
    w().__appsInTossNativeBridge = {
      callAsyncMethod: () => new Promise((res) => (settle = res)),
    };
    installBridgeObserver();
    const events: number[] = [];
    window.addEventListener('ait:bridge-call', () => events.push(1));

    const p = w().__appsInTossNativeBridge?.callAsyncMethod?.('m') as Promise<unknown>;
    expect(events).toHaveLength(1); // start
    settle?.(undefined);
    await p;
    await Promise.resolve();
    expect(events).toHaveLength(2); // settle
  });

  it('SECRET-HANDLING: call arguments never appear in the snapshot', () => {
    w().__appsInTossNativeBridge = { callAsyncMethod: () => Promise.resolve() };
    installBridgeObserver();

    void w().__appsInTossNativeBridge?.callAsyncMethod?.('appLogin', {
      accessToken: 'super-secret-token-value',
    });

    expect(JSON.stringify(snapshot())).not.toContain('super-secret-token-value');
    expect(pendingMethods()).toEqual(['appLogin']); // name only
  });

  it('restores the original callAsyncMethod and drops the snapshot on uninstall', () => {
    const original = (): Promise<unknown> => Promise.resolve();
    const bridge = { callAsyncMethod: original };
    w().__appsInTossNativeBridge = bridge;
    installBridgeObserver();
    expect(bridge.callAsyncMethod).not.toBe(original); // wrapped

    uninstallBridgeObserver();

    expect(bridge.callAsyncMethod).toBe(original); // restored
    expect(snapshot()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2.x line — postMessage START + emitter SETTLE fallback
// ---------------------------------------------------------------------------

describe('installBridgeObserver — 2.x postMessage/emitter fallback', () => {
  function plant2x(): { posted: string[]; emitted: string[]; originalPost: (m: string) => void } {
    const posted: string[] = [];
    const emitted: string[] = [];
    const originalPost = (m: string): void => {
      posted.push(m);
    };
    w().ReactNativeWebView = { postMessage: originalPost };
    w().__GRANITE_NATIVE_EMITTER = {
      emit: (e: string): void => {
        emitted.push(e);
      },
    };
    return { posted, emitted, originalPost };
  }

  it('records a START from a 2.x async postMessage and still calls the original', () => {
    const { posted } = plant2x();
    installBridgeObserver();

    w().ReactNativeWebView?.postMessage?.(
      JSON.stringify({
        type: 'method',
        functionName: 'appLogin',
        eventId: 'e1',
        args: [{ pw: 1 }],
      }),
    );

    expect(posted).toHaveLength(1); // original dispatch preserved
    expect(snapshot()?.pending.e1).toMatchObject({ method: 'appLogin' });
    expect(snapshot()?.last).toMatchObject({ method: 'appLogin', status: 'pending' });
  });

  it('settles resolved from a matching emitter event and still calls the original emit', () => {
    const { emitted } = plant2x();
    installBridgeObserver();
    w().ReactNativeWebView?.postMessage?.(
      JSON.stringify({ type: 'method', functionName: 'appLogin', eventId: 'e1', args: [] }),
    );

    w().__GRANITE_NATIVE_EMITTER?.emit?.('appLogin/resolve/e1', { ok: true });

    expect(emitted).toContain('appLogin/resolve/e1'); // original emit preserved
    expect(snapshot()?.pending.e1).toBeUndefined();
    expect(snapshot()?.last).toMatchObject({ method: 'appLogin', status: 'resolved' });
  });

  it('settles rejected from a reject emitter event', () => {
    plant2x();
    installBridgeObserver();
    w().ReactNativeWebView?.postMessage?.(
      JSON.stringify({ type: 'method', functionName: 'checkoutPayment', eventId: 'e9', args: [] }),
    );

    w().__GRANITE_NATIVE_EMITTER?.emit?.('checkoutPayment/reject/e9', { code: 'X' });

    expect(snapshot()?.pending.e9).toBeUndefined();
    expect(snapshot()?.last).toMatchObject({ method: 'checkoutPayment', status: 'rejected' });
  });

  it('ignores event-bridge onEvent emits (not an async settle)', () => {
    plant2x();
    installBridgeObserver();
    w().ReactNativeWebView?.postMessage?.(
      JSON.stringify({ type: 'method', functionName: 'getServerTime', eventId: 'e1', args: [] }),
    );

    w().__GRANITE_NATIVE_EMITTER?.emit?.('startUpdateLocation/onEvent/e2', { lat: 1 });

    // The pending async call is untouched by an unrelated onEvent emit.
    expect(snapshot()?.pending.e1).toMatchObject({ method: 'getServerTime' });
  });

  it('ignores non-async postMessage envelopes (event subscription / cleanup)', () => {
    plant2x();
    installBridgeObserver();

    w().ReactNativeWebView?.postMessage?.(
      JSON.stringify({ type: 'addEventListener', functionName: 'contactsViral', eventId: 'e3' }),
    );

    expect(pendingMethods()).toEqual([]);
  });

  it('also observes a 3.0-shape envelope on the postMessage fallback path', () => {
    plant2x();
    installBridgeObserver();

    w().ReactNativeWebView?.postMessage?.(
      JSON.stringify({
        from: 'appsInTossNativeBridge',
        type: 'callAsyncMethod',
        callbackId: 'cb1',
        name: 'getServerTime',
        params: { secret: 'x' },
      }),
    );

    expect(snapshot()?.pending.cb1).toMatchObject({ method: 'getServerTime' });
  });

  it('SECRET-HANDLING: postMessage args never appear in the snapshot', () => {
    plant2x();
    installBridgeObserver();

    w().ReactNativeWebView?.postMessage?.(
      JSON.stringify({
        type: 'method',
        functionName: 'appLogin',
        eventId: 'e1',
        args: [{ token: 'leak-me-please' }],
      }),
    );

    expect(JSON.stringify(snapshot())).not.toContain('leak-me-please');
  });

  it('never throws into native dispatch on a malformed message', () => {
    const { posted } = plant2x();
    installBridgeObserver();

    expect(() => w().ReactNativeWebView?.postMessage?.('not-json{')).not.toThrow();
    expect(posted).toHaveLength(1); // original still called despite the parse failure
  });

  it('restores postMessage and emit on uninstall', () => {
    const { originalPost } = plant2x();
    const bridge = w().ReactNativeWebView as { postMessage: (m: string) => void };
    installBridgeObserver();
    expect(bridge.postMessage).not.toBe(originalPost); // wrapped

    uninstallBridgeObserver();

    expect(bridge.postMessage).toBe(originalPost); // restored
    expect(snapshot()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// idempotency + no-bridge no-op
// ---------------------------------------------------------------------------

describe('installBridgeObserver — idempotency + no-op', () => {
  it('is idempotent — a second install does not re-wrap', () => {
    const bridge = { callAsyncMethod: (): Promise<unknown> => Promise.resolve() };
    w().__appsInTossNativeBridge = bridge;
    installBridgeObserver();
    const wrappedOnce = bridge.callAsyncMethod;
    installBridgeObserver();
    expect(bridge.callAsyncMethod).toBe(wrappedOnce);
  });

  it('publishes an empty snapshot when no bridge global is present (no throw)', () => {
    expect(() => installBridgeObserver()).not.toThrow();
    expect(snapshot()).toMatchObject({ last: null });
    expect(pendingMethods()).toEqual([]);
  });

  it('uninstall is a no-op when nothing was installed', () => {
    expect(() => uninstallBridgeObserver()).not.toThrow();
  });
});
