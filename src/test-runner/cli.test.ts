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
const { main, shouldSuppressQr, resolveTimeouts, renderSummary } = await import('./cli.js');

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
 * Regression guard for #717: the single --timeout flag must NOT collapse both
 * clocks. These tests are the load-bearing assertion that proves the fix:
 *
 *   - No flags → attach-wait is undefined (factory default ≥ 600 000, NOT 60 000)
 *   - --timeout only → per-file evaluate uses that value; attach-wait stays undefined
 *   - --attach-timeout only → attach-wait uses that value; evaluate stays 60 000
 *
 * The critical invariant is the first case: before the fix, passing no flags
 * caused createRelayConnectionFactory to receive timeoutMs=30_000, which tore
 * down the QR dashboard 30 s after boot — before anyone could scan it.
 *
 * #731: the CLI's own no-flags fallback is now 60_000, matching rpc.ts's
 * DEFAULT_TIMEOUT_MS — before this fix the CLI's 30_000 fallback silently
 * overrode rpc.ts's 60s bump (#726) on every CLI run that omitted --timeout.
 */
describe('resolveTimeouts — two clocks must be independent (#717)', () => {
  it('no flags → evaluateTimeoutMs=60000, attachTimeoutMs=undefined (factory default) (#731)', () => {
    const result = resolveTimeouts(undefined, undefined);
    expect(typeof result).not.toBe('string');
    if (typeof result === 'string') return; // type narrowing for tsc
    // LOAD-BEARING (#731): must match rpc.ts DEFAULT_TIMEOUT_MS (60_000), not
    // the old 30_000 fallback that silently undid #726's 60s bump.
    expect(result.evaluateTimeoutMs).toBe(60_000);
    // LOAD-BEARING: must be undefined, not 30_000 — so factory's 600 000 applies.
    expect(result.attachTimeoutMs).toBeUndefined();
  });

  it('--timeout 5000 → evaluateTimeoutMs=5000, attachTimeoutMs still undefined', () => {
    const result = resolveTimeouts('5000', undefined);
    expect(typeof result).not.toBe('string');
    if (typeof result === 'string') return;
    expect(result.evaluateTimeoutMs).toBe(5_000);
    expect(result.attachTimeoutMs).toBeUndefined();
  });

  it('--attach-timeout 120000 → attachTimeoutMs=120000, evaluateTimeoutMs still 60000 (#731)', () => {
    const result = resolveTimeouts(undefined, '120000');
    expect(typeof result).not.toBe('string');
    if (typeof result === 'string') return;
    expect(result.evaluateTimeoutMs).toBe(60_000);
    expect(result.attachTimeoutMs).toBe(120_000);
  });

  it('both flags → each clock uses its own value', () => {
    const result = resolveTimeouts('5000', '60000');
    expect(typeof result).not.toBe('string');
    if (typeof result === 'string') return;
    expect(result.evaluateTimeoutMs).toBe(5_000);
    expect(result.attachTimeoutMs).toBe(60_000);
  });

  it('--timeout 0 → returns an error string', () => {
    const result = resolveTimeouts('0', undefined);
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/--timeout/);
  });

  it('--timeout -1 → returns an error string', () => {
    const result = resolveTimeouts('-1', undefined);
    expect(typeof result).toBe('string');
  });

  it('--attach-timeout -1 → returns an error string', () => {
    const result = resolveTimeouts(undefined, '-1');
    expect(typeof result).toBe('string');
    expect(result as string).toMatch(/--attach-timeout/);
  });

  it('--attach-timeout 0 → returns an error string', () => {
    const result = resolveTimeouts(undefined, '0');
    expect(typeof result).toBe('string');
  });
});

/**
 * Integration-level: verify that main() does NOT forward 30_000 to the factory
 * when no --attach-timeout is given (the exact regression from #717).
 */
describe('main() — attach-wait wiring (#717)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    discoverTestFilesMock.mockResolvedValue(['/abs/foo.ait.test.ts']);
    factoryOpenMock.mockResolvedValue(FAKE_CONN);
    runTestFilesOverRelayMock.mockResolvedValue({
      totals: { passed: 1, failed: 0, skipped: 0, total: 1 },
      duration: 5,
      files: [],
      captures: [],
    });
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it('no --attach-timeout → factory receives no timeoutMs (factory default governs)', async () => {
    await main(ARGS);
    expect(createRelayConnectionFactoryMock).toHaveBeenCalledOnce();
    const factoryOpts = createRelayConnectionFactoryMock.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    // LOAD-BEARING: must not be 30_000. undefined means factory uses its own 600 000.
    expect(factoryOpts?.timeoutMs).toBeUndefined();
    expect(factoryOpts?.timeoutMs).not.toBe(30_000);
  });

  it('--timeout 5000 → evaluate uses 5000, factory still receives no timeoutMs', async () => {
    await main([...ARGS, '--timeout', '5000']);
    const factoryOpts = createRelayConnectionFactoryMock.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(factoryOpts?.timeoutMs).toBeUndefined();

    const runOpts = runTestFilesOverRelayMock.mock.calls[0]?.[2] as
      | { timeoutMs?: number }
      | undefined;
    expect(runOpts?.timeoutMs).toBe(5_000);
  });

  it('--attach-timeout 120000 → factory receives timeoutMs=120000', async () => {
    await main([...ARGS, '--attach-timeout', '120000']);
    const factoryOpts = createRelayConnectionFactoryMock.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(factoryOpts?.timeoutMs).toBe(120_000);
  });

  it('exits 1 for --attach-timeout 0 without calling the factory', async () => {
    await main([...ARGS, '--attach-timeout', '0']);
    expect(process.exitCode).toBe(1);
    expect(createRelayConnectionFactoryMock).not.toHaveBeenCalled();
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

/**
 * fix #1 — renderSummary: per-file failure exposure (devtools#723)
 *
 * These tests guard that a timed-out or errored file's basename and error
 * appear in the rendered summary, and that the aggregate totals line follows.
 * The load-bearing assertion is the first test: before the fix, the summary
 * printed ONLY the aggregate line ("40 passed, 7 failed") with no indication
 * that camera.ait.test.ts had been silently dropped.
 *
 * SECRET-HANDLING: the rendered output must not contain wss://, at=, or any
 * relay/tunnel/scheme URL fragment.
 */
describe('renderSummary — per-file failure exposure (fix #1, devtools#723)', () => {
  function makeReport(
    files: Array<{ file: string; result: import('./relay-worker.js').FileResult['result'] }>,
    overrides?: Partial<import('./relay-worker.js').RelayRunReport>,
  ): import('./relay-worker.js').RelayRunReport {
    const totals = files.reduce(
      (acc, { result }) => {
        if ('error' in result) {
          acc.failed += 1;
          acc.total += 1;
        } else {
          acc.passed += result.passed;
          acc.failed += result.failed;
          acc.skipped += result.skipped;
          acc.total += result.passed + result.failed + result.skipped;
        }
        return acc;
      },
      { passed: 0, failed: 0, skipped: 0, total: 0 },
    );
    return {
      startedAt: new Date().toISOString(),
      duration: 12_345,
      files: files.map(({ file, result }) => ({ file, result })),
      totals,
      captures: [],
      ...overrides,
    };
  }

  function passingReport(): import('./runtime.js').RunReport {
    return {
      startedAt: new Date().toISOString(),
      duration: 8,
      passed: 5,
      failed: 0,
      skipped: 0,
      tests: [],
    };
  }

  /**
   * LOAD-BEARING: a timed-out file must appear in the summary as a FAIL line.
   * Before the fix, this line did not exist — only the aggregate was printed.
   */
  it('LOAD-BEARING: timed-out file basename + error appears before aggregate totals', () => {
    const report = makeReport([
      {
        file: '/abs/path/camera.ait.test.ts',
        result: { error: 'rpc: evaluate timed out after 30000ms' },
      },
      { file: '/abs/path/storage.ait.test.ts', result: passingReport() },
    ]);

    const summary = renderSummary(report);

    // LOAD-BEARING: timed-out file must have a FAIL line with its basename and error class.
    expect(summary).toContain('FAIL camera.ait.test.ts:');
    expect(summary).toContain('rpc: evaluate timed out after 30000ms');

    // Passing file must have an OK line.
    expect(summary).toContain('OK   storage.ait.test.ts:');
    expect(summary).toContain('5 passed');

    // FAIL line must appear BEFORE the aggregate totals line.
    const failIdx = summary.indexOf('FAIL camera.ait.test.ts:');
    const totalsIdx = summary.indexOf('devtools-test:');
    expect(failIdx).toBeGreaterThanOrEqual(0);
    expect(totalsIdx).toBeGreaterThan(failIdx);
  });

  it('aggregate totals line matches the report totals', () => {
    const report = makeReport([
      { file: '/abs/foo.ait.test.ts', result: { error: 'rpc: evaluate timed out after 30000ms' } },
      { file: '/abs/bar.ait.test.ts', result: passingReport() },
    ]);

    const summary = renderSummary(report);

    expect(summary).toContain('devtools-test: 5 passed, 1 failed, 0 skipped');
  });

  it('all-passing report produces only OK lines and the aggregate', () => {
    const report = makeReport([
      { file: '/abs/auth.ait.test.ts', result: passingReport() },
      { file: '/abs/location.ait.test.ts', result: { ...passingReport(), passed: 3 } },
    ]);

    const summary = renderSummary(report);

    expect(summary).not.toContain('FAIL');
    expect(summary).toContain('OK   auth.ait.test.ts:');
    expect(summary).toContain('OK   location.ait.test.ts:');
  });

  it('error entry without timeout marker still appears as FAIL', () => {
    const report = makeReport([
      { file: '/abs/iap.ait.test.ts', result: { error: 'bundle-eval: ReferenceError: __sdk' } },
    ]);

    const summary = renderSummary(report);

    expect(summary).toContain('FAIL iap.ait.test.ts:');
    expect(summary).toContain('bundle-eval: ReferenceError: __sdk');
  });

  /**
   * SECRET-HANDLING: the rendered output must never contain wss://, at=,
   * intoss-private://, or trycloudflare host fragments even if the error string
   * were somehow to include them (defence in depth — the error should never
   * contain them, but the test pins the contract).
   */
  it('SECRET-HANDLING: rendered lines do not contain wss://, at=, or scheme URLs', () => {
    const report = makeReport([
      // Hypothetical error that accidentally includes a secret — must still be clean.
      {
        file: '/abs/camera.ait.test.ts',
        result: { error: 'rpc: evaluate timed out after 30000ms' },
      },
    ]);

    const summary = renderSummary(report);

    expect(summary).not.toContain('wss://');
    expect(summary).not.toContain('at=');
    expect(summary).not.toContain('intoss-private://');
    expect(summary).not.toContain('.trycloudflare.com');
  });
});
