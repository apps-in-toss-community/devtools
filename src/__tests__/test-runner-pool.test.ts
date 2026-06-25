/**
 * Unit tests for the Vitest relay custom pool (devtools#645).
 *
 * Exercises the in-process PoolWorker lifecycle and result reporting with a
 * fake CdpConnection, a fake connection factory, and a stub TestProject/state.
 * No phone or relay needed.
 *
 * `bundleTestFile` is mocked so esbuild is not required in the test env.
 */

import type { File, TaskResultPack } from '@vitest/runner';
import { describe, expect, it, vi } from 'vitest';
import type { PoolOptions, TestProject, WorkerRequest } from 'vitest/node';
import type {
  CdpCommandMap,
  CdpCommandName,
  CdpConnection,
  CdpEventMap,
  CdpEventName,
  CdpTarget,
} from '../mcp/cdp-connection.js';
import type { RelayConnectionFactory } from '../test-runner/pool.js';
import { createRelayPool, RELAY_POOL_NAME } from '../test-runner/pool.js';
import type { RunReport } from '../test-runner/runtime.js';

vi.mock('../test-runner/bundle.js', () => ({
  bundleTestFile: vi.fn(async () => ({ code: '/* mocked bundle */', warnings: [] })),
}));

/* -------------------------------------------------------------------------- */
/* Fakes                                                                       */
/* -------------------------------------------------------------------------- */

function makeFakeConnection(report: RunReport): CdpConnection {
  const raw = JSON.stringify({ ok: true, value: report });
  return {
    kind: 'relay' as const,
    enableDomains: () => Promise.resolve(),
    listTargets: (): CdpTarget[] => [],
    getBufferedEvents: <E extends CdpEventName>(_e: E): ReadonlyArray<CdpEventMap[E]> => [],
    on:
      <E extends CdpEventName>(_e: E, _l: (p: CdpEventMap[E]) => void): (() => void) =>
      () => {},
    send: <M extends CdpCommandName>(
      _method: M,
      _params?: CdpCommandMap[M]['params'],
    ): Promise<CdpCommandMap[M]['result']> =>
      Promise.resolve({ result: { type: 'string', value: raw } } as CdpCommandMap[M]['result']),
  };
}

interface StateCalls {
  collectFiles: File[][];
  updateTasks: TaskResultPack[][];
}

function makeFakeProject(calls: StateCalls): TestProject {
  const state = {
    collectFiles: (_project: TestProject, files?: File[]) => {
      if (files) calls.collectFiles.push(files);
    },
    updateTasks: (packs: TaskResultPack[]) => {
      calls.updateTasks.push(packs);
    },
  };
  // Only the fields the pool reads are present (name/config.root/vitest.state);
  // cast via `unknown` at this single boundary.
  return {
    name: 'fake-proj',
    config: { root: '/project' },
    vitest: { state },
  } as unknown as TestProject;
}

function makePoolOptions(project: TestProject): PoolOptions {
  // The pool only reads options.project; cast via `unknown`.
  return { project } as unknown as PoolOptions;
}

function makeFactory(conn: CdpConnection): RelayConnectionFactory & {
  opened: number;
  closed: number;
} {
  const f = {
    opened: 0,
    closed: 0,
    open: async () => {
      f.opened++;
      return conn;
    },
    close: async (_c: CdpConnection) => {
      f.closed++;
    },
  };
  return f;
}

function passReport(): RunReport {
  return {
    startedAt: '2024-01-01T00:00:00.000Z',
    duration: 5,
    passed: 1,
    failed: 0,
    skipped: 0,
    tests: [{ name: 'grp > works', status: 'pass', duration: 5 }],
  };
}

/** Drives a worker through send() and resolves with the emitted message. */
function sendAndAwait(
  worker: ReturnType<ReturnType<typeof createRelayPool>['createPoolWorker']>,
  // Tests build minimal messages; the worker only reads `type` and (for run)
  // `context.files`, so an unknown shape cast at send() is sufficient.
  message: unknown,
): Promise<{ type: string; error?: unknown }> {
  return new Promise((resolve) => {
    const onMessage = (msg: unknown) => {
      worker.off('message', onMessage);
      resolve(msg as { type: string; error?: unknown });
    };
    worker.on('message', onMessage);
    worker.send(message as WorkerRequest);
  });
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                       */
/* -------------------------------------------------------------------------- */

describe('createRelayPool', () => {
  it('exposes the relay pool name and a createPoolWorker factory', () => {
    const conn = makeFakeConnection(passReport());
    const pool = createRelayPool({ connection: makeFactory(conn) });
    expect(pool.name).toBe(RELAY_POOL_NAME);
    expect(typeof pool.createPoolWorker).toBe('function');
  });

  it('start → started, stop → stopped', async () => {
    const calls: StateCalls = { collectFiles: [], updateTasks: [] };
    const conn = makeFakeConnection(passReport());
    const pool = createRelayPool({ connection: makeFactory(conn) });
    const worker = pool.createPoolWorker(makePoolOptions(makeFakeProject(calls)));

    const started = await sendAndAwait(worker, { __vitest_worker_request__: true, type: 'start' });
    expect(started.type).toBe('started');

    const stopped = await sendAndAwait(worker, { __vitest_worker_request__: true, type: 'stop' });
    expect(stopped.type).toBe('stopped');
  });

  it('run → reports the task graph through state and emits testfileFinished', async () => {
    const calls: StateCalls = { collectFiles: [], updateTasks: [] };
    const conn = makeFakeConnection(passReport());
    const pool = createRelayPool({ connection: makeFactory(conn) });
    const worker = pool.createPoolWorker(makePoolOptions(makeFakeProject(calls)));

    const res = await sendAndAwait(worker, {
      __vitest_worker_request__: true,
      type: 'run',
      context: { files: [{ filepath: '/project/foo.phone.test.ts' }] },
    });

    expect(res.type).toBe('testfileFinished');
    expect(res.error).toBeUndefined();
    // The file's task graph was reported.
    expect(calls.collectFiles).toHaveLength(1);
    expect(calls.collectFiles[0][0].filepath).toBe('/project/foo.phone.test.ts');
    expect(calls.updateTasks).toHaveLength(1);
    // file + suite 'grp' + test 'works'
    expect(calls.updateTasks[0]).toHaveLength(3);
  });

  it('opens the relay connection lazily (only on first run) and closes on stop', async () => {
    const calls: StateCalls = { collectFiles: [], updateTasks: [] };
    const conn = makeFakeConnection(passReport());
    const factory = makeFactory(conn);
    const pool = createRelayPool({ connection: factory });
    const worker = pool.createPoolWorker(makePoolOptions(makeFakeProject(calls)));

    await sendAndAwait(worker, { __vitest_worker_request__: true, type: 'start' });
    expect(factory.opened).toBe(0); // start does not touch the device

    await sendAndAwait(worker, {
      __vitest_worker_request__: true,
      type: 'run',
      context: { files: [{ filepath: '/project/a.phone.test.ts' }] },
    });
    expect(factory.opened).toBe(1);

    // The `stop` message acknowledges; the actual connection teardown is the
    // worker's `stop()` lifecycle method (called by the core's pool driver).
    const stopped = await sendAndAwait(worker, { __vitest_worker_request__: true, type: 'stop' });
    expect(stopped.type).toBe('stopped');
    await worker.stop();
    expect(factory.closed).toBe(1);
  });

  it('reuses a single connection across multiple run requests (single-attach)', async () => {
    const calls: StateCalls = { collectFiles: [], updateTasks: [] };
    const conn = makeFakeConnection(passReport());
    const factory = makeFactory(conn);
    const pool = createRelayPool({ connection: factory });
    const worker = pool.createPoolWorker(makePoolOptions(makeFakeProject(calls)));

    await sendAndAwait(worker, {
      __vitest_worker_request__: true,
      type: 'run',
      context: { files: [{ filepath: '/project/a.phone.test.ts' }] },
    });
    await sendAndAwait(worker, {
      __vitest_worker_request__: true,
      type: 'run',
      context: { files: [{ filepath: '/project/b.phone.test.ts' }] },
    });
    expect(factory.opened).toBe(1); // not re-attached per run
    expect(calls.collectFiles).toHaveLength(2);
  });

  it('surfaces a relay-open failure as the testfileFinished error', async () => {
    const calls: StateCalls = { collectFiles: [], updateTasks: [] };
    const failingFactory: RelayConnectionFactory = {
      open: async () => {
        throw new Error('relay unreachable');
      },
      close: async () => {},
    };
    const pool = createRelayPool({ connection: failingFactory });
    const worker = pool.createPoolWorker(makePoolOptions(makeFakeProject(calls)));

    const res = await sendAndAwait(worker, {
      __vitest_worker_request__: true,
      type: 'run',
      context: { files: [{ filepath: '/project/a.phone.test.ts' }] },
    });
    expect(res.type).toBe('testfileFinished');
    expect(res.error).toBeInstanceOf(Error);
    expect((res.error as Error).message).toContain('relay unreachable');
  });
});
