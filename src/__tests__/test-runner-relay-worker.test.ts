/**
 * Unit tests for the relay-worker orchestrator (devtools#644).
 *
 * Uses a fake CdpConnection and a pre-bundled code string to test the
 * bundle→inject→run→collect pipeline without a phone or relay.
 *
 * `bundleTestFile` is mocked at the module level so tests do not require
 * esbuild to be installed in the test environment.
 */

import { describe, expect, it, vi } from 'vitest';
import type {
  CdpCommandMap,
  CdpCommandName,
  CdpConnection,
  CdpEventMap,
  CdpEventName,
  CdpTarget,
  ConsoleApiCalledEvent,
} from '../mcp/cdp-connection.js';
import { flattenResults, runTestFilesOverRelay } from '../test-runner/relay-worker.js';
import type { RunReport } from '../test-runner/runtime.js';

/* -------------------------------------------------------------------------- */
/* Fake CdpConnection                                                          */
/* -------------------------------------------------------------------------- */

type CannedResults = Partial<{
  [M in CdpCommandName]: CdpCommandMap[M]['result'];
}>;

function makeFakeConnection(canned: CannedResults = {}): CdpConnection {
  return {
    kind: 'relay' as const,
    enableDomains: () => Promise.resolve(),
    listTargets: (): CdpTarget[] => [],
    getBufferedEvents: <E extends CdpEventName>(_event: E): ReadonlyArray<CdpEventMap[E]> => [],
    on:
      <E extends CdpEventName>(
        _event: E,
        _listener: (payload: CdpEventMap[E]) => void,
      ): (() => void) =>
      () => {},
    send: <M extends CdpCommandName>(
      method: M,
      _params?: CdpCommandMap[M]['params'],
    ): Promise<CdpCommandMap[M]['result']> => {
      if (method in canned) {
        return Promise.resolve(canned[method] as CdpCommandMap[M]['result']);
      }
      return Promise.reject(new Error(`FakeCdpConnection: no canned result for ${method}`));
    },
  };
}

/** Minimal RunReport. */
function makeRunReport(overrides?: Partial<RunReport>): RunReport {
  return {
    startedAt: '2024-01-01T00:00:00.000Z',
    duration: 15,
    passed: 2,
    failed: 0,
    skipped: 0,
    tests: [
      { name: 'test A', status: 'pass', duration: 5 },
      { name: 'test B', status: 'pass', duration: 10 },
    ],
    ...overrides,
  };
}

// Mock bundleTestFile so we don't need esbuild in vitest environment
vi.mock('../test-runner/bundle.js', () => ({
  bundleTestFile: vi.fn(async (_absPath: string) => ({
    code: '/* mocked bundle */',
    warnings: [],
  })),
}));

// Mock the permission preflight (devtools#739) — this file's fakes are
// call-count/canned-result keyed on a SINGLE `Runtime.evaluate` per file, so
// an unmocked preflight (which also sends `Runtime.evaluate`) would shift
// call counts and double-fire console events. Preflight behavior itself is
// covered by cell.test.ts and the dedicated describe block in
// relay-worker.test.ts.
vi.mock('../test-runner/cell.js', () => ({
  runPermissionPreflight: vi.fn(() => Promise.resolve(undefined)),
}));

/* -------------------------------------------------------------------------- */
/* runTestFilesOverRelay                                                       */
/* -------------------------------------------------------------------------- */

describe('runTestFilesOverRelay', () => {
  it('returns a report with totals for a single passing file', async () => {
    const report = makeRunReport();
    const raw = JSON.stringify({ ok: true, value: report });
    const conn = makeFakeConnection({
      'Runtime.evaluate': { result: { type: 'string', value: raw } },
    });

    const result = await runTestFilesOverRelay(conn, ['/project/foo.test.ts']);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].file).toBe('/project/foo.test.ts');
    expect(result.totals.passed).toBe(2);
    expect(result.totals.failed).toBe(0);
    expect(result.totals.total).toBe(2);
  });

  it('accumulates totals across multiple files', async () => {
    let callCount = 0;
    const reports = [
      makeRunReport({ passed: 2, failed: 0 }),
      makeRunReport({
        passed: 0,
        failed: 1,
        tests: [{ name: 'x', status: 'fail', duration: 1, error: 'boom' }],
      }),
    ];
    const conn: CdpConnection = {
      ...makeFakeConnection(),
      send: <M extends CdpCommandName>(
        _method: M,
        _params?: CdpCommandMap[M]['params'],
      ): Promise<CdpCommandMap[M]['result']> => {
        const report = reports[callCount++ % reports.length];
        const raw = JSON.stringify({ ok: true, value: report });
        return Promise.resolve({
          result: { type: 'string', value: raw },
        } as CdpCommandMap[M]['result']);
      },
    };

    const result = await runTestFilesOverRelay(conn, ['/a.ts', '/b.ts']);
    expect(result.files).toHaveLength(2);
    expect(result.totals.passed).toBe(2);
    expect(result.totals.failed).toBe(1);
    expect(result.totals.total).toBe(3);
  });

  it('records per-file error when inject throws', async () => {
    const conn: CdpConnection = {
      ...makeFakeConnection(),
      send: (): Promise<never> => Promise.reject(new Error('CDP connection lost')),
    };

    const result = await runTestFilesOverRelay(conn, ['/bad.ts']);
    expect(result.files).toHaveLength(1);
    const fileResult = result.files[0].result;
    expect('error' in fileResult).toBe(true);
    if ('error' in fileResult) {
      expect(fileResult.error).toContain('CDP connection lost');
    }
    // Whole-file error counts as one failure
    expect(result.totals.failed).toBe(1);
  });

  it('continues to next file after per-file error', async () => {
    let callCount = 0;
    const conn: CdpConnection = {
      ...makeFakeConnection(),
      send: <M extends CdpCommandName>(
        _method: M,
        _params?: CdpCommandMap[M]['params'],
      ): Promise<CdpCommandMap[M]['result']> => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error('first file error'));
        }
        const raw = JSON.stringify({ ok: true, value: makeRunReport({ passed: 1 }) });
        return Promise.resolve({
          result: { type: 'string', value: raw },
        } as CdpCommandMap[M]['result']);
      },
    };

    const result = await runTestFilesOverRelay(conn, ['/err.ts', '/ok.ts']);
    expect(result.files).toHaveLength(2);
    expect('error' in result.files[0].result).toBe(true);
    expect('error' in result.files[1].result).toBe(false);
    expect(result.totals.failed).toBe(1); // error file
    expect(result.totals.passed).toBe(1); // ok file
  });

  it('includes startedAt ISO timestamp', async () => {
    const raw = JSON.stringify({ ok: true, value: makeRunReport() });
    const conn = makeFakeConnection({
      'Runtime.evaluate': { result: { type: 'string', value: raw } },
    });
    const result = await runTestFilesOverRelay(conn, ['/t.ts']);
    expect(result.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('runs zero files and returns empty totals', async () => {
    const conn = makeFakeConnection();
    const result = await runTestFilesOverRelay(conn, []);
    expect(result.files).toHaveLength(0);
    expect(result.totals.total).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* collectCaptures: live console listener → parseCaptureLines seam            */
/* -------------------------------------------------------------------------- */

/** A console.log event whose args render to `text` when space-joined. */
function consoleEvent(...args: string[]): ConsoleApiCalledEvent {
  return {
    type: 'log',
    timestamp: 0,
    args: args.map((value) => ({ type: 'string', value })),
  };
}

/**
 * Fake connection that stores the `Runtime.consoleAPICalled` listener so a test
 * can fire console events into the live-capture seam, and records whether the
 * listener was unsubscribed. The events to fire are supplied up front and are
 * flushed synchronously from inside the `Runtime.evaluate` send — by then the
 * run has already registered the listener (it registers before the file loop),
 * so there is no microtask-ordering fragility.
 */
function makeCapturingConnection(opts: { raw: string; fireOnEvaluate?: ConsoleApiCalledEvent[] }): {
  conn: CdpConnection;
  isSubscribed: () => boolean;
  fireConsole: (event: ConsoleApiCalledEvent) => void;
} {
  let listener: ((payload: ConsoleApiCalledEvent) => void) | undefined;
  const base = makeFakeConnection();
  const conn: CdpConnection = {
    ...base,
    on: (<E extends CdpEventName>(
      event: E,
      cb: (payload: CdpEventMap[E]) => void,
    ): (() => void) => {
      if (event === 'Runtime.consoleAPICalled') {
        listener = cb as unknown as (payload: ConsoleApiCalledEvent) => void;
      }
      return () => {
        listener = undefined;
      };
    }) as CdpConnection['on'],
    send: (<M extends CdpCommandName>(
      method: M,
      _params?: CdpCommandMap[M]['params'],
    ): Promise<CdpCommandMap[M]['result']> => {
      if (method === 'Runtime.evaluate') {
        // The listener is live by now — flush the canned console events into it.
        for (const ev of opts.fireOnEvaluate ?? []) listener?.(ev);
        return Promise.resolve({
          result: { type: 'string', value: opts.raw },
        } as unknown as CdpCommandMap[M]['result']);
      }
      return Promise.reject(new Error(`FakeCdpConnection: no canned result for ${method}`));
    }) as CdpConnection['send'],
  };
  return {
    conn,
    isSubscribed: () => listener !== undefined,
    fireConsole: (event) => listener?.(event),
  };
}

describe('runTestFilesOverRelay collectCaptures', () => {
  const RAW = JSON.stringify({ ok: true, value: makeRunReport() });

  it('harvests __AIT_CAPTURE__ lines fired during the run, dropping noise', async () => {
    const cap = makeCapturingConnection({
      raw: RAW,
      fireOnEvaluate: [
        consoleEvent('__AIT_CAPTURE__', 'clipboard', '[{"op":"writeText"}]'),
        consoleEvent('a regular log line'), // noise → dropped
        consoleEvent('relay wss://FAKE.example/x'), // wss noise → dropped
        consoleEvent('__AIT_CAPTURE__', 'storage', '[1,2]'),
      ],
    });

    const result = await runTestFilesOverRelay(cap.conn, ['/t.ts'], { collectCaptures: true });

    expect(result.captures).toEqual([
      { category: 'clipboard', json: '[{"op":"writeText"}]' },
      { category: 'storage', json: '[1,2]' },
    ]);
    // No fake secret survived into the captures.
    expect(JSON.stringify(result.captures)).not.toContain('wss://');
  });

  it('returns empty captures when collectCaptures is not set (default false)', async () => {
    const cap = makeCapturingConnection({
      raw: RAW,
      fireOnEvaluate: [consoleEvent('__AIT_CAPTURE__', 'clipboard', '[1]')],
    });

    const result = await runTestFilesOverRelay(cap.conn, ['/t.ts']);

    expect(result.captures).toEqual([]);
    // The listener was never registered → the fired event went nowhere.
    expect(cap.isSubscribed()).toBe(false);
  });

  it('unsubscribes the listener after the run (post-run events are not captured)', async () => {
    const cap = makeCapturingConnection({ raw: RAW });

    const result = await runTestFilesOverRelay(cap.conn, ['/t.ts'], { collectCaptures: true });

    // The finally block removed the listener.
    expect(cap.isSubscribed()).toBe(false);
    // Firing after the run does nothing and cannot retroactively add captures.
    cap.fireConsole(consoleEvent('__AIT_CAPTURE__', 'late', '[1]'));
    expect(result.captures).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* flattenResults                                                              */
/* -------------------------------------------------------------------------- */

describe('flattenResults', () => {
  it('flattens passing tests across files', async () => {
    const raw = JSON.stringify({ ok: true, value: makeRunReport() });
    const conn = makeFakeConnection({
      'Runtime.evaluate': { result: { type: 'string', value: raw } },
    });
    const report = await runTestFilesOverRelay(conn, ['/a.ts']);
    const flat = flattenResults(report);
    expect(flat).toHaveLength(2);
    expect(flat[0].file).toBe('/a.ts');
    expect(flat[0].name).toBe('test A');
  });

  it('produces a synthetic failed entry for error files', () => {
    const report = {
      startedAt: 'now',
      duration: 0,
      files: [{ file: '/bad.ts', result: { error: 'boom' } }],
      totals: { passed: 0, failed: 1, skipped: 0, total: 1 },
      captures: [],
    };
    const flat = flattenResults(report);
    expect(flat).toHaveLength(1);
    expect(flat[0].status).toBe('fail');
    expect(flat[0].name).toBe('<bundle/inject error>');
    expect(flat[0].error).toBe('boom');
  });
});
