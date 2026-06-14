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
import { isPidAlive as _isPidAlive } from '../shared/parent-watcher.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LockData {
  pid: number;
  /** `null` until the cloudflared tunnel URL is assigned. */
  wssUrl: string | null;
  startedAt: string;
  /**
   * PID of the cloudflared child process. Written once the tunnel is up via
   * `LockHandle.updateTunnelChildPid`. Absent in lock files written by older
   * versions — those fall back to PID-only stale detection.
   *
   * FIX 3 (issue #571): `acquireLock` treats a live holder whose tunnel child
   * is known-dead as a stale lock and reclaims it.
   */
  tunnelChildPid?: number | null;
}

export interface LockHandle {
  /** Updates the wssUrl field in the lock file once the tunnel URL is known. */
  updateWssUrl(wssUrl: string): void;
  /**
   * Updates the cloudflared child PID in the lock file once the tunnel is up.
   *
   * FIX 3 (issue #571): a second `acquireLock` caller will see this PID and
   * can detect that the holder's tunnel child is dead even though the Node
   * process itself is still alive, allowing lock reclamation.
   */
  updateTunnelChildPid(pid: number): void;
  /** Removes the lock file. Idempotent — safe to call multiple times. */
  release(): void;
}

/** Thrown when a live server process already holds the lock. */
export class ServerLockConflictError extends Error {
  /** PID of the existing server process. */
  readonly existingPid: number;
  /** wssUrl from the existing lock — may be `null` if the tunnel is still starting. */
  readonly existingWssUrl: string | null;
  /** ISO timestamp from the existing lock — when that session started. */
  readonly existingStartedAt: string;

  constructor(existingPid: number, existingWssUrl: string | null, existingStartedAt: string) {
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
    this.existingStartedAt = existingStartedAt;
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
 * Re-exported from `../shared/parent-watcher` so external callers that
 * import from `./server-lock` keep working without an import-path change.
 */
export const isPidAlive: (pid: number) => boolean = _isPidAlive;

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
      // FIX 3: read optional tunnelChildPid — absent in lock files from older
      // versions; those fall back to PID-only stale detection.
      const tunnelChildPid = typeof p.tunnelChildPid === 'number' ? p.tunnelChildPid : null;
      return {
        pid: p.pid as number,
        wssUrl: typeof p.wssUrl === 'string' ? p.wssUrl : null,
        startedAt: p.startedAt as string,
        tunnelChildPid,
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
// Force-takeover helper
// ---------------------------------------------------------------------------

/**
 * Sends SIGTERM to `pid` and waits up to `graceMs` (default 2 000 ms) for it
 * to exit; then falls back to SIGKILL.  Synchronous — uses a busy-wait loop so
 * it is usable in the top-level startup path without async plumbing.
 *
 * Ignores errors from `process.kill` so that a race where the target exits
 * between the alive check and the kill call does not crash the caller.
 */
function killAndWait(pid: number, graceMs = 2_000): void {
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Already gone — nothing to do.
    return;
  }

  const deadline = Date.now() + graceMs;
  // Poll every 100 ms until the process is gone or the grace period expires.
  while (isPidAlive(pid) && Date.now() < deadline) {
    // Busy-wait: this is a very short window (≤2 s) at startup.
    const end = Date.now() + 100;
    while (Date.now() < end) {
      // spin
    }
  }

  if (isPidAlive(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Reads the current lock file without acquiring it. Returns the parsed
 * `LockData` when the file exists and is valid, otherwise `null`. Used by
 * `get_debug_status` to surface the `serverLockHolder` field without
 * interfering with the running lock owner.
 */
export function readServerLock(): LockData | null {
  return readLock(lockFilePath());
}

/** Options for `acquireLock`. */
export interface AcquireLockOptions {
  /**
   * When `true`, terminates the process holding the existing lock (SIGTERM →
   * wait up to 2 s → SIGKILL) and takes over the lock.
   *
   * Corresponds to the `--force` / `--takeover` CLI flag.
   */
  force?: boolean;
}

/**
 * Attempts to acquire the server lock.
 *
 * - If no lock exists (or the lock is stale): writes a new lock and returns a
 *   `LockHandle` with `updateWssUrl` + `release`.
 * - If a live process holds the lock and `force` is `false` (default): writes
 *   a clear recovery message to stderr and throws `ServerLockConflictError`.
 * - If a live process holds the lock and `force` is `true`: sends SIGTERM to
 *   that process (waiting up to 2 s then SIGKILL) and takes over the lock.
 *
 * The initial `wssUrl` in the lock file is `null` — call
 * `handle.updateWssUrl(url)` once the cloudflared tunnel is ready.
 */
export function acquireLock(options: AcquireLockOptions = {}): LockHandle {
  const { force = false } = options;
  const lockPath = lockFilePath();
  const existing = readLock(lockPath);

  if (existing !== null) {
    if (isPidAlive(existing.pid)) {
      // FIX 3 (issue #571): even if the Node process is alive, check whether
      // its cloudflared child has died. A zombie daemon whose tunnel is dead
      // is effectively stale — reclaim the lock without waiting for the user
      // to manually kill the process.
      const tunnelChildPid = existing.tunnelChildPid;
      const tunnelChildDead = typeof tunnelChildPid === 'number' && !isPidAlive(tunnelChildPid);

      if (tunnelChildDead) {
        process.stderr.write(
          `[ait-debug] stale lock: holder PID=${existing.pid} alive but tunnel child PID=${tunnelChildPid} is dead — reclaiming lock.\n`,
        );
        // Fall through to write a fresh lock.
      } else if (force) {
        // Force takeover: SIGTERM → 2 s grace → SIGKILL.
        process.stderr.write(
          `[ait-debug] --force: terminating existing session PID=${existing.pid} …\n`,
        );
        killAndWait(existing.pid);
        process.stderr.write(`[ait-debug] --force: PID=${existing.pid} stopped, taking over.\n`);
      } else {
        // Emit a user-actionable message before throwing so the MCP host can
        // surface it — the thrown message is included in the "process exited"
        // log, but the stderr line is more prominent and machine-parseable.
        const urlPart =
          existing.wssUrl != null ? `wssUrl=${existing.wssUrl}` : 'wssUrl=(tunnel starting)';
        process.stderr.write(
          `[ait-debug] 기존 debug-mode 세션이 이미 실행 중 — PID=${existing.pid}, started ${existing.startedAt}, ${urlPart}\n` +
            `[ait-debug] 회복: \`kill ${existing.pid}\` 또는 \`npx @ait-co/devtools devtools-mcp --force\`\n`,
        );
        throw new ServerLockConflictError(existing.pid, existing.wssUrl, existing.startedAt);
      }
    } else {
      // Stale lock — previous process died without cleanup.
      process.stderr.write(
        `[ait-debug] stale lock from PID ${existing.pid} recovered — starting fresh.\n`,
      );
    }
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
    updateTunnelChildPid(pid: number): void {
      if (released) return;
      data.tunnelChildPid = pid;
      writeLock(lockPath, data);
    },
    release(): void {
      if (released) return;
      released = true;
      removeLock(lockPath);
    },
  };
}
