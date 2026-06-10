// Unit tests for the pure letterbox-detection logic (#469, discriminator
// redesigned in #484). The `.vitest.ts` extension keeps Playwright
// (testMatch '**/*.test.ts') from collecting this file — see vitest.config.ts
// `include`.

import { describe, expect, it } from 'vitest';
import { detectLetterbox, LETTERBOX_MIN_SHORTFALL_PX, type ViewportMetrics } from './letterbox.js';

// iPhone 16e-class geometry (390×844 logical, 47–59pt status bar, 34pt home
// indicator) — the device class of the #469 forensics. Under black-translucent
// (#484) a HEALTHY edge-to-edge window reports safeAreaTop > 0 (status bar) and
// safeAreaBottom 34 (home indicator) with no height shortfall.
function base(overrides: Partial<ViewportMetrics> = {}): ViewportMetrics {
  return {
    innerWidth: 390,
    innerHeight: 844,
    screenWidth: 390,
    screenHeight: 844,
    visualViewportHeight: 844,
    safeAreaTop: 59,
    safeAreaBottom: 34,
    standalone: true,
    ...overrides,
  };
}

describe('detectLetterbox', () => {
  it('detects a letterbox: height shortfall + zero bottom inset (#484 model)', () => {
    // Black-translucent letterbox geometry: the OS paints a dead band BELOW the
    // mis-sized window, so the window stops above the home indicator and the
    // bottom inset collapses to 0. innerHeight 797 vs screen 844 (shortfall 47).
    // safeAreaTop is non-zero (status bar) but is no longer consulted (#484).
    const verdict = detectLetterbox(
      base({
        innerHeight: 797,
        visualViewportHeight: 797,
        safeAreaTop: 47,
        safeAreaBottom: 0,
      }),
    );
    expect(verdict.detected).toBe(true);
    expect(verdict.shortfallPx).toBe(47);
  });

  it('does NOT detect the healthy black-translucent edge-to-edge layout (#484)', () => {
    // Real-device CDP measurement (iPhone, iOS 18.7, 2026-06-11): under
    // black-translucent the healthy window extends under the status bar
    // (safeAreaTop 47–59) AND reaches the home indicator (safeAreaBottom 34)
    // with no height shortfall. The non-zero bottom inset is the discriminator
    // that keeps this out of the letterbox bucket.
    const verdict = detectLetterbox(base());
    expect(verdict.detected).toBe(false);
    expect(verdict.shortfallPx).toBe(0);
  });

  it('does NOT detect when a shortfall coexists with a real bottom inset (#484)', () => {
    // Defensive: even if a healthy notch window briefly reports a small
    // shortfall during cold-start settling, a non-zero bottom inset means it
    // reached the home indicator → not a letterbox. The bottom inset vetoes the
    // shortfall here (the inverse of the old #479 top-inset requirement).
    const verdict = detectLetterbox(
      base({
        innerHeight: 797,
        visualViewportHeight: 797,
        safeAreaTop: 47,
        safeAreaBottom: 34,
      }),
    );
    expect(verdict.detected).toBe(false);
    expect(verdict.shortfallPx).toBe(47);
  });

  it('does NOT detect in a normal browser tab (not standalone)', () => {
    // Safari chrome (URL bar + tab bar) legitimately eats viewport height.
    const verdict = detectLetterbox(
      base({
        innerHeight: 664,
        visualViewportHeight: 664,
        safeAreaTop: 0,
        safeAreaBottom: 0,
        standalone: false,
      }),
    );
    expect(verdict.detected).toBe(false);
    expect(verdict.shortfallPx).toBe(180);
  });

  it('does NOT detect on home-button devices (20pt status bar stays under threshold)', () => {
    // iPhone SE class: 375×667, no home indicator → safe-area-bottom is 0 even
    // in a healthy layout. The shortfall (20) must stay under the threshold so
    // the zero bottom inset alone never false-positives this device class.
    const verdict = detectLetterbox(
      base({
        innerWidth: 375,
        innerHeight: 647,
        screenWidth: 375,
        screenHeight: 667,
        visualViewportHeight: 647,
        safeAreaTop: 20,
        safeAreaBottom: 0,
      }),
    );
    expect(verdict.detected).toBe(false);
    expect(verdict.shortfallPx).toBe(20);
    expect(verdict.shortfallPx).toBeLessThan(LETTERBOX_MIN_SHORTFALL_PX);
  });

  it('does NOT detect in landscape (iOS screen dims stay portrait-fixed)', () => {
    // Landscape: innerWidth(844) > screenWidth(390) — comparing innerHeight
    // against the portrait screenHeight would produce a bogus shortfall.
    const verdict = detectLetterbox(
      base({
        innerWidth: 844,
        innerHeight: 390,
        visualViewportHeight: 390,
        safeAreaTop: 0,
        safeAreaBottom: 0,
      }),
    );
    expect(verdict.detected).toBe(false);
  });

  it('uses the tallest of innerHeight/visualViewport (keyboard shrink never inflates shortfall)', () => {
    // Soft keyboard open: visualViewport shrinks, layout viewport does not.
    // safeAreaBottom 0 here would otherwise tempt detection — the no-shortfall
    // result keeps it false.
    const keyboard = detectLetterbox(
      base({ innerHeight: 844, visualViewportHeight: 500, safeAreaBottom: 0 }),
    );
    expect(keyboard.detected).toBe(false);
    expect(keyboard.shortfallPx).toBe(0);

    // Inverse lag: innerHeight stale-small while visualViewport already settled.
    const settled = detectLetterbox(
      base({ innerHeight: 700, visualViewportHeight: 844, safeAreaBottom: 0 }),
    );
    expect(settled.detected).toBe(false);
    expect(settled.shortfallPx).toBe(0);
  });

  it('handles a missing visualViewport API (null)', () => {
    // When visualViewport is unavailable, innerHeight alone carries the
    // shortfall. Supply safeAreaBottom 0 so the letterbox signature is complete
    // and detected: true confirms the null path is handled.
    const verdict = detectLetterbox(
      base({
        innerHeight: 797,
        visualViewportHeight: null,
        safeAreaTop: 47,
        safeAreaBottom: 0,
      }),
    );
    expect(verdict.detected).toBe(true);
    expect(verdict.shortfallPx).toBe(47);
  });

  it('the bottom inset gates detection: any non-zero value vetoes it (#484)', () => {
    // The exact inverse of the pre-#484 behaviour. A letterboxed shortfall with
    // even a 1px bottom inset is treated as "reached the home indicator" and is
    // NOT a letterbox — the dead-band signature requires bottom === 0.
    const verdict = detectLetterbox(
      base({ innerHeight: 797, visualViewportHeight: 797, safeAreaBottom: 1 }),
    );
    expect(verdict.detected).toBe(false);
    expect(verdict.shortfallPx).toBe(47);
  });
});
