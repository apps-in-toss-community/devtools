import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SafeAreaInsets } from '../mock/navigation/index.js';
import {
  applyForwardedSafeAreaInsets,
  installSafeAreaInsetsBridge,
  parseSafeAreaInsetsMessage,
  SAFE_AREA_INSETS_MESSAGE_TYPE,
} from '../mock/safe-area-bridge.js';
import { aitState } from '../mock/state.js';

// env-2 safe-area inset bridge (#484, slice 2). The launcher forwards its real
// env() insets to the framed dev app via postMessage; this module is the receive
// half. Tests cover (a) shape/range validation, (b) the apply path firing the
// existing subscribe channel, and (c) the message-driven no-op guard that keeps
// the panel preset authoritative in env 1 (desktop, no launcher → no message).

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
