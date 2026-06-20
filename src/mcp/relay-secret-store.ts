/**
 * Project-local relay TOTP secret store (#394 first-run auto-mint, #396 moved to
 * a project-local single file `.ait_relay`).
 *
 * Two surfaces, intentionally split by who is allowed to write:
 *
 *   - {@link ensureRelaySecret} — WRITE path, called ONLY from the unplugin
 *     (env-2 relay boot). Mints a fresh secret on first run and persists it to
 *     `<projectRoot>/.ait_relay` (0600). A single file — no directory is created.
 *
 *   - {@link loadRelaySecretReadOnly} — READ-ONLY path, called from the MCP
 *     daemon when switching into a relay environment. It NEVER mints, chmods, or
 *     creates anything: it only reads an already-existing `.ait_relay` and injects
 *     its value into `env`. A daemon that minted would defeat the #250 fail-fast
 *     (the daemon is the verifier side — a self-minted secret would let a leaked
 *     tunnel URL attach unauthenticated), so the daemon stays read-only.
 *
 * Why a per-session `projectRoot` instead of `process.cwd()`: the daemon cannot
 * trust its own cwd — agent-plugin spawns it via `npx` without `cwd`, so cwd is
 * frozen at Claude Code launch and a cwd-walk stops at the monorepo workspace
 * root (which always has a package.json). So the project root is supplied
 * per-debug-session through `start_debug`.
 *
 * SECRET-HANDLING: this module handles AIT_DEBUG_TOTP_SECRET — the raw value and
 * its length MUST NOT appear in any log, error message, stdout, stderr, or
 * assertion output. Only boolean pass/fail signals are safe to surface, and the
 * discovered file path is never logged either. The persist file is written mode
 * 0600.
 */

import { dirname, join } from 'node:path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Project-local secret file name (single file, not a directory). */
export const RELAY_SECRET_FILE_NAME = '.ait_relay';

// ---------------------------------------------------------------------------
// Dependency injection surface
// ---------------------------------------------------------------------------

/** Minimal fs subset needed by {@link ensureRelaySecret} — injectable for tests. */
export interface RelaySecretFs {
  writeFileSync(path: string, data: string, options: { mode: number; flag: string }): void;
  readFileSync(path: string, encoding: BufferEncoding): string;
  chmodSync(path: string, mode: number): void;
  existsSync(path: string): boolean;
}

/**
 * Minimal fs subset needed by {@link loadRelaySecretReadOnly} — strictly the two
 * read-only operations. Deliberately omits writeFileSync/mkdirSync/chmodSync so
 * the daemon path cannot mutate the filesystem even by accident (the type
 * forbids it).
 */
export interface RelaySecretReadOnlyFs {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: BufferEncoding): string;
}

export interface RelaySecretDeps {
  /**
   * Project root (typically Vite `server.config.root`). The `.ait_relay` file is
   * resolved against the nearest `package.json` directory at or above this path.
   * When omitted, the current working directory is used as the start point —
   * retained for back-compat/tests; the unplugin always passes it.
   */
  projectRoot?: string;
  /** Process environment to read from and inject into. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Cryptographically secure random bytes. Defaults to node:crypto randomBytes. */
  randomBytes?: (n: number) => Buffer;
  /** Filesystem operations. Defaults to node:fs synchronous functions. */
  fs?: RelaySecretFs;
  /** existsSync used to resolve the nearest package.json directory. Defaults to node:fs. */
  existsSync?: (path: string) => boolean;
  /** Current working directory resolver (used only when `projectRoot` is omitted). */
  cwd?: () => string;
  /** Log function for first-mint announcement. Defaults to process.stderr.write. */
  log?: (msg: string) => void;
}

export interface RelaySecretReadOnlyDeps {
  /**
   * Project root supplied per-debug-session via `start_debug`. The daemon reads
   * `<nearest package.json dir from projectRoot>/.ait_relay`. When omitted, the
   * loader is a no-op (the daemon has no anchor to read from).
   */
  projectRoot?: string;
  /** Process environment to read from and inject into. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Read-only filesystem operations. Defaults to node:fs (existsSync + readFileSync). */
  fs?: RelaySecretReadOnlyFs;
  /** existsSync used to resolve the nearest package.json directory. Defaults to node:fs. */
  existsSync?: (path: string) => boolean;
  /** Optional log sink — never receives the secret value, length, or file path. */
  log?: (msg: string) => void;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Walks upward from `start` and returns the nearest directory that contains a
 * `package.json`. Falls back to `start` itself when none is found (so a write
 * still lands somewhere deterministic).
 *
 * The write (unplugin) and read (daemon) sides use the SAME anchor so a secret
 * minted by `pnpm dev` is found by the daemon: real mini-apps keep
 * `vite.config.ts` and `package.json` in the same directory, so
 * `server.config.root === package.json-dir`. In a monorepo subdir the anchor is
 * the package's own directory — the one the daemon can also reach via the
 * per-session projectRoot.
 *
 * @param start - Directory to start the upward walk from.
 * @param existsSyncFn - Injectable existence check (defaults to node:fs).
 */
export function nearestPackageJsonDir(
  start: string,
  existsSyncFn: (path: string) => boolean,
): string {
  let dir = start;
  // Stop at the filesystem root (dirname of root === root).
  while (true) {
    if (existsSyncFn(join(dir, 'package.json'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      // Reached the filesystem root without finding a package.json — fall back
      // to the original start directory.
      return start;
    }
    dir = parent;
  }
}

/**
 * Absolute path to the project-local `.ait_relay` file for a given start
 * directory (resolved against the nearest package.json directory).
 *
 * Exported so tests can compute the expected path without duplicating the
 * resolution logic.
 */
export function relaySecretFilePath(
  start: string,
  existsSyncFn: (path: string) => boolean,
): string {
  return join(nearestPackageJsonDir(start, existsSyncFn), RELAY_SECRET_FILE_NAME);
}

// ---------------------------------------------------------------------------
// WRITE path (unplugin only) — mint + persist
// ---------------------------------------------------------------------------

/**
 * Ensures `env.AIT_DEBUG_TOTP_SECRET` is set to a valid relay TOTP secret,
 * persisting a freshly-minted one to `<projectRoot>/.ait_relay` (0600) on first
 * run and loading it silently on subsequent runs.
 *
 * Writes a SINGLE file into the already-existing project directory — it never
 * creates a directory (so no `mkdirSync`/dir `chmod`). The file is created with
 * `O_EXCL` (`flag: 'wx'`) so a concurrent process cannot be clobbered; on the
 * EEXIST race the winner's value is read instead.
 *
 * Called ONLY from the unplugin (env-2 relay boot). The MCP daemon uses
 * {@link loadRelaySecretReadOnly} (read-only) — it must never mint.
 *
 * @param deps - Optional dependency overrides for testing.
 */
export async function ensureRelaySecret(deps?: RelaySecretDeps): Promise<void> {
  const {
    projectRoot,
    env = process.env,
    randomBytes: randomBytesFn,
    fs: fsDep,
    existsSync: existsSyncDep,
    cwd: cwdFn,
    log,
  } = deps ?? {};

  const logFn: (msg: string) => void = log ?? ((msg: string) => process.stderr.write(msg));

  // Lazily import isValidRelayAuthSecret to avoid pulling in node:crypto at
  // module-load time (keeps the import side-effect free).
  const { isValidRelayAuthSecret } = await import('./totp.js');

  // 1. Already configured — no-op (operator export or earlier run wins).
  //    But first check for a divergence between the env value and .ait_relay —
  //    if they differ the relay will verify against the env value while QR/
  //    deep-links carry codes derived from the file, causing silent 401s (#620).
  if (isValidRelayAuthSecret(env.AIT_DEBUG_TOTP_SECRET)) {
    // We need fs to compare — resolve deps early just for the divergence check.
    // This mirrors the lazy-resolve block below but is hoisted here so we can
    // still early-return after the (possibly-emitted) warning.
    const fsEarly: RelaySecretFs = fsDep ?? (await import('node:fs'));
    const existsSyncEarly: (path: string) => boolean = existsSyncDep ?? fsEarly.existsSync;
    const startEarly = projectRoot ?? (cwdFn ?? (() => process.cwd()))();
    const secretPathEarly = relaySecretFilePath(startEarly, existsSyncEarly);
    warnIfEnvDiffersFromFile(
      env.AIT_DEBUG_TOTP_SECRET,
      secretPathEarly,
      fsEarly,
      isValidRelayAuthSecret,
      logFn,
    );
    return;
  }

  // Resolve injected or real dependencies lazily to keep the import graph clean.
  const rb: (n: number) => Buffer = randomBytesFn ?? (await import('node:crypto')).randomBytes;
  const fs: RelaySecretFs = fsDep ?? (await import('node:fs'));
  const existsSyncFn: (path: string) => boolean = existsSyncDep ?? fs.existsSync;

  const start = projectRoot ?? (cwdFn ?? (() => process.cwd()))();
  const secretPath = relaySecretFilePath(start, existsSyncFn);

  // 2. Persist file exists — read and inject (silent reload).
  if (fs.existsSync(secretPath)) {
    return readAndInject(secretPath, fs, env, logFn, isValidRelayAuthSecret, rb);
  }

  // 3. Mint a fresh secret.
  return mintAndPersist(secretPath, fs, env, rb, logFn, isValidRelayAuthSecret);
}

// ---------------------------------------------------------------------------
// READ-ONLY path (daemon only) — never mints, chmods, or creates anything
// ---------------------------------------------------------------------------

/**
 * Reads an already-existing `<projectRoot>/.ait_relay` and, if its contents are a
 * valid relay TOTP secret, injects them into `env.AIT_DEBUG_TOTP_SECRET`.
 *
 * Strictly READ-ONLY: it uses only `existsSync` + `readFileSync` and NEVER mints,
 * chmods, or creates files/directories. The daemon must not mint because it is
 * the relay verifier side — a self-minted secret would defeat the #250 fail-fast
 * (a leaked tunnel URL could then attach unauthenticated). If no valid secret is
 * found the function leaves `env` untouched and returns without throwing, so the
 * downstream `assertRelayAuthConfigured()` stays the single fail-fast.
 *
 * Resolution order:
 *   1. `env.AIT_DEBUG_TOTP_SECRET` already valid → no-op (operator export wins).
 *   2. `projectRoot` given → read `<nearest package.json dir>/.ait_relay`; inject
 *      iff the contents pass {@link isValidRelayAuthSecret}.
 *   3. Otherwise (no projectRoot, file absent, or invalid) → silent no-op.
 *
 * SECRET-HANDLING: the read value is passed ONLY to the boolean predicate before
 * assignment; its value, length, and the discovered file path are never logged.
 *
 * @param deps - Optional dependency overrides for testing.
 */
export async function loadRelaySecretReadOnly(deps?: RelaySecretReadOnlyDeps): Promise<void> {
  const { projectRoot, env = process.env, fs: fsDep, existsSync: existsSyncDep, log } = deps ?? {};

  const logFn: (msg: string) => void = log ?? ((msg: string) => process.stderr.write(msg));

  const { isValidRelayAuthSecret } = await import('./totp.js');

  // 1. Already configured — no-op (operator export or unplugin run wins).
  //    But first check for a divergence between the env value and .ait_relay —
  //    if they differ the relay will verify against the env value while QR/
  //    deep-links carry codes derived from the file, causing silent 401s (#620).
  if (isValidRelayAuthSecret(env.AIT_DEBUG_TOTP_SECRET)) {
    if (projectRoot !== undefined) {
      const fsEarly: RelaySecretReadOnlyFs = fsDep ?? (await import('node:fs'));
      const existsSyncEarly: (path: string) => boolean = existsSyncDep ?? fsEarly.existsSync;
      const secretPathEarly = relaySecretFilePath(projectRoot, existsSyncEarly);
      warnIfEnvDiffersFromFile(
        env.AIT_DEBUG_TOTP_SECRET,
        secretPathEarly,
        fsEarly,
        isValidRelayAuthSecret,
        logFn,
      );
    }
    return;
  }

  // 2. No anchor → nothing to read.
  if (projectRoot === undefined) {
    return;
  }

  const fs: RelaySecretReadOnlyFs = fsDep ?? (await import('node:fs'));
  const existsSyncFn: (path: string) => boolean = existsSyncDep ?? fs.existsSync;

  const secretPath = relaySecretFilePath(projectRoot, existsSyncFn);
  if (!fs.existsSync(secretPath)) {
    return;
  }

  let stored: string;
  try {
    stored = fs.readFileSync(secretPath, 'utf8').trim();
  } catch {
    // Unreadable file (permissions, transient FS error) — stay silent and let
    // the downstream assert be the single fail-fast. SECRET-HANDLING: the error
    // and path are not surfaced.
    return;
  }

  // SECRET-HANDLING: the value flows only through the boolean predicate.
  if (!isValidRelayAuthSecret(stored)) {
    return;
  }

  env.AIT_DEBUG_TOTP_SECRET = stored;
}

// ---------------------------------------------------------------------------
// Internal helpers (not exported — single-use extracted for readability)
// ---------------------------------------------------------------------------

/**
 * Compares `envSecret` against the contents of `secretPath` (if the file
 * exists and contains a valid secret) and emits a single warning via `logFn`
 * when they differ.
 *
 * SECRET-HANDLING (hard rules — do NOT relax):
 *   - The warning MUST NOT include either secret value, its length, a hash of
 *     it, or the resolved file path.
 *   - Only an inequality boolean drives the warning; no secret-derived data
 *     enters the log message.
 *   - If the file is absent, unreadable, or its contents are invalid the
 *     function returns silently — no spurious noise.
 *
 * This helper is intentionally synchronous-like (reads via the injected fs)
 * so it can be called from within the async early-return guards without
 * introducing additional async hops.
 *
 * @param envSecret - The validated env value (caller must have confirmed it is
 *   valid before calling).
 * @param secretPath - Absolute path to `.ait_relay` to read for comparison.
 * @param fsDep - Injectable fs subset (at minimum `existsSync` + `readFileSync`).
 * @param isValidRelayAuthSecret - Injectable predicate from totp.ts.
 * @param logFn - Injectable log sink; never receives a secret value.
 */
function warnIfEnvDiffersFromFile(
  envSecret: string,
  secretPath: string,
  fsDep: RelaySecretReadOnlyFs,
  isValidRelayAuthSecret: (s: string | undefined) => s is string,
  logFn: (msg: string) => void,
): void {
  // File absent → nothing to compare.
  if (!fsDep.existsSync(secretPath)) {
    return;
  }

  let stored: string;
  try {
    stored = fsDep.readFileSync(secretPath, 'utf8').trim();
  } catch {
    // Unreadable — skip silently. SECRET-HANDLING: error and path not surfaced.
    return;
  }

  // Invalid stored contents → skip silently (no spurious noise).
  if (!isValidRelayAuthSecret(stored)) {
    return;
  }

  // Compare by equality only. Neither value nor path enters the log message.
  if (envSecret !== stored) {
    logFn(
      `[@ait-co/devtools] AIT_DEBUG_TOTP_SECRET (from environment) differs from the project-local relay secret; ` +
        `the relay will verify against the environment value. ` +
        `Remove .env/.env.local/exported AIT_DEBUG_TOTP_SECRET, or sync the file, ` +
        `so QR/deep-links and the relay agree.\n`,
    );
  }
}

async function readAndInject(
  secretPath: string,
  fs: RelaySecretFs,
  env: NodeJS.ProcessEnv,
  logFn: (msg: string) => void,
  isValidRelayAuthSecret: (s: string | undefined) => s is string,
  rb: (n: number) => Buffer,
): Promise<void> {
  let stored: string;
  try {
    stored = fs.readFileSync(secretPath, 'utf8').trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[@ait-co/devtools] relay 시크릿 파일 읽기 실패: ${msg}`);
  }

  if (!isValidRelayAuthSecret(stored)) {
    // Stored value is corrupt — re-mint over the same path.
    logFn('[@ait-co/devtools] relay 시크릿 파일의 값이 유효하지 않습니다. 재생성합니다.\n');
    return mintAndPersist(secretPath, fs, env, rb, logFn, isValidRelayAuthSecret, true);
  }

  // Inject into env — silent path (no log on successful reload).
  env.AIT_DEBUG_TOTP_SECRET = stored;
}

async function mintAndPersist(
  secretPath: string,
  fs: RelaySecretFs,
  env: NodeJS.ProcessEnv,
  rb: (n: number) => Buffer,
  logFn: (msg: string) => void,
  isValidRelayAuthSecret: (s: string | undefined) => s is string,
  /** When re-minting over a corrupt file, the existing file must be overwritten. */
  overwrite = false,
): Promise<void> {
  // SECRET-HANDLING: the raw bytes are never written to any log or string other
  // than the persist file and the env variable.
  const secret = rb(32).toString('hex'); // 64 hex chars = 256 bits

  // Self-consistency guard: our own minted secret must pass validation.
  if (!isValidRelayAuthSecret(secret)) {
    throw new Error(
      '[@ait-co/devtools] 내부 오류: mint된 시크릿이 유효성 검사를 통과하지 못했습니다.',
    );
  }

  // Write a SINGLE file into the already-existing project directory — no
  // directory is created. `O_EXCL` (flag 'wx') makes the create exclusive so a
  // concurrent process cannot be clobbered; on EEXIST we read the winner's value.
  // (When re-minting over a corrupt file we must overwrite, so use 'w'.)
  const flag = overwrite ? 'w' : 'wx';
  try {
    fs.writeFileSync(secretPath, secret, { mode: 0o600, flag });
    // Belt-and-suspenders: apply chmod after write in case umask relaxed the mode.
    fs.chmodSync(secretPath, 0o600);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      // Race: another process already wrote the file — read their value.
      let stored: string;
      try {
        stored = fs.readFileSync(secretPath, 'utf8').trim();
      } catch (readErr) {
        const msg = readErr instanceof Error ? readErr.message : String(readErr);
        throw new Error(`[@ait-co/devtools] relay 시크릿 파일 읽기 실패(경합): ${msg}`);
      }
      if (!isValidRelayAuthSecret(stored)) {
        throw new Error('[@ait-co/devtools] relay 시크릿 파일이 경합 후에도 유효하지 않습니다.');
      }
      env.AIT_DEBUG_TOTP_SECRET = stored;
      return;
    }
    throw err;
  }

  // Inject into the current process env so the immediately following
  // assertRelayAuthConfigured() / buildRelayVerifyAuth() calls see the value.
  env.AIT_DEBUG_TOTP_SECRET = secret;

  // First-mint announcement (value never included — SECRET-HANDLING). The file
  // name is fixed (`.ait_relay`); we do not echo the resolved directory either.
  logFn(
    `[@ait-co/devtools] relay 인증 시크릿을 생성해 프로젝트의 ${RELAY_SECRET_FILE_NAME} 파일에 저장했습니다 (권한 0600).\n` +
      `다음 실행부터 자동으로 사용됩니다. 직접 export할 필요 없습니다.\n` +
      `팀이 같은 relay를 공유하려면 이 파일을 repo에 커밋하세요(비공개 repo 권장).\n` +
      `자세히: https://docs.aitc.dev/guides/relay-auth-totp\n`,
  );
}
