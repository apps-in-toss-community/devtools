/**
 * Unit tests for the single-attach model in ChiiCdpConnection (devtools#263).
 *
 * Covers:
 * - Two attach events for different targetIds → after second, listTargets has
 *   exactly the second, first's pending commands are rejected with
 *   'replaced-by-new-attach'.
 * - One attach then same targetId attach again → idempotent (no eviction).
 * - Eviction emits lifecycle event with kind='replaced'.
 * - activeTargetId is updated after eviction.
 *
 * Uses the same private-field casting trick as chii-connection-crash.test.ts.
 */

import { describe, expect, it, vi } from 'vitest';
import type { TargetLifecycleEvent } from '../mcp/chii-connection.js';
import { ChiiCdpConnection } from '../mcp/chii-connection.js';

// ---------------------------------------------------------------------------
// Test helpers (mirrored from chii-connection-crash.test.ts)
// ---------------------------------------------------------------------------

type Internal = {
  targets: Map<string, { id: string; title: string; url: string }>;
  pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
  connectionState: 'idle' | 'connected' | 'disconnected';
  handleMessage: (raw: string) => void;
  targetLastSeenAt: Map<string, number>;
  activeTargetId: string | null;
};

function internals(conn: ChiiCdpConnection): Internal {
  return conn as unknown as Internal;
}

/** Inject a pending command and return the spy handles. */
function addPending(
  conn: ChiiCdpConnection,
  id = 42,
): {
  resolve: ReturnType<typeof vi.fn<(v: unknown) => void>>;
  reject: ReturnType<typeof vi.fn<(e: Error) => void>>;
} {
  const resolve = vi.fn<(v: unknown) => void>();
  const reject = vi.fn<(e: Error) => void>();
  internals(conn).pending.set(id, { resolve, reject });
  return { resolve, reject };
}

/**
 * Simulate what `refreshTargets()` does when called with a relay response
 * containing the given target IDs (last in list wins under single-attach model).
 *
 * We patch the `fetch` that `refreshTargets()` uses by overriding it on the
 * instance's private `relayBaseUrl` — instead of doing that, we call
 * `refreshTargets` with a mocked global `fetch`.
 */
async function simulateRefreshTargets(conn: ChiiCdpConnection, targetIds: string[]): Promise<void> {
  const fakeTargets = targetIds.map((id) => ({
    id,
    title: `Page ${id}`,
    url: `http://app/${id}`,
  }));

  const originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn().mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({ targets: fakeTargets }),
  } as unknown as Response);

  try {
    await conn.refreshTargets();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

// ---------------------------------------------------------------------------
// Single-attach: two different targetIds
// ---------------------------------------------------------------------------

describe('single-attach model — two different targetIds', () => {
  it('after second attach, listTargets has exactly the second target', async () => {
    const conn = new ChiiCdpConnection({ relayBaseUrl: 'http://127.0.0.1:9100' });

    await simulateRefreshTargets(conn, ['target-alpha']);
    expect(conn.listTargets().map((t) => t.id)).toEqual(['target-alpha']);

    await simulateRefreshTargets(conn, ['target-beta']);
    expect(conn.listTargets().map((t) => t.id)).toEqual(['target-beta']);
    expect(conn.listTargets()).toHaveLength(1);
  });

  it('first target is removed from the map after second attach', async () => {
    const conn = new ChiiCdpConnection({ relayBaseUrl: 'http://127.0.0.1:9100' });

    await simulateRefreshTargets(conn, ['target-alpha']);
    await simulateRefreshTargets(conn, ['target-beta']);

    const ids = conn.listTargets().map((t) => t.id);
    expect(ids).not.toContain('target-alpha');
    expect(ids).toContain('target-beta');
  });

  it("pending commands are rejected with 'replaced-by-new-attach' when first target is evicted", async () => {
    const conn = new ChiiCdpConnection({ relayBaseUrl: 'http://127.0.0.1:9100' });

    await simulateRefreshTargets(conn, ['target-alpha']);
    const { reject } = addPending(conn);

    await simulateRefreshTargets(conn, ['target-beta']);

    expect(reject).toHaveBeenCalledOnce();
    const err: Error = reject.mock.calls[0]?.[0] as Error;
    expect(err.message).toContain('replaced-by-new-attach');
  });

  it("eviction emits lifecycle event with kind='replaced'", async () => {
    const conn = new ChiiCdpConnection({ relayBaseUrl: 'http://127.0.0.1:9100' });

    await simulateRefreshTargets(conn, ['target-alpha']);
    const events: TargetLifecycleEvent[] = [];
    conn.onLifecycle((e) => events.push(e));

    await simulateRefreshTargets(conn, ['target-beta']);

    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('replaced');
    expect(events[0]?.targetId).toBe('target-alpha');
    expect(events[0]?.detectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('onLifecycle unsubscribe prevents replaced event delivery', async () => {
    const conn = new ChiiCdpConnection({ relayBaseUrl: 'http://127.0.0.1:9100' });

    await simulateRefreshTargets(conn, ['target-alpha']);
    const events: TargetLifecycleEvent[] = [];
    const unsub = conn.onLifecycle((e) => events.push(e));
    unsub();

    await simulateRefreshTargets(conn, ['target-beta']);

    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Single-attach: same targetId re-attaches → idempotent
// ---------------------------------------------------------------------------

describe('single-attach model — same targetId re-attaches (idempotent)', () => {
  it('no eviction when the same targetId appears again', async () => {
    const conn = new ChiiCdpConnection({ relayBaseUrl: 'http://127.0.0.1:9100' });

    await simulateRefreshTargets(conn, ['target-alpha']);
    const events: TargetLifecycleEvent[] = [];
    conn.onLifecycle((e) => events.push(e));

    // Same targetId again — should not trigger eviction.
    await simulateRefreshTargets(conn, ['target-alpha']);

    expect(events).toHaveLength(0);
  });

  it('pending commands are not rejected on idempotent re-attach', async () => {
    const conn = new ChiiCdpConnection({ relayBaseUrl: 'http://127.0.0.1:9100' });

    await simulateRefreshTargets(conn, ['target-alpha']);
    const { reject } = addPending(conn);

    await simulateRefreshTargets(conn, ['target-alpha']);

    expect(reject).not.toHaveBeenCalled();
  });

  it('listTargets still has the target after idempotent re-attach', async () => {
    const conn = new ChiiCdpConnection({ relayBaseUrl: 'http://127.0.0.1:9100' });

    await simulateRefreshTargets(conn, ['target-alpha']);
    await simulateRefreshTargets(conn, ['target-alpha']);

    expect(conn.listTargets().map((t) => t.id)).toEqual(['target-alpha']);
  });
});

// ---------------------------------------------------------------------------
// Single-attach: relay returns two targets simultaneously (relay didn't clean up)
// ---------------------------------------------------------------------------

describe('single-attach model — relay returns multiple targets', () => {
  it('only the last (newest) target is kept', async () => {
    const conn = new ChiiCdpConnection({ relayBaseUrl: 'http://127.0.0.1:9100' });

    // Relay returns two targets (old session didn't detach). Last-in-list wins.
    await simulateRefreshTargets(conn, ['target-old', 'target-new']);

    expect(conn.listTargets()).toHaveLength(1);
    expect(conn.listTargets()[0]?.id).toBe('target-new');
  });

  it('no eviction lifecycle event for the very first attach (activeTargetId was null)', async () => {
    const conn = new ChiiCdpConnection({ relayBaseUrl: 'http://127.0.0.1:9100' });

    const events: TargetLifecycleEvent[] = [];
    conn.onLifecycle((e) => events.push(e));

    // First ever call — activeTargetId is null, no previous target to evict.
    await simulateRefreshTargets(conn, ['target-old', 'target-new']);

    // No 'replaced' event should fire since there was no prior active target.
    const replacedEvents = events.filter((e) => e.kind === 'replaced');
    expect(replacedEvents).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// activeTargetId tracking
// ---------------------------------------------------------------------------

describe('activeTargetId tracking', () => {
  it('is set to the new targetId after second attach', async () => {
    const conn = new ChiiCdpConnection({ relayBaseUrl: 'http://127.0.0.1:9100' });

    await simulateRefreshTargets(conn, ['target-alpha']);
    expect(internals(conn).activeTargetId).toBe('target-alpha');

    await simulateRefreshTargets(conn, ['target-beta']);
    expect(internals(conn).activeTargetId).toBe('target-beta');
  });

  it('is null when relay returns no targets', async () => {
    const conn = new ChiiCdpConnection({ relayBaseUrl: 'http://127.0.0.1:9100' });

    await simulateRefreshTargets(conn, ['target-alpha']);
    await simulateRefreshTargets(conn, []);

    expect(internals(conn).activeTargetId).toBeNull();
  });
});
