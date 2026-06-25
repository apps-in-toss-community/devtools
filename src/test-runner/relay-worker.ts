/**
 * Orchestrator: runs a list of test files sequentially over a CDP relay.
 *
 * Each file goes through: bundle → inject → run → collect.
 * This is the transport layer: it does NOT integrate with Vitest's pool or the
 * MCP surface. The Vitest custom pool (`pool.ts`) and the `run_tests` MCP tool
 * are separate callers that build on this orchestrator.
 *
 * Single-attach constraint: only one page is active at a time. Files run
 * sequentially; parallel execution across targets is out of scope.
 *
 * The 30-second per-file timeout is inherited from `injectAndRunBundle`.
 * For suites that exceed it, split the file into smaller pieces.
 *
 * SECRET-HANDLING: file paths are surfaced in reports; relay URLs are not.
 */

import type { CdpConnection } from '../mcp/cdp-connection.js';
import { type BundleOptions, bundleTestFile } from './bundle.js';
import { injectAndRunBundle } from './rpc.js';
import type { RunReport, TestResult } from './runtime.js';

/** Per-file result in the aggregate `RunReport`. */
export interface FileResult {
  /** Absolute or relative path to the test file. */
  file: string;
  /** Full run report for this file, or an error if bundling/injection failed. */
  result: RunReport | { error: string };
}

/** Aggregate report returned by `runTestFilesOverRelay`. */
export interface RelayRunReport {
  /** ISO timestamp of when the run started. */
  startedAt: string;
  /** Total elapsed wall-clock milliseconds. */
  duration: number;
  /** Per-file results in execution order. */
  files: FileResult[];
  /** Flattened totals across all files. */
  totals: {
    passed: number;
    failed: number;
    skipped: number;
    total: number;
  };
}

/** Options for `runTestFilesOverRelay`. */
export interface RelayRunOptions {
  /**
   * Options forwarded to `bundleTestFile` for each file.
   */
  bundleOptions?: BundleOptions;
  /**
   * Per-file evaluate timeout in milliseconds. Defaults to 30 000.
   * Increase for long-running suites or split the file.
   */
  timeoutMs?: number;
}

/**
 * Runs all `files` sequentially over the given CDP `connection`.
 *
 * For each file:
 *   1. Bundle with esbuild (includes SDK shim + runtime).
 *   2. Inject into the attached page via `Runtime.evaluate`.
 *   3. Await the `RunReport` JSON response.
 *   4. Accumulate results.
 *
 * Returns a `RelayRunReport` with per-file results and flattened totals.
 *
 * This function does NOT open or manage the relay connection — the caller
 * is responsible for attaching and closing it.
 *
 * TODO (#645): implement the Vitest `PoolRunnerInitializer` interface here
 * so that `runTestFilesOverRelay` can be used as a Vitest pool entry.
 *
 * @param connection - Active CDP connection (relay or local kind).
 * @param files      - Absolute paths to test files, run in order.
 * @param opts       - Optional per-run overrides.
 */
export async function runTestFilesOverRelay(
  connection: CdpConnection,
  files: string[],
  opts?: RelayRunOptions,
): Promise<RelayRunReport> {
  const wallStart = Date.now();
  const startedAt = new Date(wallStart).toISOString();
  const fileResults: FileResult[] = [];

  for (const file of files) {
    let fileEntry: FileResult;
    try {
      const { code } = await bundleTestFile(file, opts?.bundleOptions);
      const rpcResult = await injectAndRunBundle(connection, code, opts?.timeoutMs);
      if (rpcResult.ok) {
        fileEntry = { file, result: rpcResult.report };
      } else {
        fileEntry = { file, result: { error: rpcResult.error } };
      }
    } catch (e) {
      // Capture bundle/inject errors per-file so subsequent files still run.
      fileEntry = {
        file,
        result: {
          error: e instanceof Error ? e.message : String(e),
        },
      };
    }
    fileResults.push(fileEntry);
  }

  const totals = fileResults.reduce(
    (acc, { result }) => {
      if ('error' in result) {
        // Treat whole-file errors as a single failure.
        acc.failed += 1;
        acc.total += 1;
      } else {
        acc.passed += result.passed;
        acc.failed += result.failed;
        acc.skipped += result.skipped;
        acc.total += result.passed + result.failed + result.skipped;
      }
      return acc;
    },
    { passed: 0, failed: 0, skipped: 0, total: 0 },
  );

  return {
    startedAt,
    duration: Date.now() - wallStart,
    files: fileResults,
    totals,
  };
}

/**
 * Flattens all test results from a `RelayRunReport` into a single array.
 * Files that errored during bundle/inject produce a synthetic failed entry.
 */
export function flattenResults(report: RelayRunReport): Array<TestResult & { file: string }> {
  const out: Array<TestResult & { file: string }> = [];
  for (const { file, result } of report.files) {
    if ('error' in result) {
      out.push({
        file,
        name: `<bundle/inject error>`,
        status: 'fail',
        duration: 0,
        error: result.error,
      });
    } else {
      for (const t of result.tests) {
        out.push({ ...t, file });
      }
    }
  }
  return out;
}
