/**
 * Unit tests for the `sdk-redirect` virtual module composition (devtools#769).
 *
 * `bundle.ts`'s `sdkRedirectPlugin` cannot be exercised end-to-end here:
 * esbuild throws its own "Invariant violation" startup check inside this
 * repo's jsdom vitest environment (`bundleTestFile`'s module doc explains
 * why esbuild is lazy-imported for exactly this reason). Instead this suite
 * covers the two things that actually matter for devtools#769's acceptance
 * criteria without needing esbuild:
 *
 *   1. `buildSdkRedirectModuleContents()` emits the exact composition order
 *      (pacing wraps the raw SDK; the stub wraps the paced result) as a
 *      string-level contract — a regression here would silently invert the
 *      documented composition order (bundle.ts's module doc + method-pace.ts's
 *      `wrapWithMethodPacing` doc).
 *   2. The REAL composed call — `wrapSdkWithStub(wrapWithMethodPacing(sdk,
 *      gapMs), stubEnabled)` — behaves correctly against a fake `__sdk`,
 *      including the exact case #769 exists for: a same-method burst gets
 *      paced, and a stubbed name is answered instantly with no added delay
 *      (verified with vitest fake timers, no esbuild needed since this
 *      composition is plain function calls, not bundled code).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isStubBlockingEnabled, wrapSdkWithStub } from './bridge-stub.js';
import { buildSdkRedirectModuleContents } from './bundle.js';
import { getPaceMethodMs, wrapWithMethodPacing } from './method-pace.js';

describe('buildSdkRedirectModuleContents', () => {
  it('imports both wrapSdkWithStub/isStubBlockingEnabled AND wrapWithMethodPacing/getPaceMethodMs', () => {
    const contents = buildSdkRedirectModuleContents();
    expect(contents).toContain('wrapSdkWithStub');
    expect(contents).toContain('isStubBlockingEnabled');
    expect(contents).toContain('wrapWithMethodPacing');
    expect(contents).toContain('getPaceMethodMs');
  });

  it('composes pacing INSIDE the stub — pacing wraps the raw sdk, the stub wraps the paced result', () => {
    const contents = buildSdkRedirectModuleContents();
    const pacedIdx = contents.indexOf('wrapWithMethodPacing(__rawSdk');
    const stubIdx = contents.indexOf('wrapSdkWithStub(__pacedSdk');
    expect(pacedIdx).toBeGreaterThan(-1);
    expect(stubIdx).toBeGreaterThan(-1);
    // Pacing must be computed BEFORE (textually precede) the stub wrap, and
    // the stub wrap must consume the PACED result, not the raw sdk —
    // asserting both the call order and the exact variable threaded in.
    expect(pacedIdx).toBeLessThan(stubIdx);
  });

  it('exports the final composed proxy as module.exports', () => {
    const contents = buildSdkRedirectModuleContents();
    expect(contents.trim().endsWith('module.exports = __proxy;')).toBe(true);
  });
});

/**
 * The REAL composition `bundle.ts`'s virtual module performs, expressed as a
 * plain function call rather than bundled code — mirrors
 * `buildSdkRedirectModuleContents()`'s three lines exactly:
 *   __pacedSdk = wrapWithMethodPacing(__rawSdk, getPaceMethodMs())
 *   __proxy    = wrapSdkWithStub(__pacedSdk, isStubBlockingEnabled())
 */
function composeSdkRedirect(rawSdk: Record<string, unknown>): Record<string, unknown> {
  const paced = wrapWithMethodPacing(rawSdk, getPaceMethodMs());
  return wrapSdkWithStub(paced, isStubBlockingEnabled());
}

describe('sdk-redirect composition (pacing + bridge-stub, devtools#769)', () => {
  afterEach(() => {
    delete (globalThis as { __AIT_PACE_METHOD_MS__?: unknown }).__AIT_PACE_METHOD_MS__;
    delete (globalThis as { __AIT_STUB_BLOCKING__?: unknown }).__AIT_STUB_BLOCKING__;
    delete (globalThis as { __AIT_METHOD_PACE_STATE__?: unknown }).__AIT_METHOD_PACE_STATE__;
  });

  it('zero behavior change when neither pacing nor stubbing is enabled', async () => {
    const sdk = { getClipboardText: async () => 'value' };
    const composed = composeSdkRedirect(sdk);
    // Both gates off — wrapWithMethodPacing and wrapSdkWithStub both take
    // their identity fast paths, so the SAME sdk function is called directly.
    await expect((composed.getClipboardText as () => Promise<string>)()).resolves.toBe('value');
  });

  describe('with pacing enabled (fake timers)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      (globalThis as { __AIT_PACE_METHOD_MS__?: number }).__AIT_PACE_METHOD_MS__ = 250;
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('paces a same-method burst through the composed proxy', async () => {
      const order: string[] = [];
      const sdk = {
        setClipboardText: async () => {
          order.push('call');
        },
      };
      const composed = composeSdkRedirect(sdk);
      const fn = composed.setClipboardText as () => Promise<void>;

      await fn();
      order.push('first-done');
      const second = fn();
      await vi.advanceTimersByTimeAsync(100);
      expect(order).toEqual(['call', 'first-done']); // still waiting
      await vi.advanceTimersByTimeAsync(150);
      await second;
      expect(order).toEqual(['call', 'first-done', 'call']);
    });

    it('a stubbed name is answered INSTANTLY — no pacing delay reaches it', async () => {
      (globalThis as { __AIT_STUB_BLOCKING__?: boolean }).__AIT_STUB_BLOCKING__ = true;
      const sdk = {
        openPermissionDialog: async () => {
          throw new Error('should never be called — stub must intercept before pacing matters');
        },
      };
      const composed = composeSdkRedirect(sdk);
      const fn = composed.openPermissionDialog as (arg: unknown) => Promise<string>;

      // Two back-to-back calls to a stubbed name must BOTH resolve
      // immediately — the stub's Proxy intercepts the property access before
      // the paced wrapper (built from the raw sdk) is ever reached.
      const first = fn({ name: 'camera' });
      await vi.advanceTimersByTimeAsync(0);
      await expect(first).resolves.toBe('allowed');
      const second = fn({ name: 'camera' });
      await vi.advanceTimersByTimeAsync(0);
      await expect(second).resolves.toBe('allowed');
    });

    it('a non-stubbed call still gets paced even while stubBlocking is enabled for OTHER names', async () => {
      (globalThis as { __AIT_STUB_BLOCKING__?: boolean }).__AIT_STUB_BLOCKING__ = true;
      const order: string[] = [];
      const sdk = {
        setClipboardText: async () => {
          order.push('call');
        },
      };
      const composed = composeSdkRedirect(sdk);
      const fn = composed.setClipboardText as () => Promise<void>;

      await fn();
      order.push('first-done');
      const second = fn();
      await vi.advanceTimersByTimeAsync(100);
      expect(order).toEqual(['call', 'first-done']);
      await vi.advanceTimersByTimeAsync(150);
      await second;
      expect(order).toEqual(['call', 'first-done', 'call']);
    });
  });

  it('gapMs=0 (--pace-method 0 opt-out) is a true no-op — same object identity flows through', () => {
    const sdk = { getClipboardText: async () => 'x' };
    (globalThis as { __AIT_PACE_METHOD_MS__?: number }).__AIT_PACE_METHOD_MS__ = 0;
    // wrapWithMethodPacing returns `sdk` itself when gapMs<=0; wrapSdkWithStub
    // (disabled) also returns its input untouched — the composed result must
    // be the exact same object reference as the original sdk.
    expect(composeSdkRedirect(sdk)).toBe(sdk);
  });
});
