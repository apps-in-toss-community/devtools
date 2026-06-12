/**
 * Project-local ephemeral URL store (#424).
 *
 * Environment-2 ("AITC Sandbox PWA") cold-start requires two ephemeral URLs:
 *   - `relayBaseUrl` — the CDP relay's https base (was `AIT_RELAY_BASE_URL`)
 *   - `tunnelBaseUrl` — the app's https tunnel base (was `AIT_TUNNEL_BASE_URL`)
 *
 * Quick-tunnel URLs change every run. Previously the user had to copy-paste them
 * into env vars on every cold-start — a single typo silently broke attach. This
 * module replaces that manual hand-off with a file-based discovery pattern that
 * exactly mirrors the `.ait_relay` TOTP-secret store (relay-secret-store.ts).
 *
 * Two surfaces, intentionally split by who is allowed to write:
 *
 *   - {@link writeRelayUrls} — WRITE path, called ONLY from the unplugin
 *     (env-2 tunnel boot). Writes JSON to `<projectRoot>/.ait_urls` (0600) on
 *     every boot (`flag: 'w'` — overwrite). A single file — no directory is
 *     created.
 *
 *   - {@link readRelayUrls} — READ-ONLY path, called from the MCP daemon as a
 *     fallback when `AIT_RELAY_BASE_URL`/`AIT_TUNNEL_BASE_URL` are not set. It
 *     NEVER writes, chmods, or creates anything: it only reads an existing
 *     `.ait_urls`. On any failure (missing file / bad JSON / wrong shape) it
 *     returns `null` silently, letting the downstream assertion be the single
 *     fail-fast.
 *
 *   - {@link deleteRelayUrls} — called from the unplugin `cleanup()` on
 *     teardown (via `void deleteRelayUrls(...)`). A stale `.ait_urls` pointing
 *     at a dead tunnel would cause the MCP daemon to attempt a doomed attach on
 *     the next cold-start — deletion is non-negotiable. Silently swallows all
 *     errors.
 *
 * Design note: the env vars (`AIT_RELAY_BASE_URL`, `AIT_TUNNEL_BASE_URL`) are
 * PRESERVED as operator overrides. The file is the fallback — env wins.
 *
 * Why `nearestPackageJsonDir` instead of `process.cwd()`: see relay-secret-store.ts.
 * The unplugin (writer) and the MCP daemon (reader) both anchor to the nearest
 * package.json from their respective `projectRoot` inputs, ensuring both sides
 * find the same file.
 *
 * SECRET-HANDLING: `relayBaseUrl` and `tunnelBaseUrl` carry the relay/tunnel host
 * — same sensitivity class as `.ait_relay`. The raw URL values, partial values,
 * and the resolved file path MUST NOT appear in any log, error message, stdout,
 * stderr, or assertion output anywhere in this module or at its call sites.
 * Only boolean pass/fail signals are safe to surface. The file is written mode
 * 0600.
 */

import { join } from 'node:path';
import { nearestPackageJsonDir } from './relay-secret-store.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Project-local ephemeral URL file name (single file, not a directory). */
export const URLS_FILE_NAME = '.ait_urls';

// ---------------------------------------------------------------------------
// Dependency injection surfaces
// ---------------------------------------------------------------------------

/** Minimal fs subset needed by {@link writeRelayUrls} — injectable for tests. */
export interface RelayUrlWriteFs {
  writeFileSync(path: string, data: string, options: { mode: number; flag: string }): void;
  existsSync(path: string): boolean;
}

/** Minimal fs subset needed by {@link readRelayUrls} — injectable for tests. */
export interface RelayUrlReadFs {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: BufferEncoding): string;
}

/** Minimal fs subset needed by {@link deleteRelayUrls} — injectable for tests. */
export interface RelayUrlDeleteFs {
  existsSync(path: string): boolean;
  unlinkSync(path: string): void;
}

// ---------------------------------------------------------------------------
// Path helper
// ---------------------------------------------------------------------------

/**
 * Absolute path to the project-local `.ait_urls` file for a given start
 * directory (resolved against the nearest package.json directory).
 *
 * Exported so tests can compute the expected path without duplicating the
 * resolution logic.
 */
export function urlsFilePath(start: string, existsSyncFn: (path: string) => boolean): string {
  return join(nearestPackageJsonDir(start, existsSyncFn), URLS_FILE_NAME);
}

// ---------------------------------------------------------------------------
// WRITE path (unplugin only) — overwrite on every boot
// ---------------------------------------------------------------------------

export interface WriteRelayUrlsDeps {
  /** Project root (typically Vite `server.config.root`). */
  projectRoot: string;
  /**
   * The CDP relay's https base URL (same value as `AIT_RELAY_BASE_URL`).
   * Omit when the relay was not started (e.g. `cdp:false`).
   * SECRET-HANDLING: never log this value.
   */
  relayBaseUrl?: string;
  /**
   * The CDP relay's LOCAL http base URL (`http://127.0.0.1:<relay-port>`).
   * Set when `cdp: true` and the local relay port is known. Used by the MCP
   * daemon's `bootExternalRelayFamily` to build the Chii inspector URL against
   * the local relay rather than the cloudflare tunnel, so front_end page load
   * and the client WS leg do not traverse the tunnel (issue #530).
   * SECRET-HANDLING: local loopback URL — no tunnel host, safe to surface.
   */
  relayLocalUrl?: string;
  /**
   * The app tunnel's https base URL (same value as `AIT_TUNNEL_BASE_URL`).
   * Omit when no tunnel URL is available.
   * SECRET-HANDLING: never log this value.
   */
  tunnelBaseUrl?: string;
  /** Filesystem operations. Defaults to node:fs synchronous functions. */
  fs?: RelayUrlWriteFs;
  /** existsSync used to resolve the nearest package.json directory. Defaults to node:fs. */
  existsSync?: (path: string) => boolean;
}

/**
 * Writes `{ relayBaseUrl, tunnelBaseUrl }` (omitting absent keys) to
 * `<projectRoot>/.ait_urls` (mode 0600). Uses `flag: 'w'` (overwrite) because
 * URLs are ephemeral — a fresh URL replaces the previous one on every boot.
 *
 * Unlike the `.ait_relay` secret store this does NOT use `O_EXCL` (`'wx'`):
 * there is no race concern here (only the unplugin writes this file) and the
 * URL must be fresh on every cold-start.
 *
 * Called ONLY from the unplugin (env-2 tunnel boot). The MCP daemon uses
 * {@link readRelayUrls} (read-only) — it must never write.
 *
 * SECRET-HANDLING: URL values are never logged.
 */
export async function writeRelayUrls(deps: WriteRelayUrlsDeps): Promise<void> {
  const { projectRoot, relayBaseUrl, tunnelBaseUrl, fs: fsDep, existsSync: existsSyncDep } = deps;

  const fs: RelayUrlWriteFs = fsDep ?? (await import('node:fs'));
  const existsSyncFn: (path: string) => boolean = existsSyncDep ?? fs.existsSync;

  const filePath = urlsFilePath(projectRoot, existsSyncFn);

  // Build the payload — omit keys whose values are absent.
  const payload: { relayBaseUrl?: string; relayLocalUrl?: string; tunnelBaseUrl?: string } = {};
  if (typeof relayBaseUrl === 'string' && relayBaseUrl !== '') {
    payload.relayBaseUrl = relayBaseUrl;
  }
  const { relayLocalUrl } = deps;
  if (typeof relayLocalUrl === 'string' && relayLocalUrl !== '') {
    payload.relayLocalUrl = relayLocalUrl;
  }
  if (typeof tunnelBaseUrl === 'string' && tunnelBaseUrl !== '') {
    payload.tunnelBaseUrl = tunnelBaseUrl;
  }

  // SECRET-HANDLING: JSON content (which includes URL values) is written to
  // the file only — never to any log, stdout, or stderr.
  const data = JSON.stringify(payload);

  // Overwrite on every boot (`flag: 'w'`) — URLs are ephemeral.
  fs.writeFileSync(filePath, data, { mode: 0o600, flag: 'w' });
}

// ---------------------------------------------------------------------------
// READ-ONLY path (daemon only) — never writes, chmods, or creates anything
// ---------------------------------------------------------------------------

export interface ReadRelayUrlsDeps {
  /** Project root supplied per-debug-session. When omitted, returns `null`. */
  projectRoot?: string;
  /** Read-only filesystem operations. Defaults to node:fs (existsSync + readFileSync). */
  fs?: RelayUrlReadFs;
  /** existsSync used to resolve the nearest package.json directory. Defaults to node:fs. */
  existsSync?: (path: string) => boolean;
}

/**
 * Reads `<projectRoot>/.ait_urls` and returns the stored URLs, or `null` on
 * any failure.
 *
 * Strictly READ-ONLY: only `existsSync` + `readFileSync`. Never writes,
 * chmods, or creates files/directories.
 *
 * Returns `null` (silently, no throw, no log) on:
 *   - missing `projectRoot`
 *   - missing `.ait_urls` file
 *   - unreadable file (permissions, transient FS error)
 *   - invalid JSON
 *   - wrong shape (non-object, non-string values)
 *
 * Trims string values before returning. Ignores non-string fields.
 *
 * SECRET-HANDLING: URL values and the file path are never logged.
 */
export async function readRelayUrls(deps?: ReadRelayUrlsDeps): Promise<{
  relayBaseUrl?: string;
  relayLocalUrl?: string;
  tunnelBaseUrl?: string;
} | null> {
  const { projectRoot, fs: fsDep, existsSync: existsSyncDep } = deps ?? {};

  if (projectRoot === undefined) {
    return null;
  }

  const fs: RelayUrlReadFs = fsDep ?? (await import('node:fs'));
  const existsSyncFn: (path: string) => boolean = existsSyncDep ?? fs.existsSync;

  const filePath = urlsFilePath(projectRoot, existsSyncFn);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch {
    // Unreadable file — silent no-op, let the downstream assert be the fail-fast.
    // SECRET-HANDLING: the error and path are not surfaced.
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Invalid JSON — silent no-op.
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;
  const result: { relayBaseUrl?: string; relayLocalUrl?: string; tunnelBaseUrl?: string } = {};

  const relay = obj.relayBaseUrl;
  if (typeof relay === 'string') {
    const trimmed = relay.trim();
    if (trimmed !== '') result.relayBaseUrl = trimmed;
  }

  const relayLocal = obj.relayLocalUrl;
  if (typeof relayLocal === 'string') {
    const trimmed = relayLocal.trim();
    if (trimmed !== '') result.relayLocalUrl = trimmed;
  }

  const tunnel = obj.tunnelBaseUrl;
  if (typeof tunnel === 'string') {
    const trimmed = tunnel.trim();
    if (trimmed !== '') result.tunnelBaseUrl = trimmed;
  }

  return result;
}

// ---------------------------------------------------------------------------
// DELETE path (unplugin cleanup only)
// ---------------------------------------------------------------------------

export interface DeleteRelayUrlsDeps {
  /** Project root. */
  projectRoot: string;
  /** Filesystem operations. Defaults to node:fs (existsSync + unlinkSync). */
  fs?: RelayUrlDeleteFs;
  /** existsSync used to resolve the nearest package.json directory. */
  existsSync?: (path: string) => boolean;
}

/**
 * Removes `<projectRoot>/.ait_urls` if present. Silently swallows ENOENT and
 * any other error so cleanup always succeeds.
 *
 * Called ONLY from the unplugin's `cleanup()` on `httpServer 'close'` + signals
 * (via `void deleteRelayUrls(...)`). A stale `.ait_urls` pointing at a dead
 * tunnel would cause the MCP daemon to attempt a doomed attach on the next
 * cold-start — deletion is non-negotiable.
 *
 * SECRET-HANDLING: the file path is never logged.
 */
export async function deleteRelayUrls(deps: DeleteRelayUrlsDeps): Promise<void> {
  const { projectRoot, fs: fsDep, existsSync: existsSyncDep } = deps;

  const fs: RelayUrlDeleteFs = fsDep ?? (await import('node:fs'));
  const existsSyncFn: (path: string) => boolean = existsSyncDep ?? fs.existsSync;

  const filePath = urlsFilePath(projectRoot, existsSyncFn);

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Swallow ENOENT and any other error — cleanup is best-effort.
    // SECRET-HANDLING: the path is not logged.
  }
}
