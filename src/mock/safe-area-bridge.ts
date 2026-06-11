/**
 * env-2 postMessage bridges (#484, #510).
 *
 * In the AITC Sandbox PWA (env 2) the dev app runs inside the launcher's
 * full-viewport `<iframe>`. The launcher is the top-level document, so its
 * `env(safe-area-inset-*)` measurement is the ground truth for the real device
 * geometry. The framed page's mock would otherwise report a synthetic preset
 * value (e.g. top=54), which sdk-example then double-pads on top of a viewport
 * that already starts below the status bar — the env-2 "dead band" defect.
 *
 * This module installs receive-half listeners for two message types:
 *
 * 1. `ait:safe-area-insets` (#484): the launcher forwards its real env() insets
 *    to the framed page on iframe load and resize/orientationchange. Validates the
 *    envelope and writes real insets into the mock SafeAreaInsets state, firing the
 *    subscribe path (see navigation/index.ts) so apps that subscribe re-read the
 *    corrected values.
 *
 * 2. `ait:navigate-back` (#510): the launcher partner bar's `←` button posts this
 *    command to the framed page. The receive half calls `history.back()` so the
 *    cross-origin back action is bridged without the launcher ever touching the
 *    framed page's history object directly. No data other than `type` is read from
 *    or written to the message — shape validation rejects anything that carries
 *    extra fields with the wrong type. Apps that do not install this mock (older
 *    builds) silently ignore the message (natural no-op).
 *
 * Origin policy: neither message type carries sensitive data, so we do NOT
 * restrict by origin — the launcher posts cross-origin from a *.trycloudflare.com
 * tunnel with targetOrigin '*'. Shape validation is still mandatory: a malformed
 * or out-of-range message is silently ignored so a stray postMessage can never
 * corrupt the mock state or trigger spurious navigation.
 *
 * Message-driven by design: env 1 (desktop browser, no launcher) never receives
 * these messages, so the panel preset stays authoritative there with zero special
 * casing here.
 */

import { aitState } from './state.js';
import type { SafeAreaInsets } from './types.js';

/** The postMessage envelope the launcher posts to the framed dev app (inset forward). */
export const SAFE_AREA_INSETS_MESSAGE_TYPE = 'ait:safe-area-insets' as const;

/**
 * The postMessage command the launcher partner bar's `←` button sends to the
 * framed dev app (#510). The framed page calls `history.back()` in response.
 *
 * Protocol: only `{ type: 'ait:navigate-back' }` is valid. No other fields are
 * read or acted on — extra fields are silently ignored by the shape guard.
 * Game variant never sends this message (back button is partner-bar-only).
 */
export const NAVIGATE_BACK_MESSAGE_TYPE = 'ait:navigate-back' as const;

// Insets are CSS px; a real device tops out well under this. The bound rejects
// nonsense (NaN/Infinity/negative/absurd) without being so tight it clips a
// future large-notch device.
const MAX_INSET_PX = 200;

function isValidInset(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_INSET_PX;
}

/**
 * Parse + validate a raw postMessage payload into a `SafeAreaInsets`, or return
 * null when it is not a well-formed `ait:safe-area-insets` message. Pure — unit
 * tested without a real MessageEvent.
 */
export function parseSafeAreaInsetsMessage(data: unknown): SafeAreaInsets | null {
  if (typeof data !== 'object' || data === null) return null;
  if ((data as { type?: unknown }).type !== SAFE_AREA_INSETS_MESSAGE_TYPE) return null;

  const insets = (data as { insets?: unknown }).insets;
  if (typeof insets !== 'object' || insets === null) return null;

  const { top, bottom, left, right } = insets as Record<string, unknown>;
  if (!isValidInset(top) || !isValidInset(bottom) || !isValidInset(left) || !isValidInset(right)) {
    return null;
  }
  return { top, bottom, left, right };
}

/**
 * Apply forwarded insets to the mock state. Skips the write (and the resulting
 * subscribe notify) when nothing changed, so repeated identical messages from a
 * resize storm don't churn subscribers.
 */
export function applyForwardedSafeAreaInsets(insets: SafeAreaInsets): void {
  const current = aitState.state.safeAreaInsets;
  if (
    current.top === insets.top &&
    current.bottom === insets.bottom &&
    current.left === insets.left &&
    current.right === insets.right
  ) {
    return;
  }
  aitState.update({ safeAreaInsets: insets });
}

let installed = false;

/**
 * Install the window `message` listener that receives forwarded insets. Safe to
 * call multiple times (idempotent) and a no-op outside a browser (SSR/jsdom
 * without a window). Imported for its side effect by the mock barrel so any
 * consumer that aliases `@apps-in-toss/web-framework` to the mock gets it wired.
 */
export function installSafeAreaInsetsBridge(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('message', (event: MessageEvent) => {
    const insets = parseSafeAreaInsetsMessage(event.data);
    if (insets) applyForwardedSafeAreaInsets(insets);
  });
}

/**
 * Parse a raw postMessage payload as an `ait:navigate-back` command.
 *
 * Returns true when the payload is a well-formed navigate-back command
 * (`{ type: 'ait:navigate-back' }`), false otherwise. Pure — unit tested
 * without a real MessageEvent.
 *
 * Shape guard: only the `type` field is inspected; any extra fields are
 * ignored so future extensions do not break older receivers. The function
 * does NOT read any data field beyond `type` — no sensitive values, no host
 * disclosure (same principle as the insets bridge).
 */
export function isNavigateBackMessage(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false;
  return (data as { type?: unknown }).type === NAVIGATE_BACK_MESSAGE_TYPE;
}

let navigateBackInstalled = false;

/**
 * Install the window `message` listener that handles `ait:navigate-back`
 * commands (#510). When the launcher partner bar's `←` button is clicked it
 * posts `{ type: 'ait:navigate-back' }` to the framed dev app; this listener
 * calls `history.back()` so the cross-origin back action is bridged without the
 * launcher touching the framed page's history directly.
 *
 * Safe to call multiple times (idempotent) and a no-op outside a browser.
 * Installed together with the inset bridge by `installBridges()` so any consumer
 * of the mock barrel gets both wired automatically.
 *
 * No-op on apps that predate this bridge — the launcher posts the message but
 * older mocks simply have no listener (harmless).
 */
export function installNavigateBackBridge(): void {
  if (navigateBackInstalled || typeof window === 'undefined') return;
  navigateBackInstalled = true;
  window.addEventListener('message', (event: MessageEvent) => {
    if (isNavigateBackMessage(event.data)) {
      history.back();
    }
  });
}

/**
 * Install both env-2 postMessage bridges in one call (#484 insets + #510
 * navigate-back). The mock barrel calls this at import time so consumers get
 * all bridges wired without any explicit setup.
 */
export function installBridges(): void {
  installSafeAreaInsetsBridge();
  installNavigateBackBridge();
}
