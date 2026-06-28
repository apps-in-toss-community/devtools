/**
 * Fixture test file for the run_tests pipeline integration test.
 *
 * This file is NOT a Playwright test and NOT a vitest test. It is a
 * *.ait.test.ts-style fixture intended to be bundled by `bundleTestFile`
 * and evaluated inside a real Chromium page via the CDP runtime.
 *
 * It deliberately uses describe/it/test/expect as globals — these are
 * installed by `runtime.ts`'s `runTestModule` before the factory runs.
 * A plain `import` of this file in Node context would fail (no globals).
 *
 * Expected results when run through the full pipeline:
 *   passed : 3  (addition, subtraction, top-level)
 *   failed : 1  (fails intentionally)
 *   skipped: 1  (skipped test)
 *   total  : 5
 */

/* global describe, it, test, expect */

describe('arithmetic', () => {
  it('addition passes', () => {
    expect(1 + 1).toBe(2);
  });

  it('subtraction passes', () => {
    expect(5 - 3).toBe(2);
  });

  it('fails intentionally', () => {
    // This test must fail so the integration test can assert on failure shape.
    expect(1).toBe(99);
  });
});

test('top-level passes', () => {
  expect('hello').toContain('ell');
});

it.skip('skipped test', () => {
  // Would fail if not skipped.
  expect(true).toBe(false);
});
