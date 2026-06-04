/**
 * `DualConnectionRouter` direction-symmetry tests (issue #356).
 *
 * #354 introduced the dual-connection router but wired it only into the
 * relay-launched `runDebugServer`. A `--target=local` start (`runLocalDebugServer`)
 * still pinned a single-connection router, so a cross-family `start_debug`
 * (local → relay) was rejected as "restart required". #356 generalizes the
 * router to be **direction-neutral**: an `eager` family (booted at startup) and
 * a lazy resolver (booted once on the first cross-family switch). Either kind
 * can be eager. #378 generalizes the lazy slot from a single "opposite kind"
 * into a `bootLazyFor(key: FamilyKey)` resolver keyed by
 * `local | relay-intoss | relay-external`, so `mobile` (env-2 external relay)
 * and `staging`/`live` (intoss relay) — both `kind: 'relay'` — get distinct warm
 * slots.
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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CdpCommandMap,
  CdpCommandName,
  CdpConnection,
  CdpEventMap,
  CdpEventName,
  CdpTarget,
} from '../cdp-connection.js';
import {
  type BootedFamily,
  bootExternalRelayFamily,
  DualConnectionRouter,
  type FamilyKey,
  familyKeyForMode,
  MOBILE_RELAY_BASE_URL_MISSING_MESSAGE,
  readMobileRelayBaseUrl,
  type StartDebugMode,
} from '../debug-server.js';
import { AutoDevtoolsOpener } from '../devtools-opener.js';
import { getLiveIntent, type RelayOrigin, setLiveIntent } from '../environment.js';
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
  relayOrigin?: RelayOrigin,
): BootedFamily & { stopped: number } {
  const family = {
    connection: new FakeConn(kind),
    stopped: 0,
    stop() {
      family.stopped += 1;
    },
    ...(tunnel ? { getTunnelStatus: () => tunnel } : {}),
    ...(relayOrigin ? { relayOrigin } : {}),
  };
  return family;
}

/** The `FamilyKey` for the family of a given eager kind (helper symmetry). */
function eagerKeyFor(eagerKind: 'relay' | 'local'): FamilyKey {
  return eagerKind === 'relay' ? 'relay-intoss' : 'local';
}

/**
 * Builds a router where `eagerKind` is the eager family and the OPPOSITE kind is
 * a single warm lazy family resolved for whichever non-eager key is requested.
 * The existing #356 suite only swaps between local and the intoss relay, so the
 * resolver returns the same `lazy` family for any non-eager key — the dedicated
 * #378 `relay-external` (mobile) slot is exercised separately below.
 */
function makeRouter(
  eagerKind: 'relay' | 'local',
  opts: { eagerTunnel?: TunnelStatus; lazyTunnel?: TunnelStatus } = {},
) {
  const eager = makeFamily(eagerKind, opts.eagerTunnel);
  const lazyKind: 'relay' | 'local' = eagerKind === 'relay' ? 'local' : 'relay';
  let lazyBootCount = 0;
  const lazy = makeFamily(lazyKind, opts.lazyTunnel);
  const bootLazyFor = vi.fn(async (_key: FamilyKey) => {
    lazyBootCount += 1;
    return lazy;
  });
  const router = new DualConnectionRouter({
    eager,
    eagerKey: eagerKeyFor(eagerKind),
    bootLazyFor,
    diagnosticsCollector: new InMemoryDiagnosticsCollector(),
    devtoolsOpener: new AutoDevtoolsOpener(),
  });
  return {
    router,
    eager,
    lazy,
    bootLazyFor,
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
    const bootLazyFor = vi.fn(async (_key: FamilyKey) => {
      await gate;
      return lazy;
    });
    const router = new DualConnectionRouter({
      eager,
      eagerKey: 'local',
      bootLazyFor,
      diagnosticsCollector: new InMemoryDiagnosticsCollector(),
      devtoolsOpener: new AutoDevtoolsOpener(),
    });

    const first = router.switchMode('staging', false);
    // Second call arrives while the first is awaiting the lazy boot.
    await expect(router.switchMode('staging', false)).rejects.toThrow(/이전 전환이 아직 진행 중/);
    release();
    await first;
    expect(bootLazyFor).toHaveBeenCalledTimes(1);
    expect(router.active).toBe(lazy.connection);
  });
});

// ---- #378: env-2 external relay (mobile) is a distinct keyed family ---------

describe('DualConnectionRouter — mobile (relay-external) keyed family (#378)', () => {
  const intossTunnel: TunnelStatus = { up: true, wssUrl: 'wss://intoss.trycloudflare.com' };
  const externalTunnel: TunnelStatus = { up: true, wssUrl: 'wss://pwa.trycloudflare.com' };

  /**
   * Builds a local-eager router with TWO distinct relay slots — an intoss relay
   * (`relay-intoss`, served to staging/live) and an external PWA relay
   * (`relay-external`, served to mobile) — so a collision between them would be
   * observable (the wrong family / origin would surface).
   */
  function makeKeyedRouter() {
    const eager = makeFamily('local');
    const intoss = makeFamily('relay', intossTunnel, 'intoss-webview');
    const external = makeFamily('relay', externalTunnel, 'external-pwa');
    const bootCounts: Record<FamilyKey, number> = {
      local: 0,
      'relay-intoss': 0,
      'relay-external': 0,
    };
    const bootLazyFor = vi.fn(async (key: FamilyKey) => {
      bootCounts[key] += 1;
      if (key === 'relay-external') return external;
      if (key === 'relay-intoss') return intoss;
      return eager;
    });
    const router = new DualConnectionRouter({
      eager,
      eagerKey: 'local',
      bootLazyFor,
      diagnosticsCollector: new InMemoryDiagnosticsCollector(),
      devtoolsOpener: new AutoDevtoolsOpener(),
    });
    return { router, eager, intoss, external, bootLazyFor, bootCounts };
  }

  it('mobile lazy-boots the external relay family and derives relay-mobile', async () => {
    const { router, external, bootCounts } = makeKeyedRouter();
    const report = await router.switchMode('mobile', false);
    expect(report.kind).toBe('relay');
    // External-PWA origin → relay-mobile (NOT relay-dev, NOT live).
    expect(report.environment).toBe('relay-mobile');
    expect(report.liveGuardActive).toBe(false);
    expect(router.active).toBe(external.connection);
    expect(router.activeRelayOrigin).toBe('external-pwa');
    expect(bootCounts['relay-external']).toBe(1);
    expect(getLiveIntent()).toBe(false);
  });

  it('mobile and staging occupy SEPARATE warm slots — no collision (#378)', async () => {
    const { router, intoss, external, bootCounts } = makeKeyedRouter();
    // staging boots the intoss relay…
    await router.switchMode('staging', false);
    expect(router.active).toBe(intoss.connection);
    expect(router.activeRelayOrigin).toBe('intoss-webview');
    // …mobile boots the SEPARATE external relay (does not reuse the intoss slot).
    const mobileReport = await router.switchMode('mobile', false);
    expect(router.active).toBe(external.connection);
    expect(mobileReport.environment).toBe('relay-mobile');
    // …back to staging reuses the warm intoss relay (no re-boot).
    const stagingReport = await router.switchMode('staging', false);
    expect(router.active).toBe(intoss.connection);
    expect(stagingReport.environment).toBe('relay-dev');
    // Each relay family booted exactly once — the two slots never collided.
    expect(bootCounts['relay-intoss']).toBe(1);
    expect(bootCounts['relay-external']).toBe(1);
  });

  it('relayTunnelStatus() follows the ACTIVE relay family across mobile/staging', async () => {
    const { router } = makeKeyedRouter();
    await router.switchMode('mobile', false);
    expect(router.relayTunnelStatus()).toEqual(externalTunnel);
    await router.switchMode('staging', false);
    expect(router.relayTunnelStatus()).toEqual(intossTunnel);
  });

  it('bootedFamilies() lists eager + both relay slots after both switches', async () => {
    const { router, eager, intoss, external } = makeKeyedRouter();
    await router.switchMode('staging', false);
    await router.switchMode('mobile', false);
    const families = router.bootedFamilies();
    expect(families).toContain(eager);
    expect(families).toContain(intoss);
    expect(families).toContain(external);
    expect(families).toHaveLength(3);
  });
});

// ---- #378: family-key mapping + external relay boot + env-var read ----------

describe('familyKeyForMode (#378)', () => {
  it('maps each mode to its serving family slot', () => {
    expect(familyKeyForMode('local')).toBe('local');
    expect(familyKeyForMode('mobile')).toBe('relay-external');
    expect(familyKeyForMode('staging')).toBe('relay-intoss');
    expect(familyKeyForMode('live')).toBe('relay-intoss');
  });
});

describe('readMobileRelayBaseUrl (#378) — SECRET-HANDLING', () => {
  it('returns the trimmed AIT_RELAY_BASE_URL when present', () => {
    expect(readMobileRelayBaseUrl({ AIT_RELAY_BASE_URL: '  https://relay.example  ' })).toBe(
      'https://relay.example',
    );
  });

  it('throws the precise missing-URL message when unset or empty', () => {
    expect(() => readMobileRelayBaseUrl({})).toThrow(MOBILE_RELAY_BASE_URL_MISSING_MESSAGE);
    expect(() => readMobileRelayBaseUrl({ AIT_RELAY_BASE_URL: '   ' })).toThrow(
      MOBILE_RELAY_BASE_URL_MISSING_MESSAGE,
    );
  });

  it('the missing-URL message names the env var but echoes NO URL value', () => {
    // The error guides the user by env-var NAME, never by leaking a (partial)
    // relay host value — same sensitivity class as a wss URL.
    expect(MOBILE_RELAY_BASE_URL_MISSING_MESSAGE).toContain('AIT_RELAY_BASE_URL');
    expect(MOBILE_RELAY_BASE_URL_MISSING_MESSAGE).not.toMatch(/wss?:\/\//);
    expect(MOBILE_RELAY_BASE_URL_MISSING_MESSAGE).not.toMatch(/https?:\/\//);
  });
});

describe('bootExternalRelayFamily (#378)', () => {
  // Relay-auth baseline (#250): bootExternalRelayFamily now asserts a configured
  // TOTP secret before opening the CDP client, so a valid hex secret must be set.
  // 64 hex chars = 32 bytes. No secret value is logged.
  const VALID_HEX_SECRET = 'deadbeef'.repeat(8);
  beforeEach(() => {
    process.env.AIT_DEBUG_TOTP_SECRET = VALID_HEX_SECRET;
  });
  afterEach(() => {
    delete process.env.AIT_DEBUG_TOTP_SECRET;
  });

  it('opens a relay CDP client tagged external-pwa, derives wss, and owns only the client', async () => {
    const family = await bootExternalRelayFamily('https://relay.example');
    expect(family.connection.kind).toBe('relay');
    expect(family.relayOrigin).toBe('external-pwa');
    // wss derived http→ws so build_attach_url's `up && wssUrl` gate is satisfied
    // even though we never opened a cloudflared tunnel ourselves.
    expect(family.getTunnelStatus?.()).toEqual({
      up: true,
      wssUrl: 'wss://relay.example',
      droppedAt: null,
      reissueAttempts: 0,
    });
    // stop() must not throw — it closes ONLY our CDP client (unplugin owns relay).
    expect(() => family.stop()).not.toThrow();
  });
});

// Relay-auth baseline wiring (issue #250): the guard lives in the relay-boot
// site, so booting an external (public-tunnel) relay WITHOUT a configured secret
// must fail fast before any CDP client opens. This proves the guard is wired
// into the boot path (not just the standalone unit in relay-auth-required.test.ts).
describe('bootExternalRelayFamily — relay-auth baseline (#250)', () => {
  beforeEach(() => {
    delete process.env.AIT_DEBUG_TOTP_SECRET;
  });
  afterEach(() => {
    delete process.env.AIT_DEBUG_TOTP_SECRET;
  });

  it('rejects boot when AIT_DEBUG_TOTP_SECRET is unset (public relay must be authed)', async () => {
    await expect(bootExternalRelayFamily('https://relay.example')).rejects.toThrow(
      /AIT_DEBUG_TOTP_SECRET/,
    );
  });

  it('rejects boot when AIT_DEBUG_TOTP_SECRET is a weak (non-hex) value', async () => {
    process.env.AIT_DEBUG_TOTP_SECRET = 'Z'.repeat(40);
    await expect(bootExternalRelayFamily('https://relay.example')).rejects.toThrow(
      /AIT_DEBUG_TOTP_SECRET/,
    );
  });
});

// Local-only exemption (issue #250): `bootLocalFamily` launches a Chromium and
// NEVER opens a relay, so it must not call the relay-auth guard. We do NOT boot a
// real Chromium here (heavy/flaky); the exemption is structural — `bootLocalFamily`
// has no `assertRelayAuthConfigured` call in its body, and a local-only session
// only ever resolves the 'local' family key. The relay-boot wiring tests above
// (which DO throw without a secret) confirm the guard is exclusive to relay boots.
//
// Pin the mode-type so an accidental literal typo fails to compile.
const _exhaustive: StartDebugMode[] = ['local', 'mobile', 'staging', 'live'];
void _exhaustive;
