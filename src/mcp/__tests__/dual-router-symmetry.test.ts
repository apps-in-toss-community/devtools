/**
 * `DualConnectionRouter` direction-symmetry tests (issue #356).
 *
 * #354 introduced the dual-connection router but wired it only into the
 * relay-launched `runDebugServer`. A `--target=local` start (`runLocalDebugServer`)
 * still pinned a single-connection router, so a cross-family `start_debug`
 * (local → relay) was rejected as "restart required". #356 generalizes the
 * router to be **direction-neutral**: an `eager` family (booted at startup) and
 * a `bootLazy` callback (the opposite kind, booted once on the first
 * cross-family switch). Either kind can be eager.
 *
 * This suite exercises the real `DualConnectionRouter` (not a test double) with
 * fake `BootedFamily` deps, over the matrix:
 *   (eager-kind: relay | local) × (switch target: same-family | cross-family)
 *
 * It covers the #356 core (local-eager → relay hot-switch), warm reuse of the
 * lazily-booted family, the relay-live confirm gate from a local-eager start,
 * `relayTunnelStatus()` sourcing, and `bootedFamilies()` for unified shutdown.
 *
 * No real Chromium / relay / tunnel — fakes only.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CdpCommandMap,
  CdpCommandName,
  CdpConnection,
  CdpEventMap,
  CdpEventName,
  CdpTarget,
} from '../cdp-connection.js';
import { type BootedFamily, DualConnectionRouter, type StartDebugMode } from '../debug-server.js';
import { AutoDevtoolsOpener } from '../devtools-opener.js';
import { getLiveIntent, setLiveIntent } from '../environment.js';
import { InMemoryDiagnosticsCollector, type TunnelStatus } from '../tools.js';

// ---- Fakes -----------------------------------------------------------------

class FakeConn implements CdpConnection {
  readonly kind: 'relay' | 'local';
  constructor(kind: 'relay' | 'local') {
    this.kind = kind;
  }
  enableDomains(): Promise<void> {
    return Promise.resolve();
  }
  listTargets(): CdpTarget[] {
    return [];
  }
  getBufferedEvents<E extends CdpEventName>(_e: E): ReadonlyArray<CdpEventMap[E]> {
    return [];
  }
  on(): () => void {
    return () => {};
  }
  send<M extends CdpCommandName>(_m: M): Promise<CdpCommandMap[M]['result']> {
    return Promise.reject(new Error(`no canned result for ${_m}`));
  }
}

/** A `BootedFamily` fake that tracks teardown and (for relay) tunnel status. */
function makeFamily(
  kind: 'relay' | 'local',
  tunnel?: TunnelStatus,
): BootedFamily & { stopped: number } {
  const family = {
    connection: new FakeConn(kind),
    stopped: 0,
    stop() {
      family.stopped += 1;
    },
    ...(tunnel ? { getTunnelStatus: () => tunnel } : {}),
  };
  return family;
}

function makeRouter(
  eagerKind: 'relay' | 'local',
  opts: { eagerTunnel?: TunnelStatus; lazyTunnel?: TunnelStatus } = {},
) {
  const eager = makeFamily(eagerKind, opts.eagerTunnel);
  const lazyKind: 'relay' | 'local' = eagerKind === 'relay' ? 'local' : 'relay';
  let lazyBootCount = 0;
  const lazy = makeFamily(lazyKind, opts.lazyTunnel);
  const bootLazy = vi.fn(async () => {
    lazyBootCount += 1;
    return lazy;
  });
  const router = new DualConnectionRouter({
    eager,
    bootLazy,
    diagnosticsCollector: new InMemoryDiagnosticsCollector(),
    devtoolsOpener: new AutoDevtoolsOpener(),
  });
  return {
    router,
    eager,
    lazy,
    bootLazy,
    getLazyBootCount: () => lazyBootCount,
  };
}

// The module-level liveIntent bit must not leak across tests.
afterEach(() => setLiveIntent(false));

// ---- (eager-kind × target) matrix ------------------------------------------

describe('DualConnectionRouter — relay-eager (runDebugServer entry, #354 behavior preserved)', () => {
  it('starts active on the eager relay family, never booting the lazy local', () => {
    const { router, eager, getLazyBootCount } = makeRouter('relay');
    expect(router.active).toBe(eager.connection);
    expect(getLazyBootCount()).toBe(0);
  });

  it('same-family switch (staging) stays on eager, no lazy boot', async () => {
    const { router, eager, getLazyBootCount } = makeRouter('relay');
    const report = await router.switchMode('staging', false);
    expect(report.kind).toBe('relay');
    // Output env layer unchanged ('relay-dev' from deriveEnvironment).
    expect(report.environment).toBe('relay-dev');
    expect(router.active).toBe(eager.connection);
    expect(getLazyBootCount()).toBe(0);
  });

  it('cross-family switch (relay → local) lazy-boots local once', async () => {
    const { router, lazy, getLazyBootCount } = makeRouter('relay');
    const report = await router.switchMode('local', false);
    expect(report.kind).toBe('local');
    expect(report.environment).toBe('mock');
    expect(router.active).toBe(lazy.connection);
    expect(getLazyBootCount()).toBe(1);
  });
});

describe('DualConnectionRouter — local-eager (runLocalDebugServer entry, #356 core)', () => {
  it('starts active on the eager local family, never booting the lazy relay', () => {
    const { router, eager, getLazyBootCount } = makeRouter('local');
    expect(router.active).toBe(eager.connection);
    expect(router.active.kind).toBe('local');
    expect(getLazyBootCount()).toBe(0);
  });

  it('same-family switch (local) stays on eager, no lazy boot', async () => {
    const { router, eager, getLazyBootCount } = makeRouter('local');
    const report = await router.switchMode('local', false);
    expect(report.kind).toBe('local');
    expect(report.environment).toBe('mock');
    expect(router.active).toBe(eager.connection);
    expect(getLazyBootCount()).toBe(0);
  });

  it('CROSS-FAMILY HOT-SWITCH local → staging lazy-boots relay once (#356)', async () => {
    const { router, lazy, getLazyBootCount } = makeRouter('local');
    expect(router.active.kind).toBe('local');
    const report = await router.switchMode('staging', false);
    expect(report.kind).toBe('relay');
    // Output env layer unchanged ('relay-dev' from deriveEnvironment).
    expect(report.environment).toBe('relay-dev');
    // The active pointer flipped to the lazily-booted relay — no restart needed.
    expect(router.active).toBe(lazy.connection);
    expect(getLazyBootCount()).toBe(1);
  });
});

// ---- lazy boot happens exactly once, warm reuse afterwards -----------------

describe('DualConnectionRouter — lazy boot is once-only, family kept warm', () => {
  it('local-eager: relay is booted on first relay switch, reused on the second', async () => {
    const { router, eager, lazy, getLazyBootCount } = makeRouter('local');
    await router.switchMode('staging', false);
    expect(getLazyBootCount()).toBe(1);
    // Bounce back to local (same-kind as eager — reuses eager, no boot).
    await router.switchMode('local', false);
    expect(router.active).toBe(eager.connection);
    expect(getLazyBootCount()).toBe(1);
    // Return to relay — the warm relay family is reused, NOT re-booted.
    await router.switchMode('staging', false);
    expect(router.active).toBe(lazy.connection);
    expect(getLazyBootCount()).toBe(1);
  });
});

// ---- relay-live confirm gate from a local-eager start (#356) ---------------

describe('DualConnectionRouter — live confirm gate (direction-neutral)', () => {
  it('local-eager → live without confirm is rejected and does not boot relay', async () => {
    const { router, getLazyBootCount } = makeRouter('local');
    await expect(router.switchMode('live', false)).rejects.toThrow(/confirm: true/);
    // Still on local; the lazy relay was never booted.
    expect(router.active.kind).toBe('local');
    expect(getLazyBootCount()).toBe(0);
    expect(getLiveIntent()).toBe(false);
  });

  it('local-eager → live with confirm:true arms the LIVE guard', async () => {
    const { router, lazy } = makeRouter('local');
    const report = await router.switchMode('live', true);
    // Output env layer unchanged ('relay-live' from deriveEnvironment).
    expect(report.environment).toBe('relay-live');
    expect(report.kind).toBe('relay');
    expect(report.liveGuardActive).toBe(true);
    expect(router.active).toBe(lazy.connection);
    expect(getLiveIntent()).toBe(true);
  });

  it('live → local disarms liveIntent (inert against local)', async () => {
    const { router } = makeRouter('local');
    await router.switchMode('live', true);
    expect(getLiveIntent()).toBe(true);
    const report = await router.switchMode('local', false);
    expect(report.liveGuardActive).toBe(false);
    expect(getLiveIntent()).toBe(false);
  });
});

// ---- relayTunnelStatus() sourcing ------------------------------------------

describe('DualConnectionRouter — relayTunnelStatus()', () => {
  const upTunnel: TunnelStatus = { up: true, wssUrl: 'wss://abc.trycloudflare.com' };

  it('relay-eager: reads the eager relay tunnel immediately', () => {
    const { router } = makeRouter('relay', { eagerTunnel: upTunnel });
    expect(router.relayTunnelStatus()).toEqual(upTunnel);
  });

  it('local-eager: reports down before the relay is booted, then follows it', async () => {
    const { router } = makeRouter('local', { lazyTunnel: upTunnel });
    // No relay family yet → tunnel is down (build_attach_url stays gated).
    expect(router.relayTunnelStatus()).toEqual({ up: false, wssUrl: null });
    await router.switchMode('staging', false);
    // After the relay switch the relay family's tunnel status is exposed.
    expect(router.relayTunnelStatus()).toEqual(upTunnel);
  });
});

// ---- bootedFamilies() for unified shutdown ---------------------------------

describe('DualConnectionRouter — bootedFamilies() drives unified shutdown', () => {
  it('local-eager: only the eager family before a cross switch, both after', async () => {
    const { router, eager, lazy } = makeRouter('local');
    expect(router.bootedFamilies()).toEqual([eager]);
    await router.switchMode('staging', false);
    expect(router.bootedFamilies()).toEqual([eager, lazy]);
    // Tearing down every booted family stops both (one Chromium + one relay).
    for (const family of router.bootedFamilies()) family.stop();
    expect(eager.stopped).toBe(1);
    expect(lazy.stopped).toBe(1);
  });
});

// ---- swapInFlight re-entrancy guard (preserved from #354) ------------------

describe('DualConnectionRouter — swapInFlight re-entrancy guard', () => {
  it('rejects a second switch while the first lazy boot is still in flight', async () => {
    const eager = makeFamily('local');
    const lazy = makeFamily('relay');
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const bootLazy = vi.fn(async () => {
      await gate;
      return lazy;
    });
    const router = new DualConnectionRouter({
      eager,
      bootLazy,
      diagnosticsCollector: new InMemoryDiagnosticsCollector(),
      devtoolsOpener: new AutoDevtoolsOpener(),
    });

    const first = router.switchMode('staging', false);
    // Second call arrives while the first is awaiting the lazy boot.
    await expect(router.switchMode('staging', false)).rejects.toThrow(/이전 전환이 아직 진행 중/);
    release();
    await first;
    expect(bootLazy).toHaveBeenCalledTimes(1);
    expect(router.active).toBe(lazy.connection);
  });
});

// Pin the mode-type so an accidental literal typo fails to compile.
const _exhaustive: StartDebugMode[] = ['local', 'staging', 'live'];
void _exhaustive;
