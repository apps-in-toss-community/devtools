/**
 * Unit tests for the project-local relay TOTP secret store (#394 mint, #396
 * project-local single file `.ait_relay` + read-only daemon loader).
 *
 * All tests use injected stubs — no real disk I/O, no real RNG. The daemon cwd
 * here contains a package.json (the repo root), so every loader test MUST inject
 * `projectRoot` + a stub `existsSync`/`fs` to avoid short-circuiting on the real
 * filesystem.
 *
 * SECRET-HANDLING: only deliberately INVALID or test-fixture hex strings appear
 * here. The log-assertion tests confirm the minted value is NEVER echoed.
 */

import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { RelaySecretFs, RelaySecretReadOnlyFs } from '../mcp/relay-secret-store.js';
import {
  ensureRelaySecret,
  loadRelaySecretReadOnly,
  nearestPackageJsonDir,
  RELAY_SECRET_FILE_NAME,
  relaySecretFilePath,
} from '../mcp/relay-secret-store.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 64-hex chars = 32 bytes — passes isValidRelayAuthSecret. */
const VALID_SECRET = 'deadbeef'.repeat(8);

const PROJECT_ROOT = '/home/testuser/my-mini-app';
const SECRET_PATH = join(PROJECT_ROOT, RELAY_SECRET_FILE_NAME);

/** Stub randomBytes that returns a deterministic 32-byte buffer. */
function makeStubRandomBytes(hexOutput = VALID_SECRET): (n: number) => Buffer {
  return (_n: number) => Buffer.from(hexOutput, 'hex');
}

/**
 * In-memory write-capable fs stub for ensureRelaySecret. The new store does NOT
 * use mkdirSync/statSync, so this exposes exactly the five methods the write
 * path needs plus capture maps.
 */
function makeFs(overrides: Partial<RelaySecretFs> = {}): RelaySecretFs & {
  _written: Map<string, { data: string; options: { mode: number; flag: string } }>;
  _chmods: Array<{ path: string; mode: number }>;
  _files: Map<string, string>;
  _appends: Array<{ path: string; data: string }>;
} {
  const files = new Map<string, string>();
  const written = new Map<string, { data: string; options: { mode: number; flag: string } }>();
  const chmods: Array<{ path: string; mode: number }> = [];
  const appends: Array<{ path: string; data: string }> = [];

  const stub: ReturnType<typeof makeFs> = {
    _written: written,
    _chmods: chmods,
    _files: files,
    _appends: appends,

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
    chmodSync(path, mode) {
      chmods.push({ path, mode });
    },
    existsSync(path) {
      return files.has(path);
    },
    appendFileSync(path, data) {
      appends.push({ path, data });
      const prev = files.get(path) ?? '';
      files.set(path, prev + data);
    },
    ...overrides,
  };
  return stub;
}

/** existsSync that returns true only for package.json directly under PROJECT_ROOT. */
function makeProjectExistsSync(packageJsonDirs: string[] = [PROJECT_ROOT]) {
  return (path: string): boolean => packageJsonDirs.some((d) => path === join(d, 'package.json'));
}

// ---------------------------------------------------------------------------
// nearestPackageJsonDir
// ---------------------------------------------------------------------------

describe('nearestPackageJsonDir', () => {
  it('returns the start dir when it has a package.json', () => {
    const existsSync = makeProjectExistsSync([PROJECT_ROOT]);
    expect(nearestPackageJsonDir(PROJECT_ROOT, existsSync)).toBe(PROJECT_ROOT);
  });

  it('walks up to the nearest parent that has a package.json', () => {
    // package.json only exists at PROJECT_ROOT, start is a subdir.
    const start = join(PROJECT_ROOT, 'packages', 'app', 'src');
    const existsSync = makeProjectExistsSync([PROJECT_ROOT]);
    expect(nearestPackageJsonDir(start, existsSync)).toBe(PROJECT_ROOT);
  });

  it('prefers the closest package.json in a monorepo subdir', () => {
    const pkgDir = join(PROJECT_ROOT, 'packages', 'app');
    const start = join(pkgDir, 'src', 'deep');
    // Both the package dir and the workspace root have package.json — closest wins.
    const existsSync = makeProjectExistsSync([pkgDir, PROJECT_ROOT]);
    expect(nearestPackageJsonDir(start, existsSync)).toBe(pkgDir);
  });

  it('falls back to the start dir when no package.json is found', () => {
    const start = '/tmp/no-pkg/here';
    const existsSync = (): boolean => false;
    expect(nearestPackageJsonDir(start, existsSync)).toBe(start);
  });
});

describe('relaySecretFilePath', () => {
  it('joins the nearest package.json dir with .ait_relay', () => {
    const start = join(PROJECT_ROOT, 'packages', 'app', 'src');
    const existsSync = makeProjectExistsSync([PROJECT_ROOT]);
    expect(relaySecretFilePath(start, existsSync)).toBe(SECRET_PATH);
  });
});

// ---------------------------------------------------------------------------
// ensureRelaySecret — mint path (projectRoot, single file)
// ---------------------------------------------------------------------------

describe('ensureRelaySecret — mint path (project-local)', () => {
  function deps(env: NodeJS.ProcessEnv, fs: RelaySecretFs, logs: string[]) {
    return {
      projectRoot: PROJECT_ROOT,
      env,
      randomBytes: makeStubRandomBytes(),
      fs,
      existsSync: makeProjectExistsSync([PROJECT_ROOT]),
      log: (msg: string) => logs.push(msg),
    };
  }

  it('writes a single .ait_relay file at <projectRoot> with mode 0o600 and flag "wx"', async () => {
    const env: NodeJS.ProcessEnv = {};
    const fs = makeFs();
    const logs: string[] = [];
    await ensureRelaySecret(deps(env, fs, logs));
    const write = fs._written.get(SECRET_PATH);
    expect(write).toBeDefined();
    expect(write?.options.mode).toBe(0o600);
    expect(write?.options.flag).toBe('wx');
  });

  it('does NOT create any directory (no mkdirSync in the fs surface)', async () => {
    const env: NodeJS.ProcessEnv = {};
    const fs = makeFs();
    const logs: string[] = [];
    // The RelaySecretFs type has no mkdirSync — assert the property is absent so
    // the daemon-vs-unplugin write surface stays single-file.
    expect('mkdirSync' in fs).toBe(false);
    await ensureRelaySecret(deps(env, fs, logs));
    // Only the secret file was written, nothing else.
    expect([...fs._written.keys()]).toEqual([SECRET_PATH]);
  });

  it('chmods the file to 0o600 after writing', async () => {
    const env: NodeJS.ProcessEnv = {};
    const fs = makeFs();
    const logs: string[] = [];
    await ensureRelaySecret(deps(env, fs, logs));
    const fileChmod = fs._chmods.find((c) => c.path === SECRET_PATH && c.mode === 0o600);
    expect(fileChmod).toBeDefined();
  });

  it('injects the minted secret into env', async () => {
    const env: NodeJS.ProcessEnv = {};
    const fs = makeFs();
    const logs: string[] = [];
    await ensureRelaySecret(deps(env, fs, logs));
    expect(env.AIT_DEBUG_TOTP_SECRET).toBe(VALID_SECRET);
  });

  it('logs exactly once on first mint, mentioning .ait_relay but NOT the value or length', async () => {
    const env: NodeJS.ProcessEnv = {};
    const fs = makeFs();
    const logs: string[] = [];
    await ensureRelaySecret(deps(env, fs, logs));
    expect(logs.length).toBe(1);
    const msg = logs.join('');
    expect(msg).toContain(RELAY_SECRET_FILE_NAME);
    // SECRET-HANDLING: value, its length ("64"), and any 64-hex run must be absent.
    expect(msg).not.toContain(VALID_SECRET);
    expect(msg).not.toMatch(/\b64\b/);
    expect(msg).not.toMatch(/[0-9a-fA-F]{64}/);
  });

  it('resolves the file at the nearest package.json dir when projectRoot is a subdir', async () => {
    const env: NodeJS.ProcessEnv = {};
    const fs = makeFs();
    const logs: string[] = [];
    const subdir = join(PROJECT_ROOT, 'packages', 'app');
    await ensureRelaySecret({
      projectRoot: subdir,
      env,
      randomBytes: makeStubRandomBytes(),
      fs,
      // package.json only at the workspace root → resolves up to PROJECT_ROOT.
      existsSync: makeProjectExistsSync([PROJECT_ROOT]),
      log: (msg) => logs.push(msg),
    });
    expect(fs._written.has(SECRET_PATH)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ensureRelaySecret — reload + no-op paths
// ---------------------------------------------------------------------------

describe('ensureRelaySecret — reload + no-op', () => {
  it('reloads the stored value silently (no write, no log)', async () => {
    const env: NodeJS.ProcessEnv = {};
    const fs = makeFs();
    fs._files.set(SECRET_PATH, VALID_SECRET);
    const logs: string[] = [];
    await ensureRelaySecret({
      projectRoot: PROJECT_ROOT,
      env,
      randomBytes: makeStubRandomBytes(),
      fs,
      existsSync: makeProjectExistsSync([PROJECT_ROOT]),
      log: (msg) => logs.push(msg),
    });
    expect(env.AIT_DEBUG_TOTP_SECRET).toBe(VALID_SECRET);
    expect(fs._written.has(SECRET_PATH)).toBe(false);
    expect(logs.length).toBe(0);
  });

  it('is a no-op when env already holds a valid secret', async () => {
    const env: NodeJS.ProcessEnv = { AIT_DEBUG_TOTP_SECRET: VALID_SECRET };
    const writeFileSyncSpy = vi.fn();
    const existsSyncSpy = vi.fn();
    const fs: RelaySecretFs = {
      writeFileSync: writeFileSyncSpy,
      readFileSync: vi.fn(),
      chmodSync: vi.fn(),
      existsSync: existsSyncSpy,
      appendFileSync: vi.fn(),
    };
    await ensureRelaySecret({
      projectRoot: PROJECT_ROOT,
      env,
      randomBytes: makeStubRandomBytes(),
      fs,
      existsSync: existsSyncSpy,
      log: vi.fn(),
    });
    expect(writeFileSyncSpy).not.toHaveBeenCalled();
  });

  it("injects the winner's value when writeFileSync throws EEXIST (race)", async () => {
    const env: NodeJS.ProcessEnv = {};
    const winnerSecret = 'cafebabe'.repeat(8);
    const files = new Map<string, string>([[SECRET_PATH, winnerSecret]]);
    const fs: RelaySecretFs = {
      writeFileSync() {
        const err = new Error('EEXIST') as NodeJS.ErrnoException;
        err.code = 'EEXIST';
        throw err;
      },
      readFileSync(path) {
        const v = files.get(path);
        if (v === undefined) throw new Error(`ENOENT ${path}`);
        return v;
      },
      chmodSync: vi.fn(),
      appendFileSync: vi.fn(),
      // existsSync(secretPath) === false here so the mint path is taken and the
      // write then races into EEXIST.
      existsSync: () => false,
    };
    await ensureRelaySecret({
      projectRoot: PROJECT_ROOT,
      env,
      randomBytes: makeStubRandomBytes(),
      fs,
      existsSync: makeProjectExistsSync([PROJECT_ROOT]),
      log: vi.fn(),
    });
    expect(env.AIT_DEBUG_TOTP_SECRET).toBe(winnerSecret);
  });
});

// ---------------------------------------------------------------------------
// loadRelaySecretReadOnly — daemon read-only loader (#396)
// ---------------------------------------------------------------------------

/** Minimal read-only fs stub: only existsSync + readFileSync. */
function makeReadOnlyFs(files: Map<string, string>): RelaySecretReadOnlyFs {
  return {
    existsSync: (path) => files.has(path),
    readFileSync(path) {
      const v = files.get(path);
      if (v === undefined) throw new Error(`ENOENT ${path}`);
      return v;
    },
  };
}

describe('loadRelaySecretReadOnly', () => {
  it('(a) is a no-op when env already holds a valid secret', async () => {
    const env: NodeJS.ProcessEnv = { AIT_DEBUG_TOTP_SECRET: VALID_SECRET };
    const existsSyncSpy = vi.fn().mockReturnValue(false); // .ait_relay absent
    const warnings: string[] = [];
    await loadRelaySecretReadOnly({
      projectRoot: PROJECT_ROOT,
      env,
      fs: { existsSync: existsSyncSpy, readFileSync: vi.fn() },
      existsSync: existsSyncSpy,
      log: (msg) => warnings.push(msg),
    });
    expect(env.AIT_DEBUG_TOTP_SECRET).toBe(VALID_SECRET);
    // env value unchanged, no divergence warning emitted (file absent).
    expect(warnings).toHaveLength(0);
  });

  it('(b) injects env from a valid <projectRoot>/.ait_relay file', async () => {
    const env: NodeJS.ProcessEnv = {};
    const files = new Map<string, string>([[SECRET_PATH, VALID_SECRET]]);
    await loadRelaySecretReadOnly({
      projectRoot: PROJECT_ROOT,
      env,
      fs: makeReadOnlyFs(files),
      existsSync: makeProjectExistsSync([PROJECT_ROOT]),
    });
    expect(env.AIT_DEBUG_TOTP_SECRET).toBe(VALID_SECRET);
  });

  it('(b2) trims surrounding whitespace from the stored value', async () => {
    const env: NodeJS.ProcessEnv = {};
    const files = new Map<string, string>([[SECRET_PATH, `  ${VALID_SECRET}\n`]]);
    await loadRelaySecretReadOnly({
      projectRoot: PROJECT_ROOT,
      env,
      fs: makeReadOnlyFs(files),
      existsSync: makeProjectExistsSync([PROJECT_ROOT]),
    });
    expect(env.AIT_DEBUG_TOTP_SECRET).toBe(VALID_SECRET);
  });

  it('(c) leaves env unset and does not throw when the file is absent', async () => {
    const env: NodeJS.ProcessEnv = {};
    await expect(
      loadRelaySecretReadOnly({
        projectRoot: PROJECT_ROOT,
        env,
        fs: makeReadOnlyFs(new Map()),
        existsSync: makeProjectExistsSync([PROJECT_ROOT]),
      }),
    ).resolves.toBeUndefined();
    expect(env.AIT_DEBUG_TOTP_SECRET).toBeUndefined();
  });

  it('(c2) leaves env unset and does not throw when projectRoot is omitted', async () => {
    const env: NodeJS.ProcessEnv = {};
    const existsSyncSpy = vi.fn();
    await expect(
      loadRelaySecretReadOnly({
        env,
        fs: { existsSync: existsSyncSpy, readFileSync: vi.fn() },
        existsSync: existsSyncSpy,
      }),
    ).resolves.toBeUndefined();
    expect(env.AIT_DEBUG_TOTP_SECRET).toBeUndefined();
    expect(existsSyncSpy).not.toHaveBeenCalled();
  });

  it('(d) leaves env unset when the stored value is invalid', async () => {
    const env: NodeJS.ProcessEnv = {};
    const files = new Map<string, string>([[SECRET_PATH, 'not-a-valid-secret']]);
    await loadRelaySecretReadOnly({
      projectRoot: PROJECT_ROOT,
      env,
      fs: makeReadOnlyFs(files),
      existsSync: makeProjectExistsSync([PROJECT_ROOT]),
    });
    expect(env.AIT_DEBUG_TOTP_SECRET).toBeUndefined();
  });

  it('(e) READ-ONLY: never calls any write/mkdir/chmod (fs surface has none)', async () => {
    const env: NodeJS.ProcessEnv = {};
    const files = new Map<string, string>([[SECRET_PATH, VALID_SECRET]]);
    // A read-only fs stub that THROWS if any mutating method is somehow invoked.
    const mutatingSpy = vi.fn(() => {
      throw new Error('read-only loader must not mutate the filesystem');
    });
    const fs = {
      existsSync: (path: string) => files.has(path),
      readFileSync(path: string) {
        const v = files.get(path);
        if (v === undefined) throw new Error(`ENOENT ${path}`);
        return v;
      },
      // These are NOT part of RelaySecretReadOnlyFs — present only to detect a
      // rogue call. Cast through unknown to attach them without widening the type.
      writeFileSync: mutatingSpy,
      mkdirSync: mutatingSpy,
      chmodSync: mutatingSpy,
    } as unknown as RelaySecretReadOnlyFs;

    await loadRelaySecretReadOnly({
      projectRoot: PROJECT_ROOT,
      env,
      fs,
      existsSync: makeProjectExistsSync([PROJECT_ROOT]),
    });
    expect(env.AIT_DEBUG_TOTP_SECRET).toBe(VALID_SECRET);
    expect(mutatingSpy).not.toHaveBeenCalled();
  });

  it('SECRET-HANDLING: does not leak the value, its length, or the file path to a log sink', async () => {
    const env: NodeJS.ProcessEnv = {};
    const files = new Map<string, string>([[SECRET_PATH, VALID_SECRET]]);
    const logs: string[] = [];
    await loadRelaySecretReadOnly({
      projectRoot: PROJECT_ROOT,
      env,
      fs: makeReadOnlyFs(files),
      existsSync: makeProjectExistsSync([PROJECT_ROOT]),
      log: (msg) => logs.push(msg),
    });
    const combined = logs.join('');
    expect(combined).not.toContain(VALID_SECRET);
    expect(combined).not.toMatch(/\b64\b/);
    expect(combined).not.toMatch(/[0-9a-fA-F]{64}/);
    expect(combined).not.toContain(SECRET_PATH);
  });
});

// ---------------------------------------------------------------------------
// ensureRelaySecret — .gitignore injection (#669)
// ---------------------------------------------------------------------------

const GITIGNORE_PATH = join(PROJECT_ROOT, '.gitignore');

/** Shared deps builder for gitignore tests — no pre-existing secret file. */
function makeMintDeps(env: NodeJS.ProcessEnv, fs: ReturnType<typeof makeFs>, logs: string[]) {
  return {
    projectRoot: PROJECT_ROOT,
    env,
    randomBytes: makeStubRandomBytes(),
    fs,
    existsSync: makeProjectExistsSync([PROJECT_ROOT]),
    log: (msg: string) => logs.push(msg),
  };
}

describe('ensureRelaySecret — .gitignore injection (#669)', () => {
  it('(gi-1) creates .gitignore with both ignore lines on first mint when none exists', async () => {
    const env: NodeJS.ProcessEnv = {};
    const fs = makeFs();
    const logs: string[] = [];
    await ensureRelaySecret(makeMintDeps(env, fs, logs));
    const gi = fs._files.get(GITIGNORE_PATH);
    expect(gi).toBeDefined();
    expect(gi).toMatch(/\.ait_relay/);
    expect(gi).toMatch(/\.ait_urls/);
  });

  it('(gi-1b) logs exactly once on first mint even when .gitignore is injected (invariant: logs.length===1)', async () => {
    const env: NodeJS.ProcessEnv = {};
    const fs = makeFs();
    const logs: string[] = [];
    await ensureRelaySecret(makeMintDeps(env, fs, logs));
    // The gitignore note is folded into the single announcement — must not split into a second call.
    expect(logs.length).toBe(1);
    // Announcement must mention .ait_relay and the injected line.
    const msg = logs[0];
    expect(msg).toContain(RELAY_SECRET_FILE_NAME);
    expect(msg).toContain('.gitignore');
    // SECRET-HANDLING: value must not appear anywhere in the folded message.
    expect(msg).not.toContain(VALID_SECRET);
    expect(msg).not.toMatch(/\b64\b/);
    expect(msg).not.toMatch(/[0-9a-fA-F]{64}/);
  });

  it('(gi-2) idempotent on mint path: pre-populated .gitignore is not duplicated', async () => {
    const env: NodeJS.ProcessEnv = {};
    const fs = makeFs();
    // Pre-seed the .gitignore with both entries (mimics sdk-example or a second run).
    fs._files.set(GITIGNORE_PATH, '.ait_relay\n.ait_urls\n');
    const logs: string[] = [];
    await ensureRelaySecret(makeMintDeps(env, fs, logs));
    const gi = fs._files.get(GITIGNORE_PATH) ?? '';
    // Both entries must appear exactly once.
    expect((gi.match(/\.ait_relay/g) ?? []).length).toBe(1);
    expect((gi.match(/\.ait_urls/g) ?? []).length).toBe(1);
    // appendFileSync must NOT have been called (pure no-op).
    expect(fs._appends).toHaveLength(0);
  });

  it('(gi-2b) idempotent on reload path: ensureRelaySecret twice does not duplicate lines', async () => {
    const env: NodeJS.ProcessEnv = {};
    const fs = makeFs();
    const logs: string[] = [];

    // First run: mint + inject.
    await ensureRelaySecret(makeMintDeps(env, fs, logs));

    // Second run: the secret file exists → takes the reload path (not mintAndPersist).
    // Reset env so the "already-valid env" early return is not hit (reload path instead).
    const env2: NodeJS.ProcessEnv = {};
    const logs2: string[] = [];
    await ensureRelaySecret({
      projectRoot: PROJECT_ROOT,
      env: env2,
      randomBytes: makeStubRandomBytes(),
      fs,
      existsSync: makeProjectExistsSync([PROJECT_ROOT]),
      log: (msg: string) => logs2.push(msg),
    });

    const gi = fs._files.get(GITIGNORE_PATH) ?? '';
    expect((gi.match(/\.ait_relay/g) ?? []).length).toBe(1);
    expect((gi.match(/\.ait_urls/g) ?? []).length).toBe(1);
  });

  it('(gi-3) no-op when both lines already present (sdk-example case)', async () => {
    const env: NodeJS.ProcessEnv = {};
    const fs = makeFs();
    fs._files.set(GITIGNORE_PATH, '.ait_relay\n.ait_urls\n');
    const logs: string[] = [];
    await ensureRelaySecret(makeMintDeps(env, fs, logs));
    // No append should have been attempted.
    expect(fs._appends).toHaveLength(0);
    // Content must be byte-identical.
    expect(fs._files.get(GITIGNORE_PATH)).toBe('.ait_relay\n.ait_urls\n');
  });

  it('(gi-4) appends only the missing line when one is already present', async () => {
    const env: NodeJS.ProcessEnv = {};
    const fs = makeFs();
    // Only .ait_relay is already in .gitignore.
    fs._files.set(GITIGNORE_PATH, '.ait_relay\n');
    const logs: string[] = [];
    await ensureRelaySecret(makeMintDeps(env, fs, logs));
    const gi = fs._files.get(GITIGNORE_PATH) ?? '';
    // .ait_relay must appear exactly once (not duplicated).
    expect((gi.match(/\.ait_relay/g) ?? []).length).toBe(1);
    // .ait_urls must have been appended.
    expect(gi).toContain('.ait_urls');
  });

  it('(gi-5) preserves trailing-newline correctness when existing .gitignore has no trailing newline', async () => {
    const env: NodeJS.ProcessEnv = {};
    const fs = makeFs();
    // Existing content without a trailing newline.
    fs._files.set(GITIGNORE_PATH, 'node_modules');
    const logs: string[] = [];
    await ensureRelaySecret(makeMintDeps(env, fs, logs));
    const gi = fs._files.get(GITIGNORE_PATH) ?? '';
    // The appended block must start on a new line.
    expect(gi).toBe('node_modules\n.ait_relay\n.ait_urls\n');
  });

  it('(gi-6) graceful on append failure: secret still generated, ensureRelaySecret does not throw', async () => {
    const env: NodeJS.ProcessEnv = {};
    const appendErr = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    const fs = makeFs({
      appendFileSync: () => {
        throw appendErr;
      },
    });
    const logs: string[] = [];
    // Must not throw even when appendFileSync throws.
    await expect(ensureRelaySecret(makeMintDeps(env, fs, logs))).resolves.toBeUndefined();
    // Secret must still be minted and injected.
    expect(env.AIT_DEBUG_TOTP_SECRET).toBe(VALID_SECRET);
    expect(fs._written.has(SECRET_PATH)).toBe(true);
    // The failure note is folded into the single announcement.
    expect(logs.length).toBe(1);
    const msg = logs[0];
    expect(msg).toContain('.gitignore');
    // SECRET-HANDLING: no value in the fallback message.
    expect(msg).not.toContain(VALID_SECRET);
    expect(msg).not.toMatch(/[0-9a-fA-F]{64}/);
  });

  it('(gi-7) graceful on unreadable existing .gitignore: secret still minted, no throw', async () => {
    const env: NodeJS.ProcessEnv = {};
    const readErr = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    // .gitignore exists but readFileSync throws for it.
    const fs = makeFs({
      readFileSync(path, _encoding) {
        if (path === GITIGNORE_PATH) throw readErr;
        // Fall through to default for other paths.
        const val = (this as { _files: Map<string, string> })._files.get(path);
        if (val === undefined) throw new Error(`ENOENT: no such file — ${path}`);
        return val;
      },
      existsSync(path) {
        if (path === GITIGNORE_PATH) return true;
        return (this as { _files: Map<string, string> })._files.has(path);
      },
    });
    const logs: string[] = [];
    await expect(ensureRelaySecret(makeMintDeps(env, fs, logs))).resolves.toBeUndefined();
    expect(env.AIT_DEBUG_TOTP_SECRET).toBe(VALID_SECRET);
    expect(fs._written.has(SECRET_PATH)).toBe(true);
  });

  it('(gi-8) SECRET-HANDLING: log output across all gitignore branches never contains secret value', async () => {
    const secretHexRegex = /[0-9a-fA-F]{64}/;

    // Case A: inject succeeds.
    {
      const env: NodeJS.ProcessEnv = {};
      const fs = makeFs();
      const logs: string[] = [];
      await ensureRelaySecret(makeMintDeps(env, fs, logs));
      const combined = logs.join('');
      expect(combined).not.toContain(VALID_SECRET);
      expect(combined).not.toMatch(/\b64\b/);
      expect(combined).not.toMatch(secretHexRegex);
    }

    // Case B: append fails (fallback branch).
    {
      const env: NodeJS.ProcessEnv = {};
      const fs = makeFs({
        appendFileSync: () => {
          throw new Error('EACCES');
        },
      });
      const logs: string[] = [];
      await ensureRelaySecret(makeMintDeps(env, fs, logs));
      const combined = logs.join('');
      expect(combined).not.toContain(VALID_SECRET);
      expect(combined).not.toMatch(secretHexRegex);
    }

    // Case C: no-op (both entries already present).
    {
      const env: NodeJS.ProcessEnv = {};
      const fs = makeFs();
      fs._files.set(GITIGNORE_PATH, '.ait_relay\n.ait_urls\n');
      const logs: string[] = [];
      await ensureRelaySecret(makeMintDeps(env, fs, logs));
      const combined = logs.join('');
      expect(combined).not.toContain(VALID_SECRET);
      expect(combined).not.toMatch(secretHexRegex);
    }
  });
});
