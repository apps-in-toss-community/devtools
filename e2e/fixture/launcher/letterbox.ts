// Pure letterbox-detection logic for the launcher PWA (#469) — no DOM, no
// library imports — so it can be unit-tested under vitest (jsdom) without the
// launcher's heavy top-level imports (same pattern as entry.ts). Launcher.tsx
// reads the live values from the DOM and feeds them in.
//
// Background (#469 forensics, iPhone 16e Simulator / iOS 26.5): in standalone
// (home-screen) mode, iOS 26 can mis-size the web view to
// (screen height − status-bar height) while anchoring it at the TOP. The
// missing ~47pt strip at the bottom is OUTSIDE the window — the OS paints it
// with the manifest `background_color`, and no page CSS (100dvh, inset:0)
// can reach it. From inside the page the signature is:
//
//   window.innerHeight ≈ screen.height − statusBar   (shortfall)
//   env(safe-area-inset-bottom) = 0                  (viewport never reaches
//                                                     the home-indicator area)
//   display-mode: standalone
//
// Healthy configurations do NOT match this signature:
//   - normal browser tab           → not standalone (Safari chrome eats height
//                                    legitimately).
//   - standalone, edge-to-edge     → innerHeight === screen.height (no shortfall).
//   - standalone, below status bar → shortfall ≈ status bar, but the viewport
//                                    still reaches the screen bottom, so
//                                    safe-area-inset-bottom > 0 on home-indicator
//                                    devices.
//   - home-button devices (20pt status bar) → shortfall stays under the
//                                    threshold below.

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
  /** `env(safe-area-inset-bottom)` in CSS px (0 when unsupported). */
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
// SE class: shortfall exactly 20 in the healthy below-status-bar layout with
// safe-area-bottom 0) never false-positive. Notch/Dynamic-Island status bars
// are 44–59pt, comfortably above.
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

  const detected =
    metrics.standalone &&
    portrait &&
    metrics.safeAreaBottom === 0 &&
    shortfallPx >= LETTERBOX_MIN_SHORTFALL_PX;

  return { detected, shortfallPx };
}
