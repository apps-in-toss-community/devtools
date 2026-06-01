/**
 * `start_debug` dual-connection router tests (issue #348).
 *
 * Verifies the DUAL-CONNECTION-COEXIST design:
 *   - `start_debug` is a bootstrap tool — visible before any attach, in every env.
 *   - Switching mode flips the active connection underneath the SAME MCP
 *     `Server` (no re-handshake): tools read through `router.active` per call.
 *   - The mode-switch report reflects the now-active env + LIVE guard state.
 *   - `relay-live` requires `confirm: true` on the `start_debug` call itself.
 *   - The LIVE guard matrix over (connection.kind × liveIntent):
 *       relay + liveIntent + no confirm   → reject
 *       relay + liveIntent + confirm:true → pass
 *       local + liveIntent (stale bit)    → pass (inert against local)
 *       relay + liveIntent=false          → pass
 *   - `normalizeStartDebugMode` / `isRelayMode` / `makeSingleConnectionRouter`
 *     pure helpers.
 *
 * No real Chromium / relay infra — a `TestRouter` holds two fake connections and
 * flips `active`, exactly as the production `DualConnectionRouter` does.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
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
import { deriveEnvironment, getLiveIntent, setLiveIntent } from '../environment.js';
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
 * flips `active` like the production `DualConnectionRouter`, including the
 * `liveIntent` arm/disarm and the relay-live confirm gate. No watcher / infra.
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
      relayAttached ? [{ id: 'r1', title: 'app', url: 'intoss-private://app' }] : [],
    );
    this.current = initial === 'relay' ? this.relay : this.local;
  }

  get active(): CdpConnection {
    return this.current;
  }

  switchMode(mode: StartDebugMode, confirm: boolean): Promise<ModeSwitchReport> {
    if (mode === 'relay-live' && !confirm) {
      return Promise.reject(new Error('start_debug: relay-live는 confirm: true가 필요합니다'));
    }
    const target = isRelayMode(mode) ? this.relay : this.local;
    this.current = target;
    setLiveIntent(mode === 'relay-live');
    this.listChangedCount++;
    const environment = deriveEnvironment(target.kind, getLiveIntent());
    return Promise.resolve({
      mode,
      environment,
      kind: target.kind,
      liveGuardActive: target.kind === 'relay' && getLiveIntent(),
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

// Each test resets liveIntent so the module-level bit does not leak.
afterEach(() => setLiveIntent(false));

// ---- pure helpers ----------------------------------------------------------

describe('normalizeStartDebugMode', () => {
  it('accepts the four modes', () => {
    expect(normalizeStartDebugMode('local-browser-dev')).toBe('local-browser-dev');
    expect(normalizeStartDebugMode('local-browser-cdp')).toBe('local-browser-cdp');
    expect(normalizeStartDebugMode('relay-dev')).toBe('relay-dev');
    expect(normalizeStartDebugMode('relay-live')).toBe('relay-live');
  });
  it('rejects anything else', () => {
    expect(normalizeStartDebugMode('mock')).toBeNull();
    expect(normalizeStartDebugMode('')).toBeNull();
    expect(normalizeStartDebugMode(undefined)).toBeNull();
    expect(normalizeStartDebugMode(42)).toBeNull();
  });
});

describe('isRelayMode', () => {
  it('relay-dev / relay-live are relay; local modes are not', () => {
    expect(isRelayMode('relay-dev')).toBe(true);
    expect(isRelayMode('relay-live')).toBe(true);
    expect(isRelayMode('local-browser-dev')).toBe(false);
    expect(isRelayMode('local-browser-cdp')).toBe(false);
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
      arguments: { mode: 'local-browser-cdp' },
    });
    const report = parseReport(result);
    expect(report.mode).toBe('local-browser-cdp');
    expect(report.environment).toBe('mock');
    expect(report.kind).toBe('local');
    expect(report.liveGuardActive).toBe(false);
    // The active pointer actually flipped (no re-handshake — same server/client).
    expect(router.active.kind).toBe('local');
    // A list_changed notification was emitted on the switch.
    expect(router.listChangedCount).toBe(1);
  });

  it('local → relay-dev switch reports relay-dev, guard off', async () => {
    const router = new TestRouter('local');
    const client = await makeClient(router);
    const report = parseReport(
      await client.callTool({ name: 'start_debug', arguments: { mode: 'relay-dev' } }),
    );
    expect(report.environment).toBe('relay-dev');
    expect(report.kind).toBe('relay');
    expect(report.liveGuardActive).toBe(false);
  });

  it('relay-live requires confirm:true on the start_debug call itself', async () => {
    const router = new TestRouter('relay');
    const client = await makeClient(router);
    const rejected = await client.callTool({
      name: 'start_debug',
      arguments: { mode: 'relay-live' },
    });
    expect(rejected.isError).toBe(true);
    // Still relay-dev — the unconfirmed live switch did not take.
    expect(router.active.kind).toBe('relay');
    expect(getLiveIntent()).toBe(false);
  });

  it('relay-live with confirm:true arms the LIVE guard', async () => {
    const router = new TestRouter('relay');
    const client = await makeClient(router);
    const report = parseReport(
      await client.callTool({
        name: 'start_debug',
        arguments: { mode: 'relay-live', confirm: true },
      }),
    );
    expect(report.environment).toBe('relay-live');
    expect(report.liveGuardActive).toBe(true);
    expect(getLiveIntent()).toBe(true);
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
    await client.callTool({ name: 'start_debug', arguments: { mode: 'relay-dev' } });
    // Switch to local, then immediately use a read tool — same session, no reconnect.
    await client.callTool({ name: 'start_debug', arguments: { mode: 'local-browser-dev' } });
    const list = await client.listTools();
    expect(list.tools.map((t) => t.name)).toContain('list_pages');
    expect(router.active.kind).toBe('local');
  });
});

// ---- LIVE guard matrix: (connection.kind × liveIntent) ---------------------

describe('LIVE guard matrix — (active connection.kind × liveIntent)', () => {
  it('relay + liveIntent + no confirm → reject', async () => {
    const router = new TestRouter('relay');
    const client = await makeClient(router);
    await client.callTool({
      name: 'start_debug',
      arguments: { mode: 'relay-live', confirm: true },
    });
    const result = await client.callTool({
      name: 'call_sdk',
      arguments: { name: 'getOperationalEnvironment' },
    });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('LIVE relay guard');
  });

  it('relay + liveIntent + confirm:true → pass', async () => {
    const router = new TestRouter('relay');
    const client = await makeClient(router);
    await client.callTool({
      name: 'start_debug',
      arguments: { mode: 'relay-live', confirm: true },
    });
    const result = await client.callTool({
      name: 'evaluate',
      arguments: { expression: '1 + 1', confirm: true },
    });
    expect(getText(result)).not.toContain('LIVE relay guard');
  });

  it('local + stale liveIntent → pass (guard inert against local target)', async () => {
    const router = new TestRouter('relay');
    const client = await makeClient(router);
    // Arm liveIntent on relay-live...
    await client.callTool({
      name: 'start_debug',
      arguments: { mode: 'relay-live', confirm: true },
    });
    expect(getLiveIntent()).toBe(true);
    // ...then switch to local. The bit stays true but is inert against local.
    await client.callTool({ name: 'start_debug', arguments: { mode: 'local-browser-cdp' } });
    // (TestRouter disarms on any non-live switch; assert guard is inert either way.)
    const result = await client.callTool({
      name: 'evaluate',
      arguments: { expression: '1 + 1' },
    });
    expect(getText(result)).not.toContain('LIVE relay guard');
    expect(router.active.kind).toBe('local');
  });

  it('relay + liveIntent=false (relay-dev) → pass unguarded', async () => {
    const router = new TestRouter('relay');
    const client = await makeClient(router);
    await client.callTool({ name: 'start_debug', arguments: { mode: 'relay-dev' } });
    const result = await client.callTool({
      name: 'call_sdk',
      arguments: { name: 'getOperationalEnvironment' },
    });
    expect(getText(result)).not.toContain('LIVE relay guard');
  });

  it('DISARM: relay-live → local-cdp disarms liveIntent', async () => {
    const router = new TestRouter('relay');
    const client = await makeClient(router);
    await client.callTool({
      name: 'start_debug',
      arguments: { mode: 'relay-live', confirm: true },
    });
    expect(getLiveIntent()).toBe(true);
    await client.callTool({ name: 'start_debug', arguments: { mode: 'local-browser-cdp' } });
    expect(getLiveIntent()).toBe(false);
  });
});

// ---- single-connection router (back-compat) --------------------------------

describe('makeSingleConnectionRouter — single-connection back-compat', () => {
  it('switching to a same-kind mode succeeds and arms/disarms liveIntent', async () => {
    const conn = new FakeConn('relay', [{ id: 'r1', title: 'app', url: 'intoss-private://app' }]);
    const router = makeSingleConnectionRouter(conn);
    const dev = await router.switchMode('relay-dev', false);
    expect(dev.environment).toBe('relay-dev');
    expect(getLiveIntent()).toBe(false);
    const live = await router.switchMode('relay-live', true);
    expect(live.environment).toBe('relay-live');
    expect(live.liveGuardActive).toBe(true);
    expect(getLiveIntent()).toBe(true);
  });

  it('relay-live without confirm is rejected', async () => {
    const conn = new FakeConn('relay');
    const router = makeSingleConnectionRouter(conn);
    await expect(router.switchMode('relay-live', false)).rejects.toThrow(/confirm: true/);
  });

  it('cross-family switch is rejected (single connection cannot lazy-boot the other)', async () => {
    const conn = new FakeConn('relay');
    const router = makeSingleConnectionRouter(conn);
    await expect(router.switchMode('local-browser-cdp', false)).rejects.toThrow(
      /동적 전환할 수 없습니다/,
    );
  });

  it('local connection accepts a local mode but rejects a relay mode', async () => {
    const conn = new FakeConn('local');
    const router = makeSingleConnectionRouter(conn);
    const report = await router.switchMode('local-browser-dev', false);
    expect(report.environment).toBe('mock');
    await expect(router.switchMode('relay-dev', false)).rejects.toThrow(/동적 전환할 수 없습니다/);
  });
});
