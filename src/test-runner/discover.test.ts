/**
 * Unit tests for `discoverTestFiles` (devtools#646).
 *
 * Uses a real temp directory tree (no CDP / phone needed) to verify glob
 * expansion, plain-path passthrough, absolute output, sort + dedup, and the
 * empty-match case.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { discoverTestFiles, isManualTestFile, partitionManualTests } from './discover.js';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'ait-discover-'));
  // Layout:
  //   a.ait.test.ts
  //   b.ait.test.ts
  //   not-a-test.ts
  //   camera.manual.ait.test.ts  (devtools#741 — manual-tagged)
  await writeFile(join(root, 'a.ait.test.ts'), '');
  await writeFile(join(root, 'b.ait.test.ts'), '');
  await writeFile(join(root, 'not-a-test.ts'), '');
  await writeFile(join(root, 'camera.manual.ait.test.ts'), '');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('discoverTestFiles', () => {
  it('expands a glob to matching files, sorted and absolute', async () => {
    const files = await discoverTestFiles(['*.ait.test.ts'], root);
    expect(files).toHaveLength(2);
    expect(files.every((f) => isAbsolute(f))).toBe(true);
    // sorted
    expect([...files]).toEqual([...files].sort());
    expect(files[0].endsWith('a.ait.test.ts')).toBe(true);
    expect(files[1].endsWith('b.ait.test.ts')).toBe(true);
  });

  it('passes a plain (non-glob) path through when it matches', async () => {
    const files = await discoverTestFiles(['a.ait.test.ts'], root);
    expect(files).toHaveLength(1);
    expect(files[0].endsWith('a.ait.test.ts')).toBe(true);
    expect(isAbsolute(files[0])).toBe(true);
  });

  it('de-duplicates a file matched by multiple patterns', async () => {
    const files = await discoverTestFiles(['a.ait.test.ts', '*.ait.test.ts'], root);
    // a.ait.test.ts matched by both patterns → present once
    const count = files.filter((f) => f.endsWith('a.ait.test.ts')).length;
    expect(count).toBe(1);
    expect(files).toHaveLength(2);
  });

  it('returns an empty array when nothing matches', async () => {
    const files = await discoverTestFiles(['*.nomatch.test.ts'], root);
    expect(files).toEqual([]);
  });

  it('does not match files outside the pattern', async () => {
    const files = await discoverTestFiles(['*.ait.test.ts'], root);
    expect(files.some((f) => f.endsWith('not-a-test.ts'))).toBe(false);
  });
});

describe('discoverTestFiles — manual-tagged file exclusion (devtools#741)', () => {
  it('EXCLUDES *.manual.ait.test.ts by default (zero-diff-when-off contract)', async () => {
    const files = await discoverTestFiles(['*.ait.test.ts'], root);
    expect(files.some((f) => f.endsWith('camera.manual.ait.test.ts'))).toBe(false);
    // Only the two regular files remain — same result as before #741 existed.
    expect(files).toHaveLength(2);
  });

  it('a manual file passed as an explicit plain path is STILL excluded by default', async () => {
    // Even a direct (non-glob) path to a manual file is filtered — the
    // exclusion is a property of the file itself, not of how it was matched.
    const files = await discoverTestFiles(['camera.manual.ait.test.ts'], root);
    expect(files).toEqual([]);
  });

  it('includes manual files (still sorted) when includeManual is true', async () => {
    const files = await discoverTestFiles(['*.ait.test.ts'], root, { includeManual: true });
    expect(files).toHaveLength(3);
    expect(files.some((f) => f.endsWith('camera.manual.ait.test.ts'))).toBe(true);
    expect([...files]).toEqual([...files].sort());
  });
});

describe('isManualTestFile', () => {
  it('matches the *.manual.ait.test.ts suffix', () => {
    expect(isManualTestFile('/abs/path/camera.manual.ait.test.ts')).toBe(true);
  });

  it('does not match a regular *.ait.test.ts file', () => {
    expect(isManualTestFile('/abs/path/camera.ait.test.ts')).toBe(false);
  });

  it('does not match a file that merely contains "manual" elsewhere in the name', () => {
    expect(isManualTestFile('/abs/path/manual-override.ait.test.ts')).toBe(false);
  });
});

describe('partitionManualTests — manual files scheduled last (devtools#741)', () => {
  it('splits into regular + manual, preserving relative order within each group', () => {
    const files = [
      '/a/1.ait.test.ts',
      '/a/2.manual.ait.test.ts',
      '/a/3.ait.test.ts',
      '/a/4.manual.ait.test.ts',
    ];
    const { regular, manual } = partitionManualTests(files);
    expect(regular).toEqual(['/a/1.ait.test.ts', '/a/3.ait.test.ts']);
    expect(manual).toEqual(['/a/2.manual.ait.test.ts', '/a/4.manual.ait.test.ts']);
  });

  it('returns an empty manual array when there are no manual-tagged files', () => {
    const { regular, manual } = partitionManualTests(['/a/1.ait.test.ts']);
    expect(regular).toEqual(['/a/1.ait.test.ts']);
    expect(manual).toEqual([]);
  });

  it('[...regular, ...manual] schedules every manual file strictly after every regular file', () => {
    const files = ['/a/2.manual.ait.test.ts', '/a/1.ait.test.ts', '/a/3.manual.ait.test.ts'];
    const { regular, manual } = partitionManualTests(files);
    const scheduled = [...regular, ...manual];
    const lastRegularIndex = Math.max(...regular.map((f) => scheduled.indexOf(f)));
    const firstManualIndex = Math.min(...manual.map((f) => scheduled.indexOf(f)));
    expect(firstManualIndex).toBeGreaterThan(lastRegularIndex);
  });
});
