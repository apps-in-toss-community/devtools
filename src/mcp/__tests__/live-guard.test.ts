/**
 * LIVE side-effect guard tests (issue #307).
 *
 * Verifies:
 *   - relay-live env + no confirm → liveGuardError for call_sdk and evaluate
 *   - relay-live env + confirm: true → guard passes (proceeds to execute)
 *   - relay-dev env → no guard (backward compat)
 *   - mock env → no guard
 *
 * The guard is implemented in `debug-server.ts` at the `CallTool` handler level,
 * before any CDP call is made. Tests use FakeCdpConnection so no real phone is
 * needed.
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
import type { TunnelStatus } from '../tools.js';

// ---- Minimal fakes -----------------------------------------------------------

class FakeCdpConnection implements CdpConnection {
  private _targets: CdpTarget[];

  constructor(targets: CdpTarget[] = [{ id: 't1', title: 'app', url: 'intoss-private://app' }]) {
    this._targets = targets;
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
    // Return a minimal successful Runtime.evaluate result so confirm: true path passes guard.
    if ((_m as string) === 'Runtime.evaluate') {
      return Promise.resolve({
        result: { type: 'string', value: JSON.stringify({ ok: true, value: null }) },
      } as CdpCommandMap[M]['result']);
    }
    return Promise.reject(new Error(`no canned result for ${_m}`));
  }
}

class FakeAitSource implements AitSource {
  get<M extends AitMethodName>(_m: M): Promise<AitMethodMap[M]> {
    return Promise.reject(new Error('no canned AIT response'));
  }
}

async function makeClient(env: McpEnvironment): Promise<Client> {
  const tunnel: TunnelStatus = { up: true, wssUrl: 'wss://abc.trycloudflare.com' };
  const server = createDebugServer({
    connection: new FakeCdpConnection(),
    aitSource: new FakeAitSource(),
    getTunnelStatus: () => tunnel,
    getEnvironment: () => env,
    getEnvironmentReason: () => `test-pinned-${env}`,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'live-guard-test', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

function getText(result: Awaited<ReturnType<Client['callTool']>>): string {
  return (result.content as Array<{ text?: string }>)[0]?.text ?? '';
}

// ---- call_sdk LIVE guard -----------------------------------------------------

describe('call_sdk — LIVE side-effect guard (relay-live)', () => {
  it('rejects call_sdk in relay-live without confirm: true', async () => {
    const client = await makeClient('relay-live');
    const result = await client.callTool({
      name: 'call_sdk',
      arguments: { name: 'getOperationalEnvironment' },
    });
    expect(result.isError).toBe(true);
    const text = getText(result);
    expect(text).toContain('LIVE relay guard');
    expect(text).toContain('call_sdk');
    expect(text).toContain('confirm: true');
    expect(text).toContain('live-guard');
  });

  it('rejects call_sdk in relay-live with confirm: false', async () => {
    const client = await makeClient('relay-live');
    const result = await client.callTool({
      name: 'call_sdk',
      arguments: { name: 'getOperationalEnvironment', confirm: false },
    });
    expect(result.isError).toBe(true);
    const text = getText(result);
    expect(text).toContain('LIVE relay guard');
  });

  it('allows call_sdk in relay-live with confirm: true', async () => {
    const client = await makeClient('relay-live');
    const result = await client.callTool({
      name: 'call_sdk',
      arguments: { name: 'getOperationalEnvironment', args: [], confirm: true },
    });
    // Guard passed — CDP call was made. FakeCdpConnection returns a valid envelope.
    const text = getText(result);
    // Should NOT contain live-guard rejection text.
    expect(text).not.toContain('LIVE relay guard');
  });

  it('does NOT guard call_sdk in relay-dev (backward compat)', async () => {
    const client = await makeClient('relay-dev');
    const result = await client.callTool({
      name: 'call_sdk',
      arguments: { name: 'getOperationalEnvironment', args: [] },
    });
    // Guard must NOT fire — text should not contain live-guard rejection.
    const text = getText(result);
    expect(text).not.toContain('LIVE relay guard');
  });

  it('does NOT guard call_sdk in mock env', async () => {
    const client = await makeClient('mock');
    const result = await client.callTool({
      name: 'call_sdk',
      arguments: { name: 'getOperationalEnvironment', args: [] },
    });
    const text = getText(result);
    expect(text).not.toContain('LIVE relay guard');
  });
});

// ---- evaluate LIVE guard -----------------------------------------------------

describe('evaluate — LIVE side-effect guard (relay-live)', () => {
  it('rejects evaluate in relay-live without confirm: true', async () => {
    const client = await makeClient('relay-live');
    const result = await client.callTool({
      name: 'evaluate',
      arguments: { expression: 'window.__sdk.closeView()' },
    });
    expect(result.isError).toBe(true);
    const text = getText(result);
    expect(text).toContain('LIVE relay guard');
    expect(text).toContain('evaluate');
    expect(text).toContain('confirm: true');
  });

  it('allows evaluate in relay-live with confirm: true', async () => {
    const client = await makeClient('relay-live');
    const result = await client.callTool({
      name: 'evaluate',
      arguments: { expression: '1 + 1', confirm: true },
    });
    // Guard passed — FakeCdpConnection returns the value JSON.
    const text = getText(result);
    expect(text).not.toContain('LIVE relay guard');
  });

  it('does NOT guard evaluate in relay-dev (backward compat)', async () => {
    const client = await makeClient('relay-dev');
    const result = await client.callTool({
      name: 'evaluate',
      arguments: { expression: '1 + 1' },
    });
    const text = getText(result);
    expect(text).not.toContain('LIVE relay guard');
  });

  it('does NOT guard evaluate in mock env', async () => {
    const client = await makeClient('mock');
    const result = await client.callTool({
      name: 'evaluate',
      arguments: { expression: '1 + 1' },
    });
    const text = getText(result);
    expect(text).not.toContain('LIVE relay guard');
  });
});

// ---- backward compat: isRelayEnv ---------------------------------------------

describe('isRelayEnv — both relay variants satisfy Tier B', () => {
  it('relay-live env exposes build_attach_url (Tier B)', async () => {
    const client = await makeClient('relay-live');
    const list = await client.listTools();
    const names = list.tools.map((t) => t.name);
    expect(names).toContain('build_attach_url');
    expect(names).toContain('measure_safe_area');
  });
});
