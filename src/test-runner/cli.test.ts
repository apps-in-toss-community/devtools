/**
 * Unit tests for the `devtools-test` CLI `main()` exit-code paths
 * (issue #684 PR3; refactored to the shared relay factory in #696).
 *
 * The full attach flow needs a real phone + intoss-private:// URL, so it is
 * manual QA. But the EXIT-CODE control flow is unit-testable without a device:
 * `main()` now delegates the entire attach assembly to
 * `createRelayConnectionFactory`, so we mock the factory (open/close) plus the
 * run core and assert each branch leaves the right `process.exitCode`.
 *
 * Regression guard (#684): an attach-prep failure must leave exit 1 — the
 * `finally` block must not clobber it back to 0. With the factory refactor,
 * "attach failed" surfaces as `factory.open()` rejecting; we pin exit 1 there.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock the heavy boundaries so main() runs without a device/network ──────────

const discoverTestFilesMock = vi.fn();
vi.mock('./discover.js', () => ({
  discoverTestFiles: (...args: unknown[]) => discoverTestFilesMock(...args),
}));

// The relay factory: open() returns a (fake) connection; close() tears down.
const factoryOpenMock = vi.fn();
const factoryCloseMock = vi.fn((..._args: unknown[]) => Promise.resolve());
const createRelayConnectionFactoryMock = vi.fn((..._args: unknown[]) => ({
  open: (...a: unknown[]) => factoryOpenMock(...a),
  close: (...a: unknown[]) => factoryCloseMock(...a),
}));
vi.mock('./relay-factory.js', () => ({
  createRelayConnectionFactory: (...args: unknown[]) => createRelayConnectionFactoryMock(...args),
}));

const runTestFilesOverRelayMock = vi.fn();
vi.mock('./relay-worker.js', () => ({
  runTestFilesOverRelay: (...args: unknown[]) => runTestFilesOverRelayMock(...args),
}));

const writeReportArtifactMock = vi.fn((..._args: unknown[]) => Promise.resolve('/abs/report.json'));
const writeCaptureArtifactsMock = vi.fn((..._args: unknown[]) => Promise.resolve([]));
vi.mock('./report.js', () => ({
  writeReportArtifact: (...args: unknown[]) => writeReportArtifactMock(...args),
  writeCaptureArtifacts: (...args: unknown[]) => writeCaptureArtifactsMock(...args),
}));

// Import AFTER mocks are registered.
const { main, shouldSuppressQr } = await import('./cli.js');

const FAKE_CONN = { kind: 'relay' as const };
const SCHEME = 'intoss-private://app?_deploymentId=test';
const ARGS = ['--scheme-url', SCHEME, '**/*.ait.test.ts'];

function passingRun() {
  return {
    totals: { passed: 3, failed: 0, skipped: 0, total: 3 },
    duration: 12,
    files: [],
    captures: [],
  };
}

describe('devtools-test main() exit codes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    // Default happy-ish setup: 1 file discovered, factory opens, run passes.
    discoverTestFilesMock.mockResolvedValue(['/abs/foo.ait.test.ts']);
    factoryOpenMock.mockResolvedValue(FAKE_CONN);
    runTestFilesOverRelayMock.mockResolvedValue(passingRun());
  });

  afterEach(() => {
    process.exitCode = undefined;
    vi.unstubAllEnvs();
  });

  it('exits 1 when --scheme-url is missing', async () => {
    await main(['**/*.ait.test.ts']);
    expect(process.exitCode).toBe(1);
    // never reached the factory
    expect(createRelayConnectionFactoryMock).not.toHaveBeenCalled();
  });

  it('exits 1 when no test files match', async () => {
    discoverTestFilesMock.mockResolvedValue([]);
    await main(ARGS);
    expect(process.exitCode).toBe(1);
    expect(createRelayConnectionFactoryMock).not.toHaveBeenCalled();
  });

  it('exits 1 (not 0) when factory.open() rejects — finally must not clobber', async () => {
    factoryOpenMock.mockRejectedValue(new Error('attach preparation failed'));

    await main(ARGS);

    expect(factoryOpenMock).toHaveBeenCalledOnce();
    expect(runTestFilesOverRelayMock).not.toHaveBeenCalled();
    // open() failed before a connection existed → no close() needed.
    expect(process.exitCode).toBe(1);
  });

  it('exits 0 on a successful run with 0 failed tests', async () => {
    await main(ARGS);
    // exitCode 0 may be left as undefined (no failure) — assert it is not 1.
    expect(process.exitCode).not.toBe(1);
    expect(factoryCloseMock).toHaveBeenCalledOnce();
  });

  it('exits 1 when a test fails (totals.failed > 0)', async () => {
    runTestFilesOverRelayMock.mockResolvedValue({
      totals: { passed: 1, failed: 2, skipped: 0, total: 3 },
      duration: 12,
      files: [],
      captures: [],
    });

    await main(ARGS);

    expect(process.exitCode).toBe(1);
    expect(factoryCloseMock).toHaveBeenCalledOnce();
  });

  it('writes report + capture artifacts when --report-dir is given', async () => {
    runTestFilesOverRelayMock.mockResolvedValue({
      ...passingRun(),
      captures: [{ category: 'clipboard', json: '[]' }],
    });

    await main([...ARGS, '--report-dir', '.ait-report', '--cell-sdk-line', '3.x']);

    expect(writeReportArtifactMock).toHaveBeenCalledOnce();
    expect(writeCaptureArtifactsMock).toHaveBeenCalledOnce();
    // collectCaptures must be enabled when a report dir is given.
    const runOpts = runTestFilesOverRelayMock.mock.calls[0]?.[2] as
      | { collectCaptures?: boolean }
      | undefined;
    expect(runOpts?.collectCaptures).toBe(true);
  });

  it('does not write artifacts (or collect captures) without --report-dir', async () => {
    await main(ARGS);
    expect(writeReportArtifactMock).not.toHaveBeenCalled();
    const runOpts = runTestFilesOverRelayMock.mock.calls[0]?.[2] as
      | { collectCaptures?: boolean }
      | undefined;
    expect(runOpts?.collectCaptures).toBe(false);
  });
});

/**
 * `shouldSuppressQr` is the SECRET-HANDLING gate that keeps the QR/attach block
 * (relay wss + TOTP `at=` code) off a captured stdout. Pin every suppress path
 * + the single "print" path so a regression can't silently leak the block.
 */
describe('shouldSuppressQr', () => {
  // Make stdout look interactive by default so each suppress trigger is isolated.
  const realIsTTY = process.stdout.isTTY;

  function setTTY(value: boolean): void {
    Object.defineProperty(process.stdout, 'isTTY', {
      value,
      configurable: true,
      writable: true,
    });
  }

  beforeEach(() => {
    setTTY(true);
    // Clear the env triggers so the interactive baseline is clean (CI is usually
    // set in the test runner's own environment).
    vi.stubEnv('CI', undefined);
    vi.stubEnv('AIT_NO_QR_STDOUT', undefined);
  });

  afterEach(() => {
    setTTY(realIsTTY);
    vi.unstubAllEnvs();
  });

  it('suppresses when --no-qr-stdout is passed (even on an interactive TTY)', () => {
    expect(shouldSuppressQr(true)).toBe(true);
  });

  it('suppresses when stdout is not a TTY', () => {
    setTTY(false);
    expect(shouldSuppressQr(false)).toBe(true);
  });

  it('suppresses when CI is set — including an empty string', () => {
    vi.stubEnv('CI', '');
    expect(shouldSuppressQr(false)).toBe(true);
  });

  it('suppresses when AIT_NO_QR_STDOUT is set', () => {
    vi.stubEnv('AIT_NO_QR_STDOUT', '1');
    expect(shouldSuppressQr(false)).toBe(true);
  });

  it('does NOT suppress on an interactive TTY with no flag/env triggers', () => {
    expect(shouldSuppressQr(false)).toBe(false);
  });
});
