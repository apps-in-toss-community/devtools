/**
 * Unit tests for the relay TOTP secret first-run auto-mint helper (#394).
 *
 * All tests use injected stubs — no real disk I/O, no real RNG.
 *
 * SECRET-HANDLING: only deliberately INVALID or test-fixture hex strings
 * appear here. The log-assertion tests confirm that the minted value
 * (whatever the stub emits) is NEVER echoed back in the log message.
 */

import { describe, expect, it, vi } from 'vitest';
import type { RelaySecretDeps, RelaySecretFs } from '../mcp/relay-secret-store.js';
import { ensureRelaySecret, relaySecretFilePath } from '../mcp/relay-secret-store.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 64-hex chars = 32 bytes — passes isValidRelayAuthSecret. */
const VALID_SECRET = 'deadbeef'.repeat(8);

/** Stub randomBytes that returns a deterministic 32-byte buffer. */
function makeStubRandomBytes(hexOutput = VALID_SECRET): (n: number) => Buffer {
  return (_n: number) => Buffer.from(hexOutput, 'hex');
}

/** Builds a minimal in-memory fs stub. */
function makeFs(overrides: Partial<RelaySecretFs> = {}): RelaySecretFs & {
  _written: Map<string, { data: string; options: { mode: number; flag: string } }>;
  _chmods: Array<{ path: string; mode: number }>;
  _mkdirs: Array<{ path: string; options: { recursive: boolean; mode: number } }>;
  _stats: Map<string, { mode: number }>;
  _files: Map<string, string>;
} {
  const files = new Map<string, string>();
  const written = new Map<string, { data: string; options: { mode: number; flag: string } }>();
  const chmods: Array<{ path: string; mode: number }> = [];
  const mkdirs: Array<{ path: string; options: { recursive: boolean; mode: number } }> = [];
  const stats = new Map<string, { mode: number }>();

  const stub: ReturnType<typeof makeFs> = {
    _written: written,
    _chmods: chmods,
    _mkdirs: mkdirs,
    _stats: stats,
    _files: files,

    mkdirSync(path, options) {
      mkdirs.push({ path, options });
    },
    writeFileSync(path, data, options) {
      if (options.flag === 'wx' && files.has(path)) {
        const err = new Error('EEXIST: file already exists') as NodeJS.ErrnoException;
        err.code = 'EEXIST';
        throw err;
      }
      files.set(path, data);
      written.set(path, { data, options });
    },
    readFileSync(path, _encoding) {
      const val = files.get(path);
      if (val === undefined) {
        throw new Error(`ENOENT: no such file — ${path}`);
      }
      return val;
    },
    statSync(path) {
      const s = stats.get(path);
      if (s === undefined) throw new Error(`ENOENT: no such file — ${path}`);
      return s;
    },
    chmodSync(path, mode) {
      chmods.push({ path, mode });
    },
    existsSync(path) {
      return files.has(path);
    },
    ...overrides,
  };
  return stub;
}

/** Common deps builder: injects stub randomBytes + fs + homedir + log. */
function makeDeps(
  env: NodeJS.ProcessEnv,
  fsStub: RelaySecretFs,
  logMessages: string[],
  hexOutput = VALID_SECRET,
): RelaySecretDeps {
  return {
    env,
    randomBytes: makeStubRandomBytes(hexOutput),
    fs: fsStub,
    homedir: () => '/home/testuser',
    log: (msg: string) => logMessages.push(msg),
  };
}

// ---------------------------------------------------------------------------
// 1. Mint path: env empty, file absent → mint + persist + inject + log
// ---------------------------------------------------------------------------

describe('ensureRelaySecret — mint path', () => {
  it('calls mkdirSync with recursive:true and mode:0o700', async () => {
    const env: NodeJS.ProcessEnv = {};
    const fs = makeFs();
    const logs: string[] = [];
    await ensureRelaySecret(makeDeps(env, fs, logs));
    expect(fs._mkdirs.length).toBeGreaterThanOrEqual(1);
    const dirCall = fs._mkdirs[0];
    expect(dirCall.options.recursive).toBe(true);
    expect(dirCall.options.mode).toBe(0o700);
  });

  it('calls chmodSync(dir, 0o700) to tighten existing directory', async () => {
    const env: NodeJS.ProcessEnv = {};
    const fs = makeFs();
    const logs: string[] = [];
    await ensureRelaySecret(makeDeps(env, fs, logs));
    const dirChmod = fs._chmods.find((c) => c.mode === 0o700);
    expect(dirChmod).toBeDefined();
  });

  it('calls writeFileSync with mode:0o600 and flag:"wx"', async () => {
    const env: NodeJS.ProcessEnv = {};
    const fs = makeFs();
    const logs: string[] = [];
    await ensureRelaySecret(makeDeps(env, fs, logs));
    const secretPath = relaySecretFilePath(env, () => '/home/testuser');
    const write = fs._written.get(secretPath);
    expect(write).toBeDefined();
    expect(write?.options.mode).toBe(0o600);
    expect(write?.options.flag).toBe('wx');
  });

  it('calls chmodSync(secretPath, 0o600) after writeFileSync', async () => {
    const env: NodeJS.ProcessEnv = {};
    const fs = makeFs();
    const logs: string[] = [];
    await ensureRelaySecret(makeDeps(env, fs, logs));
    const secretPath = relaySecretFilePath(env, () => '/home/testuser');
    const fileChmod = fs._chmods.find((c) => c.path === secretPath && c.mode === 0o600);
    expect(fileChmod).toBeDefined();
  });

  it('injects the minted secret into env', async () => {
    const env: NodeJS.ProcessEnv = {};
    const fs = makeFs();
    const logs: string[] = [];
    await ensureRelaySecret(makeDeps(env, fs, logs));
    expect(env.AIT_DEBUG_TOTP_SECRET).toBe(VALID_SECRET);
  });

  it('calls log exactly once on first mint', async () => {
    const env: NodeJS.ProcessEnv = {};
    const fs = makeFs();
    const logs: string[] = [];
    await ensureRelaySecret(makeDeps(env, fs, logs));
    expect(logs.length).toBe(1);
  });

  it('log message contains the persist path but NOT the secret value or its length', async () => {
    const env: NodeJS.ProcessEnv = {};
    const fs = makeFs();
    const logs: string[] = [];
    await ensureRelaySecret(makeDeps(env, fs, logs));
    const msg = logs.join('');
    // Must mention the path pattern.
    expect(msg).toMatch(/relay-totp-secret/);
    // SECRET-HANDLING: value must not appear.
    expect(msg).not.toContain(VALID_SECRET);
    // SECRET-HANDLING: length ("64") must not appear.
    expect(msg).not.toMatch(/\b64\b/);
    // Must not contain any 64-char hex substring.
    expect(msg).not.toMatch(/[0-9a-fA-F]{64}/);
  });
});

// ---------------------------------------------------------------------------
// 2. Reload path: file exists with valid secret → inject, no write, no log
// ---------------------------------------------------------------------------

describe('ensureRelaySecret — reload path', () => {
  it('injects the stored secret into env', async () => {
    const env: NodeJS.ProcessEnv = {};
    const fs = makeFs();
    const logs: string[] = [];
    const deps = makeDeps(env, fs, logs);
    const secretPath = relaySecretFilePath(env, () => '/home/testuser');
    fs._files.set(secretPath, VALID_SECRET);
    fs._stats.set(secretPath, { mode: 0o100600 }); // 0600 permissions

    await ensureRelaySecret(deps);

    expect(env.AIT_DEBUG_TOTP_SECRET).toBe(VALID_SECRET);
  });

  it('does NOT call writeFileSync on reload', async () => {
    const env: NodeJS.ProcessEnv = {};
    const fs = makeFs();
    const logs: string[] = [];
    const deps = makeDeps(env, fs, logs);
    const secretPath = relaySecretFilePath(env, () => '/home/testuser');
    fs._files.set(secretPath, VALID_SECRET);
    fs._stats.set(secretPath, { mode: 0o100600 });

    await ensureRelaySecret(deps);

    // writeFileSync should not have been called for the secret path.
    expect(fs._written.has(secretPath)).toBe(false);
  });

  it('does NOT call log on silent reload', async () => {
    const env: NodeJS.ProcessEnv = {};
    const fs = makeFs();
    const logs: string[] = [];
    const deps = makeDeps(env, fs, logs);
    const secretPath = relaySecretFilePath(env, () => '/home/testuser');
    fs._files.set(secretPath, VALID_SECRET);
    fs._stats.set(secretPath, { mode: 0o100600 });

    await ensureRelaySecret(deps);

    expect(logs.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Already-set no-op: env has a valid secret → fs never touched
// ---------------------------------------------------------------------------

describe('ensureRelaySecret — already-set no-op', () => {
  it('returns immediately without touching fs when env is already valid', async () => {
    const env: NodeJS.ProcessEnv = { AIT_DEBUG_TOTP_SECRET: VALID_SECRET };
    const mkdirSyncSpy = vi.fn();
    const writeFileSyncSpy = vi.fn();
    const readFileSyncSpy = vi.fn();
    const existsSyncSpy = vi.fn();
    const logs: string[] = [];

    const fs: RelaySecretFs = {
      mkdirSync: mkdirSyncSpy,
      writeFileSync: writeFileSyncSpy,
      readFileSync: readFileSyncSpy,
      statSync: vi.fn(),
      chmodSync: vi.fn(),
      existsSync: existsSyncSpy,
    };

    await ensureRelaySecret({
      env,
      randomBytes: makeStubRandomBytes(),
      fs,
      homedir: () => '/home/testuser',
      log: (msg) => logs.push(msg),
    });

    expect(mkdirSyncSpy).not.toHaveBeenCalled();
    expect(writeFileSyncSpy).not.toHaveBeenCalled();
    expect(readFileSyncSpy).not.toHaveBeenCalled();
    expect(existsSyncSpy).not.toHaveBeenCalled();
    expect(logs.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Loose-permissions reload: file exists but mode has group/other bits
//    → chmodSync(path, 0o600) must be called
// ---------------------------------------------------------------------------

describe('ensureRelaySecret — loose permissions tightening', () => {
  it('calls chmodSync(path, 0o600) when file has group-readable bits', async () => {
    const env: NodeJS.ProcessEnv = {};
    const fs = makeFs();
    const logs: string[] = [];
    const deps = makeDeps(env, fs, logs);
    const secretPath = relaySecretFilePath(env, () => '/home/testuser');
    fs._files.set(secretPath, VALID_SECRET);
    // 0o100644 → group and other read bits are set.
    fs._stats.set(secretPath, { mode: 0o100644 });

    await ensureRelaySecret(deps);

    const tighten = fs._chmods.find((c) => c.path === secretPath && c.mode === 0o600);
    expect(tighten).toBeDefined();
  });

  it('does NOT call chmodSync(path, 0o600) when permissions are already tight', async () => {
    const env: NodeJS.ProcessEnv = {};
    const fs = makeFs();
    const logs: string[] = [];
    const deps = makeDeps(env, fs, logs);
    const secretPath = relaySecretFilePath(env, () => '/home/testuser');
    fs._files.set(secretPath, VALID_SECRET);
    // 0o100600 → no group/other bits.
    fs._stats.set(secretPath, { mode: 0o100600 });

    await ensureRelaySecret(deps);

    const tighten = fs._chmods.find((c) => c.path === secretPath && c.mode === 0o600);
    expect(tighten).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. SECRET-HANDLING: log message never contains the minted value
// ---------------------------------------------------------------------------

describe('ensureRelaySecret — SECRET-HANDLING: log never leaks value', () => {
  it('does not include the minted hex value in the log message', async () => {
    const env: NodeJS.ProcessEnv = {};
    const fs = makeFs();
    const logs: string[] = [];
    await ensureRelaySecret(makeDeps(env, fs, logs));
    const combined = logs.join('');
    // VALID_SECRET is "deadbeef" × 8 = 64 hex chars.
    expect(combined).not.toContain(VALID_SECRET);
    // The value injected into env must not appear in the log either.
    const injected = env.AIT_DEBUG_TOTP_SECRET ?? '';
    expect(combined).not.toContain(injected);
  });
});

// ---------------------------------------------------------------------------
// 6. EEXIST race — falls back to reading the winner's value
// ---------------------------------------------------------------------------

describe('ensureRelaySecret — EEXIST race recovery', () => {
  it("injects the winner's value when writeFileSync throws EEXIST", async () => {
    const env: NodeJS.ProcessEnv = {};
    const logs: string[] = [];

    // Pre-populate the file with a winner's valid secret BEFORE calling
    // ensureRelaySecret, and make writeFileSync always throw EEXIST.
    const winnerSecret = 'cafebabe'.repeat(8);
    const files = new Map<string, string>();
    const secretPath = relaySecretFilePath(env, () => '/home/testuser');
    files.set(secretPath, winnerSecret);

    const fs: RelaySecretFs = {
      mkdirSync: vi.fn(),
      writeFileSync(_p, _d, _opts) {
        // Simulate EEXIST (another process wrote first).
        const err = new Error('EEXIST') as NodeJS.ErrnoException;
        err.code = 'EEXIST';
        throw err;
      },
      readFileSync(path, _enc) {
        const val = files.get(path);
        if (val === undefined) throw new Error(`ENOENT: ${path}`);
        return val;
      },
      statSync: vi.fn().mockReturnValue({ mode: 0o100600 }),
      chmodSync: vi.fn(),
      existsSync: (path) => files.has(path),
    };

    await ensureRelaySecret({
      env,
      randomBytes: makeStubRandomBytes(),
      fs,
      homedir: () => '/home/testuser',
      log: (msg) => logs.push(msg),
    });

    expect(env.AIT_DEBUG_TOTP_SECRET).toBe(winnerSecret);
  });
});

// ---------------------------------------------------------------------------
// 7. relaySecretFilePath helper — respects AIT_DEVTOOLS_LOCK_DIR override
// ---------------------------------------------------------------------------

describe('relaySecretFilePath', () => {
  it('defaults to ~/.ait-devtools/relay-totp-secret', () => {
    const env: NodeJS.ProcessEnv = {};
    const path = relaySecretFilePath(env, () => '/home/testuser');
    expect(path).toBe('/home/testuser/.ait-devtools/relay-totp-secret');
  });

  it('respects AIT_DEVTOOLS_LOCK_DIR override', () => {
    const env: NodeJS.ProcessEnv = { AIT_DEVTOOLS_LOCK_DIR: '/tmp/ait-test-lock' };
    const path = relaySecretFilePath(env, () => '/home/testuser');
    expect(path).toBe('/tmp/ait-test-lock/relay-totp-secret');
  });
});
