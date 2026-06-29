/**
 * Unit tests for the `devtools-test` CLI `main()` exit-code paths (issue #684 PR3).
 *
 * The full attach flow needs a real phone + intoss-private:// URL, so it is
 * manual QA. But the EXIT-CODE control flow is unit-testable without a device:
 * mock the heavy boundaries (relay boot, attach orchestrator, discovery) and
 * assert that each early-exit branch leaves `process.exitCode === 1`.
 *
 * Regression guard: `!prep.ok` (attach preparation failed) previously wrote
 * `process.exitCode = 1` directly, which the `finally` block (`process.exitCode
 * = exitCode`, exitCode=0) clobbered back to 0 — turning an attach-prep failure
 * into a false success. This file pins that branch (and its siblings) so the
 * clobber cannot regress silently.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock the heavy boundaries so main() runs without a device/network ──────────

const prepareAttachMock = vi.fn();
const renderAndMaybeWaitMock = vi.fn();
vi.mock('../mcp/attach-orchestrator.js', () => ({
  prepareAttach: (...args: unknown[]) => prepareAttachMock(...args),
  renderAndMaybeWait: (...args: unknown[]) => renderAndMaybeWaitMock(...args),
}));

const discoverTestFilesMock = vi.fn();
vi.mock('./discover.js', () => ({
  discoverTestFiles: (...args: unknown[]) => discoverTestFilesMock(...args),
}));

const injectGlobalsMock = vi.fn((..._args: unknown[]) => Promise.resolve());
const injectDebugIndicatorMock = vi.fn((..._args: unknown[]) => Promise.resolve());
vi.mock('./cell.js', () => ({
  injectGlobals: (...args: unknown[]) => injectGlobalsMock(...args),
  injectDebugIndicator: (...args: unknown[]) => injectDebugIndicatorMock(...args),
}));

const runTestFilesOverRelayMock = vi.fn();
vi.mock('./relay-worker.js', () => ({
  runTestFilesOverRelay: (...args: unknown[]) => runTestFilesOverRelayMock(...args),
}));

// Dynamic imports inside main(): relay-secret-store + debug-server.
const loadRelaySecretReadOnlyMock = vi.fn((..._args: unknown[]) => Promise.resolve());
vi.mock('../mcp/relay-secret-store.js', () => ({
  loadRelaySecretReadOnly: (...args: unknown[]) => loadRelaySecretReadOnlyMock(...args),
}));

const familyStopMock = vi.fn();
const bootRelayFamilyMock = vi.fn((..._args: unknown[]) =>
  Promise.resolve({
    connection: { kind: 'relay' as const },
    getTunnelStatus: () => ({ up: false, wssUrl: null }),
    stop: familyStopMock,
  }),
);
vi.mock('../mcp/debug-server.js', () => ({
  bootRelayFamily: (...args: unknown[]) => bootRelayFamilyMock(...args),
  buildRelayVerifyAuth: () => () => Promise.resolve(true),
}));

// Import AFTER mocks are registered.
const { main } = await import('./cli.js');

const SCHEME = 'intoss-private://app?_deploymentId=test';
const ARGS = ['--scheme-url', SCHEME, '**/*.ait.test.ts'];

describe('devtools-test main() exit codes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    // Default happy-ish setup: 1 file discovered.
    discoverTestFilesMock.mockResolvedValue(['/abs/foo.ait.test.ts']);
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.unstubAllEnvs();
  });

  it('exits 1 when --scheme-url is missing', async () => {
    await main(['**/*.ait.test.ts']);
    expect(process.exitCode).toBe(1);
    // never reached relay boot
    expect(bootRelayFamilyMock).not.toHaveBeenCalled();
  });

  it('exits 1 when no test files match', async () => {
    discoverTestFilesMock.mockResolvedValue([]);
    await main(ARGS);
    expect(process.exitCode).toBe(1);
    expect(bootRelayFamilyMock).not.toHaveBeenCalled();
  });

  it('exits 1 (not 0) when attach preparation fails — finally must not clobber', async () => {
    // This is the regression: prep.ok=false set process.exitCode=1, but the
    // finally block reset it to the local exitCode (0). Pin exit 1 here.
    prepareAttachMock.mockResolvedValue({
      ok: false,
      error: { content: [{ type: 'text', text: 'bad scheme' }] },
    });

    await main(ARGS);

    expect(prepareAttachMock).toHaveBeenCalledOnce();
    expect(renderAndMaybeWaitMock).not.toHaveBeenCalled();
    expect(familyStopMock).toHaveBeenCalledOnce(); // teardown ran
    expect(process.exitCode).toBe(1); // ← the clobber bug would make this 0
  });

  it('exits 1 when attach times out (renderAndMaybeWait isError)', async () => {
    prepareAttachMock.mockResolvedValue({ ok: true /* opaque prep */ });
    renderAndMaybeWaitMock.mockResolvedValue({
      isError: true,
      content: [{ type: 'text', text: 'timed out' }],
    });

    await main(ARGS);

    expect(process.exitCode).toBe(1);
    expect(injectGlobalsMock).not.toHaveBeenCalled();
    expect(familyStopMock).toHaveBeenCalledOnce();
  });

  it('exits 0 on a successful run with 0 failed tests', async () => {
    prepareAttachMock.mockResolvedValue({ ok: true });
    renderAndMaybeWaitMock.mockResolvedValue({
      isError: false,
      content: [{ type: 'text', text: 'attached' }],
    });
    runTestFilesOverRelayMock.mockResolvedValue({
      totals: { passed: 3, failed: 0, skipped: 0 },
      duration: 12,
    });

    await main(ARGS);

    // exitCode 0 may be left as undefined (no failure) — assert it is not 1.
    expect(process.exitCode).not.toBe(1);
    expect(familyStopMock).toHaveBeenCalledOnce();
  });

  it('exits 1 when a test fails (totals.failed > 0)', async () => {
    prepareAttachMock.mockResolvedValue({ ok: true });
    renderAndMaybeWaitMock.mockResolvedValue({
      isError: false,
      content: [{ type: 'text', text: 'attached' }],
    });
    runTestFilesOverRelayMock.mockResolvedValue({
      totals: { passed: 1, failed: 2, skipped: 0 },
      duration: 12,
    });

    await main(ARGS);

    expect(process.exitCode).toBe(1);
    expect(familyStopMock).toHaveBeenCalledOnce();
  });
});
