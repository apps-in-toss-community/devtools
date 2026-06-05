/**
 * First-run auto-mint helper for the relay TOTP secret.
 *
 * SECRET-HANDLING: this module handles AIT_DEBUG_TOTP_SECRET — the raw value
 * and its length MUST NOT appear in any log, error message, stdout, stderr, or
 * assertion output. Only boolean pass/fail signals are safe to surface. The
 * persist file is written mode 0600 and the containing directory mode 0700.
 *
 * Behaviour summary:
 *   1. If env.AIT_DEBUG_TOTP_SECRET is already a valid hex secret → no-op.
 *   2. If the persist file exists → read, chmod 0600 if permissions are loose,
 *      inject into env. Re-mint if the stored value fails validation.
 *   3. If neither → mint a 256-bit random secret, write to file (O_EXCL),
 *      chmod 0600/0700, inject into env, log one informational message.
 *
 * The MCP daemon (debug-server.ts / cli.ts) is NOT touched — it keeps its
 * existing fail-fast assertRelayAuthConfigured() call unchanged. This module
 * is called only from the unplugin (env-2 relay path) so that first-time
 * users do not need to manually export AIT_DEBUG_TOTP_SECRET.
 */

import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Dependency injection surface
// ---------------------------------------------------------------------------

/** Minimal fs subset needed by ensureRelaySecret — injectable for tests. */
export interface RelaySecretFs {
  mkdirSync(path: string, options: { recursive: boolean; mode: number }): void;
  writeFileSync(path: string, data: string, options: { mode: number; flag: string }): void;
  readFileSync(path: string, encoding: BufferEncoding): string;
  statSync(path: string): { mode: number };
  chmodSync(path: string, mode: number): void;
  existsSync(path: string): boolean;
}

export interface RelaySecretDeps {
  /** Process environment to read from and inject into. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Cryptographically secure random bytes. Defaults to node:crypto randomBytes. */
  randomBytes?: (n: number) => Buffer;
  /** Filesystem operations. Defaults to node:fs synchronous functions. */
  fs?: RelaySecretFs;
  /** Home directory resolver. Defaults to node:os homedir(). */
  homedir?: () => string;
  /** Log function for first-mint announcement. Defaults to process.stderr.write. */
  log?: (msg: string) => void;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Returns the directory used for ait-devtools persisted state.
 *
 * Mirrors the AIT_DEVTOOLS_LOCK_DIR override used by server-lock.ts so that
 * tests and the relay secret store use the same temp directory when the env
 * var is set.
 */
function resolveAitDevtoolsDir(env: NodeJS.ProcessEnv, homedirFn: () => string): string {
  return env.AIT_DEVTOOLS_LOCK_DIR ?? join(homedirFn(), '.ait-devtools');
}

/**
 * Absolute path to the persisted relay TOTP secret file.
 *
 * Exported so tests can compute the expected path without duplicating the
 * resolution logic.
 */
export function relaySecretFilePath(
  env: NodeJS.ProcessEnv = process.env,
  homedirFn?: () => string,
): string {
  // `homedirFn` is always injected in tests. In production callers (e.g. the
  // path helper used in test assertions) we fall back to a synchronous inline
  // import via createRequire — this avoids a top-level side-effect import while
  // keeping the function synchronous for test ergonomics.
  const resolvedHomedir: () => string =
    homedirFn ??
    (() => {
      const { createRequire } = require('node:module') as typeof import('node:module');
      const req = createRequire(import.meta.url);
      const { homedir } = req('node:os') as typeof import('node:os');
      return homedir();
    });
  const dir = resolveAitDevtoolsDir(env, resolvedHomedir);
  return join(dir, 'relay-totp-secret');
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Ensures `env.AIT_DEBUG_TOTP_SECRET` is set to a valid relay TOTP secret.
 *
 * On first run (no env var, no persist file) a 256-bit random secret is minted,
 * written to `~/.ait-devtools/relay-totp-secret` (0600), and injected into
 * `env`. Subsequent runs load the persisted value silently.
 *
 * @param deps - Optional dependency overrides for testing. All default to real
 *   Node.js modules; inject stubs in unit tests to avoid touching disk or RNG.
 */
export async function ensureRelaySecret(deps?: RelaySecretDeps): Promise<void> {
  const {
    env = process.env,
    randomBytes: randomBytesFn,
    fs: fsDep,
    homedir: homedirFn,
    log,
  } = deps ?? {};

  // Resolve injected or real dependencies lazily to keep the import graph clean.
  const rb: (n: number) => Buffer = randomBytesFn ?? (await import('node:crypto')).randomBytes;
  const os: () => string = homedirFn ?? (await import('node:os')).homedir;
  const logFn: (msg: string) => void = log ?? ((msg: string) => process.stderr.write(msg));

  // Resolve fs — real node:fs or injected stub.
  const fs: RelaySecretFs = fsDep ?? (await import('node:fs'));

  // Lazily import isValidRelayAuthSecret to avoid pulling in node:crypto at
  // module-load time (keeps the import side-effect free).
  const { isValidRelayAuthSecret } = await import('./totp.js');

  // 1. Already configured — no-op.
  if (isValidRelayAuthSecret(env.AIT_DEBUG_TOTP_SECRET)) {
    return;
  }

  const dir = resolveAitDevtoolsDir(env, os);
  const secretPath = join(dir, 'relay-totp-secret');

  // 2. Persist file exists — read and inject.
  if (fs.existsSync(secretPath)) {
    return readAndInject(secretPath, fs, env, logFn, isValidRelayAuthSecret, rb, dir, os, logFn);
  }

  // 3. Mint a fresh secret.
  return mintAndPersist(secretPath, dir, fs, env, rb, os, logFn, isValidRelayAuthSecret);
}

// ---------------------------------------------------------------------------
// Internal helpers (not exported — single-use extracted for readability)
// ---------------------------------------------------------------------------

async function readAndInject(
  secretPath: string,
  fs: RelaySecretFs,
  env: NodeJS.ProcessEnv,
  logFn: (msg: string) => void,
  isValidRelayAuthSecret: (s: string | undefined) => s is string,
  rb: (n: number) => Buffer,
  dir: string,
  os: () => string,
  mintLogFn: (msg: string) => void,
): Promise<void> {
  let stored: string;
  try {
    stored = fs.readFileSync(secretPath, 'utf8').trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[@ait-co/devtools] relay 시크릿 파일 읽기 실패: ${msg}`);
  }

  // Tighten permissions if group/other bits are set (SSH-style hardening).
  try {
    const stat = fs.statSync(secretPath);
    // 0o077 mask: group-read/write/execute + other-read/write/execute bits.
    if ((stat.mode & 0o077) !== 0) {
      fs.chmodSync(secretPath, 0o600);
    }
  } catch {
    // If stat/chmod fails (e.g. read-only FS in tests), continue — value
    // is still usable.
  }

  if (!isValidRelayAuthSecret(stored)) {
    // Stored value is corrupt — re-mint.
    logFn('[@ait-co/devtools] relay 시크릿 파일의 값이 유효하지 않습니다. 재생성합니다.\n');
    return mintAndPersist(secretPath, dir, fs, env, rb, os, mintLogFn, isValidRelayAuthSecret);
  }

  // Inject into env — silent path (no log on successful reload).
  env.AIT_DEBUG_TOTP_SECRET = stored;
}

async function mintAndPersist(
  secretPath: string,
  dir: string,
  fs: RelaySecretFs,
  env: NodeJS.ProcessEnv,
  rb: (n: number) => Buffer,
  os: () => string,
  logFn: (msg: string) => void,
  isValidRelayAuthSecret: (s: string | undefined) => s is string,
): Promise<void> {
  // Ensure directory exists with strict permissions (0700).
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Forcibly tighten in case the directory already existed with looser perms.
  fs.chmodSync(dir, 0o700);

  // SECRET-HANDLING: the raw bytes are never written to any log or string
  // other than the persist file and the env variable.
  const secret = rb(32).toString('hex'); // 64 hex chars = 256 bits

  // Self-consistency guard: our own minted secret must pass validation.
  if (!isValidRelayAuthSecret(secret)) {
    throw new Error(
      '[@ait-co/devtools] 내부 오류: mint된 시크릿이 유효성 검사를 통과하지 못했습니다.',
    );
  }

  // Write atomically (O_EXCL — exclusive create). If a concurrent process
  // already created the file between the existsSync check and here, EEXIST
  // is thrown; read the winner's value instead.
  try {
    fs.writeFileSync(secretPath, secret, { mode: 0o600, flag: 'wx' });
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

  // First-mint announcement (value never included — SECRET-HANDLING).
  const displayPath = secretPath.replace(os(), '~');
  logFn(
    `[@ait-co/devtools] relay 인증 시크릿을 생성해 ${displayPath} 에 저장했습니다 (권한 0600).\n` +
      `다음 실행부터 자동으로 사용됩니다. 직접 export할 필요 없습니다.\n` +
      `자세히: https://docs.aitc.dev/guides/relay-auth-totp\n`,
  );
}
