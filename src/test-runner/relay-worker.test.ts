/**
 * Unit tests for `runTestFilesOverRelay` in relay-worker.ts.
 *
 * Covers the two fidelity fixes from devtools#723 and devtools#726:
 *   fix #2a — per-file evaluate timeout is forwarded from opts.timeoutMs to
 *              injectAndRunBundle (the Promise.race clock).
 *   fix #2b — a timed-out file gets exactly one retry before being dropped;
 *              the retry succeeds when the second call resolves normally.
 *   fix #726a — retry gate is live: injectAndRunBundle now RETURNS (not throws)
 *               on timeout, so the EVALUATE_TIMEOUT_MARKER gate in attempt()
 *               can fire `return null` → retry branch → "retrying once" stderr.
 *   fix #726b — double timeout error message contains "(after retry)".
 *   fix #726c — CDP exceptionDetails (throw path) does NOT trigger retry.
 *
 * SECRET-HANDLING: all wss/scheme/relay URLs in fixtures are synthetic
 * placeholders — no real relay hosts, TOTP codes, or tunnel URLs appear here.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock bundleTestFile so no real esbuild runs ─────────────────────────────

const bundleTestFileMock = vi.fn();
vi.mock('./bundle.js', () => ({
  bundleTestFile: (...args: unknown[]) => bundleTestFileMock(...args),
}));

// ── Mock injectAndRunBundle — the core RPC surface ──────────────────────────

const injectAndRunBundleMock = vi.fn();
vi.mock('./rpc.js', () => ({
  injectAndRunBundle: (...args: unknown[]) => injectAndRunBundleMock(...args),
  buildRunTestsExpression: vi.fn((code: string) => code),
  parseRunTestsResult: vi.fn(),
}));

// ── Mock capture helpers ─────────────────────────────────────────────────────

vi.mock('./capture.js', () => ({
  parseCaptureLines: vi.fn(() => []),
}));

// Import AFTER mocks are registered.
const { runTestFilesOverRelay, EVALUATE_TIMEOUT_MARKER } = await import('./relay-worker.js');

// ── Fake CdpConnection — minimal surface for relay-worker ───────────────────

const FAKE_CONN = {
  kind: 'relay' as const,
  enableDomains: vi.fn(() => Promise.resolve()),
  on: vi.fn(() => () => {}),
  send: vi.fn(),
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function fakeRunReport(passed = 3): import('./runtime.js').RunReport {
  return {
    startedAt: new Date().toISOString(),
    duration: 10,
    passed,
    failed: 0,
    skipped: 0,
    tests: [],
  };
}

function timeoutError(ms = 30_000): string {
  return `${EVALUATE_TIMEOUT_MARKER} ${ms}ms`;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('relay-worker — fix #2a: timeout forwarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bundleTestFileMock.mockResolvedValue({ code: '/* bundled */' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('passes opts.timeoutMs to injectAndRunBundle as the third argument', async () => {
    injectAndRunBundleMock.mockResolvedValue({ ok: true, report: fakeRunReport() });

    await runTestFilesOverRelay(FAKE_CONN as never, ['/abs/foo.ait.test.ts'], {
      timeoutMs: 5_000,
    });

    // LOAD-BEARING: the third argument to injectAndRunBundle must be 5_000, not
    // the default 30_000 — proving the CLI's --timeout value flows all the way
    // through to the Promise.race clock in rpc.ts.
    expect(injectAndRunBundleMock).toHaveBeenCalledWith(
      expect.anything(), // connection
      expect.anything(), // bundleCode
      5_000, // timeoutMs — load-bearing
    );
  });

  it('passes undefined timeoutMs when no opts given (rpc.ts default governs)', async () => {
    injectAndRunBundleMock.mockResolvedValue({ ok: true, report: fakeRunReport() });

    await runTestFilesOverRelay(FAKE_CONN as never, ['/abs/foo.ait.test.ts']);

    expect(injectAndRunBundleMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      undefined,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('relay-worker — fix #2b: per-file timeout retry (load-bearing)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bundleTestFileMock.mockResolvedValue({ code: '/* bundled */' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * LOAD-BEARING: first call → timeout (ok:false + EVALUATE_TIMEOUT_MARKER);
   * second call → success.  The file must appear in the report with its full
   * RunReport — NOT as a dropped error entry.
   */
  it('retries a timed-out file once and reports success on the second call (load-bearing)', async () => {
    injectAndRunBundleMock
      .mockResolvedValueOnce({ ok: false, error: timeoutError() }) // first: timeout
      .mockResolvedValueOnce({ ok: true, report: fakeRunReport(5) }); // second: success

    const report = await runTestFilesOverRelay(FAKE_CONN as never, ['/abs/camera.ait.test.ts']);

    // LOAD-BEARING: the file must NOT be dropped to 0 tests.
    expect(report.files).toHaveLength(1);
    const entry = report.files[0];
    expect(entry).toBeDefined();
    if (!entry) return;

    // Must have the full RunReport (not an error entry).
    expect('error' in entry.result).toBe(false);
    if ('error' in entry.result) return; // type narrowing
    expect(entry.result.passed).toBe(5);

    // injectAndRunBundle must have been called twice.
    expect(injectAndRunBundleMock).toHaveBeenCalledTimes(2);

    // Aggregate must reflect the successful retry.
    expect(report.totals.passed).toBe(5);
    expect(report.totals.failed).toBe(0);
  });

  /**
   * When the retry also times out, the file is confirmed as a failure (not
   * silently dropped to 0).  The totals must count it as failed=1.
   */
  it('marks a file as failed after two timeouts (retry exhausted)', async () => {
    injectAndRunBundleMock
      .mockResolvedValueOnce({ ok: false, error: timeoutError() })
      .mockResolvedValueOnce({ ok: false, error: timeoutError() });

    const report = await runTestFilesOverRelay(FAKE_CONN as never, ['/abs/camera.ait.test.ts']);

    expect(report.files).toHaveLength(1);
    const entry = report.files[0];
    expect(entry).toBeDefined();
    if (!entry) return;

    // Must be an error entry — the file failed both attempts.
    expect('error' in entry.result).toBe(true);

    // Totals: 0 passed, 1 failed.
    expect(report.totals.passed).toBe(0);
    expect(report.totals.failed).toBe(1);
  });

  /**
   * Non-timeout errors (bundle eval error, parse failure, …) must NOT be
   * retried — they are deterministic failures that a retry cannot fix.
   */
  it('does NOT retry a non-timeout error (bundle eval errors are final)', async () => {
    injectAndRunBundleMock.mockResolvedValueOnce({
      ok: false,
      error: 'bundle-eval: ReferenceError: __sdk is not defined',
    });

    const report = await runTestFilesOverRelay(FAKE_CONN as never, ['/abs/foo.ait.test.ts']);

    // Only one call — no retry.
    expect(injectAndRunBundleMock).toHaveBeenCalledTimes(1);

    const entry = report.files[0];
    expect(entry).toBeDefined();
    if (!entry) return;
    expect('error' in entry.result).toBe(true);
  });

  /**
   * Multiple files: a timeout-retry on the first file must not prevent
   * subsequent files from running.
   */
  it('continues to run subsequent files after a timed-out file is retried', async () => {
    injectAndRunBundleMock
      .mockResolvedValueOnce({ ok: false, error: timeoutError() }) // camera: timeout
      .mockResolvedValueOnce({ ok: false, error: timeoutError() }) // camera: retry timeout
      .mockResolvedValueOnce({ ok: true, report: fakeRunReport(3) }); // storage: success

    const report = await runTestFilesOverRelay(FAKE_CONN as never, [
      '/abs/camera.ait.test.ts',
      '/abs/storage.ait.test.ts',
    ]);

    expect(report.files).toHaveLength(2);
    const [camera, storage] = report.files;
    expect(camera).toBeDefined();
    expect(storage).toBeDefined();
    if (!camera || !storage) return;

    expect('error' in camera.result).toBe(true);
    expect('error' in storage.result).toBe(false);
    if ('error' in storage.result) return;
    expect(storage.result.passed).toBe(3);

    expect(report.totals.passed).toBe(3);
    expect(report.totals.failed).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('relay-worker — EVALUATE_TIMEOUT_MARKER export', () => {
  it('is a non-empty string that matches the rpc.ts timeout message format', () => {
    expect(typeof EVALUATE_TIMEOUT_MARKER).toBe('string');
    expect(EVALUATE_TIMEOUT_MARKER.length).toBeGreaterThan(0);
    // The marker must be a prefix-compatible fragment of the actual error string
    // emitted by rpc.ts ("rpc: evaluate timed out after Nms").
    expect('rpc: evaluate timed out after 60000ms').toContain(EVALUATE_TIMEOUT_MARKER);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('relay-worker — devtools#726 regression: retry-gate is live', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bundleTestFileMock.mockResolvedValue({ code: '/* bundled */' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * LOAD-BEARING (devtools#726, BUG 1): the `retrying once` stderr line MUST
   * be emitted when the first attempt returns a timeout result.  Before the fix,
   * injectAndRunBundle THREW on timeout → attempt()'s catch block returned a
   * non-null FileResult → firstResult !== null was always true → the retry
   * branch (including this stderr line) was dead code.
   *
   * This test drives the retry path and asserts:
   *   1. stderr contains the "retrying once" message.
   *   2. The file's final result reflects the successful retry.
   *   3. injectAndRunBundle was called exactly twice.
   */
  it('emits "retrying once" stderr and reports success when retry succeeds (BUG 1 dead-branch proof)', async () => {
    const stderrLines: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    const spy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        stderrLines.push(typeof chunk === 'string' ? chunk : chunk.toString());
        return true;
      });

    injectAndRunBundleMock
      .mockResolvedValueOnce({ ok: false, error: timeoutError() }) // first: timeout
      .mockResolvedValueOnce({ ok: true, report: fakeRunReport(7) }); // retry: success

    const report = await runTestFilesOverRelay(FAKE_CONN as never, ['/abs/storage.ait.test.ts']);

    spy.mockRestore();
    void origWrite; // satisfy lint

    // LOAD-BEARING: the "retrying once" line must appear — proves the branch
    // that was dead before BUG 1 fix is now live.
    const retryLine = stderrLines.find((l) => l.includes('retrying once'));
    expect(retryLine).toBeDefined();

    // File must report success from the retry.
    expect(report.files).toHaveLength(1);
    const entry = report.files[0];
    expect(entry).toBeDefined();
    if (!entry) return;
    expect('error' in entry.result).toBe(false);
    if ('error' in entry.result) return;
    expect(entry.result.passed).toBe(7);

    // Exactly two calls: original + retry.
    expect(injectAndRunBundleMock).toHaveBeenCalledTimes(2);
  });

  /**
   * LOAD-BEARING (devtools#726): double timeout → final FileResult error must
   * contain "(after retry)" so callers can distinguish "timed out once" from
   * "timed out twice and gave up".
   */
  it('final error contains "(after retry)" when both attempts time out (double-timeout)', async () => {
    injectAndRunBundleMock
      .mockResolvedValueOnce({ ok: false, error: timeoutError() })
      .mockResolvedValueOnce({ ok: false, error: timeoutError() });

    const report = await runTestFilesOverRelay(FAKE_CONN as never, ['/abs/iap.ait.test.ts']);

    const entry = report.files[0];
    expect(entry).toBeDefined();
    if (!entry) return;

    expect('error' in entry.result).toBe(true);
    if (!('error' in entry.result)) return;

    // LOAD-BEARING: the "(after retry)" suffix must be present.
    expect(entry.result.error).toContain('(after retry)');
    expect(entry.result.error).toContain(EVALUATE_TIMEOUT_MARKER);

    // Totals: this file counts as failed.
    expect(report.totals.failed).toBe(1);
    expect(report.totals.passed).toBe(0);
  });

  /**
   * LOAD-BEARING (devtools#726): CDP exceptionDetails cause injectAndRunBundle
   * to THROW (not return), which relay-worker's catch block catches and turns
   * into a final error WITHOUT triggering the retry gate.  The retry branch
   * must NOT fire for non-timeout throws.
   */
  it('CDP exceptionDetails (throw from injectAndRunBundle) is final — no retry', async () => {
    // Simulate the throw path (CDP exceptionDetails).
    injectAndRunBundleMock.mockRejectedValueOnce(
      new Error('rpc.injectAndRunBundle: SyntaxError: Unexpected token'),
    );

    const report = await runTestFilesOverRelay(FAKE_CONN as never, ['/abs/foo.ait.test.ts']);

    // LOAD-BEARING: only ONE call — the throw must not trigger retry.
    expect(injectAndRunBundleMock).toHaveBeenCalledTimes(1);

    const entry = report.files[0];
    expect(entry).toBeDefined();
    if (!entry) return;

    expect('error' in entry.result).toBe(true);
    if (!('error' in entry.result)) return;

    // Error message must NOT contain "(after retry)" — this was a throw, not a
    // timeout return, so the EVALUATE_TIMEOUT_MARKER gate never fired.
    expect(entry.result.error).not.toContain('(after retry)');
    expect(entry.result.error).toContain('SyntaxError');
  });
});
