/**
 * In-app Chii target injection for the debug attach flow.
 *
 * Spec: docs/superpowers/specs/2026-05-18-in-app-debug-mcp.md
 * "MCP attach" topology section — Phase 1 browser-side implementation.
 *
 * This module bridges the 3-layer gate result to a Chii `target.js` script
 * injection. The Chii npm package is the relay SERVER — the in-app side is
 * a plain `<script src="…/target.js">` pointing at the relay host. No chii
 * npm dependency is needed here.
 */

import { setScreenAwakeMode } from '@apps-in-toss/web-framework';
import {
  RELAY_AUTH_REJECT_CLOSE_CODE,
  RELAY_AUTH_REJECT_REASON,
} from '../shared/relay-auth-close.js';
import { installBridgeObserver, uninstallBridgeObserver } from './bridge-observer.js';
import { mountEruda, unmountEruda } from './eruda-overlay.js';
import { checkDebugGate, type GateResult } from './index.js';

/**
 * Converts a validated `wss:` relay URL into the Chii `target.js` script URL.
 *
 * Scheme is mapped `wss:` → `https:`. Host and port are preserved.
 * Pathname is set to `/target.js` (or `/at/<code>/target.js` when a TOTP code
 * is given) regardless of the relay path. Query params and hash from the
 * relay URL are dropped — the target script URL is a static asset path on the
 * same host.
 *
 * TOTP path-prefix transport (issue #466): chii's stock `target.js` derives
 * its WS endpoint from the script `src` (`scriptEl.src.replace('target.js',
 * '')`), so embedding the current TOTP code in the script URL *path* is the
 * only way the phone-side WS upgrade can carry it — both the script fetch and
 * the derived `wss://<host>/at/<code>/target/<id>` dial inherit the prefix,
 * and the relay verifies + strips it before chii parses the URL. The
 * `window.ChiiServerUrl` + query alternative does NOT work: chii appends
 * `target/<id>` to the serverUrl string, which would land after a `?`.
 *
 * SECRET-HANDLING: `atCode` rides only inside the returned URL (the intended
 * transport — same exposure grade as the daemon client's `at=` query). It is
 * never logged here.
 *
 * @example
 * deriveTargetScriptUrl('wss://abc.trycloudflare.com/relay')
 * // → 'https://abc.trycloudflare.com/target.js'
 *
 * deriveTargetScriptUrl('wss://h.example.com:9100/', '123456')
 * // → 'https://h.example.com:9100/at/123456/target.js'
 *
 * @param relayUrl - Validated `wss:` relay URL from the gate result.
 * @param atCode - Current TOTP code from the page URL's `at` query param, or
 *   `null`/`undefined`/`''` to keep the legacy un-prefixed URL.
 */
export function deriveTargetScriptUrl(relayUrl: string, atCode?: string | null): string {
  const u = new URL(relayUrl);
  u.protocol = 'https:';
  u.pathname =
    atCode !== undefined && atCode !== null && atCode !== ''
      ? `/at/${encodeURIComponent(atCode)}/target.js`
      : '/target.js';
  u.search = '';
  u.hash = '';
  return u.toString();
}

/** Module-level guard against double-injection within a page lifecycle. */
let attached = false;

// ---------------------------------------------------------------------------
// Relay-origin WebSocket observer (issue #478)
//
// After a successful attach, chii's target.js owns its own reconnect loop —
// `maybeAttach()` never re-runs, so a much-later reconnect carrying the stale
// `/at/<code>/` prefix is rejected by the relay with NO in-page signal. The
// relay now names that rejection (accept-then-close, code 4401), and this
// observer is the in-page half: it watches relay-bound WebSockets for the
// 4401 close and tells the parent launcher shell once, then fail-fasts any
// further relay dials so the retry loop stops generating network traffic.
// ---------------------------------------------------------------------------

/** One-shot guard for the parent notification (both observer + onerror probe). */
let authExpiredNotified = false;

/** Set once a relay-bound socket closed with 4401 — flips dials to fail-fast. */
let relayAuthExpired = false;

/** Guard against stacking multiple observer wrappers on window.WebSocket. */
let wsObserverInstalled = false;

declare global {
  interface Window {
    /**
     * Set once {@link installRelayWsObserver} has wrapped `window.WebSocket`
     * (#730). The bare CDP-injected indicator (`buildIndicatorExpression`)
     * checks this flag to decide whether it can piggy-back on the
     * `ait:relay-ws-state` CustomEvent this module broadcasts, instead of
     * installing a second competing `Proxy` on `window.WebSocket`.
     */
    __ait_relay_ws_observed?: boolean;
  }
}

/**
 * Broadcasts relay-socket lifecycle to any in-page listener (#730) — the
 * on-phone debug indicator subscribes to this instead of wrapping
 * `window.WebSocket` a second time.
 *
 * SECRET-HANDLING: the CustomEvent `detail` carries ONLY the enum
 * `'open' | 'close'` — never a close code, host, relay URL, or TOTP value.
 */
function broadcastRelayWsState(state: 'open' | 'close'): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('ait:relay-ws-state', { detail: { state } }));
}

/**
 * Posts the `auth-expired` block signal to the parent launcher shell, once.
 *
 * Mirrors the existing `reason: 'auth'` postMessage in {@link maybeAttach}.
 * SECRET-HANDLING: the payload carries ONLY the reason enum — never the code,
 * secret, host, or relay URL.
 */
function notifyAuthExpired(): void {
  if (authExpiredNotified) return;
  if (typeof window === 'undefined' || window.parent === window) return;
  authExpiredNotified = true;
  window.parent.postMessage({ type: 'ait:debug-attach-blocked', reason: 'auth-expired' }, '*');
}

/**
 * Normalises a URL into a comparable origin key, mapping the HTTP scheme pair
 * onto the WS pair (`https:`→`wss:`, `http:`→`ws:`) so the `wss:` relay URL
 * from the gate result matches the dials target.js derives from its
 * `https://…/target.js` script src. Returns `null` for unparsable URLs.
 */
function wsOriginKey(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  const protocol =
    parsed.protocol === 'https:' ? 'wss:' : parsed.protocol === 'http:' ? 'ws:' : parsed.protocol;
  return `${protocol}//${parsed.host}`;
}

/**
 * Builds a dummy WebSocket that never connects and closes immediately
 * (asynchronously, with the 4401 code) — returned for relay-bound dials after
 * auth expiry so chii's internal reconnect loop stops producing real network
 * traffic. We cannot stop the loop itself (it lives inside stock target.js);
 * we can only make each iteration free.
 *
 * Both `onclose`-style property handlers and `addEventListener` listeners are
 * fired — stock target.js uses property handlers, but we cannot know every
 * consumer. (A consumer wiring BOTH would see a double callback; acceptable
 * for a retry scheduler and irrelevant for chii.)
 */
function createFailFastSocket(url: string): WebSocket {
  const eventTarget = new EventTarget();
  const sock = {
    url,
    readyState: 3, // CLOSED
    bufferedAmount: 0,
    extensions: '',
    protocol: '',
    binaryType: 'blob' as BinaryType,
    onopen: null as ((ev: Event) => unknown) | null,
    onmessage: null as ((ev: Event) => unknown) | null,
    onerror: null as ((ev: Event) => unknown) | null,
    onclose: null as ((ev: Event) => unknown) | null,
    close(): void {},
    send(): void {},
    addEventListener: eventTarget.addEventListener.bind(eventTarget),
    removeEventListener: eventTarget.removeEventListener.bind(eventTarget),
    dispatchEvent: eventTarget.dispatchEvent.bind(eventTarget),
    CONNECTING: 0,
    OPEN: 1,
    CLOSING: 2,
    CLOSED: 3,
  };
  setTimeout(() => {
    const errorEvent = new Event('error');
    sock.onerror?.(errorEvent);
    eventTarget.dispatchEvent(errorEvent);
    // CloseEvent exists in every real WebView; the Object.assign fallback
    // keeps the dummy environment-proof (consumers only read `.code`).
    let closeEvent: Event;
    try {
      closeEvent = new CloseEvent('close', {
        code: RELAY_AUTH_REJECT_CLOSE_CODE,
        reason: RELAY_AUTH_REJECT_REASON,
        wasClean: false,
      });
    } catch {
      closeEvent = Object.assign(new Event('close'), {
        code: RELAY_AUTH_REJECT_CLOSE_CODE,
        reason: RELAY_AUTH_REJECT_REASON,
        wasClean: false,
      });
    }
    sock.onclose?.(closeEvent);
    eventTarget.dispatchEvent(closeEvent);
  }, 0);
  return sock as unknown as WebSocket;
}

// ---------------------------------------------------------------------------
// Graceful detach — return the mini-app to a clean, usable state on run end
// (issue #748).
//
// Real-device observation (run7): after an env3 run completes the phone showed
// a persistent "Debugger Disconnected" badge and the app felt wedged. This is
// the in-app half of the fix — a single idempotent teardown that removes OUR
// debug-surface elements (the CDP-injected indicator badge, the eruda console)
// and restores the keepAwake side effect, so nothing we injected lingers after
// the relay session ends.
//
// Trigger model (all close paths, transient-safe):
//   - Normal completion / relay death / tunnel drop that does NOT recover /
//     dashboard-initiated stop → relay WS closes (any non-4401 code). We
//     schedule teardown after a grace window; a reconnect 'open' cancels it, so
//     a transient tunnel blip that target.js recovers from does NOT flash away
//     the surface.
//   - 4401 (relay TOTP auth-reject, #478) → terminal by design (the session
//     cannot reconnect without a QR rescan), so we tear down immediately.
//   - WS 'error' with no clean close → scheduled defensively (unclean-close
//     path).
//   - pagehide → immediate (navigating away; restores keepAwake even if no
//     close fired).
//
// OUT OF OUR LAYER (issue #748 hypothesis (a)): a native Toss-app loading
// overlay / spinner that absorbs touches is NOT something a JS surface can
// dismiss — we never try. Our surface adds no full-viewport element, no
// capture-phase document listener, and no body pointer-events/scroll lock, so
// it structurally cannot absorb ALL input; the total-touch-absorb + spinner
// symptom is native and stays device-gated (tracked in #748 / sdk-example#277).
// ---------------------------------------------------------------------------

/** Grace window before a non-terminal relay close tears the surface down. */
const RECONNECT_GRACE_MS = 5000;

/** One-shot guard so the teardown runs at most once per page lifecycle. */
let debugSurfaceDetached = false;

/** Pending grace-window timer for a non-terminal close, or `null`. */
let pendingDetachTimer: ReturnType<typeof setTimeout> | null = null;

/** Cancels a scheduled teardown — called when a relay socket re-opens. */
function cancelScheduledDetach(): void {
  if (pendingDetachTimer !== null) {
    clearTimeout(pendingDetachTimer);
    pendingDetachTimer = null;
  }
}

/**
 * Schedules {@link detachDebugSurface} after {@link RECONNECT_GRACE_MS} unless
 * a reconnect cancels it first. No-op if teardown already ran or is already
 * scheduled. Defensive: if `setTimeout` is somehow unavailable, tears down
 * immediately rather than never.
 */
function scheduleDetach(): void {
  if (debugSurfaceDetached || pendingDetachTimer !== null) return;
  if (typeof setTimeout === 'undefined') {
    detachDebugSurface();
    return;
  }
  pendingDetachTimer = setTimeout(() => {
    pendingDetachTimer = null;
    detachDebugSurface();
  }, RECONNECT_GRACE_MS);
}

/**
 * Idempotent, non-throwing teardown of the in-app debug surface (issue #748).
 *
 * Removes every debug-surface element WE injected and restores the one side
 * effect WE applied:
 *   1. The CDP-injected `#__ait_debug_indicator` badge (the persistent
 *      "Debugger Disconnected" element). Its live heartbeat/pending-call timer
 *      (#749) is stopped first via the badge controller's `stop()` so no 1 Hz
 *      interval leaks past detach; `buildIndicatorExpression` also
 *      self-dismisses the node — this is the in-app hard guarantee, idempotent,
 *      a no-op if it is already gone.
 *   2. The eruda in-page console (floating button + any open panel).
 *   3. The native-bridge call observer (#749) — its `callAsyncMethod` /
 *      `postMessage` / emitter wraps are restored and `window.__ait_bridge` is
 *      removed, so nothing we wrapped survives the run's end.
 *   4. keepAwake — forced on at attach; restored here so a run that ends
 *      WITHOUT a page unload does not leave the screen pinned awake (the
 *      existing `beforeunload` restore only covers the unload path).
 *
 * Deliberately NOT touched: the `window.WebSocket` observer proxy (kept so the
 * #478 post-4401 fail-fast survives; it is non-blocking and never absorbs
 * input), and any NATIVE overlay (out of our layer — see the block comment
 * above and issue #748 hypothesis (a)).
 *
 * Never throws into the host app — every step is individually guarded.
 * Exported for unit tests and for a consumer that wants to force a clean detach.
 */
export function detachDebugSurface(): void {
  if (debugSurfaceDetached) return;
  debugSurfaceDetached = true;
  cancelScheduledDetach();

  // 1. Stop the badge's heartbeat/pending-call interval (#749) BEFORE removing
  // the node, then remove the on-phone indicator badge if it is still present.
  // The controller (`window.__ait_indicator`) exposes `stop()`; the optional
  // chaining makes this a no-op for a bare pre-#749 badge or when absent.
  try {
    if (typeof window !== 'undefined') {
      (window as unknown as { __ait_indicator?: { stop?: () => void } }).__ait_indicator?.stop?.();
    }
    if (typeof document !== 'undefined') {
      document.getElementById('__ait_debug_indicator')?.remove();
    }
  } catch {
    // Never let a DOM edge case break teardown.
  }

  // 2. Tear down the eruda console (unmountEruda is itself fail-silent).
  try {
    unmountEruda();
  } catch {
    // unmountEruda already swallows internally; this is belt-and-suspenders.
  }

  // 3. Restore the native-bridge call observer wraps and drop the snapshot
  // (#749) — never throws (uninstallBridgeObserver guards each undo).
  try {
    uninstallBridgeObserver();
  } catch {
    // Belt-and-suspenders — uninstall is already internally guarded.
  }

  // 4. Restore normal screen sleep. SECRET-HANDLING: no relay/TOTP value is
  // read or logged here — this only flips the awake flag off.
  try {
    void setScreenAwakeMode({ enabled: false }).catch(() => {});
  } catch {
    // Some platforms/mock reject synchronously — swallow.
  }
}

/**
 * Wraps `window.WebSocket` with a relay-origin-scoped observer (issue #478).
 *
 * - Connections whose URL origin does NOT match the relay origin pass through
 *   to the native constructor untouched — app traffic is never observed.
 * - Relay-origin connections get a `close` listener: code 4401 (the relay's
 *   named TOTP rejection) flips the module into the expired state and posts
 *   `reason: 'auth-expired'` to the parent launcher shell (once).
 * - After 4401, further relay-origin dials return a fail-fast dummy socket so
 *   target.js's autonomous reconnect loop stops hitting the network.
 *
 * Installed by {@link maybeAttach} BEFORE target.js is injected so the very
 * first dial is already observed. Idempotent per page lifecycle. Exported for
 * unit tests.
 */
export function installRelayWsObserver(relayUrl: string): void {
  if (wsObserverInstalled) return;
  if (typeof window === 'undefined' || typeof window.WebSocket !== 'function') return;
  const relayKey = wsOriginKey(relayUrl);
  if (relayKey === null) return;
  wsObserverInstalled = true;
  // #730: signal to the page that relay-WS lifecycle is already observed, so
  // a CDP-injected debug indicator can subscribe to `ait:relay-ws-state`
  // instead of installing a second Proxy on window.WebSocket.
  window.__ait_relay_ws_observed = true;

  // #748: beforeunload-safe teardown — navigating away restores keepAwake and
  // clears the surface even if no WS close fired. Registered ONLY here (inside
  // the observer install, which runs only after a debug attach), so there is
  // zero behavior change when no debug attach happened. Idempotent + fail-safe.
  window.addEventListener('pagehide', () => detachDebugSurface(), { once: true });

  const NativeWebSocket = window.WebSocket;
  const observed = new Proxy(NativeWebSocket, {
    construct(target, args: unknown[]): object {
      const url = String(args[0]);
      if (wsOriginKey(url) !== relayKey) {
        // Not relay traffic — construct natively, no observation.
        return Reflect.construct(target, args);
      }
      if (relayAuthExpired) {
        // Retry-storm cutoff: the relay already named this session expired.
        return createFailFastSocket(url);
      }
      const ws = Reflect.construct(target, args) as WebSocket;
      // #730: broadcast generic open/close lifecycle (any close code) so the
      // debug indicator can flip its live badge — additive to the existing
      // 4401-specific branch below, which is untouched.
      ws.addEventListener('open', () => {
        broadcastRelayWsState('open');
        // #748: a (re)connect aborts any pending graceful-detach — a transient
        // tunnel blip that target.js recovers from must not tear the surface down.
        cancelScheduledDetach();
      });
      ws.addEventListener('close', (event) => {
        broadcastRelayWsState('close');
        if ((event as CloseEvent).code === RELAY_AUTH_REJECT_CLOSE_CODE) {
          relayAuthExpired = true;
          notifyAuthExpired();
          // #748: 4401 is terminal by design (no reconnect without a QR rescan)
          // — tear down immediately, no grace window.
          detachDebugSurface();
        } else {
          // #748: any other close may be transient — schedule teardown after a
          // grace window; a reconnect 'open' cancels it.
          scheduleDetach();
        }
      });
      // #748: an error that never emits a clean close still needs teardown
      // (unclean-close path) — schedule defensively; a recovery 'open' cancels it.
      ws.addEventListener('error', () => {
        scheduleDetach();
      });
      return ws;
    },
  });
  window.WebSocket = observed as typeof WebSocket;
}

/**
 * The webViewType self-report postMessage type (#580).
 *
 * Canonical definition + the receive-side parser live in
 * `src/mock/safe-area-bridge.ts` (`WEB_VIEW_TYPE_MESSAGE_TYPE`,
 * `parseWebViewTypeMessage`). It is re-declared here as a local literal so the
 * in-app entry does NOT import the mock barrel (which would drag mock internals
 * — navigation/state — into the dogfood in-app graph). The two literals are
 * kept in sync by value; if one changes, change both. Same decoupling pattern
 * the launcher fixture uses for its message-type constants.
 */
const WEB_VIEW_TYPE_MESSAGE_TYPE = 'ait:web-view-type' as const;

/** Guard so the webViewType self-report is posted at most once per page. */
let webViewTypeReported = false;

/**
 * Self-report the mini-app's webViewType to the parent launcher shell, ONCE
 * (#580).
 *
 * The mini-app's type is the build constant `__WEB_VIEW_TYPE__`, injected by
 * the devtools unplugin from `granite.config.ts`'s `webViewProps.type`. The
 * launcher (env-2 PWA) is cross-origin and cannot read it directly, so the
 * framed page posts it to `window.parent`; the launcher switches to game mode
 * automatically (no manual `?navBarType=game` URL edit).
 *
 * Defensive by construction — must NEVER break attach:
 *  - `__WEB_VIEW_TYPE__` is a CONSUMER-build define; it does not exist in
 *    devtools' own build or where the unplugin did not inject it. The `typeof`
 *    guard avoids a ReferenceError; an absent constant is a silent no-op.
 *  - Only posts when inside an iframe (`window.parent !== window`) — a
 *    top-level load has no launcher shell to receive the message.
 *  - The SDK's deprecated `'external'` alias of `partner` (web-framework 2.6.1)
 *    is mapped to `'partner'`; the launcher only emulates `partner` | `game`.
 *  - Wrapped in try/catch so any postMessage/iframe edge case is swallowed.
 *
 * SECRET-HANDLING: the payload carries ONLY the webViewType enum — no host,
 * relay URL, code, or secret.
 */
export function reportWebViewType(): void {
  if (webViewTypeReported) return;
  try {
    if (typeof window === 'undefined' || window.parent === window) return;
    // `typeof` guard: the define is absent in devtools' own build and wherever
    // the unplugin did not inject it — a bare read would throw ReferenceError.
    const raw = typeof __WEB_VIEW_TYPE__ !== 'undefined' ? __WEB_VIEW_TYPE__ : undefined;
    if (raw === undefined) return;
    // Map the deprecated 'external' alias onto 'partner'; the launcher only
    // knows the two shapes it emulates. Anything unexpected → no report.
    const value: 'partner' | 'game' | null =
      raw === 'game' ? 'game' : raw === 'partner' || raw === 'external' ? 'partner' : null;
    if (value === null) return;
    webViewTypeReported = true;
    window.parent.postMessage({ type: WEB_VIEW_TYPE_MESSAGE_TYPE, value }, '*');
  } catch {
    // Never let the self-report break attach — swallow any iframe/postMessage
    // edge case silently (no log: a missing define on plain loads is expected).
  }
}

/**
 * Evaluates the 3-layer debug gate and, if the gate passes, injects the Chii
 * `target.js` script into `document.head`.
 *
 * Idempotent — calling more than once is safe. The second call is a no-op if
 * a script with the same `src` is already present in the document, and the
 * module-level `attached` flag prevents redundant DOM queries after the first
 * successful injection.
 *
 * Safe to call even if `document` is somehow unavailable (defensive boundary
 * guard — in practice this always runs in a real WebView).
 *
 * **keepAwake side effect**: on a successful attach, `setScreenAwakeMode({
 * enabled: true })` is called so the phone screen stays awake during the debug
 * session. A `beforeunload` handler restores normal sleep on page unload.
 * Opt out by adding `noKeepAwake=1` to the page URL query string — the check
 * reads `window.location.search` directly, consistent with other guards in
 * this file.
 *
 * @param gateResult - Optional pre-evaluated gate result for testability.
 *   Defaults to `checkDebugGate()` which reads the current page URL. Passing a
 *   custom value avoids the need to manipulate `window.location` in tests.
 */
export function maybeAttach(gateResult: GateResult = checkDebugGate()): void {
  // #580: self-report the mini-app's webViewType to the launcher shell once,
  // independent of the gate outcome — the launcher auto-enters game mode for
  // a game-type mini-app. No-op outside an iframe / when the define is absent.
  reportWebViewType();

  if (!gateResult.attach) {
    console.debug(
      `[@ait-co/devtools] debug attach skipped — gate blocked (reason: ${gateResult.reason})`,
    );
    // Defect 2: a wrong/expired TOTP code is the ONLY block reason that is a
    // user-actionable failure inside a deliberate debug session — the operator
    // scanned a QR expecting an attach. Surface it to the parent launcher shell
    // so it can show a "rescan the QR" banner. Every other reason
    // ('host'/'entry'/'opt-in'/'invalid-relay') fires on ordinary non-debug page
    // loads and must stay silent to avoid a banner on every plain pageview.
    // SECRET-HANDLING: the message carries ONLY the 'auth' reason enum — never
    // the code, secret, host, or relay URL.
    if (gateResult.reason === 'auth' && typeof window !== 'undefined' && window.parent !== window) {
      window.parent.postMessage({ type: 'ait:debug-attach-blocked', reason: 'auth' }, '*');
    }
    return;
  }

  // Guard against double-injection across repeated calls.
  if (attached) {
    return;
  }

  // Defensive: if document is not available (unusual, but possible in some
  // SSR-adjacent edge cases), bail silently rather than throwing.
  if (typeof document === 'undefined') {
    return;
  }

  // TOTP path-prefix transport (issue #466): forward the page URL's `at` code
  // (delivered by the dashboard QR → launcher deep-link) into the target
  // script URL so the WS upgrade derived from it passes the relay's TOTP
  // gate. Absent `at` → legacy un-prefixed URL (relay without TOTP, tests).
  // Read window.location.search directly, consistent with other guards in
  // this file. SECRET-HANDLING: the code is never logged; it rides only in
  // the script src (the intended transport).
  //
  // TTL note: the code is verified within the relay's ±1-step window (90 s),
  // so the initial attach always fits. A much-later automatic reconnect by
  // target.js reuses the stale prefix and is rejected (401) — by design under
  // the URL-leak threat model; recover by rescanning the QR (the relay-side
  // auth-reject counter from issue #467 makes this visible).
  const atCode =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('at') : null;

  const src = deriveTargetScriptUrl(gateResult.relayUrl, atCode);

  // Issue #478: observe relay-bound WebSockets BEFORE target.js is injected so
  // even its very first dial — and every autonomous reconnect after a session
  // drop — is covered. The relay names a TOTP rejection with close code 4401;
  // the observer relays it to the launcher banner and cuts the retry storm.
  installRelayWsObserver(gateResult.relayUrl);

  // Issue #749: observe the REAL native bridge (env 3) so the indicator can
  // show in-flight SDK calls + a last-call stamp — the mock's sdkCallLog does
  // not see the real SDK here. SECRET-HANDLING: records API names + timings
  // only, never arguments/results. Fail-safe: never throws into attach.
  installBridgeObserver();

  // Also guard against a script with the same src already in the DOM
  // (e.g. injected by a different code path or a page reload within SPA).
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
  if (existing !== null) {
    attached = true;
    return;
  }

  const script = document.createElement('script');
  script.src = src;
  script.async = true;
  // Issue #478: a first-load stale code (QR scanned after expiry) fails the
  // target.js GET itself — no WebSocket is ever dialled, so the observer
  // above can't see it. Probe the same URL once with fetch(): the relay's
  // 401 now carries CORS headers, so the status is readable cross-origin.
  // 401 → surface auth-expired; anything else (tunnel down, transient
  // network) stays silent — same behaviour as before #478.
  script.onerror = () => {
    void fetch(src)
      .then((res) => {
        if (res.status === 401) notifyAuthExpired();
      })
      .catch(() => {
        // Network-level failure — not an auth signal; stay silent.
      });
  };
  (document.head ?? document.documentElement).appendChild(script);

  attached = true;

  // Mount the eruda in-page console alongside the Chii remote transport. Same
  // post-gate point, same debug session — Chii relays CDP to the PC frontend,
  // eruda shows the console on the phone itself. Fire-and-forget: eruda loads
  // lazily and fail-silent, so a slow or absent eruda never blocks the Chii
  // attach or the keepAwake step below. See eruda-overlay.ts for the build-time
  // absence + gate-inheritance contract.
  void mountEruda();

  // keepAwake — keep phone screen on during the debug session.
  // Opt out via noKeepAwake=1 in the URL (consistent with direct window reads
  // used throughout this file).
  if (
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('noKeepAwake') === '1'
  ) {
    return;
  }

  setScreenAwakeMode({ enabled: true })
    .then(() => {
      // Restore normal sleep on page unload — only if the enable call succeeded
      // (nothing to restore if it failed).
      window.addEventListener(
        'beforeunload',
        () => {
          setScreenAwakeMode({ enabled: false }).catch(() => {});
        },
        { once: true },
      );
    })
    .catch((err) => {
      // Swallow rejection so attach never breaks — some platforms/mock reject.
      console.debug('[@ait-co/devtools] setScreenAwakeMode failed:', err);
    });
}
