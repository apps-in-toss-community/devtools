// Pure letterbox-detection logic for the launcher PWA (#469) — no DOM, no
// library imports — so it can be unit-tested under vitest (jsdom) without the
// launcher's heavy top-level imports (same pattern as entry.ts). Launcher.tsx
// reads the live values from the DOM and feeds them in.
//
// Background (#469 forensics, iPhone 16e Simulator / iOS 26.5; #475 real-device
// CDP measurements, iOS 26): in standalone (home-screen) mode, iOS can
// mis-size the web view while anchoring it at the TOP. From inside the page the
// signature is:
//
//   window.innerHeight ≈ screen.height − statusBar   (shortfall)
//   display-mode: standalone
//
// Geometry model (CORRECTED 2026-06-13, #561 — supersedes the earlier
// "missing strip is OUTSIDE the window, OS-painted" theory):
//
//   The window is the FULL screen height — real-device measurement of an
//   attached letterboxed iframe reported outerHeight 844 === screen.height,
//   screenY 0, standalone true. It is NOT an OS-level letterbox.
//
//   What is mis-sized is the WebKit top-level VIEWPORT: layout + content paint
//   + hit-testing all clip at screen.height − statusBar (≈797 on a 844 screen).
//   An IntersectionObserver sentinel ladder (sentinels at bottom 0…110px inside
//   the framed page) found the clip boundary exactly at y≈797: every sentinel at
//   or below the boundary reported isIntersecting:false, the first above it
//   reported true. The bottom ~47pt band receives only the canvas background
//   (black) — no content paints there and no touch lands there.
//
//   Consequence: the #527 px expansion (forcing the root container to
//   screen.height px) does NOT paint into that band — a fixed box does not
//   contribute to document scroll overflow, so the band stays unreachable. Worse,
//   stretching the iframe to screen.height − envTop − bar (743) while the real
//   viewport is 797 CLIPS the mini-app's own bottom ~47px of content (its bottom
//   buttons silently vanish). The pre-#527 formula (calc(100% − env(top) − bar),
//   100% resolving against the real ≈797 ICB → iframe ≈696) leaves the dead band
//   visible but loses no content. The earlier "Web Inspector height override
//   paints into the band (2026-06-12)" observation is now believed to be an
//   artifact of the Inspector attach itself altering viewport state — it is
//   irreconcilable with today's IO-ladder measurement.
//
//   #561 response: the px correction is no longer applied on faith. Launcher.tsx
//   applies it, then VERIFIES it at runtime (verifyLetterboxCorrection() below —
//   a bottom sentinel + top-level IntersectionObserver). If the sentinel is
//   clipped, the layout falls back to the honest calc()/100% formula, bridge
//   insets are re-sent with letterboxCorrected=false (bottom 0), and the toast
//   states the limit honestly instead of claiming a fix.
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

/**
 * Stable identity of the current GENUINE geometry epoch — screen dimensions +
 * orientation. Deliberately EXCLUDES innerHeight / visualViewportHeight so the
 * html/body height force (which only moves innerHeight) does NOT change the key:
 * a held correction stays within one epoch and is never released by its own
 * shortfall→0 side effect. Only a true rotation (portrait↔landscape flips the
 * orientation char) or a real screen-dimension change advances the epoch and
 * re-arms detection. Returns null for degenerate metrics (screenHeight ≤ 0,
 * observed transiently on iOS background/foreground) so a garbage snapshot can
 * never forge an epoch transition that clears a valid force.
 */
export function letterboxEpochKey(m: ViewportMetrics): string | null {
  if (m.screenWidth <= 0 || m.screenHeight <= 0) return null;
  const portrait = m.innerWidth <= m.screenWidth;
  return `${m.screenWidth}x${m.screenHeight}|${portrait ? 'P' : 'L'}`;
}

/**
 * Correction-aware letterbox verdict. When a correction is being held and the
 * viewport now reads full height (shortfall ≈ 0), report detected=true ("the
 * correction is HOLDING") rather than false — so a successful correction never
 * reads as "never was letterboxed" and the force is never torn down by its own
 * success. When correctionActive is false this is byte-identical to
 * detectLetterbox(m).detected (the honest signature), so when the real cause is
 * gone (epoch change clears correctionActive) it honestly returns false.
 *
 * The "holding" branch reuses detectLetterbox's exact guards (standalone +
 * portrait + safeAreaTop > 0) so there is no boundary off-by-one and partial
 * expansions (797→820, shortfall 24) still satisfy the raw branch above
 * unchanged.
 */
export function isLetterboxResolved(m: ViewportMetrics, correctionActive: boolean): boolean {
  if (detectLetterbox(m).detected) return true;
  if (!correctionActive) return false;
  // Correction in force: treat the geometry as if the height matched screen
  // height and re-run the SAME guards (standalone + portrait + safeAreaTop > 0).
  // Reusing detectLetterbox's guard set keeps the threshold contract
  // single-sourced.
  const portrait = m.innerWidth <= m.screenWidth;
  return m.standalone && portrait && m.safeAreaTop > 0;
}

// ---------------------------------------------------------------------------
// Runtime self-verification of the #527 px correction (#561)
// ---------------------------------------------------------------------------

/** Outcome of verifying that the px-corrected container actually paints. */
export type LetterboxVerification = 'visible' | 'clipped';

/**
 * One-shot observation of whether a sentinel placed at the very bottom of the
 * corrected container intersects the top-level viewport. Abstracts the
 * `IntersectionObserver` so the verification flow can be unit-tested without a
 * real one (jsdom has no IO). `onResult` is invoked at most once with the
 * observed `isIntersecting`; the returned function disconnects the observer and
 * removes the sentinel (idempotent — safe to call after a result or a timeout).
 */
export type SentinelObserver = (onResult: (isIntersecting: boolean) => void) => () => void;

/**
 * Injectable timer pair so the timeout guard is testable with fake timers.
 * Generic over the handle type so the real `window.setTimeout`/`clearTimeout`
 * pair (handle = number) type-checks without a cast, and tests can inject a
 * stub returning any handle they like.
 */
export interface VerificationTimers<H = unknown> {
  setTimeout: (fn: () => void, ms: number) => H;
  clearTimeout: (handle: H) => void;
}

/**
 * Time budget (ms) for the IntersectionObserver to report. If it stays silent
 * past this, the band is treated as clipped — the honest fallback is the safe
 * default (it never hides mini-app content), so a missing callback must not
 * leave the harmful #527 expansion in place.
 */
export const LETTERBOX_VERIFY_TIMEOUT_MS = 1000;

/**
 * Verify that the #527 px correction actually paints to the screen bottom,
 * rather than assuming it (the assumption was refuted on real hardware — see
 * the geometry-model note in this file's header, #561).
 *
 * The caller installs a 1px sentinel at `bottom:0` of the corrected container
 * and wires it to a top-level `IntersectionObserver` (root null), exposed here
 * as `observe`. This function arms a timeout guard and resolves exactly once:
 *
 *   - sentinel intersects   → 'visible'  (correction holds — keep it)
 *   - sentinel clipped      → 'clipped'  (fall back to the honest layout)
 *   - observer never fires  → 'clipped'  (timeout — fail safe, never keep #527)
 *
 * After resolving it disconnects the observer and removes the sentinel via the
 * `observe` cleanup. Pure control-flow (no DOM, no real IO/timer) — the DOM and
 * IntersectionObserver wiring lives in Launcher.tsx, the timing is injected — so
 * all three branches are unit-testable.
 *
 * @returns a cancel function. Calling it before resolution aborts the
 *   verification (clears the timeout, disconnects the observer) WITHOUT invoking
 *   `onVerified` — used by the React effect cleanup on unmount / re-evaluation.
 */
export function verifyLetterboxCorrection<H>(
  observe: SentinelObserver,
  onVerified: (result: LetterboxVerification) => void,
  timers: VerificationTimers<H>,
  timeoutMs: number = LETTERBOX_VERIFY_TIMEOUT_MS,
): () => void {
  let settled = false;
  let timeoutHandle: H | undefined;
  let disconnect: (() => void) | null = null;

  // Single resolution path: clear the timer, tear down the observer/sentinel,
  // and notify. Guarded so a late IO callback after a timeout is a no-op.
  const settle = (result: LetterboxVerification, notify: boolean): void => {
    if (settled) return;
    settled = true;
    if (timeoutHandle !== undefined) timers.clearTimeout(timeoutHandle);
    disconnect?.();
    if (notify) onVerified(result);
  };

  timeoutHandle = timers.setTimeout(() => settle('clipped', true), timeoutMs);

  disconnect = observe((isIntersecting) => {
    settle(isIntersecting ? 'visible' : 'clipped', true);
  });

  // Defensive: a real IntersectionObserver never reports synchronously inside
  // observe(), but if a stub did, settle() ran before `disconnect` was assigned
  // — so its disconnect?.() was a no-op. Tear down here now that we hold the
  // cleanup, to avoid a leaked observer/sentinel.
  if (settled) disconnect();

  // Return the abort handle for the React cleanup (no notify).
  return () => settle('clipped', false);
}
