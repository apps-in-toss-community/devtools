/**
 * In-app native-bridge call observer (issue #749).
 *
 * WHY THIS EXISTS — the mock's `observe()` (`src/mock/observe.ts` → `aitState.
 * sdkCallLog`) only wraps the MOCK SDK. In the on-device debug context (env 3,
 * real Toss WebView, run7) the REAL `@apps-in-toss/web-framework` is loaded, so
 * that groundwork sees nothing. The in-app debug surface needs its own
 * observation point at the one place every real async bridge call funnels
 * through, so the on-phone indicator can answer run7's question: is a spinner a
 * pending native call, the app's own UI, or a wedged JS main thread?
 *
 * OBSERVATION POINTS (version-agnostic — both SDK lines route through one of
 * these; picked so a GA flip 2.x↔3.0 does not break the signal):
 *
 *   - 3.0 line — `window.__appsInTossNativeBridge.callAsyncMethod(name, params)`
 *     is the single async dispatcher; it returns the native Promise. Wrapping
 *     it gives the COMPLETE lifecycle (pending on call, settle on resolve/
 *     reject) from ONE hook, with no reliance on how native calls back.
 *   - 2.x line — there is no single dispatcher method (each async bridge is an
 *     independent `createAsyncBridge` closure). The universal START choke point
 *     is `window.ReactNativeWebView.postMessage(json)`; the matching SETTLE
 *     signal is `window.__GRANITE_NATIVE_EMITTER.emit('<method>/resolve|reject/
 *     <eventId>')`. We wrap both.
 *
 * The observer publishes a read-only snapshot on `window.__ait_bridge` (an
 * id→pending map + a last-call record) and fires a payload-less
 * {@link BRIDGE_CALL_EVENT} CustomEvent on every change, so the CDP-injected
 * indicator badge (`buildIndicatorExpression`) can render the pending list +
 * last-call stamp without polling — the same pub/sub decoupling the relay-WS
 * observer uses for `ait:relay-ws-state` (#730).
 *
 * SECRET-HANDLING: this module records API METHOD NAMES + timestamps + a
 * correlation id ONLY. It NEVER reads, stores, or forwards call arguments
 * (`params`/`args`) or results — those may carry tokens, URLs, or user data.
 * The outbound-message parser reads `type`/`name`/`functionName`/`callbackId`/
 * `eventId` and deliberately never touches `params`/`args`.
 *
 * Lives in the in-app graph (reached only via {@link maybeAttach}); a release
 * consumer build DCEs it with the rest of the debug surface (§check:debug-
 * surface-absent). Never throws into the host app — every hook is guarded.
 */

/** Name of the API being called (never its arguments). */
export interface BridgePendingCall {
  method: string;
  /** `Date.now()` epoch ms when the call was dispatched. */
  startedAt: number;
}

/** The most-recent bridge activity — API name + wall-clock + settle status. */
export interface BridgeLastCall {
  method: string;
  /** `Date.now()` epoch ms of the start or settle that produced this record. */
  at: number;
  status: 'pending' | 'resolved' | 'rejected';
}

/**
 * The snapshot exposed on `window.__ait_bridge`. `pending` is keyed by
 * correlation id so a settle is an O(1) delete; the indicator reads
 * `Object.values(pending)` and computes each call's live elapsed itself.
 */
export interface BridgeObserverState {
  pending: Record<string, BridgePendingCall>;
  last: BridgeLastCall | null;
}

/**
 * CustomEvent fired (no detail) on every start/settle so the indicator badge
 * re-renders promptly. SECRET-HANDLING: carries no detail payload at all — the
 * badge reads the enum-only `window.__ait_bridge` snapshot on receipt.
 */
export const BRIDGE_CALL_EVENT = 'ait:bridge-call';

/**
 * Pending entries older than this are pruned on the next start — a safety net
 * for the fallback path where a settle signal might be missed, so the pending
 * list can never grow unbounded or show a forever-stuck row. Generous enough
 * that a genuinely slow native call (the exact signal we want to surface) still
 * shows while it is plausibly in flight.
 */
const MAX_PENDING_AGE_MS = 120_000;

declare global {
  interface Window {
    /**
     * Read-only bridge-call snapshot published by {@link installBridgeObserver}
     * (#749). The CDP-injected indicator badge reads this to render the pending
     * native-call list + last-call stamp. Absent when no debug attach ran or in
     * a context with no observable bridge (env 2 mock). SECRET-HANDLING: holds
     * API names + timings only — never arguments or results.
     */
    __ait_bridge?: BridgeObserverState;
    /**
     * 3.0-line native bridge (`@apps-in-toss/webview-bridge`
     * `injectNativeBridge`). `callAsyncMethod` is the single async dispatcher
     * the observer wraps.
     */
    __appsInTossNativeBridge?: {
      callAsyncMethod?: (name: string, params?: unknown) => unknown;
      [key: string]: unknown;
    };
    /** 2.x-line native call transport (`ReactNativeWebView.postMessage`). */
    ReactNativeWebView?: {
      postMessage?: (message: string) => void;
      [key: string]: unknown;
    };
    /** 2.x-line native→JS settle emitter (`@apps-in-toss/bridge-core`). */
    __GRANITE_NATIVE_EMITTER?: {
      emit?: (event: string, args?: unknown) => void;
      [key: string]: unknown;
    };
  }
}

/** Guard so the observer wraps the bridge at most once per page lifecycle. */
let bridgeObserverInstalled = false;

/** Monotonic id source for the primary (3.0) path, where native gives us none. */
let callIdCounter = 0;

/** Undo hooks that {@link uninstallBridgeObserver} runs to restore originals. */
let restoreHooks: Array<() => void> = [];

/** Drops pending entries older than {@link MAX_PENDING_AGE_MS}. */
function pruneStale(state: BridgeObserverState, now: number): void {
  for (const id of Object.keys(state.pending)) {
    const entry = state.pending[id];
    if (entry !== undefined && now - entry.startedAt > MAX_PENDING_AGE_MS) {
      delete state.pending[id];
    }
  }
}

/** Fires the payload-less notify event so the badge re-renders. */
function broadcast(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(BRIDGE_CALL_EVENT));
}

/** Records a call start: add to pending, set last=pending, notify. */
function startCall(state: BridgeObserverState, id: string, method: string, now: number): void {
  pruneStale(state, now);
  state.pending[id] = { method, startedAt: now };
  state.last = { method, at: now, status: 'pending' };
  broadcast();
}

/** Records a call settle: remove from pending, stamp last, notify. */
function settleCall(
  state: BridgeObserverState,
  id: string,
  status: 'resolved' | 'rejected',
  now: number,
): void {
  const entry = state.pending[id];
  delete state.pending[id];
  const method = entry?.method ?? state.last?.method ?? 'unknown';
  state.last = { method, at: now, status };
  broadcast();
}

/**
 * Parses an outbound `ReactNativeWebView.postMessage` JSON envelope and records
 * a START for async request/response calls only. Event subscriptions
 * (`addEventListener`/`removeEventListener`/`callEventMethod`), cleanup, and
 * constants are ignored — they are not the "spinner is a pending call" signal.
 *
 * SECRET-HANDLING: reads `type`/`name`/`functionName`/`callbackId`/`eventId`
 * ONLY — never `params`/`args`.
 */
function observeOutbound(state: BridgeObserverState, message: string): void {
  if (typeof message !== 'string') return;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(message) as Record<string, unknown>;
  } catch {
    return;
  }
  const now = Date.now();
  // 3.0 envelope: { from:'appsInTossNativeBridge', type:'callAsyncMethod', callbackId, name }
  if (
    parsed.type === 'callAsyncMethod' &&
    typeof parsed.name === 'string' &&
    typeof parsed.callbackId === 'string'
  ) {
    startCall(state, parsed.callbackId, parsed.name, now);
    return;
  }
  // 2.x envelope: { type:'method', functionName, eventId, args }
  if (
    parsed.type === 'method' &&
    typeof parsed.functionName === 'string' &&
    typeof parsed.eventId === 'string'
  ) {
    startCall(state, parsed.eventId, parsed.functionName, now);
  }
}

/**
 * Parses a `__GRANITE_NATIVE_EMITTER.emit` event name and records a SETTLE for
 * 2.x async resolves/rejects (`<method>/resolve/<eventId>` |
 * `<method>/reject/<eventId>`). Event-bridge emits (`.../onEvent/...`) are
 * ignored. SECRET-HANDLING: reads the event NAME only — never the emitted args.
 */
function observeSettle(state: BridgeObserverState, event: string): void {
  if (typeof event !== 'string') return;
  const match = /\/(resolve|reject)\/([^/]+)$/.exec(event);
  if (match === null) return;
  settleCall(
    state,
    match[2] as string,
    match[1] === 'resolve' ? 'resolved' : 'rejected',
    Date.now(),
  );
}

/**
 * Installs the native-bridge call observer (#749). Idempotent per page
 * lifecycle. Called by {@link maybeAttach} after the gate passes (debug builds
 * only). Prefers the 3.0 single-dispatcher wrap; falls back to the universal
 * 2.x postMessage-start + emitter-settle pair. A context with no observable
 * bridge (env 2 mock) leaves `window.__ait_bridge` as an empty snapshot — the
 * badge then shows the heartbeat only, which is correct.
 *
 * Never throws into the host app — a wrapped hook that somehow fails is caught
 * and the original behavior is always preserved.
 */
export function installBridgeObserver(): void {
  if (bridgeObserverInstalled) return;
  if (typeof window === 'undefined') return;
  bridgeObserverInstalled = true;

  const state: BridgeObserverState = {
    pending: Object.create(null) as Record<string, never>,
    last: null,
  };
  window.__ait_bridge = state;

  // ── Primary (3.0): wrap the single async dispatcher ────────────────────────
  const nativeBridge = window.__appsInTossNativeBridge;
  if (nativeBridge !== undefined && typeof nativeBridge.callAsyncMethod === 'function') {
    const original = nativeBridge.callAsyncMethod;
    const wrapped = function (this: unknown, name: string, params?: unknown): unknown {
      const id = `c${++callIdCounter}`;
      const started = Date.now();
      startCall(state, id, String(name), started);
      let result: unknown;
      try {
        // SECRET-HANDLING: params is forwarded UNTOUCHED — never read or stored.
        result = original.call(this, name, params);
      } catch (err) {
        settleCall(state, id, 'rejected', Date.now());
        throw err;
      }
      if (result !== null && typeof (result as { then?: unknown }).then === 'function') {
        // Observe the returned native Promise WITHOUT altering it — the original
        // reference is returned unchanged (behavior-preserving).
        (result as Promise<unknown>).then(
          () => settleCall(state, id, 'resolved', Date.now()),
          () => settleCall(state, id, 'rejected', Date.now()),
        );
      } else {
        settleCall(state, id, 'resolved', Date.now());
      }
      return result;
    };
    nativeBridge.callAsyncMethod = wrapped;
    restoreHooks.push(() => {
      nativeBridge.callAsyncMethod = original;
    });
    return;
  }

  // ── Fallback (2.x / generic): postMessage START + emitter SETTLE ───────────
  const webView = window.ReactNativeWebView;
  if (webView !== undefined && typeof webView.postMessage === 'function') {
    const originalPost = webView.postMessage;
    webView.postMessage = function (this: unknown, message: string): void {
      try {
        observeOutbound(state, message);
      } catch {
        // Never let observation break native dispatch.
      }
      originalPost.call(this, message);
    };
    restoreHooks.push(() => {
      webView.postMessage = originalPost;
    });
  }
  const emitter = window.__GRANITE_NATIVE_EMITTER;
  if (emitter !== undefined && typeof emitter.emit === 'function') {
    const originalEmit = emitter.emit;
    emitter.emit = function (this: unknown, event: string, args?: unknown): void {
      try {
        observeSettle(state, event);
      } catch {
        // Never let observation break native settle delivery.
      }
      originalEmit.call(this, event, args);
    };
    restoreHooks.push(() => {
      emitter.emit = originalEmit;
    });
  }
}

/**
 * Restores every wrapped bridge hook and removes `window.__ait_bridge` (#749).
 * Idempotent; safe to call when nothing was installed. Wired into
 * {@link detachDebugSurface} (#748) so no bridge wrap survives a run's end.
 */
export function uninstallBridgeObserver(): void {
  if (!bridgeObserverInstalled) return;
  bridgeObserverInstalled = false;
  const hooks = restoreHooks;
  restoreHooks = [];
  for (const undo of hooks) {
    try {
      undo();
    } catch {
      // Best-effort restore — a failed undo must not break teardown.
    }
  }
  if (typeof window !== 'undefined') {
    window.__ait_bridge = undefined;
  }
}
