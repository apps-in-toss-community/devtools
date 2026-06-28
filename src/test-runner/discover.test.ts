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
import { discoverTestFiles } from './discover.js';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'ait-discover-'));
  // Layout:
  //   a.ait.test.ts
  //   b.ait.test.ts
  //   not-a-test.ts
  await writeFile(join(root, 'a.ait.test.ts'), '');
  await writeFile(join(root, 'b.ait.test.ts'), '');
  await writeFile(join(root, 'not-a-test.ts'), '');
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
