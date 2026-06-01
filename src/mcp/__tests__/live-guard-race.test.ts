/**
 * Regression tests for the #354 (dual-connection router) per-call snapshot
 * defects fixed in this change:
 *
 *   - Defect B (SECURITY — LIVE guard false→true race): the side-effect guard
 *     (`evaluate` / `call_sdk`) used to read the STALE entry-time `env`. A
 *     concurrent `start_debug('relay-live')` that armed `liveIntent` while the
 *     call was parked on an `await` would slip past the guard and execute a
 *     LIVE side-effect WITHOUT `confirm: true`. The guard now reads
 *     `conn.kind === 'relay' && getLiveIntent()` (snapshot conn.kind + FRESH
 *     liveIntent) at the side-effect boundary, so the race is rejected.
 *
 *   - Defect A (per-call env snapshot): output sites used to re-call
 *     `resolveEnvironment()` after an `await`, so a mid-flight swap could stamp
 *     the WRONG env into the response envelope. The handler now snapshots
 *     `env`/`envReason` once at entry and reuses them.
 *
 * Injection point: the handler `await conn.enableDomains()` sits AFTER the
 * stale `env` capture and BEFORE the LIVE guard / the output `envelopeResult`,
 * so a fake whose `enableDomains` flips `liveIntent` faithfully simulates a
 * concurrent `start_debug('relay-live')` interleaving on that await.
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
import { createDebugServer } from '../debug-server.js';
import { getLiveIntent, setLiveIntent } from '../environment.js';
import type { TunnelStatus } from '../tools.js';

// ---- Fakes ------------------------------------------------------------------

/**
 * Relay-kind fake whose `enableDomains` runs an optional hook on the first call
 * — used to flip `liveIntent` (simulating a concurrent `start_debug`) on the
 * exact `await` the handler suspends on before reaching the LIVE guard.
 */
class HookableRelayConn implements CdpConnection {
  readonly kind = 'relay' as const;
  private fired = false;

  constructor(private readonly onFirstEnable?: () => void) {}

  async enableDomains(): Promise<void> {
    if (!this.fired && this.onFirstEnable) {
      this.fired = true;
      // Yield a microtask so the swap lands while the handler is genuinely
      // suspended on this await, not synchronously inline.
      await Promise.resolve();
      this.onFirstEnable();
    }
  }
  listTargets(): CdpTarget[] {
    return [{ id: 'r1', title: 'app', url: 'intoss-private://app' }];
  }
  getBufferedEvents<E extends CdpEventName>(_e: E): ReadonlyArray<CdpEventMap[E]> {
    return [];
  }
  on(): () => void {
    return () => {};
  }
  send<M extends CdpCommandName>(method: M): Promise<CdpCommandMap[M]['result']> {
    if ((method as string) === 'Runtime.evaluate') {
      return Promise.resolve({
        result: { type: 'string', value: JSON.stringify({ ok: true, value: null }) },
      } as CdpCommandMap[M]['result']);
    }
    return Promise.reject(new Error(`no canned result for ${method}`));
  }
}

class FakeAitSource implements AitSource {
  get<M extends AitMethodName>(_m: M): Promise<AitMethodMap[M]> {
    return Promise.reject(new Error('no canned AIT response'));
  }
}

async function makeClient(conn: CdpConnection): Promise<Client> {
  const tunnel: TunnelStatus = { up: true, wssUrl: 'wss://abc.trycloudflare.com' };
  // No getEnvironment injection — exercise the real derived resolver
  // (deriveEnvironment(conn.kind, liveIntent)) so the snapshot path is real.
  const server = createDebugServer({
    connection: conn,
    aitSource: new FakeAitSource(),
    getTunnelStatus: () => tunnel,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'live-guard-race-test', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

function getText(result: Awaited<ReturnType<Client['callTool']>>): string {
  return (result.content as Array<{ text?: string }>)[0]?.text ?? '';
}

// Each test resets the module-level liveIntent bit so it never leaks.
afterEach(() => setLiveIntent(false));

// ---- Defect B: LIVE guard false→true race ----------------------------------

describe('LIVE guard — false→true race (concurrent start_debug arms liveIntent mid-await)', () => {
  it('rejects evaluate when liveIntent flips to true during the pre-guard await', async () => {
    // Start in relay-dev (unguarded): liveIntent is false at handler entry, so
    // the stale-env logic would compute env=relay-dev and NOT guard.
    setLiveIntent(false);
    // The handler suspends on enableDomains() — flip liveIntent there to mimic a
    // concurrent start_debug('relay-live') landing on that await.
    const conn = new HookableRelayConn(() => setLiveIntent(true));
    const client = await makeClient(conn);

    const result = await client.callTool({
      name: 'evaluate',
      arguments: { expression: 'window.__sdk.closeView()' }, // no confirm
    });

    // With the fix, the guard reads FRESH liveIntent (now true) → rejects.
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('LIVE relay guard');
    // The flip actually happened (sanity: the await hook ran).
    expect(getLiveIntent()).toBe(true);
  });

  it('rejects call_sdk when liveIntent flips to true during the pre-guard await', async () => {
    setLiveIntent(false);
    const conn = new HookableRelayConn(() => setLiveIntent(true));
    const client = await makeClient(conn);

    const result = await client.callTool({
      name: 'call_sdk',
      arguments: { name: 'closeView', args: [] }, // no confirm
    });

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('LIVE relay guard');
    expect(getLiveIntent()).toBe(true);
  });

  it('still allows the side-effect when confirm:true even if liveIntent flips', async () => {
    setLiveIntent(false);
    const conn = new HookableRelayConn(() => setLiveIntent(true));
    const client = await makeClient(conn);

    const result = await client.callTool({
      name: 'evaluate',
      arguments: { expression: '1 + 1', confirm: true },
    });

    // confirm:true is the operator-acknowledged escape hatch — guard passes.
    expect(getText(result)).not.toContain('LIVE relay guard');
  });
});

// ---- Defect A: per-call env snapshot in the response envelope --------------

describe('per-call env snapshot — output envelope reflects entry-time env', () => {
  it('measure_safe_area stamps the entry-time env even when liveIntent flips mid-await', async () => {
    // Entry env = relay-dev. A concurrent flip to relay-live mid-await must NOT
    // change the env stamped into THIS call's envelope (per-call snapshot).
    setLiveIntent(false);
    const conn = new HookableRelayConn(() => setLiveIntent(true));
    const client = await makeClient(conn);

    const result = await client.callTool({ name: 'measure_safe_area', arguments: {} });
    const payload = JSON.parse(getText(result)) as { meta?: { env?: string } };

    // Snapshot env (relay-dev) — NOT the post-flip relay-live.
    expect(payload.meta?.env).toBe('relay-dev');
    // The flip did happen, proving the env was captured pre-flip.
    expect(getLiveIntent()).toBe(true);
  });
});
