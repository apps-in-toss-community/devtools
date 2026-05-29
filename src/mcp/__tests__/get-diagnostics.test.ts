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
  type DiagnosticsCollector,
  getDiagnostics,
  InMemoryDiagnosticsCollector,
  redactErrorMessage,
  type TunnelStatus,
} from '../tools.js';

// ---- Minimal fakes ----------------------------------------------------------

class FakeCdpConnection implements CdpConnection {
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
  return JSON.parse(content[0]!.text!);
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
      environment: { env: 'mock', reason: 'default-mock' },
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
      env: 'relay',
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
      env: 'relay',
      envReason: 'env-var-relay',
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
    expect(data.environment).toMatchObject({ env: 'mock', reason: 'test-pinned-mock' });
  });

  it('is available in relay env', async () => {
    const client = await makeClient({ env: 'relay' });
    const result = await client.callTool({ name: 'get_diagnostics', arguments: {} });
    expect(result.isError).toBeFalsy();
    const data = parseResult(result) as Record<string, unknown>;
    expect(data.environment).toMatchObject({ env: 'relay', reason: 'test-pinned-relay' });
  });

  it('returns the current tunnel status', async () => {
    const tunnelUp: TunnelStatus = { up: true, wssUrl: 'wss://abc.trycloudflare.com' };
    const client = await makeClient({ env: 'relay', tunnelStatus: tunnelUp });
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
    const client = await makeClient({ connection, env: 'relay' });
    const result = await client.callTool({ name: 'get_diagnostics', arguments: {} });
    const data = parseResult(result) as Record<string, unknown>;
    const pages = data.pages as Record<string, unknown>;
    expect(pages).not.toBeNull();
    const pageList = pages.pages as unknown[];
    expect(pageList).toHaveLength(1);
  });
});
