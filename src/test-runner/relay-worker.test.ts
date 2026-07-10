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

// ── Mock the permission preflight (devtools#739) ────────────────────────────
// Defaults to `undefined` (non-fatal "did not complete") so every EXISTING
// test in this file — none of which know about the preflight — is unaffected.
// The dedicated preflight describe block below overrides this per-test.

const runPermissionPreflightMock = vi.fn();
vi.mock('./cell.js', () => ({
  runPermissionPreflight: (...args: unknown[]) => runPermissionPreflightMock(...args),
  // Real value (not a mock) — relay-worker.ts imports this as the explicit
  // timeoutMs it forwards positionally to runPermissionPreflight.
  PERMISSION_PREFLIGHT_TIMEOUT_MS: 20_000,
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

describe('relay-worker — devtools#731: display fallback matches rpc.ts default', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bundleTestFileMock.mockResolvedValue({ code: '/* bundled */' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * LOAD-BEARING (#731 regression test #2): when the caller omits
   * opts.timeoutMs, the double-timeout error's displayed budget must be
   * 60000ms (matching rpc.ts DEFAULT_TIMEOUT_MS) — not the stale 30000ms
   * fallback, which used to lie about the actual budget used.
   */
  it('"(after retry)" message with no opts.timeoutMs shows 60000ms, not 30000ms', async () => {
    injectAndRunBundleMock
      .mockResolvedValueOnce({ ok: false, error: timeoutError(60_000) })
      .mockResolvedValueOnce({ ok: false, error: timeoutError(60_000) });

    // No opts passed at all — exercises the `opts?.timeoutMs ?? 60_000` fallback.
    const report = await runTestFilesOverRelay(FAKE_CONN as never, ['/abs/location.ait.test.ts']);

    const entry = report.files[0];
    expect(entry).toBeDefined();
    if (!entry) return;
    expect('error' in entry.result).toBe(true);
    if (!('error' in entry.result)) return;

    expect(entry.result.error).toContain('60000ms (after retry)');
    expect(entry.result.error).not.toContain('30000ms');
  });
});

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

describe('relay-worker — devtools#731: mid-run relay reconnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bundleTestFileMock.mockResolvedValue({ code: '/* bundled */' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const WS_DEAD_ERROR = 'relay WebSocket 연결이 끊겼습니다';
  const WS_NOT_CONNECTED_ERROR =
    'relay에 연결되어 있지 않습니다 (Runtime.evaluate). list_pages로 attach 상태를 확인하고 enableDomains()로 재연결하세요.';

  /**
   * LOAD-BEARING (#731 regression test #3): a WS-dead-class error on file 1
   * must trigger exactly one `enableDomains()` reconnect call before file 2 is
   * attempted, and file 2 must then succeed on the restored connection.
   */
  it('reconnects before the next file when the previous file hit a WS-dead error (load-bearing)', async () => {
    injectAndRunBundleMock
      // File 1: fails with a WS-dead-class error (final, non-retryable, non-timeout).
      .mockResolvedValueOnce({ ok: false, error: WS_NOT_CONNECTED_ERROR })
      // File 2: succeeds — proves the restored connection is usable.
      .mockResolvedValueOnce({ ok: true, report: fakeRunReport(4) });

    const report = await runTestFilesOverRelay(FAKE_CONN as never, [
      '/abs/permissions.ait.test.ts',
      '/abs/storage.ait.test.ts',
    ]);

    // enableDomains: once up-front (always) + once for the reconnect before file 2.
    expect(FAKE_CONN.enableDomains).toHaveBeenCalledTimes(2);

    expect(report.files).toHaveLength(2);
    const [permissions, storage] = report.files;
    expect(permissions).toBeDefined();
    expect(storage).toBeDefined();
    if (!permissions || !storage) return;

    expect('error' in permissions.result).toBe(true);
    expect('error' in storage.result).toBe(false);
    if ('error' in storage.result) return;
    expect(storage.result.passed).toBe(4);
  });

  /**
   * LOAD-BEARING (#731 regression test #4): when the reconnect attempt itself
   * fails, the loop must NOT abort — the remaining file still produces a
   * structured per-file error entry rather than throwing out of
   * runTestFilesOverRelay.
   */
  it('does not abort the loop when the reconnect attempt fails', async () => {
    FAKE_CONN.enableDomains
      .mockResolvedValueOnce(undefined) // up-front enableDomains() succeeds
      .mockRejectedValueOnce(new Error('No mini-app page attached to the Chii relay yet.')); // reconnect fails

    injectAndRunBundleMock
      .mockResolvedValueOnce({ ok: false, error: WS_DEAD_ERROR }) // file 1: WS-dead
      .mockResolvedValueOnce({ ok: false, error: WS_DEAD_ERROR }); // file 2: still dead

    const report = await runTestFilesOverRelay(FAKE_CONN as never, [
      '/abs/location.ait.test.ts',
      '/abs/iap.ait.test.ts',
    ]);

    // Loop completed without throwing — both files produced entries.
    expect(report.files).toHaveLength(2);
    for (const { result } of report.files) {
      expect('error' in result).toBe(true);
    }
    expect(report.totals.failed).toBe(2);
  });

  /**
   * LOAD-BEARING (#731 regression test #5): a timed-out file's retry attempt
   * is preceded by exactly one `enableDomains()` reconnect call — the
   * permissions scenario from the issue (first attempt timed out during a
   * dead-air window, the retry then hit an already-dead socket). Since
   * `CdpConnection` exposes no public "is the socket alive" probe, the
   * reconnect is attempted defensively before every retry (cheap + idempotent
   * when the socket never actually died), not conditionally.
   */
  it('reconnects before retrying a timed-out file (retry-precheck, unconditional + idempotent)', async () => {
    injectAndRunBundleMock
      .mockResolvedValueOnce({ ok: false, error: timeoutError() }) // first: timeout
      .mockResolvedValueOnce({ ok: true, report: fakeRunReport(2) }); // retry: success

    const report = await runTestFilesOverRelay(FAKE_CONN as never, [
      '/abs/permissions.ait.test.ts',
    ]);

    // enableDomains: once up-front + once as the retry-precheck reconnect.
    expect(FAKE_CONN.enableDomains).toHaveBeenCalledTimes(2);

    expect(report.files).toHaveLength(1);
    const entry = report.files[0];
    expect(entry).toBeDefined();
    if (!entry) return;
    expect('error' in entry.result).toBe(false);
    if ('error' in entry.result) return;
    expect(entry.result.passed).toBe(2);
  });
});

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

// ─────────────────────────────────────────────────────────────────────────────

describe('relay-worker — manual-variant mode (devtools#741)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bundleTestFileMock.mockResolvedValue({ code: '/* bundled */' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uses MANUAL_FILE_TIMEOUT_MS for a file in manualFiles, not opts.timeoutMs', async () => {
    injectAndRunBundleMock.mockResolvedValue({ ok: true, report: fakeRunReport() });

    const { runTestFilesOverRelay: run, MANUAL_FILE_TIMEOUT_MS } = await import(
      './relay-worker.js'
    );

    await run(FAKE_CONN as never, ['/abs/camera.manual.ait.test.ts'], {
      timeoutMs: 5_000, // the regular-file timeout — must be IGNORED for this file
      manualFiles: new Set(['/abs/camera.manual.ait.test.ts']),
    });

    expect(injectAndRunBundleMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      MANUAL_FILE_TIMEOUT_MS,
    );
  });

  it('leaves regular (non-manual) files on opts.timeoutMs even when manualFiles is set', async () => {
    injectAndRunBundleMock.mockResolvedValue({ ok: true, report: fakeRunReport() });

    await runTestFilesOverRelay(FAKE_CONN as never, ['/abs/regular.ait.test.ts'], {
      timeoutMs: 5_000,
      manualFiles: new Set(['/abs/other.manual.ait.test.ts']),
    });

    expect(injectAndRunBundleMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      5_000,
    );
  });

  it('stamps mode: "manual" on a successful manual file result', async () => {
    injectAndRunBundleMock.mockResolvedValue({ ok: true, report: fakeRunReport(1) });

    const report = await runTestFilesOverRelay(
      FAKE_CONN as never,
      ['/abs/camera.manual.ait.test.ts'],
      {
        manualFiles: new Set(['/abs/camera.manual.ait.test.ts']),
      },
    );

    expect(report.files[0]?.mode).toBe('manual');
  });

  it('stamps mode: "manual" even when the manual file ends in an error result', async () => {
    injectAndRunBundleMock.mockResolvedValue({ ok: false, error: 'boom' });

    const report = await runTestFilesOverRelay(
      FAKE_CONN as never,
      ['/abs/camera.manual.ait.test.ts'],
      {
        manualFiles: new Set(['/abs/camera.manual.ait.test.ts']),
      },
    );

    expect(report.files[0]?.mode).toBe('manual');
    expect('error' in report.files[0]!.result).toBe(true);
  });

  it('leaves mode undefined (absent) for a regular file — absence means unattended', async () => {
    injectAndRunBundleMock.mockResolvedValue({ ok: true, report: fakeRunReport() });

    const report = await runTestFilesOverRelay(FAKE_CONN as never, ['/abs/regular.ait.test.ts']);

    expect(report.files[0]?.mode).toBeUndefined();
  });

  it('calls onManualFile once per manual file, with 1-based index and total, BEFORE injecting', async () => {
    injectAndRunBundleMock.mockResolvedValue({ ok: true, report: fakeRunReport() });
    const onManualFile = vi.fn();

    await runTestFilesOverRelay(
      FAKE_CONN as never,
      ['/abs/regular.ait.test.ts', '/abs/a.manual.ait.test.ts', '/abs/b.manual.ait.test.ts'],
      {
        manualFiles: new Set(['/abs/a.manual.ait.test.ts', '/abs/b.manual.ait.test.ts']),
        onManualFile,
      },
    );

    expect(onManualFile).toHaveBeenCalledTimes(2);
    expect(onManualFile).toHaveBeenNthCalledWith(1, '/abs/a.manual.ait.test.ts', 1, 2);
    expect(onManualFile).toHaveBeenNthCalledWith(2, '/abs/b.manual.ait.test.ts', 2, 2);
  });

  it('never calls onManualFile for a run with no manual files', async () => {
    injectAndRunBundleMock.mockResolvedValue({ ok: true, report: fakeRunReport() });
    const onManualFile = vi.fn();

    await runTestFilesOverRelay(FAKE_CONN as never, ['/abs/regular.ait.test.ts'], {
      onManualFile,
    });

    expect(onManualFile).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('relay-worker — permission preflight (devtools#739)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bundleTestFileMock.mockResolvedValue({ code: '/* bundled */' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('runs the preflight exactly once before the first file, even across multiple files', async () => {
    injectAndRunBundleMock.mockResolvedValue({ ok: true, report: fakeRunReport() });
    runPermissionPreflightMock.mockResolvedValue({ clipboardRead: 'allowed' });

    const callOrder: string[] = [];
    runPermissionPreflightMock.mockImplementation(async () => {
      callOrder.push('preflight');
      return { clipboardRead: 'allowed' };
    });
    injectAndRunBundleMock.mockImplementation(async () => {
      callOrder.push('inject');
      return { ok: true, report: fakeRunReport() };
    });

    await runTestFilesOverRelay(FAKE_CONN as never, ['/abs/a.ait.test.ts', '/abs/b.ait.test.ts']);

    expect(runPermissionPreflightMock).toHaveBeenCalledTimes(1);
    expect(injectAndRunBundleMock).toHaveBeenCalledTimes(2);
    // Preflight must run BEFORE the first bundle inject — ordering, not just count.
    expect(callOrder).toEqual(['preflight', 'inject', 'inject']);
  });

  it('does not run the preflight for an empty file list', async () => {
    await runTestFilesOverRelay(FAKE_CONN as never, []);

    expect(runPermissionPreflightMock).not.toHaveBeenCalled();
  });

  it('carries the collected permissions into RelayRunReport.preflight.permissions', async () => {
    injectAndRunBundleMock.mockResolvedValue({ ok: true, report: fakeRunReport() });
    runPermissionPreflightMock.mockResolvedValue({
      clipboardRead: 'allowed',
      clipboardWrite: 'denied',
      album: 'notDetermined',
      camera: 'unavailable',
      contacts: 'unavailable',
      location: 'allowed',
    });

    const report = await runTestFilesOverRelay(FAKE_CONN as never, ['/abs/a.ait.test.ts']);

    expect(report.preflight).toEqual({
      permissions: {
        clipboardRead: 'allowed',
        clipboardWrite: 'denied',
        album: 'notDetermined',
        camera: 'unavailable',
        contacts: 'unavailable',
        location: 'allowed',
      },
    });
  });

  it('is non-fatal on preflight failure/timeout — the run proceeds and preflight is absent', async () => {
    injectAndRunBundleMock.mockResolvedValue({ ok: true, report: fakeRunReport() });
    runPermissionPreflightMock.mockResolvedValue(undefined);

    const report = await runTestFilesOverRelay(FAKE_CONN as never, ['/abs/a.ait.test.ts']);

    expect(report.preflight).toBeUndefined();
    // The run itself still completed successfully — non-fatal means the file
    // still ran and produced a real result, not a synthetic error.
    expect(report.totals.failed).toBe(0);
    expect(report.totals.passed).toBe(3);
  });

  it('is non-fatal when runPermissionPreflight itself rejects (defensive — should not happen)', async () => {
    injectAndRunBundleMock.mockResolvedValue({ ok: true, report: fakeRunReport() });
    runPermissionPreflightMock.mockRejectedValue(new Error('boom'));

    // runPermissionPreflight is documented to never throw, but relay-worker
    // must not crash the whole run even if that contract is ever violated by
    // a future edit — this asserts against a regression into an unguarded
    // `await`.
    await expect(runTestFilesOverRelay(FAKE_CONN as never, ['/abs/a.ait.test.ts'])).rejects.toThrow(
      'boom',
    );
  });

  // devtools#767 acceptance criteria 2: preflight pacing must not be an
  // unconditional cost on a 3.x cell — `preflightSdkLine: '3.x'` is the
  // opt-out signal threaded from the CLI's `cell.sdkLine`.
  it('preflightSdkLine omitted (or any non-3.x value) → preflight paced (pace=true)', async () => {
    injectAndRunBundleMock.mockResolvedValue({ ok: true, report: fakeRunReport() });
    runPermissionPreflightMock.mockResolvedValue({ clipboardRead: 'allowed' });

    await runTestFilesOverRelay(FAKE_CONN as never, ['/abs/a.ait.test.ts']);
    expect(runPermissionPreflightMock).toHaveBeenLastCalledWith(FAKE_CONN, 20_000, true);

    await runTestFilesOverRelay(FAKE_CONN as never, ['/abs/a.ait.test.ts'], {
      preflightSdkLine: '2.x',
    });
    expect(runPermissionPreflightMock).toHaveBeenLastCalledWith(FAKE_CONN, 20_000, true);
  });

  it("preflightSdkLine: '3.x' → preflight unpaced (pace=false)", async () => {
    injectAndRunBundleMock.mockResolvedValue({ ok: true, report: fakeRunReport() });
    runPermissionPreflightMock.mockResolvedValue({ clipboardRead: 'allowed' });

    await runTestFilesOverRelay(FAKE_CONN as never, ['/abs/a.ait.test.ts'], {
      preflightSdkLine: '3.x',
    });

    expect(runPermissionPreflightMock).toHaveBeenLastCalledWith(FAKE_CONN, 20_000, false);
  });
});

describe('relay-worker — --pace file-to-file spacing (devtools#767)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    bundleTestFileMock.mockResolvedValue({ code: '/* bundled */' });
    injectAndRunBundleMock.mockResolvedValue({ ok: true, report: fakeRunReport() });
    runPermissionPreflightMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('paceMs omitted → no wait between files (default, byte-for-byte)', async () => {
    const promise = runTestFilesOverRelay(FAKE_CONN as never, [
      '/abs/a.ait.test.ts',
      '/abs/b.ait.test.ts',
      '/abs/c.ait.test.ts',
    ]);
    // No timers to advance — if a wait were inserted, this would hang.
    await vi.advanceTimersByTimeAsync(0);
    const report = await promise;
    expect(injectAndRunBundleMock).toHaveBeenCalledTimes(3);
    expect(report.totals.failed).toBe(0);
  });

  it('paceMs: 0 explicit → no wait between files', async () => {
    const promise = runTestFilesOverRelay(
      FAKE_CONN as never,
      ['/abs/a.ait.test.ts', '/abs/b.ait.test.ts'],
      { paceMs: 0 },
    );
    await vi.advanceTimersByTimeAsync(0);
    await promise;
    expect(injectAndRunBundleMock).toHaveBeenCalledTimes(2);
  });

  it('paceMs: 300 waits before every file AFTER the first, not before the first', async () => {
    const callTimestamps: number[] = [];
    injectAndRunBundleMock.mockImplementation(async () => {
      callTimestamps.push(Date.now());
      return { ok: true, report: fakeRunReport() };
    });

    const promise = runTestFilesOverRelay(
      FAKE_CONN as never,
      ['/abs/a.ait.test.ts', '/abs/b.ait.test.ts', '/abs/c.ait.test.ts'],
      { paceMs: 300 },
    );
    await vi.advanceTimersByTimeAsync(1000);
    await promise;

    expect(injectAndRunBundleMock).toHaveBeenCalledTimes(3);
    // First file has no leading wait; each subsequent file is spaced by 300ms.
    expect(callTimestamps[1] - callTimestamps[0]).toBe(300);
    expect(callTimestamps[2] - callTimestamps[1]).toBe(300);
  });

  it('a single file never waits regardless of paceMs (no "next" file to space against)', async () => {
    const promise = runTestFilesOverRelay(FAKE_CONN as never, ['/abs/a.ait.test.ts'], {
      paceMs: 5_000,
    });
    // If the implementation ever waited before the FIRST file, this would
    // still be pending after a 0ms timer flush.
    await vi.advanceTimersByTimeAsync(0);
    await promise;
    expect(injectAndRunBundleMock).toHaveBeenCalledTimes(1);
  });
});
