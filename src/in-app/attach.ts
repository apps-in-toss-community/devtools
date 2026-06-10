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
      ws.addEventListener('close', (event) => {
        if ((event as CloseEvent).code === RELAY_AUTH_REJECT_CLOSE_CODE) {
          relayAuthExpired = true;
          notifyAuthExpired();
        }
      });
      return ws;
    },
  });
  window.WebSocket = observed as typeof WebSocket;
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
