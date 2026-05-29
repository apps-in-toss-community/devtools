/**
 * Single debug session lock for the `devtools-mcp` debug server.
 *
 * At most one debug server process should run on a given machine at a time —
 * multiple concurrent instances create duplicate cloudflared tunnels, waste
 * resources, and confuse the user about which wssUrl to use.
 *
 * ## Lock file
 *
 * Location: `~/.ait-devtools/server.lock`
 *
 * Schema (JSON):
 * ```json
 * { "pid": 12345, "wssUrl": "wss://xxx.trycloudflare.com", "startedAt": "2026-01-01T00:00:00.000Z" }
 * ```
 *
 * ## Behaviour
 *
 * - **Acquire**: write PID + wssUrl + startedAt. Returns a `release()` handle.
 * - **Stale lock recovery**: if the stored PID is no longer alive
 *   (`process.kill(pid, 0)` throws ESRCH), the lock is silently replaced.
 * - **Live conflict (option B)**: if the stored PID is alive, `acquireLock`
 *   throws `ServerLockConflictError` with the existing PID and wssUrl so the
 *   caller can surface a clear message to the agent.
 * - **Release**: remove the lock file. Called on graceful shutdown (SIGINT /
 *   SIGTERM / SIGHUP). SIGKILL survivors leave a stale file — the next startup
 *   recovers it automatically via the alive check.
 *
 * ## wssUrl update
 *
 * The lock is written before cloudflared starts, so `wssUrl` begins as `null`
 * and is updated in place once the tunnel URL is known via `updateWssUrl`.
 *
 * Node-only.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LockData {
  pid: number;
  /** `null` until the cloudflared tunnel URL is assigned. */
  wssUrl: string | null;
  startedAt: string;
}

export interface LockHandle {
  /** Updates the wssUrl field in the lock file once the tunnel URL is known. */
  updateWssUrl(wssUrl: string): void;
  /** Removes the lock file. Idempotent — safe to call multiple times. */
  release(): void;
}

/** Thrown when a live server process already holds the lock. */
export class ServerLockConflictError extends Error {
  /** PID of the existing server process. */
  readonly existingPid: number;
  /** wssUrl from the existing lock — may be `null` if the tunnel is still starting. */
  readonly existingWssUrl: string | null;

  constructor(existingPid: number, existingWssUrl: string | null) {
    const urlNote =
      existingWssUrl != null
        ? `  relay URL: ${existingWssUrl}\n`
        : '  relay URL: (tunnel still starting — retry in a moment)\n';

    super(
      `A debug server is already running (PID ${existingPid}).\n` +
        urlNote +
        'Stop the existing session before starting a new one.\n' +
        'If it is already stopped but this error persists, remove the lock file:\n' +
        `  rm "${lockFilePath()}"`,
    );
    this.name = 'ServerLockConflictError';
    this.existingPid = existingPid;
    this.existingWssUrl = existingWssUrl;
  }
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Returns `~/.ait-devtools/server.lock` (or `AIT_DEVTOOLS_LOCK_DIR` override for tests). */
export function lockFilePath(): string {
  const dir = process.env.AIT_DEVTOOLS_LOCK_DIR ?? join(homedir(), '.ait-devtools');
  return join(dir, 'server.lock');
}

function ensureLockDir(lockPath: string): void {
  const dir = join(lockPath, '..');
  mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// PID alive check
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the given PID refers to a running process.
 *
 * Uses `process.kill(pid, 0)` — a no-op signal that succeeds when the process
 * exists and we have permission to signal it; throws ESRCH when it doesn't exist.
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    // ESRCH = no such process → stale lock.
    // EPERM = process exists but we can't signal it (still alive).
    if ((err as NodeJS.ErrnoException).code === 'EPERM') return true;
    return false;
  }
}

// ---------------------------------------------------------------------------
// Read / write helpers
// ---------------------------------------------------------------------------

function readLock(lockPath: string): LockData | null {
  if (!existsSync(lockPath)) return null;
  try {
    const raw = readFileSync(lockPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'pid' in parsed &&
      typeof (parsed as Record<string, unknown>).pid === 'number' &&
      'startedAt' in parsed &&
      typeof (parsed as Record<string, unknown>).startedAt === 'string'
    ) {
      const p = parsed as Record<string, unknown>;
      return {
        pid: p.pid as number,
        wssUrl: typeof p.wssUrl === 'string' ? p.wssUrl : null,
        startedAt: p.startedAt as string,
      };
    }
    // Unrecognised schema — treat as stale.
    return null;
  } catch {
    // Corrupt / unreadable — treat as stale.
    return null;
  }
}

function writeLock(lockPath: string, data: LockData): void {
  ensureLockDir(lockPath);
  writeFileSync(lockPath, JSON.stringify(data, null, 2), { encoding: 'utf8' });
}

function removeLock(lockPath: string): void {
  try {
    rmSync(lockPath);
  } catch {
    // Already removed — fine.
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reads the current lock file without acquiring it. Returns the parsed
 * `LockData` when the file exists and is valid, otherwise `null`. Used by
 * `get_diagnostics` to surface the `serverLockHolder` field without
 * interfering with the running lock owner.
 */
export function readServerLock(): LockData | null {
  return readLock(lockFilePath());
}

/**
 * Attempts to acquire the server lock.
 *
 * - If no lock exists (or the lock is stale): writes a new lock and returns a
 *   `LockHandle` with `updateWssUrl` + `release`.
 * - If a live process holds the lock: throws `ServerLockConflictError`.
 *
 * The initial `wssUrl` in the lock file is `null` — call
 * `handle.updateWssUrl(url)` once the cloudflared tunnel is ready.
 */
export function acquireLock(): LockHandle {
  const lockPath = lockFilePath();
  const existing = readLock(lockPath);

  if (existing !== null) {
    if (isPidAlive(existing.pid)) {
      throw new ServerLockConflictError(existing.pid, existing.wssUrl);
    }
    // Stale lock — previous process died without cleanup.
    process.stderr.write(
      `[ait-debug] stale lock from PID ${existing.pid} recovered — starting fresh.\n`,
    );
  }

  const data: LockData = {
    pid: process.pid,
    wssUrl: null,
    startedAt: new Date().toISOString(),
  };
  writeLock(lockPath, data);

  let released = false;

  return {
    updateWssUrl(wssUrl: string): void {
      if (released) return;
      data.wssUrl = wssUrl;
      writeLock(lockPath, data);
    },
    release(): void {
      if (released) return;
      released = true;
      removeLock(lockPath);
    },
  };
}
