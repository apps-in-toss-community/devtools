/**
 * env-2 safe-area inset bridge (#484, slice 2).
 *
 * In the AITC Sandbox PWA (env 2) the dev app runs inside the launcher's
 * full-viewport `<iframe>`. The launcher is the top-level document, so its
 * `env(safe-area-inset-*)` measurement is the ground truth for the real device
 * geometry. The framed page's mock would otherwise report a synthetic preset
 * value (e.g. top=54), which sdk-example then double-pads on top of a viewport
 * that already starts below the status bar — the env-2 "dead band" defect.
 *
 * The launcher forwards its measured insets to the framed page with
 * `postMessage({ type: 'ait:safe-area-insets', insets })` (on iframe load and on
 * resize/orientationchange). This module installs the receive half: it validates
 * the envelope and writes the real insets into the mock `SafeAreaInsets` state,
 * which fires the existing subscribe path (see navigation/index.ts) so apps that
 * subscribe re-read the corrected values.
 *
 * Origin: the inset values are non-sensitive geometry (four small numbers), so
 * we do NOT restrict by origin — the launcher posts cross-origin from a
 * *.trycloudflare.com tunnel with targetOrigin '*'. Shape + range validation is
 * still mandatory: a malformed or out-of-range message is silently ignored so a
 * stray postMessage from any frame can never corrupt the mock state.
 *
 * Message-driven by design: env 1 (desktop browser, no launcher) never receives
 * this message, so the panel preset stays authoritative there with zero special
 * casing here.
 */

import { aitState } from './state.js';
import type { SafeAreaInsets } from './types.js';

/** The postMessage envelope the launcher posts to the framed dev app. */
export const SAFE_AREA_INSETS_MESSAGE_TYPE = 'ait:safe-area-insets' as const;

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
