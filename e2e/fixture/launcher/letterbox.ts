// Pure letterbox-detection logic for the launcher PWA (#469) — no DOM, no
// library imports — so it can be unit-tested under vitest (jsdom) without the
// launcher's heavy top-level imports (same pattern as entry.ts). Launcher.tsx
// reads the live values from the DOM and feeds them in.
//
// Background (#469 forensics, iPhone 16e Simulator / iOS 26.5; #475 real-device
// CDP measurements, iOS 26): in standalone (home-screen) mode, iOS 26 can
// mis-size the web view to (screen height − status-bar height) while anchoring
// it at the TOP. The missing ~47pt strip at the bottom is OUTSIDE the window —
// the OS paints it with the manifest `background_color`, and no page CSS
// (100dvh, inset:0) can reach it. From inside the page the signature is:
//
//   window.innerHeight ≈ screen.height − statusBar   (shortfall)
//   display-mode: standalone
//   env(safe-area-inset-top) > 0
//
// env(safe-area-inset-top) discriminator (#479): real-device CDP measurements
// confirm that the top inset is reliable:
//   - letterboxed (top-anchored, bottom strip dead): safeAreaTop = 47
//   - healthy below-status-bar standalone:           safeAreaTop = 0
// This single bit resolves the false-positive accepted in #475/#476 — a
// healthy reinstalled device now correctly gets detected: false.
//
// Limits of the heuristic: a hypothetical "middle-floating" window that touches
// neither the top nor the bottom of the screen would also report safeAreaTop 0
// and would be missed. No such geometry has been observed in the wild; phantom
// behaviour has only been seen on the bottom inset (#475).
//
// env(safe-area-inset-bottom) is NOT part of the signature (#475): the
// Simulator reports 0 in the letterboxed state (the viewport never reaches the
// home-indicator area), but a real iOS 26 device reports a PHANTOM 34 in the
// exact same letterboxed geometry (innerHeight 797 vs screen.height 844). The
// inset value is therefore untrustworthy as a discriminator and is ignored
// here — it stays in ViewportMetrics only for the diagnostics panel.
//
// Configurations that still do NOT match:
//   - normal browser tab           → not standalone (Safari chrome eats height
//                                    legitimately).
//   - standalone, edge-to-edge     → innerHeight === screen.height (no shortfall).
//   - home-button devices (20pt status bar) → shortfall stays under the
//                                    threshold below (the threshold, not the
//                                    inset, carries this guard).
//   - healthy below-status-bar     → safeAreaTop === 0, so detected: false
//                                    (trade-off from #475/#476 resolved by #479).

/** A snapshot of the page-visible viewport geometry. */
export interface ViewportMetrics {
  innerWidth: number;
  innerHeight: number;
  screenWidth: number;
  screenHeight: number;
  /** `visualViewport.height`, or null when the API is unavailable. */
  visualViewportHeight: number | null;
  /** `env(safe-area-inset-top)` in CSS px (0 when unsupported). */
  safeAreaTop: number;
  /**
   * `env(safe-area-inset-bottom)` in CSS px (0 when unsupported).
   * Diagnostics-display only — not consulted by detectLetterbox() (#475).
   */
  safeAreaBottom: number;
  /** `(display-mode: standalone)` media query or `navigator.standalone`. */
  standalone: boolean;
}

export interface LetterboxVerdict {
  detected: boolean;
  /** screen height minus the tallest observed viewport height, in CSS px. */
  shortfallPx: number;
}

// Strictly above the classic 20pt status bar so home-button devices (iPhone
// SE class: shortfall exactly 20 in the healthy below-status-bar layout) never
// false-positive. Notch/Dynamic-Island status bars are 44–59pt, comfortably
// above. With the inset condition dropped (#475) this threshold is the only
// SE-class guard.
export const LETTERBOX_MIN_SHORTFALL_PX = 24;

/**
 * Decide whether the current geometry matches the iOS standalone letterbox
 * signature (#469). Pure — call with a fresh ViewportMetrics snapshot.
 */
export function detectLetterbox(metrics: ViewportMetrics): LetterboxVerdict {
  // The keyboard shrinks visualViewport but not innerHeight; some engines lag
  // one of the two during rotation. Take the tallest honest observation so a
  // transiently-small value never inflates the shortfall.
  const effectiveHeight = Math.max(metrics.innerHeight, metrics.visualViewportHeight ?? 0);
  const shortfallPx = Math.round(metrics.screenHeight - effectiveHeight);

  // Portrait guard: on iOS, screen.width/height stay portrait-fixed across
  // rotation, so in landscape innerWidth > screenWidth and a height comparison
  // against screenHeight is meaningless. (The manifest locks portrait and the
  // observed iOS 26 defect is portrait-specific.)
  const portrait = metrics.innerWidth <= metrics.screenWidth;

  // safeAreaBottom is deliberately NOT consulted (#475 phantom inset — see the
  // header comment): real iOS 26 devices report a non-zero bottom inset even
  // when the window never reaches the home indicator.
  //
  // safeAreaTop IS consulted (#479): the top inset proved reliable as a
  // discriminator. A letterboxed window is anchored at the screen top, so iOS
  // reports the full status-bar height as safeAreaTop (e.g. 47). A healthy
  // below-status-bar standalone window starts below the status bar, so
  // safeAreaTop === 0. Requiring safeAreaTop > 0 eliminates the false-positive
  // for healthy reinstalled devices (the trade-off accepted in #475/#476).
  const detected =
    metrics.standalone &&
    portrait &&
    shortfallPx >= LETTERBOX_MIN_SHORTFALL_PX &&
    metrics.safeAreaTop > 0;

  return { detected, shortfallPx };
}
