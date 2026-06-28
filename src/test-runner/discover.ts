/**
 * Test-file discovery shared by the `devtools-test` CLI and the `run_tests`
 * MCP tool, so both expand glob patterns with identical semantics.
 *
 * Uses Node's built-in `fs/promises` `glob` (Node 22+) — no extra dependency,
 * which keeps the MCP daemon install graph lean (a plain glob lib would land in
 * the `npx … devtools-mcp` path for no benefit).
 *
 * Pure Node IO only (`node:fs/promises` + `node:path`) — react-free, so it is
 * safe to import from the MCP daemon graph.
 */

import { glob } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

/**
 * Expands `patterns` (globs or plain paths) into a sorted, de-duplicated list of
 * ABSOLUTE test file paths, resolved relative to `cwd`.
 *
 * A plain (non-glob) path passes through when it matches a real file; a glob
 * expands against `cwd`. Absolute matches are kept as-is; relative matches are
 * resolved against `cwd`. `bundleTestFile` requires an absolute path, so the
 * absolute output feeds it directly.
 *
 * @param patterns Glob patterns or file paths (e.g. `['src/**\/*.ait.test.ts']`).
 * @param cwd      Base directory for relative patterns/results.
 * @returns Sorted, de-duplicated absolute file paths. Empty when nothing matches.
 */
export async function discoverTestFiles(patterns: string[], cwd: string): Promise<string[]> {
  const out = new Set<string>();
  for await (const match of glob(patterns, { cwd })) {
    out.add(isAbsolute(match) ? match : resolve(cwd, match));
  }
  return [...out].sort();
}
