/**
 * Tests for the `run_tests` MCP tool (devtools#646).
 *
 * Drives the tool through the full MCP request/response path
 * (InMemoryTransport + Client → createDebugServer dispatch) with a fake
 * CdpConnection returning a canned `Runtime.evaluate` RunReport. `bundleTestFile`
 * is mocked at the module level so esbuild is not required in the test env
 * (mirrors src/__tests__/test-runner-relay-worker.test.ts).
 *
 * Real-device relay (real WebKit engine) is manual QA per #646; this covers the
 * mock-SDK / local path through a fake connection.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AitMethodMap, AitMethodName, AitSource } from '../ait-source.js';
import type {
  CdpCommandMap,
  CdpCommandName,
  CdpConnection,
  CdpEventMap,
  CdpEventName,
  CdpTarget,
} from '../cdp-connection.js';
import { createDebugServer } from '../debug-server.js';
import { type McpEnvironment, setLiveIntent } from '../environment.js';
import type { TunnelStatus } from '../tools.js';

// Mock bundleTestFile so esbuild is not needed (same as test-runner-relay-worker).
vi.mock('../../test-runner/bundle.js', () => ({
  bundleTestFile: vi.fn(async () => ({ code: '/* mocked bundle */', warnings: [] })),
}));

// Spy on the run core + discovery while delegating to the real implementations,
// so boundary tests can assert the exact `timeoutMs` / `cwd` the handler passes
// (the canned report is identical regardless, so "no error" alone is too weak).
const runWithConnectionSpy = vi.fn();
vi.mock('../../test-runner/cli.js', async (importActual) => {
  const actual = await importActual<typeof import('../../test-runner/cli.js')>();
  return {
    ...actual,
    runWithConnection: (...args: Parameters<typeof actual.runWithConnection>) => {
      runWithConnectionSpy(...args);
      return actual.runWithConnection(...args);
    },
  };
});

const discoverTestFilesSpy = vi.fn();
vi.mock('../../test-runner/discover.js', async (importActual) => {
  const actual = await importActual<typeof import('../../test-runner/discover.js')>();
  return {
    ...actual,
    discoverTestFiles: (...args: Parameters<typeof actual.discoverTestFiles>) => {
      discoverTestFilesSpy(...args);
      return actual.discoverTestFiles(...args);
    },
  };
});

/* -------------------------------------------------------------------------- */
/* Fakes                                                                       */
/* -------------------------------------------------------------------------- */

const ONE_TARGET: CdpTarget = {
  id: 't1',
  title: 'fixture',
  url: 'http://localhost/',
};

/** A relay-kind fake whose `Runtime.evaluate` returns `raw` (a JSON RunReport envelope). */
class FakeCdpConnection implements CdpConnection {
  readonly kind: 'relay' | 'local';
  private readonly raw: string | undefined;
  private readonly targets: CdpTarget[];

  constructor(opts: { kind?: 'relay' | 'local'; raw?: string; targets?: CdpTarget[] } = {}) {
    this.kind = opts.kind ?? 'relay';
    this.raw = opts.raw;
    this.targets = opts.targets ?? [ONE_TARGET];
  }

  enableDomains(): Promise<void> {
    return Promise.resolve();
  }
  listTargets(): CdpTarget[] {
    return this.targets;
  }
  getBufferedEvents<E extends CdpEventName>(_event: E): ReadonlyArray<CdpEventMap[E]> {
    return [];
  }
  on<E extends CdpEventName>(_event: E, _listener: (payload: CdpEventMap[E]) => void): () => void {
    return () => {};
  }
  send<M extends CdpCommandName>(
    _method: M,
    _params?: CdpCommandMap[M]['params'],
  ): Promise<CdpCommandMap[M]['result']> {
    if (this.raw === undefined) {
      return Promise.reject(new Error('FakeCdpConnection: no canned result'));
    }
    return Promise.resolve({
      result: { type: 'string', value: this.raw },
    } as CdpCommandMap[M]['result']);
  }
}

class FakeAitSource implements AitSource {
  get<M extends AitMethodName>(_method: M): Promise<AitMethodMap[M]> {
    return Promise.reject(new Error('no canned AIT response'));
  }
}

function cannedRunReport(): string {
  return JSON.stringify({
    ok: true,
    value: {
      startedAt: '2024-01-01T00:00:00.000Z',
      duration: 12,
      passed: 1,
      failed: 0,
      skipped: 0,
      tests: [{ name: 'grp > works', status: 'pass', duration: 12 }],
    },
  });
}

const tunnelUp: TunnelStatus = { up: true, wssUrl: 'wss://abc123.trycloudflare.com' };

async function makeClient(opts: {
  connection: CdpConnection;
  env?: McpEnvironment;
}): Promise<Client> {
  // The LIVE guard reads the module-level liveIntent bit (race fix #354), not
  // the injected env — arm it to match the env under test. Reset in afterEach.
  setLiveIntent((opts.env ?? 'relay-dev') === 'relay-live');
  const server = createDebugServer({
    connection: opts.connection,
    aitSource: new FakeAitSource(),
    getTunnelStatus: () => tunnelUp,
    getEnvironment: () => opts.env ?? 'relay-dev',
    getEnvironmentReason: () => `test-pinned-${opts.env ?? 'relay-dev'}`,
    totpSecret: 'cafebabe'.repeat(8),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

function getText(result: Awaited<ReturnType<Client['callTool']>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  return content.map((c) => c.text ?? '').join('\n');
}

/** Parses the {ok,data,meta} envelope text and returns `data`. */
function getEnvelopeData(text: string): Record<string, unknown> {
  const parsed = JSON.parse(text);
  return (parsed.data ?? parsed) as Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* Temp project with a matching test file                                      */
/* -------------------------------------------------------------------------- */

let projectRoot: string;

beforeAll(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), 'ait-run-tests-'));
  await writeFile(join(projectRoot, 'sample.phone.test.ts'), '');
});

afterAll(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

// Reset the module-level liveIntent bit so it never leaks across tests/files,
// and clear the run-core / discovery spies' captured calls.
afterEach(() => {
  setLiveIntent(false);
  runWithConnectionSpy.mockClear();
  discoverTestFilesSpy.mockClear();
});

/* -------------------------------------------------------------------------- */
/* Tests                                                                       */
/* -------------------------------------------------------------------------- */

describe('run_tests tool', () => {
  it('runs a matched file and reports totals + per-file results', async () => {
    const conn = new FakeCdpConnection({ raw: cannedRunReport() });
    const client = await makeClient({ connection: conn });

    const result = await client.callTool({
      name: 'run_tests',
      arguments: { files: ['*.phone.test.ts'], projectRoot },
    });

    expect(result.isError).toBeFalsy();
    const data = getEnvelopeData(getText(result));
    expect(data.totals).toEqual({ passed: 1, failed: 0, skipped: 0, total: 1 });
    const files = data.files as Array<Record<string, unknown>>;
    expect(files).toHaveLength(1);
    expect(String(files[0].file)).toContain('sample.phone.test.ts');
    expect(files[0].passed).toBe(1);
    // Per-file wall-clock from the in-page RunReport is surfaced (regression
    // guard: toRunTestsResult once dropped it).
    expect(files[0].duration).toBe(12);
    const tests = files[0].tests as Array<Record<string, unknown>>;
    expect(tests[0].name).toBe('grp > works');
  });

  it('returns an error when files is empty', async () => {
    const conn = new FakeCdpConnection({ raw: cannedRunReport() });
    const client = await makeClient({ connection: conn });

    const result = await client.callTool({
      name: 'run_tests',
      arguments: { files: [] },
    });

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('files 인자가 비어');
  });

  it('returns an error when no test file matches', async () => {
    const conn = new FakeCdpConnection({ raw: cannedRunReport() });
    const client = await makeClient({ connection: conn });

    const result = await client.callTool({
      name: 'run_tests',
      arguments: { files: ['*.nomatch.test.ts'], projectRoot },
    });

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('매칭된 테스트 파일이 없습니다');
  });

  it('returns pageMissingError when no target is attached (fail-fast)', async () => {
    const conn = new FakeCdpConnection({ raw: cannedRunReport(), targets: [] });
    const client = await makeClient({ connection: conn });

    const result = await client.callTool({
      name: 'run_tests',
      arguments: { files: ['*.phone.test.ts'], projectRoot },
    });

    expect(result.isError).toBe(true);
    // pageMissingError / classifyEnableDomainError style hint — re-attach guidance.
    expect(getText(result).length).toBeGreaterThan(0);
  });

  it('blocks on relay-live without confirm (LIVE guard)', async () => {
    const conn = new FakeCdpConnection({ raw: cannedRunReport() });
    const client = await makeClient({ connection: conn, env: 'relay-live' });

    const result = await client.callTool({
      name: 'run_tests',
      arguments: { files: ['*.phone.test.ts'], projectRoot },
    });

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('LIVE relay guard');
  });

  it('runs on relay-live when confirm: true', async () => {
    const conn = new FakeCdpConnection({ raw: cannedRunReport() });
    const client = await makeClient({ connection: conn, env: 'relay-live' });

    const result = await client.callTool({
      name: 'run_tests',
      arguments: { files: ['*.phone.test.ts'], projectRoot, confirm: true },
    });

    expect(result.isError).toBeFalsy();
    const data = getEnvelopeData(getText(result));
    expect((data.totals as Record<string, unknown>).passed).toBe(1);
  });

  it('clamps an out-of-range timeout to the default (no error)', async () => {
    const conn = new FakeCdpConnection({ raw: cannedRunReport() });
    const client = await makeClient({ connection: conn });

    const result = await client.callTool({
      name: 'run_tests',
      arguments: { files: ['*.phone.test.ts'], projectRoot, timeout_ms: 999_999_999 },
    });

    expect(result.isError).toBeFalsy();
  });

  // Boundary table for the 1000–600000 clamp: in-range values are forwarded
  // verbatim; out-of-range/invalid fall back to undefined (relay-worker default).
  // `timeoutMs` is the 3rd arg of runWithConnection (conn, files, { timeoutMs }).
  it.each([
    { timeout_ms: 999, expected: undefined, why: 'below min → default' },
    { timeout_ms: 1000, expected: 1000, why: 'min boundary → forwarded' },
    { timeout_ms: 600_000, expected: 600_000, why: 'max boundary → forwarded' },
    { timeout_ms: 600_001, expected: undefined, why: 'above max → default' },
    { timeout_ms: 'nope' as unknown as number, expected: undefined, why: 'non-number → default' },
  ])('timeout boundary: $timeout_ms ($why)', async ({ timeout_ms, expected }) => {
    const conn = new FakeCdpConnection({ raw: cannedRunReport() });
    const client = await makeClient({ connection: conn });

    const result = await client.callTool({
      name: 'run_tests',
      arguments: { files: ['*.phone.test.ts'], projectRoot, timeout_ms },
    });

    expect(result.isError).toBeFalsy();
    expect(runWithConnectionSpy).toHaveBeenCalledTimes(1);
    const opts = runWithConnectionSpy.mock.calls[0]?.[2] as { timeoutMs?: number };
    expect(opts.timeoutMs).toBe(expected);
  });

  it('falls back to process.cwd() as the glob base when projectRoot is omitted', async () => {
    const conn = new FakeCdpConnection({ raw: cannedRunReport() });
    const client = await makeClient({ connection: conn });

    // No projectRoot → no match in cwd (fine), but discovery must be called
    // with process.cwd() as its base.
    await client.callTool({
      name: 'run_tests',
      arguments: { files: ['*.no-such-file.phone.test.ts'] },
    });

    expect(discoverTestFilesSpy).toHaveBeenCalledTimes(1);
    expect(discoverTestFilesSpy.mock.calls[0]?.[1]).toBe(process.cwd());
  });

  it('releases the in-flight lock after an erroring run (next run is not blocked)', async () => {
    // First run errors per-file (no canned raw → send() rejects). The finally
    // block must still release runTestsInFlight so a second run proceeds rather
    // than hitting the "already in progress" guard.
    const conn = new FakeCdpConnection({ targets: [ONE_TARGET] });
    const client = await makeClient({ connection: conn });

    const first = await client.callTool({
      name: 'run_tests',
      arguments: { files: ['*.phone.test.ts'], projectRoot },
    });
    expect(first.isError).toBeFalsy(); // run returns with the file marked failed

    const second = await client.callTool({
      name: 'run_tests',
      arguments: { files: ['*.phone.test.ts'], projectRoot },
    });
    // Must NOT be the concurrency rejection — the lock was released.
    expect(getText(second)).not.toContain('이미 다른 테스트 실행이 진행 중');
  });

  it('LIVE guard is exempt for a local-kind connection even with liveIntent armed', async () => {
    // The guard is `conn.kind === 'relay' && getLiveIntent() && !confirm`. A
    // local-kind connection is never blocked, so a local session with the
    // liveIntent bit set must still run without confirm (kind-check exemption).
    const conn = new FakeCdpConnection({ kind: 'local', raw: cannedRunReport() });
    const client = await makeClient({ connection: conn, env: 'relay-live' }); // arms liveIntent

    const result = await client.callTool({
      name: 'run_tests',
      arguments: { files: ['*.phone.test.ts'], projectRoot },
    });

    expect(result.isError).toBeFalsy();
    const data = getEnvelopeData(getText(result));
    expect((data.totals as Record<string, unknown>).passed).toBe(1);
  });

  it('does not leak the bundle code or relay URL in the result', async () => {
    const conn = new FakeCdpConnection({ raw: cannedRunReport() });
    const client = await makeClient({ connection: conn });

    const result = await client.callTool({
      name: 'run_tests',
      arguments: { files: ['*.phone.test.ts'], projectRoot },
    });

    const text = getText(result);
    expect(text).not.toContain('mocked bundle');
    expect(text).not.toContain('wss://');
    expect(text).not.toContain('trycloudflare');
  });

  it('rejects a concurrent run_tests (single-attach guard)', async () => {
    // A connection whose Runtime.evaluate resolves only after a tick, so two
    // concurrent calls overlap and the second hits the in-flight guard.
    const raw = cannedRunReport();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const slowConn: CdpConnection = {
      kind: 'relay',
      enableDomains: () => Promise.resolve(),
      listTargets: () => [ONE_TARGET],
      getBufferedEvents: <E extends CdpEventName>(_e: E): ReadonlyArray<CdpEventMap[E]> => [],
      on:
        <E extends CdpEventName>(_e: E, _l: (p: CdpEventMap[E]) => void): (() => void) =>
        () => {},
      send: async <M extends CdpCommandName>(): Promise<CdpCommandMap[M]['result']> => {
        await gate;
        return { result: { type: 'string', value: raw } } as CdpCommandMap[M]['result'];
      },
    };
    const client = await makeClient({ connection: slowConn });

    const first = client.callTool({
      name: 'run_tests',
      arguments: { files: ['*.phone.test.ts'], projectRoot },
    });
    // Give the first call time to claim the in-flight lock before the second.
    await new Promise((r) => setTimeout(r, 20));
    const second = client.callTool({
      name: 'run_tests',
      arguments: { files: ['*.phone.test.ts'], projectRoot },
    });

    const secondResult = await second;
    expect(secondResult.isError).toBe(true);
    expect(getText(secondResult)).toContain('이미 다른 테스트 실행이 진행 중');

    release?.();
    const firstResult = await first;
    expect(firstResult.isError).toBeFalsy();
  });

  it('fires two run_tests with NO delay — exactly one succeeds (TOCTOU)', async () => {
    // Regression for the TOCTOU race: the in-flight flag must be claimed
    // synchronously before the first `await` (discoverTestFiles). Firing both
    // with no gap means both pass the entry guard in the same tick if the flag
    // is set late — so exactly one must win and the other must be rejected.
    const conn = new FakeCdpConnection({ raw: cannedRunReport() });
    const client = await makeClient({ connection: conn });

    const args = { name: 'run_tests', arguments: { files: ['*.phone.test.ts'], projectRoot } };
    const [a, b] = await Promise.all([client.callTool(args), client.callTool(args)]);

    const results = [a, b];
    const rejected = results.filter(
      (r) => r.isError && getText(r).includes('이미 다른 테스트 실행이 진행 중'),
    );
    const succeeded = results.filter((r) => !r.isError);
    expect(rejected).toHaveLength(1);
    expect(succeeded).toHaveLength(1);
  });

  it('surfaces a relay failure as an error (whole-run)', async () => {
    // No canned raw → send() rejects → relay-worker captures it per-file.
    const conn = new FakeCdpConnection({ targets: [ONE_TARGET] });
    const client = await makeClient({ connection: conn });

    const result = await client.callTool({
      name: 'run_tests',
      arguments: { files: ['*.phone.test.ts'], projectRoot },
    });

    // relay-worker records the per-file error; the run still returns (not isError)
    // with the file marked failed — the per-file results array is the progress record.
    expect(result.isError).toBeFalsy();
    const data = getEnvelopeData(getText(result));
    expect((data.totals as Record<string, unknown>).failed).toBe(1);
    const files = data.files as Array<Record<string, unknown>>;
    expect(typeof files[0].error).toBe('string');
    // The error string must not carry a secret.
    expect(String(files[0].error)).not.toContain('wss://');
  });
});
