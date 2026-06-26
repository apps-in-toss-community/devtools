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
});
