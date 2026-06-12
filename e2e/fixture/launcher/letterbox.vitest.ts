// Unit tests for the pure letterbox-detection logic (#469, discriminator
// restored to #479 rule in #491). The `.vitest.ts` extension keeps Playwright
// (testMatch '**/*.test.ts') from collecting this file — see vitest.config.ts
// `include`.
//
// #491 re-grounds the fixtures on real-device measurement (iPhone, iOS 18.7,
// 2026-06-11): the letterboxed window reported safeAreaBottom 34 (phantom),
// not 0 as #487 assumed. Bottom carries no signal; top > 0 is reinstated.

import { describe, expect, it, vi } from 'vitest';
import {
  computeBridgeInsets,
  detectLetterbox,
  LETTERBOX_MIN_SHORTFALL_PX,
  type LetterboxVerification,
  type SentinelObserver,
  type VerificationTimers,
  type ViewportMetrics,
  verifyLetterboxCorrection,
} from './letterbox.js';

// iPhone 16e-class geometry (390×844 logical, 47pt status bar, 34pt home
// indicator). Under black-translucent the HEALTHY edge-to-edge window fills
// screen.height with no shortfall — safeAreaTop 47, safeAreaBottom 34.
function base(overrides: Partial<ViewportMetrics> = {}): ViewportMetrics {
  return {
    innerWidth: 390,
    innerHeight: 844,
    screenWidth: 390,
    screenHeight: 844,
    visualViewportHeight: 844,
    safeAreaTop: 47,
    safeAreaBottom: 34,
    standalone: true,
    ...overrides,
  };
}

describe('detectLetterbox', () => {
  // -------------------------------------------------------------------------
  // Core real-device case (#491 AC)
  // -------------------------------------------------------------------------

  it('오늘 실측 letterbox(797/844, top 47, bottom 34) → detected=true', () => {
    // Real-device CDP measurement: iPhone iOS 18.7, 2026-06-11, launcher
    // cold start. The OS mis-sizes the window (797 vs 844), safeAreaTop 47
    // (black-translucent active), safeAreaBottom 34 (phantom — window does
    // NOT reach the home indicator, yet the OS still reports 34).
    // The #487 discriminator (bottom===0) produced false-negative here.
    // The restored #479 rule (top>0 + shortfall) correctly detects it.
    const verdict = detectLetterbox(
      base({
        innerHeight: 797,
        visualViewportHeight: 797,
        safeAreaTop: 47,
        safeAreaBottom: 34,
      }),
    );
    expect(verdict.detected).toBe(true);
    expect(verdict.shortfallPx).toBe(47);
  });

  it('신메타(black-translucent) healthy: shortfall 0, top 47, bottom 34 → detected=false', () => {
    // Healthy edge-to-edge window: shortfall 0 — the top>0 guard never fires.
    const verdict = detectLetterbox(base());
    expect(verdict.detected).toBe(false);
    expect(verdict.shortfallPx).toBe(0);
  });

  it('구메타(stale web clip) healthy below-status-bar: shortfall 59, top 0 → detected=false', () => {
    // Legacy web clip without black-translucent meta: window starts below the
    // status bar (safeAreaTop 0), so even with a height shortfall the top
    // guard correctly gates it out — safeAreaTop===0 means no status bar
    // underlay, not a black-translucent letterbox.
    const verdict = detectLetterbox(
      base({
        innerHeight: 785,
        visualViewportHeight: 785,
        screenHeight: 844,
        safeAreaTop: 0,
        safeAreaBottom: 34,
      }),
    );
    expect(verdict.detected).toBe(false);
    expect(verdict.shortfallPx).toBe(59);
  });

  it('SE-class healthy (shortfall 20 < threshold 24) → detected=false', () => {
    // iPhone SE: 375×667, 20pt status bar, no home indicator.
    // Shortfall stays under the threshold — safe-area-bottom is 0 here too,
    // but the threshold guard resolves it before the top check.
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

  // -------------------------------------------------------------------------
  // bottom inset has NO effect on detection (#491 key invariant)
  // -------------------------------------------------------------------------

  it('bottom 0 + shortfall 47 + top 47 → detected=true (bottom=0 does not block)', () => {
    // Even if the OS were to report bottom 0 in the letterbox state, the
    // detection must still fire — the rule is top>0, not bottom===0.
    const verdict = detectLetterbox(
      base({
        innerHeight: 797,
        visualViewportHeight: 797,
        safeAreaTop: 47,
        safeAreaBottom: 0,
      }),
    );
    expect(verdict.detected).toBe(true);
  });

  it('bottom 1 + shortfall 47 + top 47 → detected=true (bottom=1 does not block)', () => {
    // Any non-zero bottom value must not veto detection under #491 rule.
    const verdict = detectLetterbox(
      base({
        innerHeight: 797,
        visualViewportHeight: 797,
        safeAreaTop: 47,
        safeAreaBottom: 1,
      }),
    );
    expect(verdict.detected).toBe(true);
  });

  it('bottom 99 + shortfall 47 + top 47 → detected=true (arbitrary bottom does not veto)', () => {
    const verdict = detectLetterbox(
      base({
        innerHeight: 797,
        visualViewportHeight: 797,
        safeAreaTop: 47,
        safeAreaBottom: 99,
      }),
    );
    expect(verdict.detected).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Other guards
  // -------------------------------------------------------------------------

  it('not standalone → detected=false', () => {
    const verdict = detectLetterbox(
      base({
        innerHeight: 797,
        visualViewportHeight: 797,
        safeAreaTop: 47,
        safeAreaBottom: 34,
        standalone: false,
      }),
    );
    expect(verdict.detected).toBe(false);
  });

  it('landscape (innerWidth > screenWidth) → detected=false', () => {
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

  it('keyboard shrink: tallest of innerHeight/visualViewport used — no spurious shortfall', () => {
    // Soft keyboard: visualViewport shrinks, innerHeight stays at 844.
    const keyboard = detectLetterbox(
      base({ innerHeight: 844, visualViewportHeight: 500, safeAreaTop: 47, safeAreaBottom: 34 }),
    );
    expect(keyboard.detected).toBe(false);
    expect(keyboard.shortfallPx).toBe(0);

    // Inverse lag: innerHeight stale-small while visualViewport already settled.
    const settled = detectLetterbox(
      base({ innerHeight: 700, visualViewportHeight: 844, safeAreaTop: 47, safeAreaBottom: 34 }),
    );
    expect(settled.detected).toBe(false);
    expect(settled.shortfallPx).toBe(0);
  });

  it('visualViewport null: innerHeight alone carries shortfall', () => {
    const verdict = detectLetterbox(
      base({
        innerHeight: 797,
        visualViewportHeight: null,
        safeAreaTop: 47,
        safeAreaBottom: 34,
      }),
    );
    expect(verdict.detected).toBe(true);
    expect(verdict.shortfallPx).toBe(47);
  });

  it('safeAreaTop 0 with large shortfall → detected=false (top guard)', () => {
    // safeAreaTop 0 means the window does not extend under the status bar —
    // regardless of shortfall this is not a black-translucent letterbox.
    const verdict = detectLetterbox(
      base({
        innerHeight: 785,
        visualViewportHeight: 785,
        safeAreaTop: 0,
        safeAreaBottom: 34,
      }),
    );
    expect(verdict.detected).toBe(false);
    expect(verdict.shortfallPx).toBe(59);
  });
});

// ---------------------------------------------------------------------------
// computeBridgeInsets — bridge bottom correction (#491, updated #527, #561)
// ---------------------------------------------------------------------------
//
// #561 note: the pure function's contract is unchanged — letterboxCorrected=true
// still means "the px correction reaches the home-indicator band → restore the
// real bottom inset". What changed is WHEN the React layer passes true: only
// after the bottom-sentinel verification confirms the band actually paints
// (letterboxVerified==='visible'). While pending or clipped the caller now
// passes false, so these corrected=true cases are the "verification passed"
// branch and the corrected=false cases are the pending/clipped branch.

describe('computeBridgeInsets', () => {
  const raw = { top: 47, bottom: 34, left: 0, right: 0 };

  // -------------------------------------------------------------------------
  // Verification-passed path (letterboxCorrected=true → #527 bottom restored)
  // -------------------------------------------------------------------------

  it('letterbox detected + corrected/verified-visible (default) → bottom RESTORED, top/left/right unchanged (#527)', () => {
    // px correction verified visible: the frame genuinely reaches the
    // home-indicator area, so the real bottom inset (34) must be forwarded.
    const result = computeBridgeInsets(raw, true);
    expect(result.bottom).toBe(34);
    expect(result.top).toBe(47);
    expect(result.left).toBe(0);
    expect(result.right).toBe(0);
  });

  it('letterbox detected + corrected explicit → bottom RESTORED (#527)', () => {
    const result = computeBridgeInsets(raw, true, true);
    expect(result.bottom).toBe(34);
    expect(result.top).toBe(47);
  });

  it('실측 오늘 letterbox(top 47 / phantom bottom 34) + corrected → bridge bottom 34 복원 (#527)', () => {
    // iPhone iOS 18.7, 2026-06-12: with screen.height px correction the frame
    // reaches the real screen bottom — restore the real bottom inset (34).
    const result = computeBridgeInsets({ top: 47, bottom: 34, left: 0, right: 0 }, true);
    expect(result.bottom).toBe(34);
    expect(result.top).toBe(47);
  });

  it('letterbox detected + corrected + raw bottom 0 (SE-class, no home indicator) → 0', () => {
    // SE-class device: no home indicator → bottom 0, correction does not change that.
    const result = computeBridgeInsets({ ...raw, bottom: 0 }, true, true);
    expect(result.bottom).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Legacy uncorrected path (letterboxCorrected=false, #491 original behaviour)
  // -------------------------------------------------------------------------

  it('letterbox detected + NOT corrected (legacy) → bottom zeroed (#491)', () => {
    // When correction is unavailable the frame still stops above the home
    // indicator — keep the #491 zeroing to avoid dead-band padding.
    const result = computeBridgeInsets(raw, true, false);
    expect(result.bottom).toBe(0);
    expect(result.top).toBe(47);
    expect(result.left).toBe(0);
    expect(result.right).toBe(0);
  });

  it('legacy: letterbox with raw bottom 0 → still 0 (idempotent)', () => {
    const result = computeBridgeInsets({ ...raw, bottom: 0 }, true, false);
    expect(result.bottom).toBe(0);
  });

  it('legacy: 실측 오늘 letterbox(top 47 / phantom bottom 34) + uncorrected → bridge bottom 0 (#491)', () => {
    // Without correction the app must not add 34px padding for an area it cannot
    // reach. This is the original #491 behaviour, now gated on letterboxCorrected=false.
    const result = computeBridgeInsets({ top: 47, bottom: 34, left: 0, right: 0 }, true, false);
    expect(result.bottom).toBe(0);
    expect(result.top).toBe(47);
  });

  // -------------------------------------------------------------------------
  // Healthy path (not letterbox) — unchanged regardless of corrected flag
  // -------------------------------------------------------------------------

  it('healthy (not letterbox) → bottom passed through unchanged', () => {
    const result = computeBridgeInsets(raw, false);
    expect(result.bottom).toBe(34);
    expect(result.top).toBe(47);
  });

  it('healthy with raw bottom 0 (SE-class) → 0 passed through', () => {
    const result = computeBridgeInsets({ ...raw, bottom: 0 }, false);
    expect(result.bottom).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// verifyLetterboxCorrection — runtime self-verification of the #527 px
// correction (#561). On real hardware the WebKit top-level viewport clips the
// bottom band, so the sentinel reports `clipped` and the layout must fall back.
// jsdom has no IntersectionObserver, so the observer + timers are injected.
// ---------------------------------------------------------------------------

describe('verifyLetterboxCorrection', () => {
  // A controllable IntersectionObserver stand-in: captures the result callback
  // so the test can fire it on demand, and records disconnect/cleanup calls.
  function makeObserver(): {
    observe: SentinelObserver;
    fire: (isIntersecting: boolean) => void;
    disconnected: () => number;
    fired: () => boolean;
  } {
    let cb: ((isIntersecting: boolean) => void) | null = null;
    let disconnects = 0;
    return {
      observe: (onResult) => {
        cb = onResult;
        return () => {
          disconnects += 1;
        };
      },
      fire: (isIntersecting) => cb?.(isIntersecting),
      disconnected: () => disconnects,
      fired: () => cb !== null,
    };
  }

  // A manual timer stand-in: stores the timeout callback so the test can trip
  // it explicitly, and records clearTimeout so cancellation is observable.
  function makeTimers(): {
    timers: VerificationTimers<number>;
    trip: () => void;
    cleared: () => boolean;
  } {
    let pending: (() => void) | null = null;
    let cleared = false;
    return {
      timers: {
        setTimeout: (fn) => {
          pending = fn;
          return 1;
        },
        clearTimeout: () => {
          cleared = true;
        },
      },
      trip: () => pending?.(),
      cleared: () => cleared,
    };
  }

  it('(a) sentinel intersects → visible, correction kept, observer + timer torn down', () => {
    const obs = makeObserver();
    const { timers, trip, cleared } = makeTimers();
    const onVerified = vi.fn<(r: LetterboxVerification) => void>();

    verifyLetterboxCorrection(obs.observe, onVerified, timers);
    obs.fire(true);

    expect(onVerified).toHaveBeenCalledTimes(1);
    expect(onVerified).toHaveBeenCalledWith('visible');
    expect(obs.disconnected()).toBe(1); // sentinel/observer torn down
    expect(cleared()).toBe(true); // timeout cancelled

    // A late timeout firing after a result is a no-op (no second verdict).
    trip();
    expect(onVerified).toHaveBeenCalledTimes(1);
  });

  it('(b) sentinel clipped → clipped, fallback verdict, torn down', () => {
    const obs = makeObserver();
    const { timers, cleared } = makeTimers();
    const onVerified = vi.fn<(r: LetterboxVerification) => void>();

    verifyLetterboxCorrection(obs.observe, onVerified, timers);
    obs.fire(false);

    expect(onVerified).toHaveBeenCalledTimes(1);
    expect(onVerified).toHaveBeenCalledWith('clipped');
    expect(obs.disconnected()).toBe(1);
    expect(cleared()).toBe(true);
  });

  it('(c) observer silent past timeout → clipped (fail safe — never keep #527)', () => {
    const obs = makeObserver();
    const { timers, trip } = makeTimers();
    const onVerified = vi.fn<(r: LetterboxVerification) => void>();

    verifyLetterboxCorrection(obs.observe, onVerified, timers);
    // No obs.fire() — simulate the IO never reporting. Trip the timeout.
    trip();

    expect(onVerified).toHaveBeenCalledTimes(1);
    expect(onVerified).toHaveBeenCalledWith('clipped');
    expect(obs.disconnected()).toBe(1); // sentinel/observer cleaned up on timeout

    // A late IO callback arriving after the timeout is ignored.
    obs.fire(true);
    expect(onVerified).toHaveBeenCalledTimes(1);
    expect(onVerified).not.toHaveBeenCalledWith('visible');
  });

  it('cancel (React cleanup) before any result → no verdict, observer + timer torn down', () => {
    const obs = makeObserver();
    const { timers, trip, cleared } = makeTimers();
    const onVerified = vi.fn<(r: LetterboxVerification) => void>();

    const cancel = verifyLetterboxCorrection(obs.observe, onVerified, timers);
    cancel();

    expect(onVerified).not.toHaveBeenCalled();
    expect(obs.disconnected()).toBe(1);
    expect(cleared()).toBe(true);

    // Both a late timeout and a late IO callback are no-ops after cancel.
    trip();
    obs.fire(true);
    expect(onVerified).not.toHaveBeenCalled();
  });

  it('uses the injected timeout value', () => {
    const obs = makeObserver();
    let observedMs = -1;
    const timers: VerificationTimers<number> = {
      setTimeout: (_fn, ms) => {
        observedMs = ms;
        return 1;
      },
      clearTimeout: () => {},
    };
    verifyLetterboxCorrection(obs.observe, vi.fn(), timers, 250);
    expect(observedMs).toBe(250);
  });

  it('a synchronously-firing observer still tears down (defensive)', () => {
    // Real IntersectionObserver never reports synchronously, but a stub that
    // does must not leak: the observer is disconnected even though the result
    // arrived before `disconnect` was assigned.
    let disconnects = 0;
    const syncObserve: SentinelObserver = (onResult) => {
      onResult(false); // fire during observe()
      return () => {
        disconnects += 1;
      };
    };
    const { timers } = makeTimers();
    const onVerified = vi.fn<(r: LetterboxVerification) => void>();

    verifyLetterboxCorrection(syncObserve, onVerified, timers);

    expect(onVerified).toHaveBeenCalledWith('clipped');
    expect(disconnects).toBe(1);
  });
});
