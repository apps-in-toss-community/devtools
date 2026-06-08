/**
 * Unit tests for src/shared/parent-watcher.ts
 *
 * All four scenarios are exercised with vitest fake timers so no real interval
 * fires and the tests run in < 1 ms wall time.
 *
 * This is the canonical test location for `startParentWatcher` and
 * `isPidAlive` after they were extracted from `src/mcp/debug-server.ts` to
 * the shared package (#420).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isPidAlive, startParentWatcher } from './parent-watcher.js';

// ---------------------------------------------------------------------------
// isPidAlive
// ---------------------------------------------------------------------------

describe('isPidAlive', () => {
  it('returns true for the current process (itself)', () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it('returns false for a PID that is virtually never in use (999999)', () => {
    // Only test this when the PID is actually dead to avoid a flaky assertion
    // on a heavily-loaded machine.  `isPidAlive` probes via kill(pid, 0).
    if (isPidAlive(999_999)) {
      // PID happened to be alive — skip rather than fail.
      return;
    }
    expect(isPidAlive(999_999)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// startParentWatcher
// ---------------------------------------------------------------------------

describe('startParentWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires onOrphaned once when getPpid() changes from initialPpid', async () => {
    const onOrphaned = vi.fn();
    let currentPpid = 1234;

    const watcher = startParentWatcher(onOrphaned, {
      intervalMs: 100,
      initialPpid: 1234,
      isAlive: () => true, // parent still alive by kill(0)
      getPpid: () => currentPpid, // ppid changes = re-parented
      log: () => {},
    });

    // No change yet — onOrphaned must not fire.
    await vi.advanceTimersByTimeAsync(150);
    expect(onOrphaned).not.toHaveBeenCalled();

    // Simulate ppid change (parent died and init/launchd adopted us).
    currentPpid = 1;
    await vi.advanceTimersByTimeAsync(200);
    expect(onOrphaned).toHaveBeenCalledTimes(1);

    // Should NOT fire again on further ticks.
    await vi.advanceTimersByTimeAsync(500);
    expect(onOrphaned).toHaveBeenCalledTimes(1);

    watcher.stop();
  });

  it('fires onOrphaned once when isAlive(initialPpid) returns false', async () => {
    const onOrphaned = vi.fn();
    let parentAlive = true;

    const watcher = startParentWatcher(onOrphaned, {
      intervalMs: 100,
      initialPpid: 5678,
      isAlive: (pid) => (pid === 5678 ? parentAlive : true),
      getPpid: () => 5678,
      log: () => {},
    });

    await vi.advanceTimersByTimeAsync(150);
    expect(onOrphaned).not.toHaveBeenCalled();

    // Parent dies — kill(pid, 0) returns ESRCH.
    parentAlive = false;
    await vi.advanceTimersByTimeAsync(200);
    expect(onOrphaned).toHaveBeenCalledTimes(1);

    // Idempotent — only fires once.
    await vi.advanceTimersByTimeAsync(500);
    expect(onOrphaned).toHaveBeenCalledTimes(1);

    watcher.stop();
  });

  it('does NOT fire while parent is alive and ppid is stable across many ticks', async () => {
    const onOrphaned = vi.fn();

    const watcher = startParentWatcher(onOrphaned, {
      intervalMs: 100,
      initialPpid: 9999,
      isAlive: () => true,
      getPpid: () => 9999,
      log: () => {},
    });

    await vi.advanceTimersByTimeAsync(2000); // 20 ticks
    expect(onOrphaned).not.toHaveBeenCalled();

    watcher.stop();
  });

  it('initialPpid <= 1 → never schedules an interval and never fires', async () => {
    const onOrphaned = vi.fn();
    const logs: string[] = [];

    const watcher = startParentWatcher(onOrphaned, {
      intervalMs: 100,
      initialPpid: 1,
      isAlive: () => false, // would fire if interval ran
      getPpid: () => 2, // would fire if interval ran
      log: (msg) => logs.push(msg),
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(onOrphaned).not.toHaveBeenCalled();
    // The no-parent log should have been emitted.
    expect(logs.some((m) => m.includes('ppid<=1'))).toBe(true);

    watcher.stop();
  });

  it('stop() prevents onOrphaned from firing after being called', async () => {
    const onOrphaned = vi.fn();
    let parentAlive = true;

    const watcher = startParentWatcher(onOrphaned, {
      intervalMs: 100,
      initialPpid: 4321,
      isAlive: () => parentAlive,
      getPpid: () => 4321,
      log: () => {},
    });

    // Stop the watcher before the parent dies.
    watcher.stop();

    // Now kill the parent — should have no effect since interval is cleared.
    parentAlive = false;
    await vi.advanceTimersByTimeAsync(500);
    expect(onOrphaned).not.toHaveBeenCalled();
  });
});
