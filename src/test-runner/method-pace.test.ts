/**
 * Unit tests for the per-method pacing wrapper (devtools#769).
 *
 * Runs entirely in jsdom (no CDP/relay/device needed) — the same "vitest =
 * mock + prompt mode coverage" spirit as `bridge-stub.test.ts`. Uses vitest
 * fake timers so per-method gap assertions do not depend on real wall-clock
 * time.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPaceMethodMs, wrapWithMethodPacing } from './method-pace.js';

describe('wrapWithMethodPacing', () => {
  afterEach(() => {
    // The registry is a page global — clear it between tests so pacing state
    // from one test never bleeds into the next.
    delete (globalThis as { __AIT_METHOD_PACE_STATE__?: unknown }).__AIT_METHOD_PACE_STATE__;
  });

  it('returns the SAME object reference (no wrapping) when gapMs is 0', () => {
    const sdk = { getClipboardText: async () => 'x' };
    expect(wrapWithMethodPacing(sdk, 0)).toBe(sdk);
  });

  it('returns the SAME object reference (no wrapping) when gapMs is negative', () => {
    const sdk = { getClipboardText: async () => 'x' };
    expect(wrapWithMethodPacing(sdk, -5)).toBe(sdk);
  });

  it('passes through non-function exports unchanged when enabled', () => {
    const sdk = { SOME_CONSTANT: 42, PermissionError: class PermissionError extends Error {} };
    const wrapped = wrapWithMethodPacing(sdk, 250);
    expect(wrapped.SOME_CONSTANT).toBe(42);
    expect(wrapped.PermissionError).toBe(sdk.PermissionError);
  });

  it('passes results/rejections through unchanged', async () => {
    const sdk = {
      ok: async () => 'value',
      bad: async () => {
        throw new Error('boom');
      },
    };
    const wrapped = wrapWithMethodPacing(sdk, 0 + 1); // gapMs=1, negligible wait
    await expect((wrapped.ok as () => Promise<string>)()).resolves.toBe('value');
    await expect((wrapped.bad as () => Promise<string>)()).rejects.toThrow('boom');
  });

  it('memoizes the wrapper per name — repeated access returns the SAME function reference', () => {
    const sdk = { getClipboardText: async () => 'x' };
    const wrapped = wrapWithMethodPacing(sdk, 250);
    const first = wrapped.getClipboardText;
    const second = wrapped.getClipboardText;
    expect(first).toBe(second);
  });

  describe('timing (fake timers)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('does not delay the FIRST call to a method', async () => {
      const calls: number[] = [];
      const sdk = {
        setClipboardText: async () => {
          calls.push(1);
          return undefined;
        },
      };
      const wrapped = wrapWithMethodPacing(sdk, 250);
      const p = (wrapped.setClipboardText as () => Promise<void>)();
      // No fake-timer advance needed — the first call must resolve without
      // waiting on any sleep.
      await vi.advanceTimersByTimeAsync(0);
      await p;
      expect(calls).toEqual([1]);
    });

    it('delays a SECOND call to the SAME method until the gap has elapsed', async () => {
      const order: string[] = [];
      const sdk = {
        setClipboardText: async () => {
          order.push('call');
        },
      };
      const wrapped = wrapWithMethodPacing(sdk, 250);
      const fn = wrapped.setClipboardText as () => Promise<void>;

      await fn(); // first call — immediate
      order.push('first-done');

      const secondPromise = fn();
      // Immediately after invoking, the real call must NOT have run yet.
      await vi.advanceTimersByTimeAsync(100);
      expect(order).toEqual(['call', 'first-done']);

      // After the full gap elapses, the second call proceeds.
      await vi.advanceTimersByTimeAsync(150);
      await secondPromise;
      expect(order).toEqual(['call', 'first-done', 'call']);
    });

    it('does NOT delay calls to a DIFFERENT method name', async () => {
      const order: string[] = [];
      const sdk = {
        setClipboardText: async () => {
          order.push('set');
        },
        getClipboardText: async () => {
          order.push('get');
          return 'x';
        },
      };
      const wrapped = wrapWithMethodPacing(sdk, 250);
      await (wrapped.setClipboardText as () => Promise<void>)();
      // A different method name is unaffected by setClipboardText's
      // just-recorded invocation timestamp.
      const getPromise = (wrapped.getClipboardText as () => Promise<string>)();
      await vi.advanceTimersByTimeAsync(0);
      await getPromise;
      expect(order).toEqual(['set', 'get']);
    });

    it('does not re-delay once the gap has already naturally elapsed', async () => {
      const order: string[] = [];
      const sdk = {
        setClipboardText: async () => {
          order.push('call');
        },
      };
      const wrapped = wrapWithMethodPacing(sdk, 250);
      const fn = wrapped.setClipboardText as () => Promise<void>;

      await fn();
      // Advance real (fake) time past the gap BEFORE the second call.
      await vi.advanceTimersByTimeAsync(300);
      const before = order.length;
      await fn();
      expect(order.length).toBe(before + 1);
    });
  });
});

describe('getPaceMethodMs', () => {
  afterEach(() => {
    delete (globalThis as { __AIT_PACE_METHOD_MS__?: unknown }).__AIT_PACE_METHOD_MS__;
  });

  it('is 0 when the global is absent (default, zero-diff-when-off)', () => {
    expect(getPaceMethodMs()).toBe(0);
  });

  it('is 0 when the global is 0', () => {
    (globalThis as { __AIT_PACE_METHOD_MS__?: number }).__AIT_PACE_METHOD_MS__ = 0;
    expect(getPaceMethodMs()).toBe(0);
  });

  it('is 0 when the global is a non-number', () => {
    (globalThis as { __AIT_PACE_METHOD_MS__?: unknown }).__AIT_PACE_METHOD_MS__ = '250';
    expect(getPaceMethodMs()).toBe(0);
  });

  it('returns the positive numeric value when set', () => {
    (globalThis as { __AIT_PACE_METHOD_MS__?: number }).__AIT_PACE_METHOD_MS__ = 250;
    expect(getPaceMethodMs()).toBe(250);
  });
});
