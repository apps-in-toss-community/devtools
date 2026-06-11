/**
 * Unit tests for the `@ait-co/devtools/in-app/auto` self-gating side-effect
 * entry (`src/in-app/auto.ts`).
 *
 * Covers:
 * - shouldActivate(): gate logic for DEV / ?debug=1 / ?relay= / neither
 * - SDK bridge installed (window.__sdk / window.__sdkCall) when gate activates
 * - window.__sdkCall returns { ok, value } on success
 * - window.__sdkCall returns { ok, error } when function is missing
 * - window.__sdkCall returns { ok, error } when function throws
 * - web-framework absent (optional peer) → fail-silent, no throw
 *
 * Note on the side-effect module: `auto.ts` runs at module evaluation time.
 * In vitest (Vite-based), `import.meta.env.DEV` is `true`, so the self-gate
 * always activates when auto.ts is imported. We test the gate logic via the
 * exported `shouldActivate()` pure function directly (passing explicit
 * `isDev`/`searchStr` args) and test the side effects (bridge install) by
 * importing auto.ts in a controlled setup.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shouldActivate } from '../in-app/auto.js';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------
vi.mock('@apps-in-toss/web-framework', () => ({
  exampleApi: vi.fn(() => Promise.resolve('sdk-result')),
  anotherApi: vi.fn(() => Promise.reject(new Error('sdk-error'))),
}));

vi.mock('../in-app/attach.js', () => ({
  maybeAttach: vi.fn(),
  deriveTargetScriptUrl: vi.fn((url: string) => url),
  installRelayWsObserver: vi.fn(),
}));

// ---------------------------------------------------------------------------
// shouldActivate() — pure gate logic
// ---------------------------------------------------------------------------

describe('shouldActivate() — self-gate logic', () => {
  it('returns false when isDev=false and no debug params', () => {
    expect(shouldActivate(false, '')).toBe(false);
  });

  it('returns true when isDev=true regardless of search params', () => {
    expect(shouldActivate(true, '')).toBe(true);
  });

  it('returns true when ?debug=1 is present (isDev=false)', () => {
    expect(shouldActivate(false, '?debug=1')).toBe(true);
  });

  it('returns true when ?relay= is present (isDev=false)', () => {
    expect(shouldActivate(false, '?relay=wss%3A%2F%2Fexample.com%2F')).toBe(true);
  });

  it('returns true when both ?debug=1 and ?relay= are present', () => {
    expect(shouldActivate(false, '?debug=1&relay=wss%3A%2F%2Fexample.com%2F')).toBe(true);
  });

  it('returns false when debug=0 (not "1")', () => {
    expect(shouldActivate(false, '?debug=0')).toBe(false);
  });

  it('returns false when debug param absent and relay absent', () => {
    expect(shouldActivate(false, '?foo=bar')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SDK bridge installation (when auto.ts is imported in active state)
//
// vitest has import.meta.env.DEV=true, so importing auto.ts always activates
// the gate. We use this to test the bridge install path.
// ---------------------------------------------------------------------------

describe('SDK bridge — installed when gate activates', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    delete window.__sdk;
    delete window.__sdkCall;
    // Import auto.ts — DEV=true in vitest → gate activates.
    await import('../in-app/auto.js');
    // Allow the dynamic import promise (bridge install) to settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  afterEach(() => {
    delete window.__sdk;
    delete window.__sdkCall;
  });

  it('installs window.__sdk as a plain object', () => {
    expect(window.__sdk).toBeDefined();
    expect(typeof window.__sdk).toBe('object');
  });

  it('installs window.__sdkCall as a function', () => {
    expect(window.__sdkCall).toBeDefined();
    expect(typeof window.__sdkCall).toBe('function');
  });

  it('exposes SDK exports on window.__sdk', () => {
    expect(window.__sdk).toHaveProperty('exampleApi');
    expect(window.__sdk).toHaveProperty('anotherApi');
  });

  it('window.__sdkCall returns { ok: true, value } for a resolving SDK function', async () => {
    const result = await window.__sdkCall?.('exampleApi');
    expect(result).toEqual({ ok: true, value: 'sdk-result' });
  });

  it('window.__sdkCall returns { ok: false, error } for a missing function', async () => {
    const result = await window.__sdkCall?.('nonExistentApi');
    expect(result?.ok).toBe(false);
    expect(result?.error).toContain('nonExistentApi');
  });

  it('window.__sdkCall returns { ok: false, error } when the SDK function throws', async () => {
    const result = await window.__sdkCall?.('anotherApi');
    expect(result?.ok).toBe(false);
    expect(result?.error).toBe('sdk-error');
  });
});

// ---------------------------------------------------------------------------
// maybeAttach() call verification
// ---------------------------------------------------------------------------

describe('maybeAttach() — called when gate activates', () => {
  afterEach(() => {
    delete window.__sdk;
    delete window.__sdkCall;
  });

  it('calls maybeAttach() on import (DEV=true in vitest)', async () => {
    vi.resetModules();
    vi.clearAllMocks();
    await import('../in-app/auto.js');
    const attachMod = (await import('../in-app/attach.js')) as unknown as {
      maybeAttach: ReturnType<typeof vi.fn>;
    };
    expect(attachMod.maybeAttach).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Optional peer — fail-silent when @apps-in-toss/web-framework is absent
// ---------------------------------------------------------------------------

describe('optional peer — fail-silent when SDK is absent', () => {
  afterEach(() => {
    delete window.__sdk;
    delete window.__sdkCall;
  });

  it('does not throw when the SDK peer is absent', async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doMock('@apps-in-toss/web-framework', () => {
      throw new Error('Cannot find module: @apps-in-toss/web-framework');
    });

    await expect(import('../in-app/auto.js')).resolves.toBeDefined();
    await new Promise((resolve) => setTimeout(resolve, 0));

    vi.doUnmock('@apps-in-toss/web-framework');
  });
});
