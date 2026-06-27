/**
 * `start_debug` dual-connection router tests (issue #348, renamed #382, #665).
 *
 * Verifies the DUAL-CONNECTION-COEXIST design:
 *   - `start_debug` is a bootstrap tool — visible before any attach, in every env.
 *   - Switching mode flips the active connection underneath the SAME MCP
 *     `Server` (no re-handshake): tools read through `router.active` per call.
 *   - The mode-switch report reflects the now-active env.
 *   - `relay-live` (env 4) is removed (#665) — confirm gate and LIVE guard matrix
 *     are removed. The positive-allowlist kill-switch in gate.ts replaces them.
 *   - `normalizeStartDebugMode` / `isRelayMode` / `makeSingleConnectionRouter`
 *     pure helpers.
 *
 * No real Chromium / relay infra — a `TestRouter` holds two fake connections and
 * flips `active`, exactly as the production `DualConnectionRouter` does.
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
import {
  type ConnectionRouter,
  createDebugServer,
  isRelayMode,
  type ModeSwitchReport,
  makeSingleConnectionRouter,
  normalizeStartDebugMode,
  type StartDebugMode,
} from '../debug-server.js';
import { deriveEnvironment } from '../environment.js';
import type { TunnelStatus } from '../tools.js';

// ---- Fakes -----------------------------------------------------------------

class FakeConn implements CdpConnection {
  readonly kind: 'relay' | 'local';
  private _targets: CdpTarget[];

  constructor(kind: 'relay' | 'local', targets: CdpTarget[] = []) {
    this.kind = kind;
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

/**
 * Minimal dual router for tests: holds a relay + a local fake connection and
 * flips `active` like the production `DualConnectionRouter`.
 * `relay-live` gate and `liveIntent` removed (#665).
 */
class TestRouter implements ConnectionRouter {
  readonly relay: FakeConn;
  readonly local = new FakeConn('local', [
    { id: 'l1', title: 'app', url: 'http://localhost:5173/' },
  ]);
  private current: CdpConnection;
  /** sendToolListChanged side-effect counter (proves listChanged emission). */
  listChangedCount = 0;

  constructor(initial: 'relay' | 'local' = 'relay', relayAttached = true) {
    this.relay = new FakeConn(
      'relay',
      relayAttached
        ? [{ id: 'r1', title: 'app', url: 'https://r1.private-apps.tossmini.com/app' }]
        : [],
    );
    this.current = initial === 'relay' ? this.relay : this.local;
  }

  get active(): CdpConnection {
    return this.current;
  }

  switchMode(mode: StartDebugMode): Promise<ModeSwitchReport> {
    const target = isRelayMode(mode) ? this.relay : this.local;
    this.current = target;
    this.listChangedCount++;
    const environment = deriveEnvironment(target.kind);
    return Promise.resolve({
      mode,
      environment,
      kind: target.kind,
      nextStep: 'next',
    });
  }
}

async function makeClient(router: ConnectionRouter): Promise<Client> {
  const tunnel: TunnelStatus = { up: true, wssUrl: 'wss://abc.trycloudflare.com' };
  const server = createDebugServer({
    connection: router.active,
    router,
    aitSource: new FakeAitSource(),
    getTunnelStatus: () => tunnel,
    // No getEnvironment injection — exercise the real derived resolver.
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'start-debug-test', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

function getText(result: Awaited<ReturnType<Client['callTool']>>): string {
  return (result.content as Array<{ text?: string }>)[0]?.text ?? '';
}

function parseReport(result: Awaited<ReturnType<Client['callTool']>>): ModeSwitchReport {
  return JSON.parse(getText(result)) as ModeSwitchReport;
}

// ---- pure helpers ----------------------------------------------------------

describe('normalizeStartDebugMode', () => {
  it('accepts the three canonical modes (relay-live removed #665)', () => {
    expect(normalizeStartDebugMode('local-browser')).toBe('local-browser');
    expect(normalizeStartDebugMode('relay-sandbox')).toBe('relay-sandbox');
    expect(normalizeStartDebugMode('relay-staging')).toBe('relay-staging');
    // relay-live no longer accepted
    expect(normalizeStartDebugMode('relay-live')).toBeNull();
  });
  it('rejects the old pre-#398 names — hard rename, no back-compat aliases', () => {
    // #398 dropped the deprecated aliases entirely (devtools is pre-1.0, 0.1.x).
    expect(normalizeStartDebugMode('local')).toBeNull();
    expect(normalizeStartDebugMode('mobile')).toBeNull();
    expect(normalizeStartDebugMode('staging')).toBeNull();
    expect(normalizeStartDebugMode('live')).toBeNull();
    expect(normalizeStartDebugMode('local-browser-dev')).toBeNull();
    expect(normalizeStartDebugMode('relay-dev')).toBeNull();
    expect(normalizeStartDebugMode('relay-mobile')).toBeNull();
  });
  it('rejects unknown values', () => {
    expect(normalizeStartDebugMode('mock')).toBeNull();
    expect(normalizeStartDebugMode('')).toBeNull();
    expect(normalizeStartDebugMode(undefined)).toBeNull();
    expect(normalizeStartDebugMode(42)).toBeNull();
  });
});

describe('isRelayMode', () => {
  it('relay-sandbox / relay-staging are relay; local-browser is not (relay-live removed #665)', () => {
    expect(isRelayMode('relay-sandbox')).toBe(true);
    expect(isRelayMode('relay-staging')).toBe(true);
    expect(isRelayMode('local-browser')).toBe(false);
  });
});

// ---- start_debug visibility (bootstrap) ------------------------------------

describe('start_debug — bootstrap visibility (before attach)', () => {
  it('is listed pre-attach in a relay session', async () => {
    const router = new TestRouter('relay', /*relayAttached*/ false);
    const client = await makeClient(router);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('start_debug');
    // Relay kind → build_attach_url (Tier B) also visible pre-attach.
    expect(names).toContain('build_attach_url');
  });

  it('is listed pre-attach in a local (mock) session', async () => {
    const router = new TestRouter('local');
    const client = await makeClient(router);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain('start_debug');
    // Tier B build_attach_url stays hidden in mock — start_debug is Tier C.
    expect(names).not.toContain('build_attach_url');
  });
});

// ---- mode switching + report -----------------------------------------------

describe('start_debug — mode switch report + seamless active-pointer flip', () => {
  it('relay → local switch flips the active connection and reports mock', async () => {
    const router = new TestRouter('relay');
    const client = await makeClient(router);

    expect(router.active.kind).toBe('relay');
    const result = await client.callTool({
      name: 'start_debug',
      arguments: { mode: 'local-browser' },
    });
    const report = parseReport(result);
    expect(report.mode).toBe('local-browser');
    expect(report.environment).toBe('mock');
    expect(report.kind).toBe('local');
    // liveGuardActive removed from ModeSwitchReport (#665)
    // The active pointer actually flipped (no re-handshake — same server/client).
    expect(router.active.kind).toBe('local');
    // A list_changed notification was emitted on the switch.
    expect(router.listChangedCount).toBe(1);
  });

  it('local-browser → relay-staging switch reports relay-dev (output env), no guard', async () => {
    const router = new TestRouter('local');
    const client = await makeClient(router);
    const report = parseReport(
      await client.callTool({ name: 'start_debug', arguments: { mode: 'relay-staging' } }),
    );
    // Output env layer is 'relay-dev' from deriveEnvironment.
    expect(report.environment).toBe('relay-dev');
    expect(report.kind).toBe('relay');
    // liveGuardActive removed from ModeSwitchReport (#665)
  });

  it('relay-live is rejected (env 4 removed #665)', async () => {
    const router = new TestRouter('relay');
    const client = await makeClient(router);
    const rejected = await client.callTool({
      name: 'start_debug',
      arguments: { mode: 'relay-live' },
    });
    expect(rejected.isError).toBe(true);
    expect(getText(rejected)).toContain('#665');
  });

  it('an unknown mode is rejected with a clear error', async () => {
    const router = new TestRouter('relay');
    const client = await makeClient(router);
    const result = await client.callTool({ name: 'start_debug', arguments: { mode: 'bogus' } });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('mode');
  });

  it('no re-handshake: the same client keeps working across a switch', async () => {
    const router = new TestRouter('relay');
    const client = await makeClient(router);
    // First call on relay.
    await client.callTool({ name: 'start_debug', arguments: { mode: 'relay-staging' } });
    // Switch to local, then immediately use a read tool — same session, no reconnect.
    await client.callTool({ name: 'start_debug', arguments: { mode: 'local-browser' } });
    const list = await client.listTools();
    expect(list.tools.map((t) => t.name)).toContain('list_pages');
    expect(router.active.kind).toBe('local');
  });
});

// ---- positive-allowlist kill-switch (replaces LIVE guard) ------------------
// The LIVE guard matrix (relay × liveIntent × confirm) is removed (#665).
// The allowlist kill-switch is tested in src/__tests__/in-app-gate.test.ts
// (isDebugAllowedHost) and in the connectionHostsAllowed integration.

describe('positive-allowlist: relay-staging on allowed host passes side-effect tools', () => {
  it('evaluate/call_sdk succeed on private-apps relay (allowed host)', async () => {
    const router = new TestRouter('relay');
    const client = await makeClient(router);
    await client.callTool({ name: 'start_debug', arguments: { mode: 'relay-staging' } });
    const result = await client.callTool({
      name: 'evaluate',
      arguments: { expression: '1 + 1' },
    });
    // Should not return host-allowlist error
    expect(getText(result)).not.toContain('#665');
    expect(getText(result)).not.toContain('허용 호스트');
  });
});

// ---- single-connection router (back-compat) --------------------------------

describe('makeSingleConnectionRouter — single-connection back-compat', () => {
  it('switching to a same-kind mode succeeds (relay-live removed #665)', async () => {
    const conn = new FakeConn('relay', [
      { id: 'r1', title: 'app', url: 'https://r1.private-apps.tossmini.com/app' },
    ]);
    const router = makeSingleConnectionRouter(conn);
    const dev = await router.switchMode('relay-staging');
    // Output env layer is 'relay-dev' from deriveEnvironment.
    expect(dev.environment).toBe('relay-dev');
    // liveGuardActive removed from ModeSwitchReport (#665)
  });

  it('relay-live is not a valid mode any more (#665)', async () => {
    // normalizeStartDebugMode rejects relay-live before switchMode is called.
    expect(normalizeStartDebugMode('relay-live')).toBeNull();
  });

  it('cross-family switch is rejected (single connection cannot lazy-boot the other)', async () => {
    const conn = new FakeConn('relay');
    const router = makeSingleConnectionRouter(conn);
    await expect(router.switchMode('local-browser')).rejects.toThrow(/동적 전환할 수 없습니다/);
  });

  it('relay-sandbox switch is rejected — cannot synthesize the env-2 external relay (#378)', async () => {
    // Even from a relay connection, `relay-sandbox` needs a DISTINCT external-PWA relay
    // family this single-connection router cannot boot.
    const conn = new FakeConn('relay', [
      { id: 'r1', title: 'app', url: 'https://r1.private-apps.tossmini.com/app' },
    ]);
    const router = makeSingleConnectionRouter(conn);
    await expect(router.switchMode('relay-sandbox')).rejects.toThrow(/동적 전환할 수 없습니다/);
    // The discriminator is absent on a single-connection router.
    expect(router.activeRelayOrigin).toBeUndefined();
  });

  it('local connection accepts local-browser mode but rejects relay modes', async () => {
    const conn = new FakeConn('local');
    const router = makeSingleConnectionRouter(conn);
    const report = await router.switchMode('local-browser');
    expect(report.environment).toBe('mock');
    await expect(router.switchMode('relay-staging')).rejects.toThrow(/동적 전환할 수 없습니다/);
  });
});
