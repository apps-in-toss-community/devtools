/**
 * Tests for the `get_diagnostics` MCP tool (#286).
 *
 * Exercises:
 *   - Full response schema (all nullable fields present)
 *   - Bootstrap tier: available before any page attaches
 *   - Tier C: available in both mock and relay envs
 *   - recent_errors_limit parameter
 *   - redactErrorMessage: secrets never appear in output
 *   - InMemoryDiagnosticsCollector: recordError / getRecentErrors / attach-detach
 *   - getDiagnostics helper: lock holder, pages, env fields
 *   - Envelope (#306): MCP tool results are wrapped in ToolEnvelope by default
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
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
import type { McpEnvironment } from '../environment.js';
import {
  computeNextRecommendedAction,
  type DiagnosticsCollector,
  getDiagnostics,
  InMemoryDiagnosticsCollector,
  readDevtoolsVersion,
  readMcpSdkVersion,
  redactErrorMessage,
  type TunnelStatus,
} from '../tools.js';

// ---- Minimal fakes ----------------------------------------------------------

class FakeCdpConnection implements CdpConnection {
  /** Test fake — relay-kind (issue #348); env is injected so the value is inert here. */
  readonly kind = 'relay' as const;

  private _targets: CdpTarget[];

  constructor(targets: CdpTarget[] = []) {
    this._targets = targets;
  }

  setTargets(t: CdpTarget[]): void {
    this._targets = t;
  }

  enableDomains(): Promise<void> {
    return Promise.resolve();
  }
  listTargets(): CdpTarget[] {
    return this._targets;
  }
  getBufferedEvents<E extends CdpEventName>(_e: E): ReadonlyArray<CdpEventMap[E]> {
    return [];
  }
  on(): () => void {
    return () => {};
  }
  send<M extends CdpCommandName>(_m: M): Promise<CdpCommandMap[M]['result']> {
    return Promise.reject(new Error('no canned result'));
  }
  close(): void {}
}

class FakeAitSource implements AitSource {
  get<M extends AitMethodName>(_m: M): Promise<AitMethodMap[M]> {
    return Promise.reject(new Error('no canned AIT response'));
  }
}

/** Null-object DiagnosticsCollector for tests that don't care about diagnostics. */
class NoopCollector implements DiagnosticsCollector {
  recordError(_msg: string, _cat?: string): void {}
  getRecentErrors(_limit: number): import('../tools.js').DiagnosticsError[] {
    return [];
  }
  recordAttach(): void {}
  recordDetach(): void {}
  getLastAttachAt(): string | null {
    return null;
  }
  getLastDetachAt(): string | null {
    return null;
  }
}

async function makeClient(opts: {
  connection?: FakeCdpConnection;
  env?: McpEnvironment;
  tunnelStatus?: TunnelStatus;
  diagnosticsCollector?: DiagnosticsCollector;
}): Promise<Client> {
  const {
    connection = new FakeCdpConnection(),
    env = 'mock',
    tunnelStatus = { up: false, wssUrl: null },
    diagnosticsCollector = new NoopCollector(),
  } = opts;

  const server = createDebugServer({
    connection,
    aitSource: new FakeAitSource(),
    getTunnelStatus: () => tunnelStatus,
    getEnvironment: () => env,
    getEnvironmentReason: () => `test-pinned-${env}`,
    diagnosticsCollector,
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

function parseResult(result: Awaited<ReturnType<Client['callTool']>>): unknown {
  const content = result.content as Array<{ type: string; text?: string }>;
  const raw = JSON.parse(content[0]!.text!);
  // When the envelope is active (AIT_MCP_COMPAT !== 'chrome-devtools') the
  // result is wrapped: { ok: true, data: <payload>, meta: { … } }.
  // Return data.data so tests assert on the actual diagnostics payload.
  if (typeof raw === 'object' && raw !== null && 'ok' in raw && 'data' in raw && 'meta' in raw) {
    return (raw as Record<string, unknown>).data;
  }
  return raw;
}

// ---- redactErrorMessage -----------------------------------------------------

describe('redactErrorMessage', () => {
  it('redacts at= TOTP code values', () => {
    expect(redactErrorMessage('login?at=123456&foo=bar')).toBe('login?at=<redacted>&foo=bar');
  });

  it('redacts cookie headers (case-insensitive)', () => {
    // The pattern preserves the original "cookie" / "set-cookie" prefix casing.
    expect(redactErrorMessage('Cookie: session=abc123')).toBe('Cookie: <redacted>');
    expect(redactErrorMessage('set-cookie: token=xyz')).toBe('set-cookie: <redacted>');
  });

  it('redacts AITCC_API_KEY', () => {
    expect(redactErrorMessage('AITCC_API_KEY=sk-abc123')).toBe('AITCC_API_KEY=<redacted>');
  });

  it('redacts Authorization header values', () => {
    expect(redactErrorMessage('Authorization: Bearer eyJhbGc...')).toBe(
      'Authorization: <redacted>',
    );
  });

  it('redacts bare Bearer tokens', () => {
    // "Bearer <token>" as a standalone pattern (not preceded by "Authorization:").
    expect(redactErrorMessage('got Bearer eyJhbGc123')).toBe('got Bearer <redacted>');
  });

  it('passes through safe messages unchanged', () => {
    const safe = 'CDP connection timeout after 5000ms';
    expect(redactErrorMessage(safe)).toBe(safe);
  });
});

// ---- InMemoryDiagnosticsCollector -------------------------------------------

describe('InMemoryDiagnosticsCollector', () => {
  it('stores errors and returns them oldest-first', () => {
    const c = new InMemoryDiagnosticsCollector();
    c.recordError('err1', 'cdp');
    c.recordError('err2');
    const errors = c.getRecentErrors(10);
    expect(errors).toHaveLength(2);
    expect(errors[0]!.message).toBe('err1');
    expect(errors[0]!.category).toBe('cdp');
    expect(errors[1]!.message).toBe('err2');
    expect(errors[1]!.category).toBeUndefined();
  });

  it('respects the limit parameter', () => {
    const c = new InMemoryDiagnosticsCollector();
    for (let i = 0; i < 15; i++) c.recordError(`err${i}`);
    const recent = c.getRecentErrors(5);
    expect(recent).toHaveLength(5);
    expect(recent[0]!.message).toBe('err10');
    expect(recent[4]!.message).toBe('err14');
  });

  it('evicts oldest entries when the buffer is full (default 50)', () => {
    const c = new InMemoryDiagnosticsCollector();
    for (let i = 0; i < 55; i++) c.recordError(`err${i}`);
    const all = c.getRecentErrors(50);
    expect(all).toHaveLength(50);
    expect(all[0]!.message).toBe('err5');
  });

  it('redacts secrets in recorded error messages', () => {
    const c = new InMemoryDiagnosticsCollector();
    c.recordError('failed at=987654 auth');
    const [entry] = c.getRecentErrors(1);
    expect(entry!.message).toBe('failed at=<redacted> auth');
    expect(entry!.message).not.toContain('987654');
  });

  it('tracks attach/detach timestamps', () => {
    const c = new InMemoryDiagnosticsCollector();
    expect(c.getLastAttachAt()).toBeNull();
    expect(c.getLastDetachAt()).toBeNull();
    c.recordAttach();
    expect(c.getLastAttachAt()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    c.recordDetach();
    expect(c.getLastDetachAt()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ---- getDiagnostics helper --------------------------------------------------

describe('getDiagnostics helper', () => {
  const tunnelDown: TunnelStatus = { up: false, wssUrl: null };
  const tunnelUp: TunnelStatus = { up: true, wssUrl: 'wss://abc.trycloudflare.com' };

  it('returns all required fields', async () => {
    const collector = new InMemoryDiagnosticsCollector();
    const result = await getDiagnostics({
      tunnel: tunnelDown,
      env: 'mock',
      envReason: 'default-mock',
      collector,
      readLock: () => null,
    });

    expect(result).toMatchObject({
      tunnel: { up: false, wssUrl: null, pid: null, startedAt: null },
      pages: null, // no connection supplied
      lastAttachAt: null,
      lastDetachAt: null,
      recentErrors: [],
      environment: { kind: 'mock', env: 'mock', reason: 'default-mock', liveGuardActive: false },
      serverLockHolder: null,
    });
    // versions may be null in test env but the fields must exist
    expect('mcpVersion' in result).toBe(true);
    expect('devtoolsVersion' in result).toBe(true);
  });

  it('includes list_pages result when a connection is supplied', async () => {
    const connection = new FakeCdpConnection([
      { id: 'p1', title: 'My App', url: 'https://example.com' },
    ]);
    const result = await getDiagnostics({
      tunnel: tunnelDown,
      connection,
      env: 'relay-dev',
      envReason: 'cdp-target-url-relay-pattern',
      collector: new InMemoryDiagnosticsCollector(),
      readLock: () => null,
    });

    expect(result.pages).not.toBeNull();
    expect(result.pages!.pages).toHaveLength(1);
    expect(result.pages!.pages[0]!.id).toBe('p1');
  });

  it('surfaces lock-holder data from readLock', async () => {
    const lockData = {
      pid: 12345,
      wssUrl: 'wss://xyz.trycloudflare.com',
      startedAt: '2026-01-01T00:00:00.000Z',
    };
    const result = await getDiagnostics({
      tunnel: tunnelUp,
      env: 'relay-dev',
      envReason: 'env-var-relay-dev',
      collector: new InMemoryDiagnosticsCollector(),
      readLock: () => lockData,
    });

    expect(result.serverLockHolder).toEqual(lockData);
    expect(result.tunnel.pid).toBe(12345);
    expect(result.tunnel.startedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('includes recent errors respecting the limit', async () => {
    const collector = new InMemoryDiagnosticsCollector();
    for (let i = 0; i < 20; i++) collector.recordError(`err${i}`);
    const result = await getDiagnostics({
      tunnel: tunnelDown,
      env: 'mock',
      envReason: 'default-mock',
      collector,
      readLock: () => null,
      recentErrorsLimit: 5,
    });

    expect(result.recentErrors).toHaveLength(5);
    // Most recent 5 of 20 — entries are oldest-first within the window.
    expect(result.recentErrors[0]!.message).toBe('err15');
    expect(result.recentErrors[4]!.message).toBe('err19');
  });

  it('surfaces attach/detach timestamps from the collector', async () => {
    const collector = new InMemoryDiagnosticsCollector();
    collector.recordAttach();
    collector.recordDetach();
    const result = await getDiagnostics({
      tunnel: tunnelDown,
      env: 'mock',
      envReason: 'default-mock',
      collector,
      readLock: () => null,
    });

    expect(result.lastAttachAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.lastDetachAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('copies droppedAt and reissueAttempts from TunnelStatus into tunnel info', async () => {
    const droppedTunnel: TunnelStatus = {
      up: false,
      wssUrl: null,
      droppedAt: '2026-06-01T10:00:00.000Z',
      reissueAttempts: 3,
    };
    const result = await getDiagnostics({
      tunnel: droppedTunnel,
      env: 'relay-dev',
      envReason: 'test',
      collector: new InMemoryDiagnosticsCollector(),
      readLock: () => null,
    });
    expect(result.tunnel.droppedAt).toBe('2026-06-01T10:00:00.000Z');
    expect(result.tunnel.reissueAttempts).toBe(3);
  });

  it('sets droppedAt=null and reissueAttempts=0 when TunnelStatus has no drop info', async () => {
    const result = await getDiagnostics({
      tunnel: tunnelDown,
      env: 'mock',
      envReason: 'default-mock',
      collector: new InMemoryDiagnosticsCollector(),
      readLock: () => null,
    });
    expect(result.tunnel.droppedAt).toBeNull();
    expect(result.tunnel.reissueAttempts).toBe(0);
  });

  it('includes process.{pid, ppid, parentAlive} block', async () => {
    const result = await getDiagnostics({
      tunnel: tunnelDown,
      env: 'mock',
      envReason: 'default-mock',
      collector: new InMemoryDiagnosticsCollector(),
      readLock: () => null,
      checkParentAlive: () => true,
    });
    expect(typeof result.process.pid).toBe('number');
    expect(typeof result.process.ppid).toBe('number');
    expect(result.process.parentAlive).toBe(true);
  });

  it('process.parentAlive reflects the injected checkParentAlive result', async () => {
    const resultAlive = await getDiagnostics({
      tunnel: tunnelDown,
      env: 'mock',
      envReason: 'default-mock',
      collector: new InMemoryDiagnosticsCollector(),
      readLock: () => null,
      checkParentAlive: () => true,
    });
    const resultDead = await getDiagnostics({
      tunnel: tunnelDown,
      env: 'mock',
      envReason: 'default-mock',
      collector: new InMemoryDiagnosticsCollector(),
      readLock: () => null,
      checkParentAlive: () => false,
    });
    expect(resultAlive.process.parentAlive).toBe(true);
    expect(resultDead.process.parentAlive).toBe(false);
  });
});

// ---- MCP tool via createDebugServer -----------------------------------------

describe('get_diagnostics MCP tool', () => {
  it('is available before any page attaches (bootstrap tier)', async () => {
    const client = await makeClient({ env: 'mock' });
    const tools = await client.listTools();
    const names = tools.tools.map((t) => t.name);
    expect(names).toContain('get_diagnostics');
  });

  it('is available in mock env', async () => {
    const client = await makeClient({ env: 'mock' });
    const result = await client.callTool({ name: 'get_diagnostics', arguments: {} });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as Record<string, unknown>;
    expect(data.environment).toMatchObject({
      kind: 'mock',
      env: 'mock',
      reason: 'test-pinned-mock',
      liveGuardActive: false,
    });
  });

  it('is available in relay-dev env', async () => {
    const client = await makeClient({ env: 'relay-dev' });
    const result = await client.callTool({ name: 'get_diagnostics', arguments: {} });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as Record<string, unknown>;
    // kind = relay-dev, legacy env = relay (backward-compat), liveGuardActive = false
    expect(data.environment).toMatchObject({
      kind: 'relay-dev',
      env: 'relay',
      reason: 'test-pinned-relay-dev',
      liveGuardActive: false,
    });
  });

  it('is available in relay-live env and sets liveGuardActive', async () => {
    const client = await makeClient({ env: 'relay-live' });
    const result = await client.callTool({ name: 'get_diagnostics', arguments: {} });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as Record<string, unknown>;
    expect(data.environment).toMatchObject({
      kind: 'relay-live',
      env: 'relay',
      liveGuardActive: true,
    });
  });

  it('returns the current tunnel status', async () => {
    const tunnelUp: TunnelStatus = { up: true, wssUrl: 'wss://abc.trycloudflare.com' };
    const client = await makeClient({ env: 'relay-dev', tunnelStatus: tunnelUp });
    const result = await client.callTool({ name: 'get_diagnostics', arguments: {} });
    const data = parseResult(result) as Record<string, unknown>;
    const tunnel = data.tunnel as Record<string, unknown>;
    expect(tunnel.up).toBe(true);
    expect(tunnel.wssUrl).toBe('wss://abc.trycloudflare.com');
  });

  it('recent_errors_limit parameter limits the error list', async () => {
    const collector = new InMemoryDiagnosticsCollector();
    for (let i = 0; i < 20; i++) collector.recordError(`err${i}`);
    const client = await makeClient({ diagnosticsCollector: collector });
    const result = await client.callTool({
      name: 'get_diagnostics',
      arguments: { recent_errors_limit: 3 },
    });
    const data = parseResult(result) as Record<string, unknown>;
    const errors = data.recentErrors as unknown[];
    expect(errors).toHaveLength(3);
  });

  it('response contains no TOTP secrets even when an error was recorded with one', async () => {
    const collector = new InMemoryDiagnosticsCollector();
    collector.recordError('auth failed at=654321 for relay');
    const client = await makeClient({ diagnosticsCollector: collector });
    const result = await client.callTool({ name: 'get_diagnostics', arguments: {} });
    const text = (result.content as Array<{ text?: string }>)[0]!.text!;
    expect(text).not.toContain('654321');
    expect(text).toContain('<redacted>');
  });

  it('pages field is populated from list_pages when a target is attached', async () => {
    const connection = new FakeCdpConnection([
      { id: 'tgt1', title: 'SDK Example', url: 'https://sdk-example.aitc.dev' },
    ]);
    const client = await makeClient({ connection, env: 'relay-dev' });
    const result = await client.callTool({ name: 'get_diagnostics', arguments: {} });
    const data = parseResult(result) as Record<string, unknown>;
    const pages = data.pages as Record<string, unknown>;
    expect(pages).not.toBeNull();
    const pageList = pages.pages as unknown[];
    expect(pageList).toHaveLength(1);
  });

  it('nextRecommendedAction is null when a page is attached and healthy', async () => {
    const connection = new FakeCdpConnection([
      { id: 'tgt1', title: 'SDK Example', url: 'https://sdk-example.aitc.dev' },
    ]);
    const tunnelUp: TunnelStatus = { up: true, wssUrl: 'wss://abc.trycloudflare.com' };
    const client = await makeClient({ connection, env: 'relay-dev', tunnelStatus: tunnelUp });
    const result = await client.callTool({ name: 'get_diagnostics', arguments: {} });
    const data = parseResult(result) as Record<string, unknown>;
    expect(data.nextRecommendedAction).toBeNull();
  });
});

// ---- computeNextRecommendedAction unit tests --------------------------------

describe('computeNextRecommendedAction', () => {
  const tunnelDown: TunnelStatus = { up: false, wssUrl: null };

  const tunnelInfoDown = {
    up: false,
    wssUrl: null,
    pid: null,
    startedAt: null,
    droppedAt: null,
    reissueAttempts: 0,
  };
  const tunnelInfoUp = {
    up: true,
    wssUrl: 'wss://abc.trycloudflare.com',
    pid: null,
    startedAt: null,
    droppedAt: null,
    reissueAttempts: 0,
  };

  // Build a minimal ListPagesResult for tests.
  function makePages(
    pages: Array<{ id: string; title: string; url: string }>,
    crashDetectedAt: string | null = null,
  ): import('../tools.js').ListPagesResult {
    return {
      pages: pages.map((p) => ({ ...p, lastSeenAt: null })),
      tunnel: tunnelDown,
      crashDetectedAt,
      crashWarning: crashDetectedAt ? `[ait-debug] page crash 감지됨 — 새 attach 필요` : null,
      singleAttachModel: true,
    };
  }

  it('Rule 1: returns restart when tunnel is down', () => {
    const action = computeNextRecommendedAction(tunnelInfoDown, null, 'relay-dev');
    expect(action).not.toBeNull();
    expect(action!.tool).toBe('restart');
  });

  it('Rule 1: tunnel down takes priority over everything else', () => {
    const crashedPages = makePages([], '2026-01-01T00:00:00.000Z');
    const action = computeNextRecommendedAction(tunnelInfoDown, crashedPages, 'relay-dev');
    expect(action!.tool).toBe('restart');
  });

  it('Rule 2: returns build_attach_url when tunnel up, no pages, relay env', () => {
    const emptyPages = makePages([]);
    const action = computeNextRecommendedAction(tunnelInfoUp, emptyPages, 'relay-dev');
    expect(action).not.toBeNull();
    expect(action!.tool).toBe('build_attach_url');
    expect(action!.reason).toContain('no pages');
  });

  it('Rule 2: does NOT trigger in mock env when no pages', () => {
    const emptyPages = makePages([]);
    const action = computeNextRecommendedAction(tunnelInfoUp, emptyPages, 'mock');
    // mock env + no pages = healthy (no relay needed)
    expect(action).toBeNull();
  });

  it('Rule 3: returns build_attach_url when crash detected', () => {
    const crashedPages = makePages([], '2026-01-01T00:00:00.000Z');
    const action = computeNextRecommendedAction(tunnelInfoUp, crashedPages, 'relay-dev');
    expect(action).not.toBeNull();
    expect(action!.tool).toBe('build_attach_url');
    expect(action!.reason).toContain('crashed');
  });

  it('Rule 4: returns null when tunnel up and page attached with no crash', () => {
    const healthyPages = makePages([{ id: 'p1', title: 'App', url: 'intoss-private://app' }]);
    const action = computeNextRecommendedAction(tunnelInfoUp, healthyPages, 'relay-dev');
    expect(action).toBeNull();
  });

  it('returns null when pages is null and tunnel is up (mock env)', () => {
    const action = computeNextRecommendedAction(tunnelInfoUp, null, 'mock');
    expect(action).toBeNull();
  });

  // ---- local-target (mock env) tunnel-down cases (#325) --------------------

  it('Rule 1b: mock env + tunnel down + no pages → wait_for_page (NOT restart)', () => {
    const emptyPages = makePages([]);
    const action = computeNextRecommendedAction(tunnelInfoDown, emptyPages, 'mock');
    expect(action).not.toBeNull();
    expect(action!.tool).toBe('wait_for_page');
    // Must NOT recommend restart — tunnel-less is the normal state for local target.
    expect(action!.tool).not.toBe('restart');
  });

  it('Rule 1b: mock env + tunnel down + null pages → null (no guidance yet)', () => {
    // No pages result available: cannot determine whether a page is attached.
    const action = computeNextRecommendedAction(tunnelInfoDown, null, 'mock');
    expect(action).toBeNull();
  });

  it('Rule 1b: mock env + tunnel down + page attached → null (healthy local session)', () => {
    const attachedPages = makePages([
      { id: 'p1', title: 'Dev App', url: 'http://localhost:5173/' },
    ]);
    const action = computeNextRecommendedAction(tunnelInfoDown, attachedPages, 'mock');
    expect(action).toBeNull();
  });

  it('Rule 1 still triggers for relay-live with tunnel down', () => {
    const action = computeNextRecommendedAction(tunnelInfoDown, null, 'relay-live');
    expect(action).not.toBeNull();
    expect(action!.tool).toBe('restart');
  });

  // ---- Rule 0: permanent tunnel drop (#347) ----------------------------------

  it('Rule 0: droppedAt non-null → restart with timestamped reason', () => {
    const droppedTunnelInfo = {
      ...tunnelInfoDown,
      droppedAt: '2026-06-01T10:00:00.000Z',
      reissueAttempts: 3,
    };
    const action = computeNextRecommendedAction(droppedTunnelInfo, null, 'relay-dev');
    expect(action).not.toBeNull();
    expect(action!.tool).toBe('restart');
    expect(action!.reason).toContain('2026-06-01T10:00:00.000Z');
    expect(action!.reason).toContain('3');
  });

  it('Rule 0: beats Rule 3 (tunnel dropped even when crash detected)', () => {
    const droppedTunnelInfo = {
      ...tunnelInfoUp,
      droppedAt: '2026-06-01T10:00:00.000Z',
      reissueAttempts: 3,
    };
    const crashedPages = makePages([], '2026-01-01T00:00:00.000Z');
    const action = computeNextRecommendedAction(droppedTunnelInfo, crashedPages, 'relay-dev');
    // Rule 0 (permanent drop) must beat Rule 3 (crash re-attach).
    expect(action!.tool).toBe('restart');
    expect(action!.reason).toContain('permanently dropped');
  });

  it('Rule 0: droppedAt=null does NOT trigger restart on its own (no drop)', () => {
    // tunnelInfoUp already has droppedAt: null, reissueAttempts: 0
    const healthyPages = makePages([{ id: 'p1', title: 'App', url: 'intoss-private://app' }]);
    const action = computeNextRecommendedAction(tunnelInfoUp, healthyPages, 'relay-dev');
    expect(action).toBeNull();
  });
});

// Issue #361 — the version resolvers must read the build-time `define`
// (bare identifier `__VERSION__` / `__MCP_SDK_VERSION__`), NOT
// `globalThis.__VERSION__`. The old `globalThis.__VERSION__` access always read
// `undefined`, so `get_diagnostics` reported `devtoolsVersion: null` in every
// real bundle. vitest.config supplies the same defines tsdown does, so these
// pin that the resolvers return the (non-null) define value.
//
// NOTE on the globalThis distinction: under a real tsdown build the bare token
// is substituted with a string literal at compile time, so a `globalThis`
// property could never shadow it. We deliberately do NOT assert that here — in
// vitest a bare undefined identifier falls back to a global lookup (vite's
// define transform differs from rolldown's), which is a test-runtime artifact,
// not the shipped behavior. The shipped behavior (bare literal, globalThis
// irrelevant) is proven by the env-1 runtime acceptance against a real bundle.
describe('version resolvers (issue #361 — build-define, not globalThis)', () => {
  it('readDevtoolsVersion returns the build-time __VERSION__ define value', () => {
    // vitest.config defines __VERSION__ = '0.0.0-test'.
    expect(readDevtoolsVersion()).toBe('0.0.0-test');
  });

  it('readMcpSdkVersion returns a non-null version via the build-define path', async () => {
    // vitest.config mirrors the tsdown __MCP_SDK_VERSION__ define so the
    // primary (no-throw, no req.resolve) path is exercised.
    expect(await readMcpSdkVersion()).toBe('0.0.0-test-sdk');
  });

  // The build-define path (above) is the shipped primary, but #363 left
  // mcpVersion: null in the real bundle because BOTH the build-time resolve
  // (tsdown.config.ts) and this fallback used the bare `@modelcontextprotocol/sdk`
  // main entry — which the SDK does NOT export, so it threw MODULE_NOT_FOUND and
  // the define baked `null`. This pins the resolution the fix relies on: the
  // `./server/mcp.js` subpath IS exported and the marker-walk reaches a real
  // package.json version. If the SDK ever drops that subpath, this fails loudly
  // instead of silently regressing to mcpVersion: null again.
  it('resolves the SDK version via the exported ./server/mcp.js subpath (fallback path)', async () => {
    const { createRequire } = await import('node:module');
    const { readFileSync } = await import('node:fs');
    const req = createRequire(import.meta.url);
    const entry = req.resolve('@modelcontextprotocol/sdk/server/mcp.js');
    const marker = '@modelcontextprotocol/sdk';
    const root = entry.slice(0, entry.indexOf(marker) + marker.length);
    const parsed = JSON.parse(readFileSync(`${root}/package.json`, 'utf8')) as {
      version?: unknown;
    };
    expect(typeof parsed.version).toBe('string');
    expect(parsed.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
