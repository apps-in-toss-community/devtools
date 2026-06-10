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
//
// Discriminator redesign (#484): the launcher now ships black-translucent
// (apple-mobile-web-app-status-bar-style) so a HEALTHY standalone window is
// edge-to-edge — it extends UNDER the status bar (top-anchored) and reaches the
// screen bottom. That inverts the #479 top-inset discriminator: black-translucent
// makes BOTH the letterbox and the healthy window report safeAreaTop > 0, so the
// top inset can no longer tell them apart.
//
// New geometry (real-device CDP, iOS 18.7 / iOS 26, #484/#475):
//
//   | state                       | shortfall      | safeAreaBottom |
//   |-----------------------------|----------------|----------------|
//   | letterboxed (bottom strip   | ~47 (dead band | 0 (window never|
//   |   OUTSIDE the window)        |   below window)|   reaches HI)  |
//   | healthy black-translucent   | ~0 (reaches    | 34 (real home  |
//   |   edge-to-edge              |   the bottom)  |   indicator)   |
//
// So the discriminator is now the BOTTOM edge: a letterboxed window has a height
// shortfall AND a zero bottom inset (it stops short of the home indicator); a
// healthy edge-to-edge window has no shortfall and a non-zero bottom inset on
// notch devices. The shortfall alone carries detection; safeAreaBottom === 0
// confirms the window failed to reach the home-indicator area.
//
// Why the bottom inset is trustworthy again: the #475 "phantom bottom 34"
// reading came from a window that was top-anchored but mis-sized — innerHeight
// 797 while reporting bottom 34. With black-translucent that same window is the
// HEALTHY state (it genuinely reaches the home indicator → bottom 34 is real),
// not a letterbox. The letterbox under black-translucent is the case where the
// OS paints a dead band BELOW the window, so the window stops above the home
// indicator and safeAreaBottom collapses to 0.
//
// env(safe-area-inset-top) is NOT consulted anymore (#484): under
// black-translucent it is non-zero in both states, so it carries no signal.
// It stays in ViewportMetrics only for the diagnostics panel.
//
// Configurations that still do NOT match:
//   - normal browser tab           → not standalone (Safari chrome eats height
//                                    legitimately).
//   - standalone, edge-to-edge     → innerHeight === screen.height (no shortfall)
//                                    and safeAreaBottom > 0 on notch devices.
//   - home-button devices (20pt status bar) → shortfall stays under the
//                                    threshold below (the threshold carries this
//                                    guard); they also have no bottom inset.

/** A snapshot of the page-visible viewport geometry. */
export interface ViewportMetrics {
  innerWidth: number;
  innerHeight: number;
  screenWidth: number;
  screenHeight: number;
  /** `visualViewport.height`, or null when the API is unavailable. */
  visualViewportHeight: number | null;
  /**
   * `env(safe-area-inset-top)` in CSS px (0 when unsupported).
   * Diagnostics-display only — not consulted by detectLetterbox() (#484): under
   * black-translucent it is non-zero in both the healthy and letterboxed states.
   */
  safeAreaTop: number;
  /**
   * `env(safe-area-inset-bottom)` in CSS px (0 when unsupported).
   * Consulted by detectLetterbox() (#484): under black-translucent a letterboxed
   * window stops above the home indicator (bottom 0), while a healthy
   * edge-to-edge window reaches it (bottom > 0 on notch devices).
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
// SE class: shortfall exactly 20 in the healthy edge-to-edge layout) never
// false-positive. Notch/Dynamic-Island status bars are 44–59pt, comfortably
// above. With the top-inset condition dropped (#484) the shortfall threshold and
// the zero-bottom-inset condition together carry the SE-class and healthy guards.
export const LETTERBOX_MIN_SHORTFALL_PX = 24;

/**
 * Decide whether the current geometry matches the iOS standalone letterbox
 * signature (#469, discriminator redesigned in #484). Pure — call with a fresh
 * ViewportMetrics snapshot.
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

  // safeAreaTop is deliberately NOT consulted (#484): under black-translucent it
  // is non-zero in BOTH the healthy and letterboxed states, so it carries no
  // discriminating signal (the inversion of the #479 reasoning).
  //
  // safeAreaBottom IS consulted (#484): under black-translucent a healthy
  // edge-to-edge window reaches the home indicator (bottom > 0 on notch
  // devices), while a letterboxed window stops above it because the OS paints a
  // dead band below the window (bottom collapses to 0). Requiring a height
  // shortfall AND a zero bottom inset distinguishes the two — a healthy
  // edge-to-edge window has no shortfall, and a healthy notch window that
  // somehow shows a small shortfall still reports bottom > 0.
  const detected =
    metrics.standalone &&
    portrait &&
    shortfallPx >= LETTERBOX_MIN_SHORTFALL_PX &&
    metrics.safeAreaBottom === 0;

  return { detected, shortfallPx };
}
