/**
 * Unit tests for the bridge-stub interceptor (devtools#740, DT-2).
 *
 * Covers: the stub registry's fixture shapes, `wrapSdkWithStub`'s pass-through
 * (disabled) vs intercepted (enabled) behavior, and `isStubBlockingEnabled`'s
 * `globalThis` gate. Runs entirely in jsdom — no CDP/relay/device needed, the
 * same "vitest = mock + prompt mode coverage" spirit as the rest of this repo
 * (CLAUDE.md "jsdom 환경의 제약").
 */

import { afterEach, describe, expect, it } from 'vitest';
import { isStubBlockingEnabled, STUB_REGISTRY, wrapSdkWithStub } from './bridge-stub.js';

describe('wrapSdkWithStub', () => {
  it('returns the SAME object reference (no wrapping) when disabled', () => {
    const sdk = { openPermissionDialog: async () => 'allowed' };
    expect(wrapSdkWithStub(sdk, false)).toBe(sdk);
  });

  it('passes through non-stubbed properties unchanged when enabled', async () => {
    const sdk = { getPlatformOS: () => 'ios', openPermissionDialog: async () => 'denied' as const };
    const wrapped = wrapSdkWithStub(sdk, true);
    expect((wrapped.getPlatformOS as () => string)()).toBe('ios');
  });

  it('intercepts openPermissionDialog and resolves "allowed" from the fixture, not the real impl', async () => {
    const sdk = {
      openPermissionDialog: async () => {
        throw new Error('should never be called when stubbed');
      },
    };
    const wrapped = wrapSdkWithStub(sdk, true);
    const fn = wrapped.openPermissionDialog as (arg: unknown) => Promise<string>;
    await expect(fn({ name: 'camera', access: 'access' })).resolves.toBe('allowed');
  });

  it('intercepts requestPermission and rejects with the NO_PERMISSION native envelope', async () => {
    const sdk = { requestPermission: async () => 'allowed' as const };
    const wrapped = wrapSdkWithStub(sdk, true);
    const fn = wrapped.requestPermission as (arg: unknown) => Promise<string>;
    await expect(fn({ name: 'geolocation', access: 'read' })).rejects.toMatchObject({
      code: 'NO_PERMISSION',
      message: 'No permission',
      __isError: true,
    });
  });

  it('intercepts saveBase64Data and resolves undefined (no share-sheet UI)', async () => {
    const sdk = {
      saveBase64Data: async () => {
        throw new Error('should never be called when stubbed');
      },
    };
    const wrapped = wrapSdkWithStub(sdk, true);
    const fn = wrapped.saveBase64Data as (arg: unknown) => Promise<undefined>;
    await expect(
      fn({ data: 'AAAA', fileName: 'a.png', mimeType: 'image/png' }),
    ).resolves.toBeUndefined();
  });

  it('intercepts showFullScreenAd via the onEvent/onError calling convention (not a Promise)', () => {
    const sdk = {
      showFullScreenAd: () => {
        throw new Error('should never be called when stubbed');
      },
    };
    const wrapped = wrapSdkWithStub(sdk, true);
    const fn = wrapped.showFullScreenAd as (args: {
      onEvent: (e: unknown) => void;
      onError: (e: unknown) => void;
    }) => () => void;

    const events: unknown[] = [];
    const errors: unknown[] = [];
    const cleanup = fn({
      onEvent: (e) => events.push(e),
      onError: (e) => errors.push(e),
    });

    expect(events).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      code: '1006',
      message: '광고가 로드 중이거나 준비되지 않았습니다',
    });
    expect(typeof cleanup).toBe('function');
    expect(() => cleanup()).not.toThrow();
  });

  it('does not intercept an API name absent from STUB_REGISTRY', async () => {
    let called = false;
    const sdk = {
      getClipboardText: async () => {
        called = true;
        return 'real value';
      },
    };
    const wrapped = wrapSdkWithStub(sdk, true);
    const fn = wrapped.getClipboardText as () => Promise<string>;
    await expect(fn()).resolves.toBe('real value');
    expect(called).toBe(true);
  });
});

describe('STUB_REGISTRY', () => {
  it('covers exactly the smallest-viable allowlist from devtools#740', () => {
    expect(Object.keys(STUB_REGISTRY).sort()).toEqual(
      ['openPermissionDialog', 'requestPermission', 'saveBase64Data', 'showFullScreenAd'].sort(),
    );
  });
});

describe('isStubBlockingEnabled', () => {
  afterEach(() => {
    delete (globalThis as { __AIT_STUB_BLOCKING__?: boolean }).__AIT_STUB_BLOCKING__;
  });

  it('is false when the global is absent (default, zero-diff-when-off)', () => {
    expect(isStubBlockingEnabled()).toBe(false);
  });

  it('is false when the global is any non-true value', () => {
    (globalThis as { __AIT_STUB_BLOCKING__?: unknown }).__AIT_STUB_BLOCKING__ = 'yes';
    expect(isStubBlockingEnabled()).toBe(false);
  });

  it('is true only when the global is the boolean true', () => {
    (globalThis as { __AIT_STUB_BLOCKING__?: boolean }).__AIT_STUB_BLOCKING__ = true;
    expect(isStubBlockingEnabled()).toBe(true);
  });
});
