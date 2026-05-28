/**
 * Unit tests for ChiiCdpConnection crash detection (devtools#265).
 *
 * Covers:
 * - Inspector.targetCrashed  → targets cleared + pending rejected + lifecycle fired
 * - Target.targetDestroyed   → matching target removed + pending rejected
 * - Target.detachedFromTarget → same handling as destroyed
 * - getLastCrashDetectedAt() returning a timestamp after crash
 * - Heartbeat: when AIT_CDP_HEARTBEAT_MS is set, a non-responding target is
 *   marked dead after the 2 s ping timeout (using vitest fake timers)
 *
 * We avoid the real Chii relay and `ws` package entirely: we instantiate
 * `ChiiCdpConnection`, then call the private `handleMessage` method directly
 * (via `(conn as unknown as Record<string, Function>).handleMessage(...)`) to
 * simulate inbound CDP frames, and pre-populate private fields through the
 * same casting trick. This keeps the tests fast, Node-only, and no-network.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TargetLifecycleEvent } from '../mcp/chii-connection.js';
import { ChiiCdpConnection } from '../mcp/chii-connection.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

type Internal = {
  targets: Map<string, { id: string; title: string; url: string }>;
  pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
  connectionState: 'idle' | 'connected' | 'disconnected';
  handleMessage: (raw: string) => void;
  targetLastSeenAt: Map<string, number>;
};

function internals(conn: ChiiCdpConnection): Internal {
  return conn as unknown as Internal;
}

/** Create a connected connection with a seeded target (no real ws). */
function makeConnectedConn(): ChiiCdpConnection {
  const conn = new ChiiCdpConnection({ relayBaseUrl: 'http://127.0.0.1:9100' });
  const int = internals(conn);
  // Simulate post-enableDomains state: connected + one target.
  int.connectionState = 'connected';
  int.targets.set('target-abc', { id: 'target-abc', title: 'Test Page', url: 'http://test' });
  int.targetLastSeenAt.set('target-abc', Date.now() - 1000);
  return conn;
}

/** Inject a pending command and return it. */
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

/** Emit an inbound CDP event frame via handleMessage. */
function emit(conn: ChiiCdpConnection, method: string, params: unknown = {}): void {
  internals(conn).handleMessage(JSON.stringify({ method, params }));
}

// ---------------------------------------------------------------------------
// Inspector.targetCrashed
// ---------------------------------------------------------------------------

describe('Inspector.targetCrashed', () => {
  it('clears all targets from the map', () => {
    const conn = makeConnectedConn();
    expect(conn.listTargets()).toHaveLength(1);
    emit(conn, 'Inspector.targetCrashed');
    expect(conn.listTargets()).toHaveLength(0);
  });

  it('rejects pending commands with a descriptive error', () => {
    const conn = makeConnectedConn();
    const { reject } = addPending(conn);
    emit(conn, 'Inspector.targetCrashed');
    expect(reject).toHaveBeenCalledOnce();
    const err: Error = reject.mock.calls[0]?.[0] as Error;
    expect(err.message).toContain('page crash');
    expect(err.message).toContain('list_pages');
  });

  it('sets getLastCrashDetectedAt() to a recent timestamp', () => {
    const conn = makeConnectedConn();
    const before = Date.now();
    emit(conn, 'Inspector.targetCrashed');
    const after = Date.now();
    const ts = conn.getLastCrashDetectedAt();
    expect(ts).not.toBeNull();
    expect(ts!).toBeGreaterThanOrEqual(before);
    expect(ts!).toBeLessThanOrEqual(after);
  });

  it('fires a lifecycle event with kind=crashed', () => {
    const conn = makeConnectedConn();
    const events: TargetLifecycleEvent[] = [];
    conn.onLifecycle((e) => events.push(e));
    emit(conn, 'Inspector.targetCrashed');
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('crashed');
    expect(events[0]?.targetId).toBeNull();
    expect(events[0]?.detectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('onLifecycle unsubscribe stops future events', () => {
    const conn = makeConnectedConn();
    const events: TargetLifecycleEvent[] = [];
    const unsub = conn.onLifecycle((e) => events.push(e));
    unsub();
    emit(conn, 'Inspector.targetCrashed');
    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Target.targetDestroyed
// ---------------------------------------------------------------------------

describe('Target.targetDestroyed', () => {
  it('removes the matching target by targetId', () => {
    const conn = makeConnectedConn();
    internals(conn).targets.set('other-target', {
      id: 'other-target',
      title: 'Other',
      url: 'http://other',
    });
    emit(conn, 'Target.targetDestroyed', { targetId: 'target-abc' });
    const ids = conn.listTargets().map((t) => t.id);
    expect(ids).not.toContain('target-abc');
    // other-target should still be present
    expect(ids).toContain('other-target');
  });

  it('rejects pending commands', () => {
    const conn = makeConnectedConn();
    const { reject } = addPending(conn);
    emit(conn, 'Target.targetDestroyed', { targetId: 'target-abc' });
    expect(reject).toHaveBeenCalledOnce();
    const err: Error = reject.mock.calls[0]?.[0] as Error;
    expect(err.message).toContain('target 종료');
  });

  it('sets getLastCrashDetectedAt()', () => {
    const conn = makeConnectedConn();
    emit(conn, 'Target.targetDestroyed', { targetId: 'target-abc' });
    expect(conn.getLastCrashDetectedAt()).not.toBeNull();
  });

  it('fires a lifecycle event with kind=destroyed', () => {
    const conn = makeConnectedConn();
    const events: TargetLifecycleEvent[] = [];
    conn.onLifecycle((e) => events.push(e));
    emit(conn, 'Target.targetDestroyed', { targetId: 'target-abc' });
    expect(events[0]?.kind).toBe('destroyed');
    expect(events[0]?.targetId).toBe('target-abc');
  });

  it('handles missing targetId in params gracefully (clears all)', () => {
    const conn = makeConnectedConn();
    emit(conn, 'Target.targetDestroyed', {});
    // targetId is null → all targets cleared
    expect(conn.listTargets()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Target.detachedFromTarget
// ---------------------------------------------------------------------------

describe('Target.detachedFromTarget', () => {
  it('removes the matching target', () => {
    const conn = makeConnectedConn();
    emit(conn, 'Target.detachedFromTarget', { targetId: 'target-abc' });
    expect(conn.listTargets()).toHaveLength(0);
  });

  it('fires lifecycle event with kind=detached', () => {
    const conn = makeConnectedConn();
    const events: TargetLifecycleEvent[] = [];
    conn.onLifecycle((e) => events.push(e));
    emit(conn, 'Target.detachedFromTarget', { targetId: 'target-abc' });
    expect(events[0]?.kind).toBe('detached');
  });
});

// ---------------------------------------------------------------------------
// lastSeenAt update on any inbound message
// ---------------------------------------------------------------------------

describe('getTargetLastSeenAt', () => {
  it('returns null for an unknown target', () => {
    const conn = makeConnectedConn();
    expect(conn.getTargetLastSeenAt('unknown-id')).toBeNull();
  });

  it('is updated when any inbound message arrives', () => {
    const conn = makeConnectedConn();
    const before = Date.now();
    // Emit a runtime console event — any message should update lastSeenAt.
    internals(conn).handleMessage(
      JSON.stringify({
        method: 'Runtime.consoleAPICalled',
        params: { type: 'log', args: [], timestamp: 1234 },
      }),
    );
    const after = Date.now();
    const ts = conn.getTargetLastSeenAt('target-abc');
    expect(ts).not.toBeNull();
    expect(ts!).toBeGreaterThanOrEqual(before);
    expect(ts!).toBeLessThanOrEqual(after);
  });

  it('is cleared after a crash event', () => {
    const conn = makeConnectedConn();
    emit(conn, 'Inspector.targetCrashed');
    expect(conn.getTargetLastSeenAt('target-abc')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Heartbeat (fake timers)
// ---------------------------------------------------------------------------

describe('Heartbeat (AIT_CDP_HEARTBEAT_MS)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.AIT_CDP_HEARTBEAT_MS = '1000';
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.AIT_CDP_HEARTBEAT_MS;
  });

  it('marks target dead when Runtime.evaluate never responds (2 s timeout)', async () => {
    const conn = makeConnectedConn();
    // Override sendCommand so it never resolves (simulates zombie ws).
    const int = internals(conn);
    (conn as unknown as Record<string, unknown>).sendCommand = () => new Promise(() => {}); // never resolves

    // Start heartbeat manually by calling startHeartbeat with our target id.
    (conn as unknown as { startHeartbeat: (id: string) => void }).startHeartbeat('target-abc');

    expect(int.targets.has('target-abc')).toBe(true);

    // Tick 1 s → heartbeat fires. Then tick 2.5 s more → the internal
    // setTimeout(reject, 2500) inside each ping iteration fires.
    // We use advanceTimersByTimeAsync to flush microtasks between advances,
    // avoiding the infinite-loop that runAllTimersAsync hits with setInterval.
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2500);

    expect(int.targets.has('target-abc')).toBe(false);
    expect(conn.getLastCrashDetectedAt()).not.toBeNull();
  });

  it('does not start when AIT_CDP_HEARTBEAT_MS is not set', () => {
    delete process.env.AIT_CDP_HEARTBEAT_MS;
    const conn = makeConnectedConn();
    const int = internals(conn);
    (conn as unknown as { startHeartbeat: (id: string) => void }).startHeartbeat('target-abc');
    // heartbeatHandle should be null (no env var → no interval).
    expect((int as unknown as { heartbeatHandle: unknown }).heartbeatHandle).toBeNull();
  });
});
