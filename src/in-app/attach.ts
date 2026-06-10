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
