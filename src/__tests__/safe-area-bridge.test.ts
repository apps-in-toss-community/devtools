import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  dispatchHostBackNavigation,
  graniteEvent,
  SafeAreaInsets,
} from '../mock/navigation/index.js';
import {
  applyForwardedSafeAreaInsets,
  installNavigateBackBridge,
  installSafeAreaInsetsBridge,
  isNavigateBackMessage,
  NAVIGATE_BACK_MESSAGE_TYPE,
  parseSafeAreaInsetsMessage,
  SAFE_AREA_INSETS_MESSAGE_TYPE,
} from '../mock/safe-area-bridge.js';
import { aitState } from '../mock/state.js';

// env-2 postMessage bridges (#484 safe-area-insets, #510 navigate-back).
// The launcher posts to the framed dev app; this module is the receive half.
// Tests cover (a) shape/range validation for insets, (b) the apply path firing
// the existing subscribe channel, (c) the message-driven no-op guard that keeps
// the panel preset authoritative in env 1 (desktop, no launcher → no message),
// and (d) navigate-back message validation + history.back() dispatch.

describe('safe-area-bridge', () => {
  beforeEach(() => {
    aitState.reset();
  });

  describe('parseSafeAreaInsetsMessage', () => {
    it('parses a well-formed ait:safe-area-insets envelope', () => {
      const insets = parseSafeAreaInsetsMessage({
        type: SAFE_AREA_INSETS_MESSAGE_TYPE,
        insets: { top: 0, bottom: 34, left: 0, right: 0 },
      });
      expect(insets).toEqual({ top: 0, bottom: 34, left: 0, right: 0 });
    });

    it('rejects a foreign message type (silent ignore)', () => {
      expect(
        parseSafeAreaInsetsMessage({
          type: 'something-else',
          insets: { top: 0, bottom: 34, left: 0, right: 0 },
        }),
      ).toBeNull();
    });

    it('rejects non-object / null payloads', () => {
      expect(parseSafeAreaInsetsMessage(null)).toBeNull();
      expect(parseSafeAreaInsetsMessage(undefined)).toBeNull();
      expect(parseSafeAreaInsetsMessage('ait:safe-area-insets')).toBeNull();
      expect(parseSafeAreaInsetsMessage(42)).toBeNull();
    });

    it('rejects a missing or non-object insets field', () => {
      expect(parseSafeAreaInsetsMessage({ type: SAFE_AREA_INSETS_MESSAGE_TYPE })).toBeNull();
      expect(
        parseSafeAreaInsetsMessage({ type: SAFE_AREA_INSETS_MESSAGE_TYPE, insets: null }),
      ).toBeNull();
    });

    it('rejects a partial insets object (any side missing)', () => {
      expect(
        parseSafeAreaInsetsMessage({
          type: SAFE_AREA_INSETS_MESSAGE_TYPE,
          insets: { top: 0, bottom: 34, left: 0 },
        }),
      ).toBeNull();
    });

    it('rejects non-numeric and non-finite inset values', () => {
      for (const bad of ['10', Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(
          parseSafeAreaInsetsMessage({
            type: SAFE_AREA_INSETS_MESSAGE_TYPE,
            insets: { top: bad, bottom: 34, left: 0, right: 0 },
          }),
        ).toBeNull();
      }
    });

    it('rejects out-of-range values (negative or above the 200px bound)', () => {
      expect(
        parseSafeAreaInsetsMessage({
          type: SAFE_AREA_INSETS_MESSAGE_TYPE,
          insets: { top: -1, bottom: 34, left: 0, right: 0 },
        }),
      ).toBeNull();
      expect(
        parseSafeAreaInsetsMessage({
          type: SAFE_AREA_INSETS_MESSAGE_TYPE,
          insets: { top: 201, bottom: 34, left: 0, right: 0 },
        }),
      ).toBeNull();
    });

    it('accepts the boundary values 0 and 200', () => {
      expect(
        parseSafeAreaInsetsMessage({
          type: SAFE_AREA_INSETS_MESSAGE_TYPE,
          insets: { top: 0, bottom: 200, left: 0, right: 0 },
        }),
      ).toEqual({ top: 0, bottom: 200, left: 0, right: 0 });
    });
  });

  describe('applyForwardedSafeAreaInsets', () => {
    it('overwrites the preset with forwarded real-device insets', () => {
      // Out-of-box preset is top=54 (the synthetic value that double-padded in
      // env 2). The real device reports top=0 — forwarding must win.
      expect(aitState.state.safeAreaInsets.top).toBe(54);
      applyForwardedSafeAreaInsets({ top: 0, bottom: 34, left: 0, right: 0 });
      expect(aitState.state.safeAreaInsets).toEqual({ top: 0, bottom: 34, left: 0, right: 0 });
      expect(SafeAreaInsets.get()).toEqual({ top: 0, bottom: 34, left: 0, right: 0 });
    });

    it('fires the SafeAreaInsets.subscribe channel on change', () => {
      const handler = vi.fn();
      const unsub = SafeAreaInsets.subscribe({ onEvent: handler });

      applyForwardedSafeAreaInsets({ top: 0, bottom: 34, left: 0, right: 0 });
      expect(handler).toHaveBeenCalledWith({ top: 0, bottom: 34, left: 0, right: 0 });
      expect(handler).toHaveBeenCalledTimes(1);

      unsub();
    });

    it('skips the write (no subscribe churn) when nothing changed', () => {
      applyForwardedSafeAreaInsets({ top: 0, bottom: 34, left: 0, right: 0 });
      const handler = vi.fn();
      const unsub = SafeAreaInsets.subscribe({ onEvent: handler });

      // Same values again (a resize storm posting identical insets).
      applyForwardedSafeAreaInsets({ top: 0, bottom: 34, left: 0, right: 0 });
      expect(handler).not.toHaveBeenCalled();

      unsub();
    });
  });

  describe('installSafeAreaInsetsBridge (window message listener)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('applies insets carried by a real window message event', () => {
      installSafeAreaInsetsBridge();
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: SAFE_AREA_INSETS_MESSAGE_TYPE,
            insets: { top: 0, bottom: 34, left: 0, right: 0 },
          },
        }),
      );
      expect(aitState.state.safeAreaInsets).toEqual({ top: 0, bottom: 34, left: 0, right: 0 });
    });

    it('ignores a malformed window message (preset stays authoritative)', () => {
      installSafeAreaInsetsBridge();
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: SAFE_AREA_INSETS_MESSAGE_TYPE, insets: { top: 'oops' } },
        }),
      );
      // env 1 no-op: a stray/garbage postMessage never corrupts the preset.
      expect(aitState.state.safeAreaInsets).toEqual({ top: 54, bottom: 34, left: 0, right: 0 });
    });

    it('is idempotent — repeated install does not add duplicate listeners', () => {
      // First install wins (it may already be installed by an earlier test in
      // this file or by the mock barrel import side effect — either way the flag
      // is now set). Spy AFTER that, then a fresh install must be a guarded
      // no-op so we never double-bind the message listener.
      installSafeAreaInsetsBridge();
      const addSpy = vi.spyOn(window, 'addEventListener');
      installSafeAreaInsetsBridge();
      expect(addSpy).not.toHaveBeenCalledWith('message', expect.anything());
    });
  });
});

// ---------------------------------------------------------------------------
// navigate-back bridge (#510)
// ---------------------------------------------------------------------------

describe('navigate-back bridge (#510)', () => {
  describe('isNavigateBackMessage', () => {
    it('returns true for a well-formed ait:navigate-back message', () => {
      expect(isNavigateBackMessage({ type: NAVIGATE_BACK_MESSAGE_TYPE })).toBe(true);
    });

    it('returns true even when extra (unknown) fields are present — forward compat', () => {
      // Extra fields must be silently ignored; the type field alone gates behaviour.
      expect(isNavigateBackMessage({ type: NAVIGATE_BACK_MESSAGE_TYPE, _extra: 42 })).toBe(true);
    });

    it('returns false for a different message type', () => {
      expect(isNavigateBackMessage({ type: 'ait:safe-area-insets', insets: {} })).toBe(false);
      expect(isNavigateBackMessage({ type: 'something-else' })).toBe(false);
    });

    it('returns false for non-object / null payloads', () => {
      expect(isNavigateBackMessage(null)).toBe(false);
      expect(isNavigateBackMessage(undefined)).toBe(false);
      expect(isNavigateBackMessage('ait:navigate-back')).toBe(false);
      expect(isNavigateBackMessage(42)).toBe(false);
    });

    it('returns false when type field is missing', () => {
      expect(isNavigateBackMessage({})).toBe(false);
      expect(isNavigateBackMessage({ data: NAVIGATE_BACK_MESSAGE_TYPE })).toBe(false);
    });
  });

  describe('installNavigateBackBridge (window message listener)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('backEvent 구독자가 없을 때: history.back() 호출됨', () => {
      const backSpy = vi.spyOn(history, 'back').mockReturnValue(undefined);
      installNavigateBackBridge();
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: NAVIGATE_BACK_MESSAGE_TYPE },
        }),
      );
      expect(backSpy).toHaveBeenCalledTimes(1);
    });

    it('does NOT call history.back() for unrelated message types', () => {
      const backSpy = vi.spyOn(history, 'back').mockReturnValue(undefined);
      installNavigateBackBridge();
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'ait:safe-area-insets', insets: { top: 0, bottom: 34, left: 0, right: 0 } },
        }),
      );
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'random-event' },
        }),
      );
      expect(backSpy).not.toHaveBeenCalled();
    });

    it('does NOT call history.back() for a malformed payload (null, string, missing type)', () => {
      const backSpy = vi.spyOn(history, 'back').mockReturnValue(undefined);
      installNavigateBackBridge();
      for (const bad of [null, 'ait:navigate-back', 42, { data: NAVIGATE_BACK_MESSAGE_TYPE }]) {
        window.dispatchEvent(new MessageEvent('message', { data: bad }));
      }
      expect(backSpy).not.toHaveBeenCalled();
    });

    it('is idempotent — repeated install does not add duplicate listeners', () => {
      installNavigateBackBridge();
      const addSpy = vi.spyOn(window, 'addEventListener');
      installNavigateBackBridge();
      expect(addSpy).not.toHaveBeenCalledWith('message', expect.anything());
    });
  });
});

// ---------------------------------------------------------------------------
// dispatchHostBackNavigation — backEvent 구독자 인지 (#510)
// ---------------------------------------------------------------------------

describe('dispatchHostBackNavigation (backEvent 구독자 인지)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('(a) backEvent 구독 후 navigate-back → onEvent 호출됨 + history.back 미호출', () => {
    const backSpy = vi.spyOn(history, 'back').mockReturnValue(undefined);
    const onEvent = vi.fn();

    const cleanup = graniteEvent.addEventListener('backEvent', { onEvent });

    installNavigateBackBridge();
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: NAVIGATE_BACK_MESSAGE_TYPE } }),
    );

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(backSpy).not.toHaveBeenCalled();

    cleanup();
  });

  it('(b) cleanup 후 같은 메시지 → history.back 호출됨', () => {
    const backSpy = vi.spyOn(history, 'back').mockReturnValue(undefined);
    const onEvent = vi.fn();

    const cleanup = graniteEvent.addEventListener('backEvent', { onEvent });

    // cleanup 전: intercept
    installNavigateBackBridge();
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: NAVIGATE_BACK_MESSAGE_TYPE } }),
    );
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(backSpy).not.toHaveBeenCalled();

    // cleanup 후: fallback to history.back()
    cleanup();
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: NAVIGATE_BACK_MESSAGE_TYPE } }),
    );
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it('(c) cleanup 이중 호출해도 카운터 안 깨짐 — 남은 구독자가 여전히 intercept', () => {
    const backSpy = vi.spyOn(history, 'back').mockReturnValue(undefined);
    const onEventA = vi.fn();
    const onEventB = vi.fn();

    const cleanupA = graniteEvent.addEventListener('backEvent', { onEvent: onEventA });
    const cleanupB = graniteEvent.addEventListener('backEvent', { onEvent: onEventB });

    // A를 두 번 cleanup — 이중 감소 방지로 카운터는 1(B만 남음)
    cleanupA();
    cleanupA(); // 이중 호출

    installNavigateBackBridge();
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: NAVIGATE_BACK_MESSAGE_TYPE } }),
    );

    // B가 남아 있으므로 여전히 intercept
    expect(onEventB).toHaveBeenCalledTimes(1);
    expect(backSpy).not.toHaveBeenCalled();

    cleanupB();

    // B도 정리됐으므로 이제 history.back() fallback
    window.dispatchEvent(
      new MessageEvent('message', { data: { type: NAVIGATE_BACK_MESSAGE_TYPE } }),
    );
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it('dispatchHostBackNavigation — 구독자 없으면 history.back()', () => {
    const backSpy = vi.spyOn(history, 'back').mockReturnValue(undefined);
    dispatchHostBackNavigation();
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it('dispatchHostBackNavigation — 구독자 있으면 __ait:backEvent 발사 + history.back 미호출', () => {
    const backSpy = vi.spyOn(history, 'back').mockReturnValue(undefined);
    const onEvent = vi.fn();
    const cleanup = graniteEvent.addEventListener('backEvent', { onEvent });

    dispatchHostBackNavigation();

    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(backSpy).not.toHaveBeenCalled();

    cleanup();
  });
});
