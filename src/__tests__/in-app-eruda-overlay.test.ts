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
vi.mock('eruda', () => ({
  default: {
    init: initSpy,
  },
}));

beforeEach(() => {
  vi.resetModules();
  initSpy.mockReset();
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
