// Pure letterbox-detection logic for the launcher PWA (#469) — no DOM, no
// library imports — so it can be unit-tested under vitest (jsdom) without the
// launcher's heavy top-level imports (same pattern as entry.ts). Launcher.tsx
// reads the live values from the DOM and feeds them in.
//
// Background (#469 forensics, iPhone 16e Simulator / iOS 26.5; #475 real-device
// CDP measurements, iOS 26): in standalone (home-screen) mode, iOS can
// mis-size the web view to (screen height − status-bar height) while anchoring
// it at the TOP. The missing ~47pt strip at the bottom is OUTSIDE the window —
// the OS paints it with the manifest `background_color`, and no page CSS
// (100dvh, inset:0) can reach it. From inside the page the signature is:
//
//   window.innerHeight ≈ screen.height − statusBar   (shortfall)
//   display-mode: standalone
//
// Discriminator (#479 rule, restored in #491): the canonical letterbox
// signature under black-translucent is:
//
//   standalone && portrait && shortfall >= 24 && safeAreaTop > 0
//
// Case analysis (real-device CDP, iOS 18.7, 2026-06-11):
//
//   |케이스                                   | shortfall | top | bottom | 판정  |
//   |------------------------------------------|-----------|-----|--------|-------|
//   | 신메타(black-translucent) healthy         |     0     | 47  |  34    | false |
//   | 신메타 letterbox (오늘 실측)               |    47     | 47  |  34*   | true  |
//   | 구메타(stale web clip) healthy below-sb   |   47–59   |  0  |  34    | false |
//   | 구메타 letterbox (#479 실측)               |    47     | 47  |   ?    | true  |
//   | SE-class healthy (20pt status bar)        |    20     | 20  |   0    | false |
//
//   * phantom bottom 34 — real-device iOS 18.7, 2026-06-11: the letterbox
//     window reports bottom 34 even though it stops above the home indicator.
//     bottom carries NO signal in either state; the discriminator ignores it.
//
// Why bottom is excluded (#491 correction of #487):
//   #487 assumed that under black-translucent a letterboxed window would
//   collapse safeAreaBottom to 0 (window stops above the home indicator).
//   Real-device measurement (iOS 18.7, 2026-06-11) refutes this: the
//   letterboxed window reported bottom 34 (the same "phantom" value that #475
//   observed on a different window state). Bottom is a phantom in BOTH states,
//   so it carries no discriminating signal. The #479 top-inset rule is
//   reinstated: under black-translucent a healthy window has no shortfall, so
//   the `safeAreaTop > 0` guard never fires against a healthy window —
//   #487's false-positive concern is dissolved by the shortfall requirement.
//
// Configurations that still do NOT match:
//   - normal browser tab           → not standalone.
//   - standalone, edge-to-edge     → innerHeight === screen.height (shortfall 0).
//   - black-translucent healthy    → shortfall 0 → false (top>0 never fires).
//   - home-button devices (20pt)   → shortfall 20 < threshold 24 → false.
//   - stale web clip (legacy meta) → top 0 (status bar below window, not under)
//                                    → false even with shortfall 47–59.

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
   * Consulted by detectLetterbox() (#479 rule, restored in #491): under
   * black-translucent safeAreaTop > 0 when the window extends under the status
   * bar. Combined with a height shortfall this is the canonical letterbox
   * signal — a healthy black-translucent window has no shortfall, so the
   * top > 0 check never false-positives against it.
   */
  safeAreaTop: number;
  /**
   * `env(safe-area-inset-bottom)` in CSS px (0 when unsupported).
   * NOT consulted by detectLetterbox() (#491): real-device measurement
   * (iOS 18.7, 2026-06-11) shows bottom reports phantom 34 in both the
   * healthy and letterboxed states — it carries no discriminating signal.
   * Retained in ViewportMetrics for the diagnostics panel only.
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
// SE class: shortfall exactly 20 in the healthy layout) never false-positive.
// Notch/Dynamic-Island status bars are 44–59pt, comfortably above.
export const LETTERBOX_MIN_SHORTFALL_PX = 24;

/** Raw safe-area insets as measured from env() CSS. */
export interface SafeAreaInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Compute the insets to forward to the framed dev app, applying letterbox
 * corrections (#491, updated #527).
 *
 * - top: always the raw measured value (status bar overlap is real).
 * - bottom: behaviour depends on whether screen.height px correction (#527) is
 *   in effect:
 *   - correction applied (letterboxCorrected=true, default when detected):
 *     raw.bottom is restored — the frame now reaches the real screen bottom
 *     (home-indicator area) so the inset is meaningful.
 *   - correction NOT applied (letterboxCorrected=false, legacy path, letterbox
 *     detected but correction unavailable): bottom is zeroed — the window
 *     stops above the home indicator so the phantom inset must not be used
 *     (#491 original rationale).
 *   - not detected: raw.bottom passed through unchanged.
 * - left/right: always raw.
 *
 * Pure function — no DOM reads — so it can be tested under vitest independently
 * of the React component.
 */
export function computeBridgeInsets(
  raw: SafeAreaInsets,
  letterboxDetected: boolean,
  letterboxCorrected = true,
): SafeAreaInsets {
  return {
    top: raw.top,
    // #527: when correction is applied the frame extends to screen.height and
    // genuinely reaches the home-indicator area — restore the real bottom inset.
    // Without correction (legacy path) the frame still stops above the indicator,
    // so keep the #491 zeroing. Healthy windows always pass raw.bottom through.
    bottom: letterboxDetected && !letterboxCorrected ? 0 : raw.bottom,
    left: raw.left,
    right: raw.right,
  };
}

/**
 * Decide whether the current geometry matches the iOS standalone letterbox
 * signature (#469, discriminator restored to #479 rule in #491). Pure — call
 * with a fresh ViewportMetrics snapshot.
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
  // observed iOS defect is portrait-specific.)
  const portrait = metrics.innerWidth <= metrics.screenWidth;

  // safeAreaTop > 0 confirms the window extends under the status bar
  // (black-translucent in effect). Under black-translucent a HEALTHY window
  // has shortfall ≈ 0 — the shortfall guard fires only for letterboxed windows,
  // so top > 0 carries no false-positive risk when combined with a shortfall.
  //
  // safeAreaBottom is NOT consulted (#491): real-device iOS 18.7 (2026-06-11)
  // reports phantom bottom 34 in the letterboxed state — same as the healthy
  // state — so bottom has no discriminating signal in either state.
  const detected =
    metrics.standalone &&
    portrait &&
    shortfallPx >= LETTERBOX_MIN_SHORTFALL_PX &&
    metrics.safeAreaTop > 0;

  return { detected, shortfallPx };
}
