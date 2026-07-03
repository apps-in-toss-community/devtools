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
import { basename, isAbsolute, resolve } from 'node:path';

/**
 * Filename suffix that opts a test file into manual-variant scheduling
 * (devtools#741). A file named `<name>.manual.ait.test.ts` is EXCLUDED from
 * `discoverTestFiles`'s default output (so existing unattended runs are
 * unaffected — the zero-diff-when-off constraint) and is only surfaced when
 * the caller explicitly asks for manual files via {@link partitionManualTests}
 * (wired from the CLI's `--manual-blocking` flag).
 *
 * This is the entire tagging contract for v1 — no separate manifest/config,
 * just a filename convention. Documented here + in the CLI `--help` text
 * (cli.ts USAGE) and the test-runner README.
 */
export const MANUAL_TEST_SUFFIX = '.manual.ait.test.ts';

/** True when `file`'s basename ends with {@link MANUAL_TEST_SUFFIX}. */
export function isManualTestFile(file: string): boolean {
  return basename(file).endsWith(MANUAL_TEST_SUFFIX);
}

/**
 * Expands `patterns` (globs or plain paths) into a sorted, de-duplicated list of
 * ABSOLUTE test file paths, resolved relative to `cwd`.
 *
 * A plain (non-glob) path passes through when it matches a real file; a glob
 * expands against `cwd`. Absolute matches are kept as-is; relative matches are
 * resolved against `cwd`. `bundleTestFile` requires an absolute path, so the
 * absolute output feeds it directly.
 *
 * By default, files matching {@link MANUAL_TEST_SUFFIX} are EXCLUDED from the
 * result (devtools#741) — blocking-UI tests opt in via that filename
 * convention and must never appear in an unattended run unless the caller
 * explicitly asks for them via `includeManual: true`. This keeps the
 * default (flag-off) discovery path byte-for-byte identical to before this
 * option existed.
 *
 * @param patterns Glob patterns or file paths (e.g. `['src/**\/*.ait.test.ts']`).
 * @param cwd      Base directory for relative patterns/results.
 * @param opts     `{ includeManual }` — when true, manual-tagged files are kept
 *                 in the (still-sorted) output instead of being filtered out.
 *                 Use {@link partitionManualTests} to separate + reorder them.
 * @returns Sorted, de-duplicated absolute file paths. Empty when nothing matches.
 */
export async function discoverTestFiles(
  patterns: string[],
  cwd: string,
  opts?: { includeManual?: boolean },
): Promise<string[]> {
  const out = new Set<string>();
  for await (const match of glob(patterns, { cwd })) {
    out.add(isAbsolute(match) ? match : resolve(cwd, match));
  }
  const sorted = [...out].sort();
  if (opts?.includeManual) return sorted;
  return sorted.filter((f) => !isManualTestFile(f));
}

/**
 * Splits an already-discovered file list into `{ regular, manual }`, each
 * still sorted. Used by the CLI's `--manual-blocking` path to schedule manual
 * files strictly AFTER every regular file (devtools#741) — regular files run
 * first (and produce the unattended-shaped part of the report) and manual
 * files run last, each preceded by a dashboard prompt.
 *
 * Pure partition — does not itself decide inclusion; call
 * `discoverTestFiles(patterns, cwd, { includeManual: true })` first so manual
 * files are present in `files` to partition.
 */
export function partitionManualTests(files: string[]): { regular: string[]; manual: string[] } {
  const regular: string[] = [];
  const manual: string[] = [];
  for (const f of files) {
    (isManualTestFile(f) ? manual : regular).push(f);
  }
  return { regular, manual };
}
