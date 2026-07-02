/**
 * Unit tests for `ChiiCdpConnection.waitForFirstTarget` non-finite timeout
 * guard (devtools#735).
 *
 * `timeoutMs = Infinity` (used by the test-runner's default unbounded
 * QR-attach wait) must NOT arm a rejection timer — Node clamps
 * `setTimeout(fn, Infinity)` to ~1ms, which would reject almost immediately
 * if passed through unguarded. The finite default (90 000ms) must still time
 * out as before (regression guard).
 *
 * Uses vitest fake timers + the internal EventEmitter (same private-field
 * access pattern as chii-connection-single-attach.test.ts) so no real relay
 * network I/O is needed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CdpTarget } from '../cdp-connection.js';
import { ChiiCdpConnection } from '../chii-connection.js';

type Internal = {
  emitter: { emit: (event: string, payload: unknown) => void };
};

function internals(conn: ChiiCdpConnection): Internal {
  return conn as unknown as Internal;
}

const FAKE_TARGET: CdpTarget = { id: 'target-1', title: 'Test Mini-App', url: 'http://localhost/' };

describe('ChiiCdpConnection.waitForFirstTarget — non-finite timeout guard (devtools#735)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    // waitForFirstTarget's fallback poll loop calls refreshTargets() → fetch()
    // every pollIntervalMs. Stub it to a no-op empty-list response so advancing
    // fake timers over long spans does not accumulate real network calls (the
    // event-driven 'target:attached' path is what this test actually exercises).
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ targets: [] }),
    } as unknown as Response);
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it('timeoutMs = Infinity: does not reject after a large timer advance, resolves on target', async () => {
    const conn = new ChiiCdpConnection({ relayBaseUrl: 'http://127.0.0.1:9999' });

    const waitPromise = conn.waitForFirstTarget(
      (targets) => targets.some((t) => t.id === FAKE_TARGET.id),
      Number.POSITIVE_INFINITY,
      // Coarser poll interval so the fake-timer advance below does not need to
      // process an enormous number of fallback-poll ticks.
      60_000,
    );

    let settled = false;
    let rejected = false;
    waitPromise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
        rejected = true;
      },
    );

    // Advance WAY past any finite default (90s) and even past the old bounded
    // factory default (600s) — must still be pending, and must NOT have
    // rejected (the Infinity-clamp bug would reject almost immediately).
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000); // 24h
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(rejected).toBe(false);

    // Now emit the attach event — must resolve.
    internals(conn).emitter.emit('target:attached', [FAKE_TARGET]);
    await vi.advanceTimersByTimeAsync(0);

    const targets = await waitPromise;
    expect(targets).toEqual([FAKE_TARGET]);
    expect(settled).toBe(true);
    expect(rejected).toBe(false);
  });

  it('finite default (90 000ms) still times out when no target attaches (regression)', async () => {
    const conn = new ChiiCdpConnection({ relayBaseUrl: 'http://127.0.0.1:9999' });

    const waitPromise = conn.waitForFirstTarget((targets) =>
      targets.some((t) => t.id === FAKE_TARGET.id),
    );

    let caughtError: Error | undefined;
    const guarded = waitPromise.catch((e: unknown) => {
      caughtError = e instanceof Error ? e : new Error(String(e));
    });

    // Just under the default — must still be pending.
    await vi.advanceTimersByTimeAsync(89_000);
    expect(caughtError).toBeUndefined();

    // Past the default — must reject with the timeout error.
    await vi.advanceTimersByTimeAsync(2_000);
    await guarded;

    expect(caughtError).toBeDefined();
    expect(caughtError?.message).toMatch(/타임아웃/);
  });
});
