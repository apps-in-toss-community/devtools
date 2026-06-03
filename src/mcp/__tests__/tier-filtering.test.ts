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
  /**
   * Authoritative connection kind (issue #348). When the server is wired with
   * no `getEnvironment` injection, the env derives from this; tests that inject
   * `getEnvironment` make it inert.
   */
  readonly kind: 'relay' | 'local';

  constructor(
    private targets: CdpTarget[] = [],
    kind: 'relay' | 'local' = 'relay',
  ) {
    this.kind = kind;
  }
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
    // Tier B → relay only (relay-dev, relay-live, and relay-mobile all satisfy it).
    expect(isToolAvailableIn('build_attach_url', 'relay-dev')).toBe(true);
    expect(isToolAvailableIn('build_attach_url', 'relay-live')).toBe(true);
    expect(isToolAvailableIn('build_attach_url', 'relay-mobile')).toBe(true);
    expect(isToolAvailableIn('build_attach_url', 'mock')).toBe(false);
    // Tier C → both.
    expect(isToolAvailableIn('measure_safe_area', 'relay-dev')).toBe(true);
    expect(isToolAvailableIn('measure_safe_area', 'relay-live')).toBe(true);
    expect(isToolAvailableIn('measure_safe_area', 'relay-mobile')).toBe(true);
    expect(isToolAvailableIn('measure_safe_area', 'mock')).toBe(true);
    expect(isToolAvailableIn('list_console_messages', 'mock')).toBe(true);
    // Unknown tools are not available in any env (caller treats as unknown).
    expect(isToolAvailableIn('does_not_exist', 'mock')).toBe(false);
    expect(isToolAvailableIn('does_not_exist', 'relay-dev')).toBe(false);
    expect(isToolAvailableIn('does_not_exist', 'relay-mobile')).toBe(false);
  });

  it('filterToolsByEnvironment hides Tier B in mock and keeps Tier C', () => {
    const mockTools = filterToolsByEnvironment(DEBUG_TOOL_DEFINITIONS, 'mock');
    const mockNames = mockTools.map((t) => t.name);
    expect(mockNames).not.toContain('build_attach_url');
    expect(mockNames).toContain('measure_safe_area');
    expect(mockNames).toContain('AIT.getMockState');
  });

  it('filterToolsByEnvironment keeps Tier B in relay-dev', () => {
    const relayTools = filterToolsByEnvironment(DEBUG_TOOL_DEFINITIONS, 'relay-dev');
    const relayNames = relayTools.map((t) => t.name);
    expect(relayNames).toContain('build_attach_url');
    expect(relayNames).toContain('measure_safe_area');
  });

  it('filterToolsByEnvironment keeps Tier B in relay-live', () => {
    const relayLiveTools = filterToolsByEnvironment(DEBUG_TOOL_DEFINITIONS, 'relay-live');
    const relayLiveNames = relayLiveTools.map((t) => t.name);
    expect(relayLiveNames).toContain('build_attach_url');
    expect(relayLiveNames).toContain('measure_safe_area');
  });

  it('filterToolsByEnvironment keeps Tier B in relay-mobile (#378)', () => {
    const relayMobileTools = filterToolsByEnvironment(DEBUG_TOOL_DEFINITIONS, 'relay-mobile');
    const relayMobileNames = relayMobileTools.map((t) => t.name);
    expect(relayMobileNames).toContain('build_attach_url');
    expect(relayMobileNames).toContain('measure_safe_area');
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

  it('relay-dev env exposes build_attach_url (Tier B)', async () => {
    const client = await makeClient('relay-dev', /*attached*/ true);
    const list = await client.listTools();
    const names = list.tools.map((t) => t.name);
    expect(names).toContain('build_attach_url');
    expect(names).toContain('measure_safe_area');
  });

  it('relay-live env exposes build_attach_url (Tier B)', async () => {
    const client = await makeClient('relay-live', /*attached*/ true);
    const list = await client.listTools();
    const names = list.tools.map((t) => t.name);
    expect(names).toContain('build_attach_url');
    expect(names).toContain('measure_safe_area');
  });

  it('relay-mobile env exposes build_attach_url (Tier B) — same surface as relay-dev (#378)', async () => {
    const client = await makeClient('relay-mobile', /*attached*/ true);
    const list = await client.listTools();
    const names = list.tools.map((t) => t.name);
    expect(names).toContain('build_attach_url');
    expect(names).toContain('measure_safe_area');
  });

  it('relay-dev env unattached still exposes bootstrap tools (list_pages, build_attach_url)', async () => {
    const client = await makeClient('relay-dev', /*attached*/ false);
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

// ----- env derives from connection.kind (issue #348) -----------------------

describe('tools/list — env derived from connection.kind (issue #348)', () => {
  /**
   * With no `getEnvironment` injection, `createDebugServer` derives the env from
   * the ACTIVE connection's `kind` (relay → relay-dev, local → mock). This
   * replaces the deleted `defaultEnv`/URL-sniffing precedence chain. The key
   * M2-5 property survives: a relay-kind connection advertises Tier B
   * `build_attach_url` from the very first `tools/list`, before any attach.
   */
  async function makeRealEnvClient(opts: {
    attached: boolean;
    kind: 'relay' | 'local';
  }): Promise<Client> {
    const targets: CdpTarget[] = opts.attached
      ? [{ id: 't1', title: 'app', url: 'intoss-private://miniapp' }]
      : [];
    const connection = new FakeCdpConnection(targets, opts.kind);
    const tunnel: TunnelStatus = { up: true, wssUrl: 'wss://abc.trycloudflare.com' };
    const server = createDebugServer({
      connection,
      aitSource: new FakeAitSource(),
      getTunnelStatus: () => tunnel,
      // NOTE: no `getEnvironment`/`getEnvironmentReason` injection — exercise
      // the real `deriveEnvironment(connection.kind, liveIntent)` path.
    });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'm2-5-test', version: '0.0.0' });
    await client.connect(clientTransport);
    return client;
  }

  // Guard against ambient MCP_ENV leaking from the host shell — it no longer
  // affects env derivation, but scrub it so nothing surprising happens.
  const originalEnv = process.env.MCP_ENV;
  beforeAll(() => {
    delete process.env.MCP_ENV;
  });
  afterAll(() => {
    if (originalEnv === undefined) delete process.env.MCP_ENV;
    else process.env.MCP_ENV = originalEnv;
  });

  it('relay-kind connection exposes build_attach_url on first tools/list — unattached', async () => {
    const client = await makeRealEnvClient({ attached: false, kind: 'relay' });
    const list = await client.listTools();
    const names = list.tools.map((t) => t.name);
    // Tier B `build_attach_url` listed because kind=relay → relay-dev env,
    // even before any target attaches (the M2-5 property, now kind-derived).
    expect(names).toContain('build_attach_url');
    expect(names).toContain('list_pages');
    expect(names).toContain('get_diagnostics');
    expect(names).toContain('start_debug');
    // Attach-dependent tools are still hidden pre-attach (orthogonal to env).
    expect(names).not.toContain('measure_safe_area');
  });

  it('local-kind connection keeps build_attach_url hidden (mock env)', async () => {
    const client = await makeRealEnvClient({ attached: false, kind: 'local' });
    const list = await client.listTools();
    const names = list.tools.map((t) => t.name);
    expect(names).not.toContain('build_attach_url');
    expect(names).toContain('list_pages');
    expect(names).toContain('start_debug');
  });

  it('relay-kind attached exposes build_attach_url + attach-dependent tools', async () => {
    const client = await makeRealEnvClient({ attached: true, kind: 'relay' });
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

  it('does NOT trip the LIVE side-effect guard in relay-mobile (#378)', async () => {
    // relay-mobile is a dev-intent env (env-2 PWA) — liveIntent is never armed,
    // so `evaluate`/`call_sdk` must NOT require `confirm: true`. The default
    // module-level liveIntent is false; the guard reads conn.kind=='relay' &&
    // getLiveIntent(), so mobile (relay kind, liveIntent off) is un-guarded.
    const client = await makeClient('relay-mobile', /*attached*/ true);
    const result = await client.callTool({
      name: 'evaluate',
      arguments: { expression: '1 + 1' },
    });
    // It errors (FakeCdpConnection has no canned Runtime.evaluate result), but
    // the failure must NOT be the LIVE confirm guard.
    const text = (result.content as Array<{ text?: string }>)[0]?.text ?? '';
    expect(text).not.toContain('confirm: true');
    expect(text).not.toContain('LIVE');
  });
});
