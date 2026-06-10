// Unit tests for the pure letterbox-detection logic (#469). The `.vitest.ts`
// extension keeps Playwright (testMatch '**/*.test.ts') from collecting this
// file — see vitest.config.ts `include`.

import { describe, expect, it } from 'vitest';
import { detectLetterbox, LETTERBOX_MIN_SHORTFALL_PX, type ViewportMetrics } from './letterbox.js';

// iPhone 16e-class geometry (390×844 logical, 47pt status bar, 34pt home
// indicator) — the device class of the #469 forensics.
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
  it('detects the iOS 26 standalone letterbox signature (#469 Simulator values)', () => {
    // Observed: web view mis-sized to screen − statusBar(47), top-anchored;
    // the Simulator reports safe-area-bottom 0 in this state.
    const verdict = detectLetterbox(
      base({
        innerHeight: 797,
        visualViewportHeight: 797,
        safeAreaTop: 0,
        safeAreaBottom: 0,
      }),
    );
    expect(verdict.detected).toBe(true);
    expect(verdict.shortfallPx).toBe(47);
  });

  it('detects despite the iOS 26 real-device phantom bottom inset (#475 observed values)', () => {
    // Real-device CDP measurement: same letterboxed geometry as above
    // (innerHeight 797 vs screen 844 — window never reaches the screen
    // bottom), yet env(safe-area-inset-bottom) reports 34. The inset must not
    // veto detection.
    const verdict = detectLetterbox(
      base({
        innerHeight: 797,
        visualViewportHeight: 797,
        safeAreaTop: 0,
        safeAreaBottom: 34,
      }),
    );
    expect(verdict.detected).toBe(true);
    expect(verdict.shortfallPx).toBe(47);
  });

  it('does NOT detect in a normal browser tab (not standalone)', () => {
    // Safari chrome (URL bar + tab bar) legitimately eats viewport height.
    const verdict = detectLetterbox(
      base({
        innerHeight: 664,
        visualViewportHeight: 664,
        safeAreaBottom: 0,
        standalone: false,
      }),
    );
    expect(verdict.detected).toBe(false);
    expect(verdict.shortfallPx).toBe(180);
  });

  it('does NOT detect in healthy standalone, edge-to-edge layout (no shortfall)', () => {
    // innerHeight === screen.height, full safe-area insets reported.
    const verdict = detectLetterbox(base());
    expect(verdict.detected).toBe(false);
    expect(verdict.shortfallPx).toBe(0);
  });

  it('flags the healthy below-status-bar standalone layout too (accepted trade-off, #475)', () => {
    // Manifest-standalone without black-translucent: the web view starts below
    // the status bar (shortfall ≈ 59) but still reaches the screen bottom.
    // Pre-#475 the reported bottom inset (34) distinguished this layout from a
    // letterbox; the real-device phantom inset removed that signal, so from
    // inside the page the two are indistinguishable and this healthy layout is
    // now flagged. Accepted: the label is diagnostic-only.
    const verdict = detectLetterbox(
      base({
        innerHeight: 785,
        visualViewportHeight: 785,
        safeAreaTop: 0,
        safeAreaBottom: 34,
      }),
    );
    expect(verdict.detected).toBe(true);
    expect(verdict.shortfallPx).toBe(59);
  });

  it('does NOT detect on home-button devices (20pt status bar stays under threshold)', () => {
    // iPhone SE class: 375×667, no home indicator → safe-area-bottom is 0 even
    // in a healthy layout. The 20pt shortfall must stay under the threshold.
    const verdict = detectLetterbox(
      base({
        innerWidth: 375,
        innerHeight: 647,
        screenWidth: 375,
        screenHeight: 667,
        visualViewportHeight: 647,
        safeAreaTop: 0,
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
        safeAreaBottom: 21,
      }),
    );
    expect(verdict.detected).toBe(false);
  });

  it('uses the tallest of innerHeight/visualViewport (keyboard shrink never inflates shortfall)', () => {
    // Soft keyboard open: visualViewport shrinks, layout viewport does not.
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
    const verdict = detectLetterbox(
      base({
        innerHeight: 797,
        visualViewportHeight: null,
        safeAreaTop: 0,
        safeAreaBottom: 0,
      }),
    );
    expect(verdict.detected).toBe(true);
    expect(verdict.shortfallPx).toBe(47);
  });

  it('ignores the reported bottom inset entirely (#475 phantom inset)', () => {
    // Pre-#475 any non-zero safe-area-bottom vetoed detection. Real iOS 26
    // devices report a phantom inset in the letterboxed state, so the inset
    // value no longer participates in the verdict at all.
    const verdict = detectLetterbox(
      base({ innerHeight: 797, visualViewportHeight: 797, safeAreaBottom: 1 }),
    );
    expect(verdict.detected).toBe(true);
    expect(verdict.shortfallPx).toBe(47);
  });
});
