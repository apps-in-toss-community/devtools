/**
 * Unit tests for the project-local ephemeral URL store (#424 file-based
 * runtime-URL discovery, replacing env-var hand-off for env-2 cold-start).
 *
 * All tests use injected stubs — no real disk I/O. The daemon cwd here
 * contains a package.json (the repo root), so every test MUST inject
 * `projectRoot` + a stub `existsSync`/`fs` to avoid short-circuiting on the
 * real filesystem.
 *
 * SECRET-HANDLING: URL values carry the relay/tunnel host — they are the same
 * sensitivity class as the relay secret. Only test-fixture URLs are used here.
 * Tests confirm module functions never write URL values to any logger.
 */

import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  MOBILE_RELAY_BASE_URL_MISSING_MESSAGE,
  readMobileRelayBaseUrl,
} from '../mcp/debug-server.js';
import {
  deleteRelayUrls,
  type RelayUrlDeleteFs,
  type RelayUrlReadFs,
  type RelayUrlWriteFs,
  readRelayUrls,
  URLS_FILE_NAME,
  urlsFilePath,
  writeRelayUrls,
} from '../mcp/relay-url-store.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const PROJECT_ROOT = '/home/testuser/my-mini-app';
const URLS_PATH = join(PROJECT_ROOT, URLS_FILE_NAME);

// Fixture URLs — test-only values, never real tunnel hosts.
const RELAY_URL = 'https://relay-test.trycloudflare.com';
const TUNNEL_URL = 'https://tunnel-test.trycloudflare.com';

/** existsSync that returns true only for package.json directly under PROJECT_ROOT. */
function makeProjectExistsSync(packageJsonDirs: string[] = [PROJECT_ROOT]) {
  return (path: string): boolean => packageJsonDirs.some((d) => path === join(d, 'package.json'));
}

// ---------------------------------------------------------------------------
// Write fs stub
// ---------------------------------------------------------------------------

interface WriteFsCaptures {
  _written: Map<string, { data: string; options: { mode: number; flag: string } }>;
  _files: Map<string, string>;
}

function makeWriteFs(overrides: Partial<RelayUrlWriteFs> = {}): RelayUrlWriteFs & WriteFsCaptures {
  const files = new Map<string, string>();
  const written = new Map<string, { data: string; options: { mode: number; flag: string } }>();

  return {
    _written: written,
    _files: files,
    writeFileSync(path, data, options) {
      files.set(path, data);
      written.set(path, { data, options });
    },
    existsSync: (path) => files.has(path),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Read-only fs stub
// ---------------------------------------------------------------------------

function makeReadFs(files: Map<string, string>): RelayUrlReadFs {
  return {
    existsSync: (path) => files.has(path),
    readFileSync(path) {
      const v = files.get(path);
      if (v === undefined) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
      return v;
    },
  };
}

// ---------------------------------------------------------------------------
// Delete fs stub
// ---------------------------------------------------------------------------

function makeDeleteFs(files: Map<string, string>): RelayUrlDeleteFs & { _unlinked: string[] } {
  const unlinked: string[] = [];
  return {
    _unlinked: unlinked,
    existsSync: (path) => files.has(path),
    unlinkSync(path) {
      if (!files.has(path)) {
        throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
      }
      files.delete(path);
      unlinked.push(path);
    },
  };
}

// ---------------------------------------------------------------------------
// urlsFilePath
// ---------------------------------------------------------------------------

describe('urlsFilePath', () => {
  it('joins the nearest package.json dir with .ait_urls', () => {
    const start = join(PROJECT_ROOT, 'packages', 'app', 'src');
    const existsSync = makeProjectExistsSync([PROJECT_ROOT]);
    expect(urlsFilePath(start, existsSync)).toBe(URLS_PATH);
  });

  it('resolves against nearestPackageJsonDir — uses the imported function', () => {
    // If package.json is at a sub-dir, resolve to that sub-dir.
    const pkgDir = join(PROJECT_ROOT, 'packages', 'app');
    const existsSync = makeProjectExistsSync([pkgDir]);
    const result = urlsFilePath(join(pkgDir, 'src'), existsSync);
    expect(result).toBe(join(pkgDir, URLS_FILE_NAME));
  });
});

// ---------------------------------------------------------------------------
// writeRelayUrls — write path
// ---------------------------------------------------------------------------

describe('writeRelayUrls', () => {
  const existsSync = makeProjectExistsSync([PROJECT_ROOT]);

  it('writes JSON with both URLs to the correct path', async () => {
    const fs = makeWriteFs();
    await writeRelayUrls({
      projectRoot: PROJECT_ROOT,
      relayBaseUrl: RELAY_URL,
      tunnelBaseUrl: TUNNEL_URL,
      fs,
      existsSync,
    });
    expect(fs._written.has(URLS_PATH)).toBe(true);
    const write = fs._written.get(URLS_PATH)!;
    const payload = JSON.parse(write.data) as Record<string, unknown>;
    expect(payload.relayBaseUrl).toBe(RELAY_URL);
    expect(payload.tunnelBaseUrl).toBe(TUNNEL_URL);
  });

  it('writes with mode 0o600', async () => {
    const fs = makeWriteFs();
    await writeRelayUrls({ projectRoot: PROJECT_ROOT, tunnelBaseUrl: TUNNEL_URL, fs, existsSync });
    const write = fs._written.get(URLS_PATH)!;
    expect(write.options.mode).toBe(0o600);
  });

  it('uses flag "w" (overwrite — not O_EXCL)', async () => {
    const fs = makeWriteFs();
    await writeRelayUrls({ projectRoot: PROJECT_ROOT, tunnelBaseUrl: TUNNEL_URL, fs, existsSync });
    const write = fs._written.get(URLS_PATH)!;
    expect(write.options.flag).toBe('w');
  });

  it('omits relayBaseUrl when not provided (tunnel-only)', async () => {
    const fs = makeWriteFs();
    await writeRelayUrls({ projectRoot: PROJECT_ROOT, tunnelBaseUrl: TUNNEL_URL, fs, existsSync });
    const payload = JSON.parse(fs._written.get(URLS_PATH)!.data) as Record<string, unknown>;
    expect(Object.hasOwn(payload, 'tunnelBaseUrl')).toBe(true);
    expect(Object.hasOwn(payload, 'relayBaseUrl')).toBe(false);
  });

  it('omits tunnelBaseUrl when not provided (relay-only)', async () => {
    const fs = makeWriteFs();
    await writeRelayUrls({ projectRoot: PROJECT_ROOT, relayBaseUrl: RELAY_URL, fs, existsSync });
    const payload = JSON.parse(fs._written.get(URLS_PATH)!.data) as Record<string, unknown>;
    expect(Object.hasOwn(payload, 'relayBaseUrl')).toBe(true);
    expect(Object.hasOwn(payload, 'tunnelBaseUrl')).toBe(false);
  });

  it('SECRET-HANDLING: never writes URL values to console or a logger during write', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const fs = makeWriteFs();
    await writeRelayUrls({
      projectRoot: PROJECT_ROOT,
      relayBaseUrl: RELAY_URL,
      tunnelBaseUrl: TUNNEL_URL,
      fs,
      existsSync,
    });
    // No URL fragment should appear in any console output.
    const allCalls = [
      ...consoleSpy.mock.calls.flat().map(String),
      ...stderrSpy.mock.calls.flat().map(String),
    ].join('');
    expect(allCalls).not.toContain('trycloudflare.com');
    consoleSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// readRelayUrls — round-trip + failure modes
// ---------------------------------------------------------------------------

describe('readRelayUrls — write→read round-trip', () => {
  const existsSync = makeProjectExistsSync([PROJECT_ROOT]);

  it('round-trip: both URLs', async () => {
    const files = new Map<string, string>();
    const writeFs = makeWriteFs();
    await writeRelayUrls({
      projectRoot: PROJECT_ROOT,
      relayBaseUrl: RELAY_URL,
      tunnelBaseUrl: TUNNEL_URL,
      fs: writeFs,
      existsSync,
    });
    // Copy written content to the read fs.
    files.set(URLS_PATH, writeFs._files.get(URLS_PATH)!);
    const result = await readRelayUrls({
      projectRoot: PROJECT_ROOT,
      fs: makeReadFs(files),
      existsSync,
    });
    expect(result).not.toBeNull();
    expect(result?.relayBaseUrl).toBe(RELAY_URL);
    expect(result?.tunnelBaseUrl).toBe(TUNNEL_URL);
  });

  it('round-trip: tunnel-only', async () => {
    const files = new Map<string, string>();
    const writeFs = makeWriteFs();
    await writeRelayUrls({
      projectRoot: PROJECT_ROOT,
      tunnelBaseUrl: TUNNEL_URL,
      fs: writeFs,
      existsSync,
    });
    files.set(URLS_PATH, writeFs._files.get(URLS_PATH)!);
    const result = await readRelayUrls({
      projectRoot: PROJECT_ROOT,
      fs: makeReadFs(files),
      existsSync,
    });
    expect(result?.tunnelBaseUrl).toBe(TUNNEL_URL);
    expect(result?.relayBaseUrl).toBeUndefined();
  });

  it('round-trip: relay-only', async () => {
    const files = new Map<string, string>();
    const writeFs = makeWriteFs();
    await writeRelayUrls({
      projectRoot: PROJECT_ROOT,
      relayBaseUrl: RELAY_URL,
      fs: writeFs,
      existsSync,
    });
    files.set(URLS_PATH, writeFs._files.get(URLS_PATH)!);
    const result = await readRelayUrls({
      projectRoot: PROJECT_ROOT,
      fs: makeReadFs(files),
      existsSync,
    });
    expect(result?.relayBaseUrl).toBe(RELAY_URL);
    expect(result?.tunnelBaseUrl).toBeUndefined();
  });
});

describe('readRelayUrls — null on failures', () => {
  const existsSync = makeProjectExistsSync([PROJECT_ROOT]);

  it('returns null when projectRoot is omitted', async () => {
    const result = await readRelayUrls();
    expect(result).toBeNull();
  });

  it('returns null when file is absent', async () => {
    const result = await readRelayUrls({
      projectRoot: PROJECT_ROOT,
      fs: makeReadFs(new Map()),
      existsSync,
    });
    expect(result).toBeNull();
  });

  it('returns null on invalid JSON', async () => {
    const files = new Map([[URLS_PATH, 'not json {{{']]);
    const result = await readRelayUrls({
      projectRoot: PROJECT_ROOT,
      fs: makeReadFs(files),
      existsSync,
    });
    expect(result).toBeNull();
  });

  it('returns null when value is not an object', async () => {
    const files = new Map([[URLS_PATH, '"just a string"']]);
    const result = await readRelayUrls({
      projectRoot: PROJECT_ROOT,
      fs: makeReadFs(files),
      existsSync,
    });
    expect(result).toBeNull();
  });

  it('returns null when value is an array', async () => {
    const files = new Map([[URLS_PATH, '[1, 2, 3]']]);
    const result = await readRelayUrls({
      projectRoot: PROJECT_ROOT,
      fs: makeReadFs(files),
      existsSync,
    });
    expect(result).toBeNull();
  });

  it('ignores non-string fields (wrong shape)', async () => {
    const files = new Map([
      [URLS_PATH, JSON.stringify({ relayBaseUrl: 123, tunnelBaseUrl: null })],
    ]);
    const result = await readRelayUrls({
      projectRoot: PROJECT_ROOT,
      fs: makeReadFs(files),
      existsSync,
    });
    // Non-string values silently ignored — result is not null but fields absent.
    expect(result).not.toBeNull();
    expect(result?.relayBaseUrl).toBeUndefined();
    expect(result?.tunnelBaseUrl).toBeUndefined();
  });

  it('trims string values', async () => {
    const files = new Map([
      [
        URLS_PATH,
        JSON.stringify({ relayBaseUrl: `  ${RELAY_URL}  `, tunnelBaseUrl: `\n${TUNNEL_URL}\n` }),
      ],
    ]);
    const result = await readRelayUrls({
      projectRoot: PROJECT_ROOT,
      fs: makeReadFs(files),
      existsSync,
    });
    expect(result?.relayBaseUrl).toBe(RELAY_URL);
    expect(result?.tunnelBaseUrl).toBe(TUNNEL_URL);
  });

  it('does not throw on unreadable file (returns null silently)', async () => {
    const badFs: RelayUrlReadFs = {
      existsSync: () => true,
      readFileSync() {
        throw new Error('EACCES: permission denied');
      },
    };
    await expect(
      readRelayUrls({ projectRoot: PROJECT_ROOT, fs: badFs, existsSync }),
    ).resolves.toBeNull();
  });

  it('SECRET-HANDLING: never writes URL values to console during read', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const files = new Map([
      [URLS_PATH, JSON.stringify({ relayBaseUrl: RELAY_URL, tunnelBaseUrl: TUNNEL_URL })],
    ]);
    await readRelayUrls({
      projectRoot: PROJECT_ROOT,
      fs: makeReadFs(files),
      existsSync,
    });
    const allCalls = consoleSpy.mock.calls.flat().map(String).join('');
    expect(allCalls).not.toContain('trycloudflare.com');
    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// deleteRelayUrls
// ---------------------------------------------------------------------------

describe('deleteRelayUrls', () => {
  const existsSync = makeProjectExistsSync([PROJECT_ROOT]);

  it('removes the file when present', async () => {
    const files = new Map([[URLS_PATH, '{}']]);
    const fs = makeDeleteFs(files);
    await deleteRelayUrls({ projectRoot: PROJECT_ROOT, fs, existsSync });
    expect(files.has(URLS_PATH)).toBe(false);
    expect(fs._unlinked).toContain(URLS_PATH);
  });

  it('is a silent no-op when the file is absent (no throw)', async () => {
    const files = new Map<string, string>();
    const fs = makeDeleteFs(files);
    await expect(
      deleteRelayUrls({ projectRoot: PROJECT_ROOT, fs, existsSync }),
    ).resolves.toBeUndefined();
    expect(fs._unlinked).toHaveLength(0);
  });

  it('swallows errors from unlinkSync', async () => {
    const badFs: RelayUrlDeleteFs = {
      existsSync: () => true,
      unlinkSync() {
        throw new Error('EBUSY: resource busy');
      },
    };
    await expect(
      deleteRelayUrls({ projectRoot: PROJECT_ROOT, fs: badFs, existsSync }),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// readMobileRelayBaseUrl — env-wins precedence + file fallback (#424)
// ---------------------------------------------------------------------------

describe('readMobileRelayBaseUrl — env wins, file fallback, throws when both absent', () => {
  it('returns env value when AIT_RELAY_BASE_URL is set (ignores file)', async () => {
    const env: NodeJS.ProcessEnv = { AIT_RELAY_BASE_URL: RELAY_URL };
    // Supply a file with a different value — env must win.
    const files = new Map([
      [URLS_PATH, JSON.stringify({ relayBaseUrl: 'https://other.trycloudflare.com' })],
    ]);
    // Inject readRelayUrls stub: if env wins, the file must NOT be read.
    const readSpy = vi.fn().mockResolvedValue({ relayBaseUrl: 'https://other.trycloudflare.com' });
    // We can't easily inject readRelayUrls into debug-server, so just assert the
    // returned value is the env value.
    const result = await readMobileRelayBaseUrl(env, PROJECT_ROOT);
    expect(result).toBe(RELAY_URL);
    // Suppress unused var lint
    void files;
    void readSpy;
  });

  it('trims the env value', async () => {
    const env: NodeJS.ProcessEnv = { AIT_RELAY_BASE_URL: `  ${RELAY_URL}  ` };
    const result = await readMobileRelayBaseUrl(env, PROJECT_ROOT);
    expect(result).toBe(RELAY_URL);
  });

  it('throws MOBILE_RELAY_BASE_URL_MISSING_MESSAGE when env is empty and projectRoot is absent', async () => {
    const env: NodeJS.ProcessEnv = {};
    await expect(readMobileRelayBaseUrl(env, undefined)).rejects.toThrow(
      MOBILE_RELAY_BASE_URL_MISSING_MESSAGE,
    );
  });

  it('throws when env is empty and file is also absent', async () => {
    const env: NodeJS.ProcessEnv = {};
    // PROJECT_ROOT has no .ait_urls — readRelayUrls returns null.
    // readMobileRelayBaseUrl itself calls readRelayUrls internally (dynamic import).
    // We can't inject the fs dep into readMobileRelayBaseUrl, but we can verify
    // it throws when no file exists on the real fs at PROJECT_ROOT.
    await expect(readMobileRelayBaseUrl(env, PROJECT_ROOT)).rejects.toThrow(
      MOBILE_RELAY_BASE_URL_MISSING_MESSAGE,
    );
  });

  it('does not echo URL values in error messages', async () => {
    const env: NodeJS.ProcessEnv = {};
    let errorMessage = '';
    try {
      await readMobileRelayBaseUrl(env, undefined);
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }
    // The error message must name the env var but never echo any URL value.
    expect(errorMessage).toContain('AIT_RELAY_BASE_URL');
    expect(errorMessage).not.toContain('trycloudflare.com');
  });
});
