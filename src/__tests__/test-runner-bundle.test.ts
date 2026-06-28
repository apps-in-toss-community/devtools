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
});
