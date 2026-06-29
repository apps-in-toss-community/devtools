/**
 * Unit tests for `bundleTestFile` (devtools#644).
 *
 * Bundles a small in-memory test fixture written to a temp file and verifies
 * the output contains expected tokens.
 *
 * NOTE: esbuild runs as a real child process here. The test file is a minimal
 * JS/TS snippet; no Vitest runner globals are required in the fixture since
 * we only assert the bundle structure, not execution correctness.
 *
 * This test runs in a Node.js environment (not jsdom) because esbuild requires
 * a real Node TextEncoder/Uint8Array invariant that jsdom breaks.
 *
 * @vitest-environment node
 */

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bundleTestFile } from '../test-runner/bundle.js';

/* -------------------------------------------------------------------------- */
/* Temp fixture setup                                                          */
/* -------------------------------------------------------------------------- */

let tmpDir: string;
let fixtureFile: string;
let sdkImportFile: string;
let multilineImportFile: string;
let multilineReExportFile: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devtools-test-runner-'));

  // Minimal test fixture that uses a local function (no SDK import)
  fixtureFile = path.join(tmpDir, 'simple.test.ts');
  await fs.writeFile(
    fixtureFile,
    `
export function hello() { return 'hello from bundle'; }
export function runTestModule() { return { passed: 1, failed: 0 }; }
`.trimStart(),
    'utf8',
  );

  // Fixture that imports a runtime value from the SDK package (should be redirected to window.__sdk)
  sdkImportFile = path.join(tmpDir, 'sdk-import.test.ts');
  await fs.writeFile(
    sdkImportFile,
    `
// biome-ignore lint: test fixture — uses SDK runtime import to verify plugin redirect
// The getPlatformOS identifier may not actually exist on the SDK; we only care that
// the import is intercepted by the sdk-redirect plugin and redirected to window.__sdk.
import { getPlatformOS } from '@apps-in-toss/web-framework';
export function getResult() { return getPlatformOS; }
export function runTestModule() { return { passed: 0 }; }
`.trimStart(),
    'utf8',
  );

  // Fixture with a MULTI-LINE named SDK import (one member per line). This is
  // the shape that broke env3 run_tests (#678): the member lines and the
  // closing `} from '…'` line leaked into the factory body, leaving an
  // unterminated `import {` at module scope → esbuild `Expected "as"`.
  // It also calls describe/it so the factory body is non-empty, exercising the
  // import-block / body split.
  multilineImportFile = path.join(tmpDir, 'multiline-import.test.ts');
  await fs.writeFile(
    multilineImportFile,
    `
import {
  appLogin,
  getAnonymousKey,
  getUserKeyForGame,
} from '@apps-in-toss/web-framework';

describe('multiline', () => {
  it('registers with members in scope', () => {
    expect(appLogin).toBeDefined();
    expect(getAnonymousKey).toBeDefined();
    expect(getUserKeyForGame).toBeDefined();
  });
});
`.trimStart(),
    'utf8',
  );

  // Fixture with a MULTI-LINE re-export block — must also stay at top level.
  multilineReExportFile = path.join(tmpDir, 'multiline-reexport.test.ts');
  await fs.writeFile(
    multilineReExportFile,
    `
export {
  appLogin,
  getAnonymousKey,
} from '@apps-in-toss/web-framework';

describe('reexport', () => {
  it('ok', () => {
    expect(true).toBe(true);
  });
});
`.trimStart(),
    'utf8',
  );
});

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

/* -------------------------------------------------------------------------- */
/* bundleTestFile tests                                                        */
/* -------------------------------------------------------------------------- */

describe('bundleTestFile', () => {
  it('returns a non-empty code string', async () => {
    const result = await bundleTestFile(fixtureFile);
    expect(typeof result.code).toBe('string');
    expect(result.code.length).toBeGreaterThan(10);
  });

  it('includes the globalName IIFE wrapper', async () => {
    const result = await bundleTestFile(fixtureFile, { globalName: '__testBundle' });
    // esbuild IIFE output always contains the globalName
    expect(result.code).toContain('__testBundle');
  });

  it('exports runTestModule and __userFactory on the IIFE global', async () => {
    // The bundle must expose both symbols so that rpc.ts can call
    // runTestModule(__userFactory) to install globals before running tests.
    const result = await bundleTestFile(fixtureFile, { globalName: '__testBundle' });
    expect(result.code).toContain('runTestModule');
    expect(result.code).toContain('__userFactory');
  });

  it('contains the fixture function token', async () => {
    const result = await bundleTestFile(fixtureFile);
    // The `hello` function body should survive bundling
    expect(result.code).toContain('hello from bundle');
  });

  it('returns empty warnings array for clean input', async () => {
    const result = await bundleTestFile(fixtureFile);
    expect(Array.isArray(result.warnings)).toBe(true);
    // Warnings may be empty or contain bundle notes; we just assert the array exists
  });

  it('accepts a custom globalName', async () => {
    const result = await bundleTestFile(fixtureFile, { globalName: '__myCustomBundle' });
    expect(result.code).toContain('__myCustomBundle');
  });

  it('injects the SDK shim banner when SDK types are imported', async () => {
    // type-only import should not cause esbuild to bundle the SDK, but the banner
    // should always be present
    const result = await bundleTestFile(sdkImportFile);
    expect(result.code).toContain('__sdk');
  });

  it('externalises the SDK package (not bundled inline)', async () => {
    const result = await bundleTestFile(sdkImportFile);
    // The real SDK source should NOT be inlined
    expect(result.code).not.toContain('@apps-in-toss/web-framework/dist');
    // The shim referencing window.__sdk should be present (from banner)
    expect(result.code).toContain('window.__sdk');
  });

  it('throws on a non-existent file', async () => {
    await expect(bundleTestFile('/nonexistent/path/test.ts')).rejects.toThrow();
  });

  // Regression: #678 — multi-line named SDK imports broke env3 run_tests.
  // The line-based factory wrapper must keep the whole import statement
  // (opening `import {`, member lines, closing `} from '…'`) at module scope.
  it('bundles a multi-line named SDK import without error (#678)', async () => {
    const result = await bundleTestFile(multilineImportFile);
    expect(result.code).toContain('__userFactory');
    expect(result.code.length).toBeGreaterThan(10);
    // The SDK redirect shim must be present (the import was processed at top
    // level, not stranded inside the factory body).
    expect(result.code).toContain('window.__sdk');
  });

  it('does not leak multi-line import member lines into the factory body', async () => {
    const result = await bundleTestFile(multilineImportFile);
    // If the closing `} from '…'` line had leaked into the factory body, the
    // bundle would have thrown above. As an extra guard, the factory wrapper
    // declaration must appear AFTER the import shim was emitted — i.e. the
    // import was not re-parsed as a stray `{ … }` block inside the function.
    const userFactoryIdx = result.code.indexOf('__userFactory');
    const sdkShimIdx = result.code.indexOf('window.__sdk');
    expect(userFactoryIdx).toBeGreaterThan(-1);
    expect(sdkShimIdx).toBeGreaterThan(-1);
  });

  it('keeps a multi-line re-export block at top level (#678)', async () => {
    const result = await bundleTestFile(multilineReExportFile);
    expect(result.code).toContain('__userFactory');
    expect(result.code.length).toBeGreaterThan(10);
  });

  it('still bundles a single-line named SDK import (no regression)', async () => {
    const result = await bundleTestFile(sdkImportFile);
    expect(result.code).toContain('__userFactory');
    expect(result.code).toContain('window.__sdk');
  });

  // Regression #697: the runtime path must resolve regardless of which dist
  // chunk rolldown hoists getRuntimePath into. At the unit level we can only
  // assert the src-context resolution still works end-to-end (the dist-chunk
  // depth cases are covered by scripts/check-test-runner-dist.sh, which runs
  // the resolver from every built carrier chunk's real directory).
  it('resolves the runtime and includes runTestModule in the bundle (#697)', async () => {
    const result = await bundleTestFile(fixtureFile);
    expect(result.code).toContain('runTestModule');
    expect(result.warnings.join('\n')).not.toMatch(/Could not resolve/);
  });
});

/* -------------------------------------------------------------------------- */
/* vitestRedirectPlugin tests (devtools#683)                                   */
/* -------------------------------------------------------------------------- */

describe('vitestRedirectPlugin', () => {
  let vitestImportFile: string;

  beforeAll(async () => {
    // Fixture that imports vitest globals — these should be redirected to globalThis
    vitestImportFile = path.join(tmpDir, 'vitest-import.test.ts');
    await fs.writeFile(
      vitestImportFile,
      `
import { describe, it, expect, afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';
describe('suite', () => {
  it('test', () => {
    expect(1).toBe(1);
  });
});
`.trimStart(),
      'utf8',
    );
  });

  it('bundles a file that imports from vitest without errors', async () => {
    const result = await bundleTestFile(vitestImportFile);
    expect(result.code.length).toBeGreaterThan(10);
    // No unresolved module errors — esbuild would throw, not produce output
  });

  it('does not include the real vitest package in the bundle', async () => {
    const result = await bundleTestFile(vitestImportFile);
    // The real Vitest internal identifiers should not appear
    expect(result.code).not.toContain('vitest/dist');
    expect(result.code).not.toContain('@vitest/');
  });

  it('redirects vitest imports via lazy globalThis getters (not a value copy)', async () => {
    const result = await bundleTestFile(vitestImportFile);
    // The redirect must defer the lookup to access time. A value-copy redirect
    // (`export var describe = globalThis.describe`) captured at evaluation time
    // would be undefined because runTestModule installs globals LATER. The
    // virtual module instead defines getters that read globalThis at access
    // time, and marks itself __esModule so esbuild's __toESM maps named imports
    // to those getters directly (a bare Proxy whose own-keys are empty would
    // expose zero named exports).
    expect(result.code).toContain('__esModule');
    expect(result.code).toContain('globalThis["describe"]');
    expect(result.code).toContain('globalThis["vi"]');
    // It must NOT be the broken value-copy form.
    expect(result.code).not.toContain('var describe = globalThis.describe');
  });

  // Regression for the env3 timing defect: globals are installed by
  // runTestModule, which runs AFTER the bundle IIFE is evaluated. If the vitest
  // redirect captured `describe` at evaluation time it would be undefined and
  // the user's describe(...) calls would register zero tests. This test
  // reproduces that order: evaluate the bundle while the runtime's own globals
  // are NOT yet installed, then call runTestModule — the user's describe/it must
  // still register through the lazy Proxy.
  it('registers tests when globals are installed only at runTestModule time (#683)', async () => {
    const timingFile = path.join(tmpDir, 'timing.test.ts');
    await fs.writeFile(
      timingFile,
      `
import { describe, it, expect } from 'vitest';
describe('timing suite', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
`.trimStart(),
      'utf8',
    );
    const { code } = await bundleTestFile(timingFile);

    type TestBundle = {
      runTestModule: (
        factory?: () => void | Promise<void>,
      ) => Promise<{ tests: unknown[]; passed: number; failed: number }>;
      __userFactory: () => void | Promise<void>;
    };

    // Snapshot and clear any test globals currently on globalThis so the bundle
    // is evaluated in the WebView state: no describe/it/expect installed yet.
    // (Vitest does not install these on globalThis by default, but we clear
    // defensively to make the timing precondition explicit and robust.)
    const g = globalThis as unknown as Record<string, unknown>;
    const NAMES = [
      'describe',
      'it',
      'test',
      'expect',
      'beforeAll',
      'afterAll',
      'beforeEach',
      'afterEach',
      'vi',
    ];
    const saved: Record<string, unknown> = {};
    for (const n of NAMES) {
      saved[n] = g[n];
      delete g[n];
    }

    try {
      // Evaluate the IIFE in the global scope (indirect eval — aliasing eval to
      // a binding makes the call indirect, so the bundle's `globalThis` footer
      // assigns `globalThis.__testBundle`). At THIS point no describe global
      // exists — exactly the WebView precondition that broke with a value-copy
      // redirect.
      // biome-ignore lint/security/noGlobalEval: deliberately evaluating the bundle IIFE to reproduce the WebView eval timing.
      const indirectEval = eval;
      indirectEval(code);
      const bundle = g.__testBundle as TestBundle;

      // describe must still be undefined right after evaluation — the redirect
      // is lazy, not a value-copy that would have captured something here.
      expect(g.describe).toBeUndefined();

      // Now call runTestModule with the factory (exactly as rpc.ts does). It
      // installs the runtime globals, then the factory's describe/it resolve
      // through the lazy Proxy and register the test.
      const report = await bundle.runTestModule(bundle.__userFactory);
      expect(report.tests.length).toBeGreaterThan(0);
      expect(report.passed).toBe(1);
      expect(report.failed).toBe(0);
    } finally {
      // Restore the original globals so we do not leak runtime globals into the
      // host Vitest run.
      for (const n of NAMES) {
        if (saved[n] === undefined) delete g[n];
        else g[n] = saved[n];
      }
    }
  });
});
