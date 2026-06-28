/**
 * Unit tests for the two behaviours introduced in issue #610:
 *
 * 1. **relay-sandbox URL diff → rebuild**
 *    `DualConnectionRouter.familyFor('relay-sandbox', …)` re-reads the relay
 *    URL via the injected `readSandboxRelayUrl` dep on every re-entry of a
 *    warm family. When the URL has rotated (dev server restarted with a new
 *    quick-tunnel) the stale family is torn down and a fresh one is booted.
 *    When the URL is unchanged (or unreadable) the warm family is reused.
 *
 * 2. **stale ghost page does NOT short-circuit wait_for_attach**
 *    `isSandboxPageFresh` (the pure function extracted from `start_attach`'s
 *    relay-mobile branch) gates on `lastSeenAt` age. A page whose
 *    `getTargetLastSeenAt` is older than `stalePageThresholdMs` is a ghost —
 *    the predicate returns false so the caller keeps polling.
 *
 * All tests are fake-timer-free. Time is injected via `nowMs` / `stalePageThresholdMs`.
 * No real relay, tunnel, or Chromium is involved.
 *
 * SECRET-HANDLING: relay URL values in this file are fake test strings. They
 * are never compared against production secrets and contain no real tunnel host.
 */
import { describe, expect, it, vi } from 'vitest';
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
  DualConnectionRouter,
  type FamilyKey,
  isSandboxPageFresh,
  RELAY_SANDBOX_STALE_PAGE_MS,
} from '../debug-server.js';
import { AutoDevtoolsOpener } from '../devtools-opener.js';
import { InMemoryDiagnosticsCollector } from '../tools.js';

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

/** Minimal `BootedFamily` fake with an optional relay URL. */
function makeFamily(
  kind: 'relay' | 'local',
  relayHttpUrl?: string,
): BootedFamily & { stopped: number } {
  const family = {
    connection: new FakeConn(kind),
    stopped: 0,
    stop() {
      family.stopped += 1;
    },
    ...(relayHttpUrl !== undefined ? { relayHttpUrl } : {}),
  };
  return family;
}

// liveIntent / setLiveIntent removed (#665) — no afterEach cleanup needed.

// ============================================================================
// 1. relay-sandbox URL diff → rebuild (issue #610 fix A)
// ============================================================================

describe('DualConnectionRouter — relay-sandbox URL diff triggers rebuild (#610)', () => {
  // Fake relay URLs. SECRET-HANDLING: these are test strings, not real tunnel hosts.
  const URL_A = 'https://relay-a.example';
  const URL_B = 'https://relay-b.example';

  /**
   * Builds an all-lazy router whose `readSandboxRelayUrl` can be controlled by
   * the test. Each key gets its own family counter so collision is observable.
   */
  function makeKeyedRouter(readSandboxRelayUrl: (pr?: string) => Promise<string | null>) {
    const sandboxFamilies: Array<BootedFamily & { stopped: number }> = [];
    const local = makeFamily('local');
    let bootCount = 0;

    const bootLazyFor = vi.fn(async (key: FamilyKey) => {
      if (key === 'relay-sandbox') {
        bootCount += 1;
        const f = makeFamily('relay', URL_A); // first boot always returns URL_A
        sandboxFamilies.push(f);
        return f;
      }
      return local;
    });

    const router = new DualConnectionRouter({
      bootLazyFor,
      diagnosticsCollector: new InMemoryDiagnosticsCollector(),
      devtoolsOpener: new AutoDevtoolsOpener(),
      readSandboxRelayUrl,
    });

    return { router, sandboxFamilies, local, bootLazyFor, getBootCount: () => bootCount };
  }

  it('same URL on re-entry — warm family is reused, no re-boot, stop() not called', async () => {
    // readSandboxRelayUrl always returns the SAME URL as the cached family.
    const { router, sandboxFamilies, getBootCount } = makeKeyedRouter(async () => URL_A);

    await router.switchMode('relay-sandbox');
    expect(getBootCount()).toBe(1);
    const first = sandboxFamilies[0];

    // Re-enter relay-sandbox — URL unchanged, so warm family must be reused.
    await router.switchMode('relay-sandbox');
    expect(getBootCount()).toBe(1); // no new boot
    expect(first.stopped).toBe(0); // no teardown
  });

  it('different URL on re-entry — stale family stopped, new family booted', async () => {
    // readSandboxRelayUrl always returns URL_B (the rotated URL after dev server restart).
    const readUrl = async () => URL_B;

    // Each boot creates a new family with the URL for that boot round.
    // We keep a mutable record of stop calls by index.
    const stopCounts: number[] = [];
    const relayUrls: string[] = [];
    let bootCount = 0;
    const urls = [URL_A, URL_B];

    const bootLazyFor = vi.fn(async (key: FamilyKey): Promise<BootedFamily> => {
      if (key === 'relay-sandbox') {
        const idx = bootCount;
        const url = urls[idx] ?? URL_B;
        relayUrls.push(url);
        stopCounts.push(0);
        bootCount += 1;
        return {
          connection: new FakeConn('relay'),
          relayHttpUrl: url,
          stop() {
            stopCounts[idx] += 1;
          },
        };
      }
      return makeFamily('local');
    });

    const router = new DualConnectionRouter({
      bootLazyFor,
      diagnosticsCollector: new InMemoryDiagnosticsCollector(),
      devtoolsOpener: new AutoDevtoolsOpener(),
      readSandboxRelayUrl: readUrl,
    });

    await router.switchMode('relay-sandbox');
    expect(bootCount).toBe(1);
    expect(relayUrls[0]).toBe(URL_A);

    // Re-enter with rotated URL (URL_B ≠ URL_A) → teardown stale, boot fresh.
    await router.switchMode('relay-sandbox');
    expect(bootCount).toBe(2);
    expect(stopCounts[0]).toBe(1); // first (stale) family torn down
    expect(relayUrls[1]).toBe(URL_B);
    expect(stopCounts[1]).toBe(0); // second (fresh) family still running
  });

  it('null from readSandboxRelayUrl (read error) — warm family is kept (fail-open)', async () => {
    const { router, sandboxFamilies, getBootCount } = makeKeyedRouter(async () => null);

    await router.switchMode('relay-sandbox');
    expect(getBootCount()).toBe(1);
    const first = sandboxFamilies[0];

    // readSandboxRelayUrl returns null (FS error) — must NOT drop working connection.
    await router.switchMode('relay-sandbox');
    expect(getBootCount()).toBe(1); // no re-boot
    expect(first.stopped).toBe(0); // no teardown
  });

  it('readSandboxRelayUrl throws — warm family is kept (fail-open)', async () => {
    const { router, sandboxFamilies, getBootCount } = makeKeyedRouter(async () => {
      throw new Error('ENOENT');
    });

    await router.switchMode('relay-sandbox');
    expect(getBootCount()).toBe(1);
    const first = sandboxFamilies[0];

    // Thrown error → same fail-open: keep warm family.
    await router.switchMode('relay-sandbox');
    expect(getBootCount()).toBe(1);
    expect(first.stopped).toBe(0);
  });

  it('readSandboxRelayUrl is undefined — warm family is always reused (no URL check)', async () => {
    // Omit readSandboxRelayUrl entirely.
    const sandboxFamilies: Array<BootedFamily & { stopped: number }> = [];
    let bootCount = 0;
    const bootLazyFor = vi.fn(async (key: FamilyKey) => {
      if (key === 'relay-sandbox') {
        bootCount += 1;
        const f = makeFamily('relay', URL_A);
        sandboxFamilies.push(f);
        return f;
      }
      return makeFamily('local');
    });

    const router = new DualConnectionRouter({
      bootLazyFor,
      diagnosticsCollector: new InMemoryDiagnosticsCollector(),
      devtoolsOpener: new AutoDevtoolsOpener(),
      // readSandboxRelayUrl intentionally omitted.
    });

    await router.switchMode('relay-sandbox');
    await router.switchMode('relay-sandbox');
    expect(bootCount).toBe(1); // always reuses warm family
    expect(sandboxFamilies[0].stopped).toBe(0);
  });

  it('non-sandbox keys are unaffected by readSandboxRelayUrl — relay-intoss reuses warm', async () => {
    let sandboxBootCount = 0;
    let intossBootCount = 0;
    const intoss = makeFamily('relay', 'https://intoss.example');

    const bootLazyFor = vi.fn(async (key: FamilyKey) => {
      if (key === 'relay-sandbox') {
        sandboxBootCount += 1;
        return makeFamily('relay', URL_A);
      }
      if (key === 'relay-intoss') {
        intossBootCount += 1;
        return intoss;
      }
      return makeFamily('local');
    });

    // readSandboxRelayUrl returns a different URL — should ONLY affect relay-sandbox.
    const router = new DualConnectionRouter({
      bootLazyFor,
      diagnosticsCollector: new InMemoryDiagnosticsCollector(),
      devtoolsOpener: new AutoDevtoolsOpener(),
      readSandboxRelayUrl: async () => URL_B,
    });

    await router.switchMode('relay-staging'); // boots relay-intoss
    await router.switchMode('relay-staging'); // re-entry: URL check skipped for non-sandbox
    expect(intossBootCount).toBe(1); // warm reuse, no rebuild
    expect(intoss.stopped).toBe(0);
    expect(sandboxBootCount).toBe(0);
  });
});

// ============================================================================
// 2. isSandboxPageFresh — stale ghost gate (issue #610 fix B)
// ============================================================================

describe('isSandboxPageFresh — stale ghost gate (#610)', () => {
  const THRESHOLD = RELAY_SANDBOX_STALE_PAGE_MS; // 5 minutes in ms
  const NOW = 1_000_000; // arbitrary frozen "now"

  /** Minimal CdpTarget-like shape accepted by isSandboxPageFresh. */
  const page = (id: string): { id: string } => ({ id });

  // ---------- empty pages ----------

  it('returns false when pages is empty (no pages.length > 0 short-circuit)', () => {
    expect(isSandboxPageFresh([], null, NOW, THRESHOLD)).toBe(false);
    expect(isSandboxPageFresh([], () => NOW, NOW, THRESHOLD)).toBe(false);
  });

  // ---------- no getLastSeenAt (local-browser fakes, regression-safe) ----------

  it('returns true for non-empty pages when getLastSeenAt is null (fallback: pages.length > 0)', () => {
    expect(isSandboxPageFresh([page('p1')], null, NOW, THRESHOLD)).toBe(true);
  });

  // ---------- fresh pages ----------

  it('returns true when lastSeenAt is exactly at the threshold boundary', () => {
    // seenMs = NOW - THRESHOLD (exactly at boundary → fresh)
    const seenMs = NOW - THRESHOLD;
    const getLastSeenAt = (id: string): number | null => (id === 'p1' ? seenMs : null);
    expect(isSandboxPageFresh([page('p1')], getLastSeenAt, NOW, THRESHOLD)).toBe(true);
  });

  it('returns true when lastSeenAt is very recent (1 ms ago)', () => {
    const getLastSeenAt = (_id: string): number | null => NOW - 1;
    expect(isSandboxPageFresh([page('p1')], getLastSeenAt, NOW, THRESHOLD)).toBe(true);
  });

  it('returns true when seenMs === null (no CDP message received yet — fresh attach)', () => {
    // A brand-new connection that has not yet received any CDP message.
    // seenMs === null should be treated as fresh, not stale.
    const getLastSeenAt = (_id: string): number | null => null;
    expect(isSandboxPageFresh([page('p1')], getLastSeenAt, NOW, THRESHOLD)).toBe(true);
  });

  // ---------- stale ghost pages ----------

  it('returns false when ALL pages are ghosts (lastSeenAt > threshold ago)', () => {
    // seenMs = NOW - THRESHOLD - 1 (just past the boundary → stale ghost)
    const ghostMs = NOW - THRESHOLD - 1;
    const getLastSeenAt = (_id: string): number | null => ghostMs;
    expect(isSandboxPageFresh([page('p1')], getLastSeenAt, NOW, THRESHOLD)).toBe(false);
  });

  it('returns false when last seen was 10 minutes ago (well past 5-minute threshold)', () => {
    const tenMinutesAgo = NOW - 10 * 60 * 1_000;
    const getLastSeenAt = (_id: string): number | null => tenMinutesAgo;
    expect(isSandboxPageFresh([page('p1')], getLastSeenAt, NOW, THRESHOLD)).toBe(false);
  });

  // ---------- mixed ghost + fresh pages ----------

  it('returns true when at least one page is fresh even if others are ghosts', () => {
    const ghostMs = NOW - THRESHOLD - 1; // stale
    const freshMs = NOW - 100; // fresh

    const getLastSeenAt = (id: string): number | null => {
      if (id === 'ghost') return ghostMs;
      if (id === 'fresh') return freshMs;
      return null;
    };
    expect(isSandboxPageFresh([page('ghost'), page('fresh')], getLastSeenAt, NOW, THRESHOLD)).toBe(
      true,
    );
  });

  it('returns true when one page has null lastSeenAt (fresh) alongside a ghost', () => {
    const ghostMs = NOW - THRESHOLD - 1;
    const getLastSeenAt = (id: string): number | null => {
      if (id === 'ghost') return ghostMs;
      return null; // 'newpage' has no CDP message yet — fresh
    };
    expect(
      isSandboxPageFresh([page('ghost'), page('newpage')], getLastSeenAt, NOW, THRESHOLD),
    ).toBe(true);
  });

  // ---------- injectable threshold ----------

  it('respects a custom stalePageThresholdMs for tests that inject a tight threshold', () => {
    const TIGHT = 500; // ms — for test time-control without fake timers
    const justFresh = NOW - TIGHT;
    const justStale = NOW - TIGHT - 1;

    const freshGet = (_id: string): number | null => justFresh;
    const staleGet = (_id: string): number | null => justStale;

    expect(isSandboxPageFresh([page('p1')], freshGet, NOW, TIGHT)).toBe(true);
    expect(isSandboxPageFresh([page('p1')], staleGet, NOW, TIGHT)).toBe(false);
  });
});
