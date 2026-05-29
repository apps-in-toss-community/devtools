/**
 * Tier A·B tool-registry filtering tests (RFC #277).
 *
 * Verifies:
 *   - `tools/list` filters out Tier B (`build_attach_url`) when env is `mock`.
 *   - `tools/list` filters out Tier A tools when env is `relay` (no Tier A
 *     tools are registered yet — guarded by the pure helpers so future Tier A
 *     additions inherit the filter automatically).
 *   - Direct invocation of an env-mismatched tool returns isError with the
 *     `reason` text and stable `current environment is <env>` wording.
 *   - `filterToolsByEnvironment` / `isToolAvailableIn` / `getToolAvailability`
 *     helpers work as the pure registry layer used by the server.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
  DEBUG_TOOL_DEFINITIONS,
  filterToolsByEnvironment,
  getToolAvailability,
  isToolAvailableIn,
  type TunnelStatus,
} from '../tools.js';

// ----- Fakes --------------------------------------------------------------

class FakeCdpConnection implements CdpConnection {
  constructor(private targets: CdpTarget[] = []) {}
  enableDomains(): Promise<void> {
    return Promise.resolve();
  }
  listTargets(): CdpTarget[] {
    return this.targets;
  }
  getBufferedEvents<E extends CdpEventName>(_e: E): ReadonlyArray<CdpEventMap[E]> {
    return [];
  }
  on(): () => void {
    return () => {};
  }
  send<M extends CdpCommandName>(_m: M): Promise<CdpCommandMap[M]['result']> {
    return Promise.reject(new Error('no canned'));
  }
}

class FakeAitSource implements AitSource {
  get<M extends AitMethodName>(_m: M): Promise<AitMethodMap[M]> {
    return Promise.reject(new Error('no canned AIT'));
  }
}

async function makeClient(env: McpEnvironment, attached: boolean): Promise<Client> {
  const targets: CdpTarget[] = attached
    ? [{ id: 't1', title: 'app', url: 'intoss-private://miniapp' }]
    : [];
  const connection = new FakeCdpConnection(targets);
  const tunnel: TunnelStatus = { up: true, wssUrl: 'wss://abc.trycloudflare.com' };
  const server = createDebugServer({
    connection,
    aitSource: new FakeAitSource(),
    getTunnelStatus: () => tunnel,
    getEnvironment: () => env,
    getEnvironmentReason: () => `test-pinned-${env}`,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'tier-test', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

// ----- Pure registry helpers ----------------------------------------------

describe('tool-registry — pure helpers', () => {
  it('getToolAvailability returns the declared tier per RFC #277', () => {
    expect(getToolAvailability('build_attach_url')).toBe('relay');
    expect(getToolAvailability('measure_safe_area')).toBe('both');
    expect(getToolAvailability('list_console_messages')).toBe('both');
    expect(getToolAvailability('AIT.getMockState')).toBe('both');
    expect(getToolAvailability('unknown_tool')).toBeUndefined();
  });

  it('isToolAvailableIn respects the env decision', () => {
    // Tier B → relay only.
    expect(isToolAvailableIn('build_attach_url', 'relay')).toBe(true);
    expect(isToolAvailableIn('build_attach_url', 'mock')).toBe(false);
    // Tier C → both.
    expect(isToolAvailableIn('measure_safe_area', 'relay')).toBe(true);
    expect(isToolAvailableIn('measure_safe_area', 'mock')).toBe(true);
    expect(isToolAvailableIn('list_console_messages', 'mock')).toBe(true);
    // Unknown tools are not available in any env (caller treats as unknown).
    expect(isToolAvailableIn('does_not_exist', 'mock')).toBe(false);
    expect(isToolAvailableIn('does_not_exist', 'relay')).toBe(false);
  });

  it('filterToolsByEnvironment hides Tier B in mock and keeps Tier C', () => {
    const mockTools = filterToolsByEnvironment(DEBUG_TOOL_DEFINITIONS, 'mock');
    const mockNames = mockTools.map((t) => t.name);
    expect(mockNames).not.toContain('build_attach_url');
    expect(mockNames).toContain('measure_safe_area');
    expect(mockNames).toContain('AIT.getMockState');
  });

  it('filterToolsByEnvironment keeps Tier B in relay', () => {
    const relayTools = filterToolsByEnvironment(DEBUG_TOOL_DEFINITIONS, 'relay');
    const relayNames = relayTools.map((t) => t.name);
    expect(relayNames).toContain('build_attach_url');
    expect(relayNames).toContain('measure_safe_area');
  });
});

// ----- tools/list integration via MCP client ------------------------------

describe('tools/list — env filtering integration', () => {
  it('mock env hides build_attach_url (Tier B)', async () => {
    const client = await makeClient('mock', /*attached*/ true);
    const list = await client.listTools();
    const names = list.tools.map((t) => t.name);
    expect(names).not.toContain('build_attach_url');
    expect(names).toContain('measure_safe_area');
  });

  it('relay env exposes build_attach_url (Tier B)', async () => {
    const client = await makeClient('relay', /*attached*/ true);
    const list = await client.listTools();
    const names = list.tools.map((t) => t.name);
    expect(names).toContain('build_attach_url');
    expect(names).toContain('measure_safe_area');
  });

  it('relay env unattached still exposes bootstrap tools (list_pages, build_attach_url)', async () => {
    const client = await makeClient('relay', /*attached*/ false);
    const list = await client.listTools();
    const names = list.tools.map((t) => t.name);
    expect(names).toContain('build_attach_url');
    expect(names).toContain('list_pages');
    // Non-bootstrap tools are hidden pre-attach.
    expect(names).not.toContain('measure_safe_area');
  });

  it('mock env unattached hides build_attach_url even though it is a bootstrap tool', async () => {
    // build_attach_url is BOOTSTRAP_TOOL_NAMES, but Tier filter (env=mock) wins.
    const client = await makeClient('mock', /*attached*/ false);
    const list = await client.listTools();
    const names = list.tools.map((t) => t.name);
    expect(names).not.toContain('build_attach_url');
    // list_pages (bootstrap + Tier C) is still listed.
    expect(names).toContain('list_pages');
  });
});

// ----- defaultEnv resolves the M2-5 dead-lock (issue #309) ------------------

describe('tools/list — defaultEnv from CLI mode intent (issue #309)', () => {
  /**
   * End-to-end variant of the M2-5 path: a server wired with `defaultEnv:
   * 'relay'` (the production relay-target debug mode wiring) must advertise
   * `build_attach_url` in the very first `tools/list`, with NO `MCP_ENV` set
   * and NO targets attached. Before the fix, the env resolved to `'mock'` →
   * Tier B `build_attach_url` was hidden → agent had no env 3/4 entry.
   *
   * This test calls the production `createDebugServer` with a real env resolver
   * (no `getEnvironment` injection) so the precedence chain is exercised end-
   * to-end.
   */
  async function makeRealEnvClient(opts: {
    attached: boolean;
    defaultEnv: McpEnvironment;
  }): Promise<Client> {
    const targets: CdpTarget[] = opts.attached
      ? [{ id: 't1', title: 'app', url: 'intoss-private://miniapp' }]
      : [];
    const connection = new FakeCdpConnection(targets);
    const tunnel: TunnelStatus = { up: true, wssUrl: 'wss://abc.trycloudflare.com' };
    const server = createDebugServer({
      connection,
      aitSource: new FakeAitSource(),
      getTunnelStatus: () => tunnel,
      defaultEnv: opts.defaultEnv,
      // NOTE: no `getEnvironment`/`getEnvironmentReason` injection — exercise
      // the real precedence chain.
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'm2-5-test', version: '0.0.0' });
    await client.connect(clientTransport);
    return client;
  }

  // Guard against ambient MCP_ENV leaking from the host shell. The precedence
  // chain says env var wins, so we must scrub it for these cases.
  const originalEnv = process.env.MCP_ENV;
  beforeAll(() => {
    delete process.env.MCP_ENV;
  });
  afterAll(() => {
    if (originalEnv === undefined) delete process.env.MCP_ENV;
    else process.env.MCP_ENV = originalEnv;
  });

  it('defaultEnv=relay (production relay-target wiring) exposes build_attach_url on first tools/list — unattached, no MCP_ENV', async () => {
    const client = await makeRealEnvClient({ attached: false, defaultEnv: 'relay' });
    const list = await client.listTools();
    const names = list.tools.map((t) => t.name);
    // Bootstrap tier visible — Tier B `build_attach_url` is now listed because
    // the env resolves to `relay` via the caller-stated default.
    expect(names).toContain('build_attach_url');
    expect(names).toContain('list_pages');
    expect(names).toContain('get_diagnostics');
    // Attach-dependent tools are still hidden pre-attach (orthogonal to env).
    expect(names).not.toContain('measure_safe_area');
  });

  it('defaultEnv=mock (production local-target wiring) keeps build_attach_url hidden', async () => {
    const client = await makeRealEnvClient({ attached: false, defaultEnv: 'mock' });
    const list = await client.listTools();
    const names = list.tools.map((t) => t.name);
    expect(names).not.toContain('build_attach_url');
    expect(names).toContain('list_pages');
  });

  it('defaultEnv=relay + URL pattern still wins (real-device target → relay regardless of default)', async () => {
    // A real-device URL would have resolved to `relay` even without the
    // default, but we keep the assertion explicit.
    const client = await makeRealEnvClient({ attached: true, defaultEnv: 'relay' });
    const list = await client.listTools();
    const names = list.tools.map((t) => t.name);
    expect(names).toContain('build_attach_url');
    expect(names).toContain('measure_safe_area');
  });
});

// ----- tools/call env-mismatch rejection -----------------------------------

describe('tools/call — env mismatch rejection', () => {
  it('rejects build_attach_url in mock env with reason text', async () => {
    const client = await makeClient('mock', /*attached*/ true);
    const result = await client.callTool({
      name: 'build_attach_url',
      arguments: { scheme_url: 'intoss-private://miniapp?_deploymentId=xyz' },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ text?: string }>)[0]?.text ?? '';
    expect(text).toContain('build_attach_url');
    expect(text).toContain('available only in relay');
    expect(text).toContain('Current environment is mock');
  });

  it('does NOT reject Tier C tools (measure_safe_area) for env mismatch', async () => {
    // measure_safe_area is Tier C → available in both. (CDP send will fail
    // due to no canned result, but the tier filter must NOT block it.)
    const client = await makeClient('mock', /*attached*/ true);
    const result = await client.callTool({
      name: 'measure_safe_area',
      arguments: {},
    });
    // It's still an error because the FakeCdpConnection has no canned result
    // for `Runtime.evaluate`, but the reason must NOT be tier-filtering.
    const text = (result.content as Array<{ text?: string }>)[0]?.text ?? '';
    expect(text).not.toContain('available only in');
  });
});
