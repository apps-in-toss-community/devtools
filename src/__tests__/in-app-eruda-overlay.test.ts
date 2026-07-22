/**
 * Unit tests for the in-app eruda console overlay (eruda-overlay.ts).
 *
 * Covers the control flow only — NOT eruda's actual rendering, which assumes
 * real-browser layout/measurement APIs that jsdom lacks (see CLAUDE.md "jsdom
 * 제약"). The real overlay is exercised manually / on-device.
 *
 * - mountEruda: calls eruda.init() once on success
 * - idempotency: a second call after a successful mount does NOT re-init
 * - fail-silent: an init() throw is swallowed (does not reject) and the guard
 *   resets so a later call can retry
 *
 * The module-level `erudaMounted` flag is reset between tests via
 * vi.resetModules() + a fresh dynamic import, mirroring in-app-attach.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// eruda is dynamic-imported by the module under test. vi.mock is hoisted; the
// factory is re-evaluated after each resetModules() so the spy is fresh.
const initSpy = vi.fn();
const destroySpy = vi.fn();
vi.mock('eruda', () => ({
  default: {
    init: initSpy,
    destroy: destroySpy,
  },
}));

beforeEach(() => {
  vi.resetModules();
  initSpy.mockReset();
  destroySpy.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('mountEruda', () => {
  it('calls eruda.init() once on success', async () => {
    const { mountEruda } = await import('../in-app/eruda-overlay.js');
    await mountEruda();
    expect(initSpy).toHaveBeenCalledTimes(1);
  });

  it('is idempotent — a second call does not re-init', async () => {
    const { mountEruda } = await import('../in-app/eruda-overlay.js');
    await mountEruda();
    await mountEruda();
    expect(initSpy).toHaveBeenCalledTimes(1);
  });

  it('is fail-silent — an init() throw is swallowed and the guard resets', async () => {
    initSpy.mockImplementationOnce(() => {
      throw new Error('eruda boom');
    });
    const { mountEruda } = await import('../in-app/eruda-overlay.js');

    // Does not reject.
    await expect(mountEruda()).resolves.toBeUndefined();

    // Guard reset → a later call retries (init succeeds the second time).
    await mountEruda();
    expect(initSpy).toHaveBeenCalledTimes(2);
  });
});

describe('unmountEruda (#748 graceful detach)', () => {
  it('calls eruda.destroy() when eruda was mounted', async () => {
    const { mountEruda, unmountEruda } = await import('../in-app/eruda-overlay.js');
    await mountEruda();
    expect(initSpy).toHaveBeenCalledTimes(1);

    unmountEruda();
    expect(destroySpy).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when eruda was never mounted', async () => {
    const { unmountEruda } = await import('../in-app/eruda-overlay.js');
    unmountEruda();
    expect(destroySpy).not.toHaveBeenCalled();
  });

  it('is idempotent — a second unmount does NOT destroy twice', async () => {
    const { mountEruda, unmountEruda } = await import('../in-app/eruda-overlay.js');
    await mountEruda();
    unmountEruda();
    unmountEruda();
    expect(destroySpy).toHaveBeenCalledTimes(1);
  });

  it('resets the guard so a later mount can re-init after unmount', async () => {
    const { mountEruda, unmountEruda } = await import('../in-app/eruda-overlay.js');
    await mountEruda();
    unmountEruda();
    // A fresh attach re-mounts.
    await mountEruda();
    expect(initSpy).toHaveBeenCalledTimes(2);
  });

  it('is fail-silent — a destroy() throw is swallowed and the guard still resets', async () => {
    destroySpy.mockImplementationOnce(() => {
      throw new Error('destroy boom');
    });
    const { mountEruda, unmountEruda } = await import('../in-app/eruda-overlay.js');
    await mountEruda();

    // Does not throw despite destroy() throwing.
    expect(() => unmountEruda()).not.toThrow();

    // Guard reset even on a failed destroy → a later mount re-inits.
    await mountEruda();
    expect(initSpy).toHaveBeenCalledTimes(2);
  });
});
