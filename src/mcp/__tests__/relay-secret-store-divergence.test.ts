/**
 * Unit tests for the relay TOTP secret divergence guard (#620).
 *
 * When `AIT_DEBUG_TOTP_SECRET` is set (env wins) AND `.ait_relay` exists AND
 * the two values differ, both `ensureRelaySecret` and `loadRelaySecretReadOnly`
 * must emit a single warning via their injectable log dep.
 *
 * SECRET-HANDLING:
 *   - Fixture secrets are deliberately distinct arbitrary hex strings.
 *   - Tests assert that neither fixture secret value appears in the emitted
 *     warning string (the warning must be value-free by design).
 *   - The `.ait_relay` file path is never asserted to appear in the warning.
 *   - No real process.env is mutated; injectable `env` objects are used
 *     throughout so tests are order-independent.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ensureRelaySecret,
  loadRelaySecretReadOnly,
  RELAY_SECRET_FILE_NAME,
  type RelaySecretFs,
  type RelaySecretReadOnlyFs,
} from '../relay-secret-store.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** A valid 64-char hex secret that represents "the env value". */
const ENV_SECRET = 'aabbccdd'.repeat(8); // 64 chars

/** A DIFFERENT valid 64-char hex secret that represents "what .ait_relay holds". */
const FILE_SECRET = '11223344'.repeat(8); // 64 chars, different from ENV_SECRET

/** Same secret used in both env and file — the "no divergence" case. */
const SAME_SECRET = ENV_SECRET;

/** An invalid stored value (not valid hex / too short). */
const INVALID_FILE_CONTENT = 'not-a-valid-secret';

/**
 * Absolute fake project root — used as anchor for path resolution.
 * We also supply a fake package.json at that location so nearestPackageJsonDir
 * resolves to this directory itself, making the expected .ait_relay path
 * `${FAKE_ROOT}/.ait_relay`.
 */
const FAKE_ROOT = '/fake/project';
const FAKE_SECRET_PATH = `${FAKE_ROOT}/${RELAY_SECRET_FILE_NAME}`;

/**
 * Builds a minimal fake `RelaySecretReadOnlyFs` whose existsSync/readFileSync
 * are controlled by the test.
 */
function makeFakeReadOnlyFs(opts: {
  secretExists: boolean;
  secretContent?: string;
  readThrows?: boolean;
}): RelaySecretReadOnlyFs {
  return {
    existsSync: (p: string) => {
      // Return true for the secret file when requested; also return true for the
      // fake package.json so nearestPackageJsonDir resolves FAKE_ROOT correctly.
      if (p === `${FAKE_ROOT}/package.json`) return true;
      if (p === FAKE_SECRET_PATH) return opts.secretExists;
      return false;
    },
    readFileSync: (p: string, _enc: BufferEncoding) => {
      if (p === FAKE_SECRET_PATH) {
        if (opts.readThrows) throw new Error('permission denied');
        return opts.secretContent ?? '';
      }
      return '';
    },
  };
}

/**
 * Builds a `RelaySecretFs` that wraps the read-only fake and also stubs the
 * write-side methods so `ensureRelaySecret` can call them without touching disk.
 * The write methods throw by default (they should not be reached in the
 * early-return path under test).
 */
function makeFakeWriteFs(opts: {
  secretExists: boolean;
  secretContent?: string;
  readThrows?: boolean;
}): RelaySecretFs {
  const ro = makeFakeReadOnlyFs(opts);
  return {
    ...ro,
    writeFileSync: vi.fn(() => {
      throw new Error('writeFileSync should not be called in early-return path');
    }),
    chmodSync: vi.fn(() => {
      throw new Error('chmodSync should not be called in early-return path');
    }),
  };
}

// ---------------------------------------------------------------------------
// ensureRelaySecret — divergence guard
// ---------------------------------------------------------------------------

describe('ensureRelaySecret — divergence guard', () => {
  let warnings: string[];
  let logFn: (msg: string) => void;

  beforeEach(() => {
    warnings = [];
    logFn = (msg: string) => {
      warnings.push(msg);
    };
  });

  afterEach(() => {
    warnings = [];
  });

  // ---- env valid + .ait_relay exists + DIFFERENT → warning emitted ----

  it('emits a warning when env secret differs from .ait_relay', async () => {
    const env: NodeJS.ProcessEnv = { AIT_DEBUG_TOTP_SECRET: ENV_SECRET };
    const fakeFs = makeFakeWriteFs({ secretExists: true, secretContent: FILE_SECRET });

    await ensureRelaySecret({
      projectRoot: FAKE_ROOT,
      env,
      fs: fakeFs,
      existsSync: fakeFs.existsSync,
      log: logFn,
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('AIT_DEBUG_TOTP_SECRET');
    expect(warnings[0]).toContain('differs');
  });

  it('emits the warning exactly once (not twice)', async () => {
    const env: NodeJS.ProcessEnv = { AIT_DEBUG_TOTP_SECRET: ENV_SECRET };
    const fakeFs = makeFakeWriteFs({ secretExists: true, secretContent: FILE_SECRET });

    await ensureRelaySecret({
      projectRoot: FAKE_ROOT,
      env,
      fs: fakeFs,
      existsSync: fakeFs.existsSync,
      log: logFn,
    });

    expect(warnings).toHaveLength(1);
  });

  it('env value still wins (env unchanged after divergence warning)', async () => {
    const env: NodeJS.ProcessEnv = { AIT_DEBUG_TOTP_SECRET: ENV_SECRET };
    const fakeFs = makeFakeWriteFs({ secretExists: true, secretContent: FILE_SECRET });

    await ensureRelaySecret({
      projectRoot: FAKE_ROOT,
      env,
      fs: fakeFs,
      existsSync: fakeFs.existsSync,
      log: logFn,
    });

    // The env secret must not be replaced by the file secret.
    expect(env.AIT_DEBUG_TOTP_SECRET).toBe(ENV_SECRET);
  });

  it('function returns normally (does not throw) on divergence', async () => {
    const env: NodeJS.ProcessEnv = { AIT_DEBUG_TOTP_SECRET: ENV_SECRET };
    const fakeFs = makeFakeWriteFs({ secretExists: true, secretContent: FILE_SECRET });

    await expect(
      ensureRelaySecret({
        projectRoot: FAKE_ROOT,
        env,
        fs: fakeFs,
        existsSync: fakeFs.existsSync,
        log: logFn,
      }),
    ).resolves.toBeUndefined();
  });

  // ---- SECRET-HANDLING: warning must not contain secret values ----

  it('warning does not contain the env secret value', async () => {
    const env: NodeJS.ProcessEnv = { AIT_DEBUG_TOTP_SECRET: ENV_SECRET };
    const fakeFs = makeFakeWriteFs({ secretExists: true, secretContent: FILE_SECRET });

    await ensureRelaySecret({
      projectRoot: FAKE_ROOT,
      env,
      fs: fakeFs,
      existsSync: fakeFs.existsSync,
      log: logFn,
    });

    expect(warnings[0]).not.toContain(ENV_SECRET);
  });

  it('warning does not contain the file secret value', async () => {
    const env: NodeJS.ProcessEnv = { AIT_DEBUG_TOTP_SECRET: ENV_SECRET };
    const fakeFs = makeFakeWriteFs({ secretExists: true, secretContent: FILE_SECRET });

    await ensureRelaySecret({
      projectRoot: FAKE_ROOT,
      env,
      fs: fakeFs,
      existsSync: fakeFs.existsSync,
      log: logFn,
    });

    expect(warnings[0]).not.toContain(FILE_SECRET);
  });

  it('warning does not contain the .ait_relay file path', async () => {
    const env: NodeJS.ProcessEnv = { AIT_DEBUG_TOTP_SECRET: ENV_SECRET };
    const fakeFs = makeFakeWriteFs({ secretExists: true, secretContent: FILE_SECRET });

    await ensureRelaySecret({
      projectRoot: FAKE_ROOT,
      env,
      fs: fakeFs,
      existsSync: fakeFs.existsSync,
      log: logFn,
    });

    expect(warnings[0]).not.toContain(FAKE_SECRET_PATH);
    expect(warnings[0]).not.toContain(FAKE_ROOT);
  });

  // ---- env valid + .ait_relay exists + SAME → no warning ----

  it('emits no warning when env and .ait_relay contain the same secret', async () => {
    const env: NodeJS.ProcessEnv = { AIT_DEBUG_TOTP_SECRET: SAME_SECRET };
    const fakeFs = makeFakeWriteFs({ secretExists: true, secretContent: SAME_SECRET });

    await ensureRelaySecret({
      projectRoot: FAKE_ROOT,
      env,
      fs: fakeFs,
      existsSync: fakeFs.existsSync,
      log: logFn,
    });

    expect(warnings).toHaveLength(0);
  });

  // ---- env valid + .ait_relay ABSENT → no warning ----

  it('emits no warning when .ait_relay does not exist', async () => {
    const env: NodeJS.ProcessEnv = { AIT_DEBUG_TOTP_SECRET: ENV_SECRET };
    const fakeFs = makeFakeWriteFs({ secretExists: false });

    await ensureRelaySecret({
      projectRoot: FAKE_ROOT,
      env,
      fs: fakeFs,
      existsSync: fakeFs.existsSync,
      log: logFn,
    });

    expect(warnings).toHaveLength(0);
  });

  // ---- env valid + .ait_relay has invalid contents → no warning ----

  it('emits no warning when .ait_relay contains invalid contents', async () => {
    const env: NodeJS.ProcessEnv = { AIT_DEBUG_TOTP_SECRET: ENV_SECRET };
    const fakeFs = makeFakeWriteFs({
      secretExists: true,
      secretContent: INVALID_FILE_CONTENT,
    });

    await ensureRelaySecret({
      projectRoot: FAKE_ROOT,
      env,
      fs: fakeFs,
      existsSync: fakeFs.existsSync,
      log: logFn,
    });

    expect(warnings).toHaveLength(0);
  });

  // ---- env valid + .ait_relay read throws → no warning, no throw ----

  it('emits no warning and does not throw when .ait_relay read fails', async () => {
    const env: NodeJS.ProcessEnv = { AIT_DEBUG_TOTP_SECRET: ENV_SECRET };
    const fakeFs = makeFakeWriteFs({ secretExists: true, readThrows: true });

    await expect(
      ensureRelaySecret({
        projectRoot: FAKE_ROOT,
        env,
        fs: fakeFs,
        existsSync: fakeFs.existsSync,
        log: logFn,
      }),
    ).resolves.toBeUndefined();

    expect(warnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// loadRelaySecretReadOnly — divergence guard
// ---------------------------------------------------------------------------

describe('loadRelaySecretReadOnly — divergence guard', () => {
  let warnings: string[];
  let logFn: (msg: string) => void;

  beforeEach(() => {
    warnings = [];
    logFn = (msg: string) => {
      warnings.push(msg);
    };
  });

  afterEach(() => {
    warnings = [];
  });

  // ---- env valid + .ait_relay exists + DIFFERENT → warning emitted ----

  it('emits a warning when env secret differs from .ait_relay', async () => {
    const env: NodeJS.ProcessEnv = { AIT_DEBUG_TOTP_SECRET: ENV_SECRET };
    const fakeFs = makeFakeReadOnlyFs({ secretExists: true, secretContent: FILE_SECRET });

    await loadRelaySecretReadOnly({
      projectRoot: FAKE_ROOT,
      env,
      fs: fakeFs,
      existsSync: fakeFs.existsSync,
      log: logFn,
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('AIT_DEBUG_TOTP_SECRET');
    expect(warnings[0]).toContain('differs');
  });

  it('emits the warning exactly once', async () => {
    const env: NodeJS.ProcessEnv = { AIT_DEBUG_TOTP_SECRET: ENV_SECRET };
    const fakeFs = makeFakeReadOnlyFs({ secretExists: true, secretContent: FILE_SECRET });

    await loadRelaySecretReadOnly({
      projectRoot: FAKE_ROOT,
      env,
      fs: fakeFs,
      existsSync: fakeFs.existsSync,
      log: logFn,
    });

    expect(warnings).toHaveLength(1);
  });

  it('env value still wins (env unchanged after divergence warning)', async () => {
    const env: NodeJS.ProcessEnv = { AIT_DEBUG_TOTP_SECRET: ENV_SECRET };
    const fakeFs = makeFakeReadOnlyFs({ secretExists: true, secretContent: FILE_SECRET });

    await loadRelaySecretReadOnly({
      projectRoot: FAKE_ROOT,
      env,
      fs: fakeFs,
      existsSync: fakeFs.existsSync,
      log: logFn,
    });

    expect(env.AIT_DEBUG_TOTP_SECRET).toBe(ENV_SECRET);
  });

  it('function returns normally (does not throw) on divergence', async () => {
    const env: NodeJS.ProcessEnv = { AIT_DEBUG_TOTP_SECRET: ENV_SECRET };
    const fakeFs = makeFakeReadOnlyFs({ secretExists: true, secretContent: FILE_SECRET });

    await expect(
      loadRelaySecretReadOnly({
        projectRoot: FAKE_ROOT,
        env,
        fs: fakeFs,
        existsSync: fakeFs.existsSync,
        log: logFn,
      }),
    ).resolves.toBeUndefined();
  });

  // ---- SECRET-HANDLING: warning must not contain secret values ----

  it('warning does not contain the env secret value', async () => {
    const env: NodeJS.ProcessEnv = { AIT_DEBUG_TOTP_SECRET: ENV_SECRET };
    const fakeFs = makeFakeReadOnlyFs({ secretExists: true, secretContent: FILE_SECRET });

    await loadRelaySecretReadOnly({
      projectRoot: FAKE_ROOT,
      env,
      fs: fakeFs,
      existsSync: fakeFs.existsSync,
      log: logFn,
    });

    expect(warnings[0]).not.toContain(ENV_SECRET);
  });

  it('warning does not contain the file secret value', async () => {
    const env: NodeJS.ProcessEnv = { AIT_DEBUG_TOTP_SECRET: ENV_SECRET };
    const fakeFs = makeFakeReadOnlyFs({ secretExists: true, secretContent: FILE_SECRET });

    await loadRelaySecretReadOnly({
      projectRoot: FAKE_ROOT,
      env,
      fs: fakeFs,
      existsSync: fakeFs.existsSync,
      log: logFn,
    });

    expect(warnings[0]).not.toContain(FILE_SECRET);
  });

  it('warning does not contain the .ait_relay file path', async () => {
    const env: NodeJS.ProcessEnv = { AIT_DEBUG_TOTP_SECRET: ENV_SECRET };
    const fakeFs = makeFakeReadOnlyFs({ secretExists: true, secretContent: FILE_SECRET });

    await loadRelaySecretReadOnly({
      projectRoot: FAKE_ROOT,
      env,
      fs: fakeFs,
      existsSync: fakeFs.existsSync,
      log: logFn,
    });

    expect(warnings[0]).not.toContain(FAKE_SECRET_PATH);
    expect(warnings[0]).not.toContain(FAKE_ROOT);
  });

  // ---- env valid + .ait_relay exists + SAME → no warning ----

  it('emits no warning when env and .ait_relay contain the same secret', async () => {
    const env: NodeJS.ProcessEnv = { AIT_DEBUG_TOTP_SECRET: SAME_SECRET };
    const fakeFs = makeFakeReadOnlyFs({ secretExists: true, secretContent: SAME_SECRET });

    await loadRelaySecretReadOnly({
      projectRoot: FAKE_ROOT,
      env,
      fs: fakeFs,
      existsSync: fakeFs.existsSync,
      log: logFn,
    });

    expect(warnings).toHaveLength(0);
  });

  // ---- env valid + .ait_relay ABSENT → no warning ----

  it('emits no warning when .ait_relay does not exist', async () => {
    const env: NodeJS.ProcessEnv = { AIT_DEBUG_TOTP_SECRET: ENV_SECRET };
    const fakeFs = makeFakeReadOnlyFs({ secretExists: false });

    await loadRelaySecretReadOnly({
      projectRoot: FAKE_ROOT,
      env,
      fs: fakeFs,
      existsSync: fakeFs.existsSync,
      log: logFn,
    });

    expect(warnings).toHaveLength(0);
  });

  // ---- env valid + no projectRoot → no warning ----

  it('emits no warning when projectRoot is not provided (daemon has no anchor)', async () => {
    const env: NodeJS.ProcessEnv = { AIT_DEBUG_TOTP_SECRET: ENV_SECRET };

    await loadRelaySecretReadOnly({
      // projectRoot deliberately omitted
      env,
      log: logFn,
    });

    expect(warnings).toHaveLength(0);
  });

  // ---- env valid + .ait_relay has invalid contents → no warning ----

  it('emits no warning when .ait_relay contains invalid contents', async () => {
    const env: NodeJS.ProcessEnv = { AIT_DEBUG_TOTP_SECRET: ENV_SECRET };
    const fakeFs = makeFakeReadOnlyFs({
      secretExists: true,
      secretContent: INVALID_FILE_CONTENT,
    });

    await loadRelaySecretReadOnly({
      projectRoot: FAKE_ROOT,
      env,
      fs: fakeFs,
      existsSync: fakeFs.existsSync,
      log: logFn,
    });

    expect(warnings).toHaveLength(0);
  });

  // ---- env valid + .ait_relay read throws → no warning, no throw ----

  it('emits no warning and does not throw when .ait_relay read fails', async () => {
    const env: NodeJS.ProcessEnv = { AIT_DEBUG_TOTP_SECRET: ENV_SECRET };
    const fakeFs = makeFakeReadOnlyFs({ secretExists: true, readThrows: true });

    await expect(
      loadRelaySecretReadOnly({
        projectRoot: FAKE_ROOT,
        env,
        fs: fakeFs,
        existsSync: fakeFs.existsSync,
        log: logFn,
      }),
    ).resolves.toBeUndefined();

    expect(warnings).toHaveLength(0);
  });
});
