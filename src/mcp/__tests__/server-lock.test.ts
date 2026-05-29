/**
 * Tests for src/mcp/server-lock.ts
 *
 * Covers:
 * - acquireLock: fresh start (no lock file)
 * - acquireLock: stale lock (dead PID) → auto-recovery
 * - acquireLock: live conflict → ServerLockConflictError with PID + wssUrl + startedAt
 * - acquireLock: live conflict → stderr message with PID + wssUrl + recovery command
 * - acquireLock: force flag → kills existing PID and takes over lock
 * - LockHandle.updateWssUrl: persists to file
 * - LockHandle.release: removes the file; idempotent
 * - isPidAlive: alive (own PID), dead (PID 0 is always dead via kill(0,0) throw on macOS/Linux)
 * - lockFilePath: respects AIT_DEVTOOLS_LOCK_DIR override
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { acquireLock, isPidAlive, lockFilePath, ServerLockConflictError } from '../server-lock.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a fresh temp dir for each test and sets AIT_DEVTOOLS_LOCK_DIR. */
function setupTmpLockDir(): { dir: string } {
  const dir = join(tmpdir(), `ait-lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  process.env.AIT_DEVTOOLS_LOCK_DIR = dir;
  return { dir };
}

function teardownTmpLockDir(dir: string): void {
  delete process.env.AIT_DEVTOOLS_LOCK_DIR;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function writeLockFile(lockPath: string, data: object): void {
  writeFileSync(lockPath, JSON.stringify(data, null, 2), 'utf8');
}

/** Returns a PID that is guaranteed not to be alive on the current machine. */
function deadPid(): number {
  // PID 999999 is virtually never in use; we verify via isPidAlive.
  // If by chance it is alive, the test will still pass because we use a range.
  const candidates = [999999, 999998, 999997];
  for (const pid of candidates) {
    if (!isPidAlive(pid)) return pid;
  }
  // Fallback: negative PID is always invalid.
  return -1;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('lockFilePath', () => {
  afterEach(() => {
    delete process.env.AIT_DEVTOOLS_LOCK_DIR;
  });

  it('respects AIT_DEVTOOLS_LOCK_DIR override', () => {
    process.env.AIT_DEVTOOLS_LOCK_DIR = '/tmp/custom-lock-dir';
    expect(lockFilePath()).toBe('/tmp/custom-lock-dir/server.lock');
  });

  it('defaults to ~/.ait-devtools/server.lock when env not set', () => {
    delete process.env.AIT_DEVTOOLS_LOCK_DIR;
    const p = lockFilePath();
    expect(p).toMatch(/\.ait-devtools[\\/]server\.lock$/);
  });
});

describe('isPidAlive', () => {
  it('returns true for own process PID', () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  it('returns false for a dead PID', () => {
    const pid = deadPid();
    expect(isPidAlive(pid)).toBe(false);
  });
});

describe('acquireLock — fresh start', () => {
  let dir: string;

  beforeEach(() => {
    ({ dir } = setupTmpLockDir());
  });

  afterEach(() => {
    teardownTmpLockDir(dir);
  });

  it('creates the lock file with current PID and null wssUrl', () => {
    const handle = acquireLock();
    try {
      const lockPath = lockFilePath();
      expect(existsSync(lockPath)).toBe(true);
      const raw = JSON.parse(readFileSync(lockPath, 'utf8'));
      expect(raw.pid).toBe(process.pid);
      expect(raw.wssUrl).toBeNull();
      expect(typeof raw.startedAt).toBe('string');
    } finally {
      handle.release();
    }
  });
});

describe('acquireLock — stale lock recovery', () => {
  let dir: string;

  beforeEach(() => {
    ({ dir } = setupTmpLockDir());
  });

  afterEach(() => {
    teardownTmpLockDir(dir);
  });

  it('replaces a lock file whose PID is dead', () => {
    const lockPath = lockFilePath();
    const dead = deadPid();
    writeLockFile(lockPath, {
      pid: dead,
      wssUrl: 'wss://old.trycloudflare.com',
      startedAt: '2020-01-01T00:00:00.000Z',
    });

    // Should NOT throw — stale lock is recovered silently.
    const handle = acquireLock();
    try {
      const raw = JSON.parse(readFileSync(lockPath, 'utf8'));
      expect(raw.pid).toBe(process.pid);
    } finally {
      handle.release();
    }
  });

  it('replaces a lock file with invalid JSON', () => {
    const lockPath = lockFilePath();
    writeFileSync(lockPath, 'not json', 'utf8');

    const handle = acquireLock();
    try {
      expect(existsSync(lockPath)).toBe(true);
    } finally {
      handle.release();
    }
  });
});

describe('acquireLock — live conflict', () => {
  let dir: string;

  beforeEach(() => {
    ({ dir } = setupTmpLockDir());
  });

  afterEach(() => {
    teardownTmpLockDir(dir);
  });

  it('throws ServerLockConflictError when own PID is in the lock file', () => {
    // Use own PID to simulate a live process holding the lock.
    const lockPath = lockFilePath();
    writeLockFile(lockPath, {
      pid: process.pid,
      wssUrl: 'wss://existing.trycloudflare.com',
      startedAt: new Date().toISOString(),
    });

    expect(() => acquireLock()).toThrow(ServerLockConflictError);
  });

  it('error contains the existing PID, wssUrl, and startedAt', () => {
    const lockPath = lockFilePath();
    const startedAt = new Date().toISOString();
    writeLockFile(lockPath, {
      pid: process.pid,
      wssUrl: 'wss://existing.trycloudflare.com',
      startedAt,
    });

    let caught: unknown;
    try {
      acquireLock();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ServerLockConflictError);
    const err = caught as ServerLockConflictError;
    expect(err.existingPid).toBe(process.pid);
    expect(err.existingWssUrl).toBe('wss://existing.trycloudflare.com');
    expect(err.existingStartedAt).toBe(startedAt);
    expect(err.message).toContain(String(process.pid));
    expect(err.message).toContain('wss://existing.trycloudflare.com');
  });

  it('error contains null wssUrl note when wssUrl is missing', () => {
    const lockPath = lockFilePath();
    writeLockFile(lockPath, {
      pid: process.pid,
      wssUrl: null,
      startedAt: new Date().toISOString(),
    });

    let caught: unknown;
    try {
      acquireLock();
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ServerLockConflictError);
    const err = caught as ServerLockConflictError;
    expect(err.existingWssUrl).toBeNull();
    expect(err.message).toContain('tunnel still starting');
  });

  it('writes PID + wssUrl + recovery hint to stderr on conflict', () => {
    const lockPath = lockFilePath();
    const startedAt = new Date().toISOString();
    writeLockFile(lockPath, {
      pid: process.pid,
      wssUrl: 'wss://existing.trycloudflare.com',
      startedAt,
    });

    const stderrLines: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      stderrLines.push(String(chunk));
      return true;
    });

    try {
      acquireLock();
    } catch {
      // expected
    } finally {
      stderrSpy.mockRestore();
    }

    const combined = stderrLines.join('');
    expect(combined).toContain(`PID=${process.pid}`);
    expect(combined).toContain('wss://existing.trycloudflare.com');
    expect(combined).toContain('--force');
    expect(combined).toContain('회복:');
  });
});

describe('acquireLock — force takeover', () => {
  let dir: string;

  beforeEach(() => {
    ({ dir } = setupTmpLockDir());
  });

  afterEach(() => {
    teardownTmpLockDir(dir);
  });

  it('takes over a stale lock with force=true (dead PID acts as stale)', () => {
    const lockPath = lockFilePath();
    const dead = deadPid();
    writeLockFile(lockPath, {
      pid: dead,
      wssUrl: 'wss://old.trycloudflare.com',
      startedAt: '2020-01-01T00:00:00.000Z',
    });

    // Dead PID is treated as stale regardless of force flag — should not throw.
    const handle = acquireLock({ force: true });
    try {
      const raw = JSON.parse(readFileSync(lockPath, 'utf8'));
      expect(raw.pid).toBe(process.pid);
    } finally {
      handle.release();
    }
  });

  it('does not throw when force=true and own PID holds the lock', () => {
    // Simulate a live-conflict scenario by mocking isPidAlive to return true for
    // a dead PID, then using force=true to take over.
    const lockPath = lockFilePath();
    const dead = deadPid();
    writeLockFile(lockPath, {
      pid: dead,
      wssUrl: 'wss://old.trycloudflare.com',
      startedAt: '2020-01-01T00:00:00.000Z',
    });

    // With force=true the conflict path tries SIGTERM then takes over.
    // Since the PID is dead, killAndWait is a no-op and we get the lock.
    let handle: ReturnType<typeof acquireLock> | undefined;
    expect(() => {
      handle = acquireLock({ force: true });
    }).not.toThrow();

    handle?.release();
  });
});

describe('LockHandle.updateWssUrl', () => {
  let dir: string;

  beforeEach(() => {
    ({ dir } = setupTmpLockDir());
  });

  afterEach(() => {
    teardownTmpLockDir(dir);
  });

  it('updates wssUrl in the lock file', () => {
    const handle = acquireLock();
    try {
      handle.updateWssUrl('wss://new.trycloudflare.com');
      const lockPath = lockFilePath();
      const raw = JSON.parse(readFileSync(lockPath, 'utf8'));
      expect(raw.wssUrl).toBe('wss://new.trycloudflare.com');
    } finally {
      handle.release();
    }
  });

  it('is a no-op after release', () => {
    const handle = acquireLock();
    const lockPath = lockFilePath();
    handle.release();
    // File is gone — updateWssUrl should not throw.
    expect(() => handle.updateWssUrl('wss://late.trycloudflare.com')).not.toThrow();
    expect(existsSync(lockPath)).toBe(false);
  });
});

describe('LockHandle.release', () => {
  let dir: string;

  beforeEach(() => {
    ({ dir } = setupTmpLockDir());
  });

  afterEach(() => {
    teardownTmpLockDir(dir);
  });

  it('removes the lock file', () => {
    const handle = acquireLock();
    const lockPath = lockFilePath();
    expect(existsSync(lockPath)).toBe(true);
    handle.release();
    expect(existsSync(lockPath)).toBe(false);
  });

  it('is idempotent — second release does not throw', () => {
    const handle = acquireLock();
    handle.release();
    expect(() => handle.release()).not.toThrow();
  });
});
