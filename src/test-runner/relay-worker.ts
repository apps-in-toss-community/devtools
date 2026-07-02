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
 * The per-file timeout is inherited from `injectAndRunBundle` (default 60 s).
 * For suites that exceed it, split the file into smaller pieces.
 *
 * SECRET-HANDLING: file paths are surfaced in reports; relay URLs are not.
 */

import type { CdpConnection, ConsoleApiCalledEvent } from '../mcp/cdp-connection.js';
import { isRelayDisconnectMessage } from '../mcp/chii-connection.js';
import { type BundleOptions, bundleTestFile } from './bundle.js';
import { type AitCaptureLine, parseCaptureLines } from './capture.js';
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
  /**
   * `__AIT_CAPTURE__` lines harvested from the page console during the run
   * (additive field, devtools#696). Empty unless `collectCaptures` was set.
   * Each entry is opaque (`{ category, json }`) — devtools does not interpret
   * the record shape, only forwards it for downstream 2.x↔3.0 diffing.
   *
   * SECRET-HANDLING: only lines matching the `__AIT_CAPTURE__ ` allowlist
   * prefix reach here; relay/wss/scheme noise lines are dropped in
   * `parseCaptureLines`.
   */
  captures: AitCaptureLine[];
}

/** Options for `runTestFilesOverRelay`. */
export interface RelayRunOptions {
  /**
   * Options forwarded to `bundleTestFile` for each file.
   */
  bundleOptions?: BundleOptions;
  /**
   * Per-file evaluate timeout in milliseconds. Defaults to 60 000 (rpc.ts
   * DEFAULT_TIMEOUT_MS). Increase for long-running suites or split the file.
   */
  timeoutMs?: number;
  /**
   * When `true`, registers a live `Runtime.consoleAPICalled` listener for the
   * duration of the run and harvests `__AIT_CAPTURE__` lines into
   * `RelayRunReport.captures`. Defaults to **false** so the build-only
   * eval/e2e path (and the Vitest pool) pay no listener/state overhead —
   * `captures` is then an empty array.
   *
   * The listener is registered just BEFORE the first file runs and removed in a
   * `finally` so it never accumulates across runs (no ring-buffer drain — the
   * default 500-entry buffer would silently drop lines via `shift`).
   */
  collectCaptures?: boolean;
}

/**
 * Sentinel string embedded in the error message by `injectAndRunBundle` when
 * the per-file evaluate race hits the timeout. Used by the retry guard so only
 * genuine timeouts get a second attempt — not bundle errors or parse failures.
 *
 * Exported for unit tests that assert the retry path is taken.
 */
export const EVALUATE_TIMEOUT_MARKER = 'rpc: evaluate timed out after';

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

  // Enable CDP domains ONCE up front. Without this the relay connection has not
  // opened its client websocket, so the very first `Runtime.evaluate` (in
  // `injectAndRunBundle`) explodes AND `Runtime.consoleAPICalled` never streams
  // — the console capture harvest would be structurally 0. `enableDomains()` is
  // idempotent (see chii-connection: early-returns when the ws is already OPEN,
  // and shares an in-flight promise), so calling it here is safe even when a
  // caller (the MCP `run_tests` path) already enabled it.
  //
  // Failure here (e.g. no target attached yet) must NOT throw the whole run: the
  // per-file inject below produces a structured error result instead. We warn on
  // stderr (secret-free) and continue. SECRET-HANDLING: the message names the
  // failure only — no relay/wss URL.
  let domainsEnabled = false;
  try {
    await connection.enableDomains();
    domainsEnabled = true;
  } catch (e) {
    process.stderr.write(
      `relay-worker: enableDomains() failed before run — console capture may be empty (${
        e instanceof Error ? e.message : String(e)
      })\n`,
    );
  }

  // Live console capture (#696): when requested, accumulate every
  // `Runtime.consoleAPICalled` event into a local array via a LIVE listener
  // registered just before the run. We deliberately do NOT drain
  // `getBufferedEvents` after the fact — that ring buffer caps at 500 and
  // `shift()`s older entries, so a chatty run would silently lose capture lines.
  // The listener is removed in `finally` so it never bleeds into the next run.
  //
  // Gate the listener on `domainsEnabled`: if enableDomains() soft-failed, the
  // client ws never opened so `Runtime.consoleAPICalled` cannot stream —
  // registering would only add a dead listener that never fires. (The `finally`
  // unsubscribe is an undefined no-op in that case, so this stays safe.)
  const collectCaptures = opts?.collectCaptures === true;
  const liveConsole: ConsoleApiCalledEvent[] = [];
  let unsubscribeConsole: (() => void) | undefined;
  if (collectCaptures && domainsEnabled) {
    unsubscribeConsole = connection.on('Runtime.consoleAPICalled', (event) => {
      liveConsole.push(event);
    });
  }

  // Tracks whether the PREVIOUS file's final result was a WS-dead-class error
  // (relay disconnect). When true, we attempt one `enableDomains()` reconnect
  // before processing the NEXT file — a single dropped socket (e.g. Cloudflare
  // edge idle-drop mid-evaluate) should not cascade into every remaining file
  // failing instantly (#731). `enableDomains()` is idempotent (early-returns
  // when the ws is already OPEN, shares an in-flight promise), so calling it
  // speculatively here is safe.
  let pendingReconnectCheck = false;

  /**
   * Attempts one `enableDomains()` reconnect. Logs the attempt and outcome to
   * stderr. Never throws — a failed reconnect just means the caller proceeds
   * as today (each remaining file / the retry will fail-fast on the still-dead
   * socket).
   *
   * `context` selects the fixed log literal: 'next-file' for the between-files
   * case (a file's FINAL result was a WS-dead-class error — the primary #731
   * scenario), 'retry-precheck' for the defensive reconnect before retrying a
   * timed-out file (cheap no-op via `enableDomains()`'s idempotency when the
   * socket never actually died).
   *
   * SECRET-HANDLING: fixed literals only — no relay wss URL, TOTP code, or
   * tunnel host.
   */
  const attemptReconnect = async (context: 'next-file' | 'retry-precheck'): Promise<void> => {
    process.stderr.write(
      context === 'next-file'
        ? 'relay-worker: relay connection lost — attempting reconnect before next file\n'
        : 'relay-worker: evaluate timed out — attempting reconnect before retry\n',
    );
    try {
      await connection.enableDomains();
      process.stderr.write('relay-worker: reconnect succeeded\n');
    } catch (e) {
      process.stderr.write(
        `relay-worker: reconnect failed (${
          e instanceof Error ? e.message : String(e)
        }) — continuing, remaining files may fail\n`,
      );
    }
  };

  try {
    for (const file of files) {
      if (pendingReconnectCheck) {
        await attemptReconnect('next-file');
        pendingReconnectCheck = false;
      }

      let fileEntry: FileResult;
      try {
        const { code } = await bundleTestFile(file, opts?.bundleOptions);

        /**
         * Runs one evaluate attempt and returns a FileResult, or `null` when the
         * result is a genuine timeout and the caller should retry.
         *
         * We need to distinguish:
         *   - `rpcResult.ok = false` + timeout error → retry candidate (`return null`)
         *   - `rpcResult.ok = false` + other error   → final error, no retry
         *   - `injectAndRunBundle` throws             → CDP exceptionDetails OR a
         *     relay-disconnect rejection from `connection.send()` (page engine
         *     threw, or the ws died mid-evaluate); treated as a final
         *     (non-retryable) error either way.
         *
         * The Promise.race timeout in rpc.ts RETURNS `{ok:false, error: '…'}` (it
         * does NOT throw/reject).  Only genuine CDP `exceptionDetails` (or a dead
         * `connection.send()`) cause a throw. This distinction is what makes the
         * EVALUATE_TIMEOUT_MARKER gate below reachable — the timeout result
         * surfaces as `rpcResult.ok=false` with the marker string, not as a
         * caught exception.
         */
        const attempt = async (): Promise<FileResult | null> => {
          let rpcResult: Awaited<ReturnType<typeof injectAndRunBundle>>;
          try {
            rpcResult = await injectAndRunBundle(connection, code, opts?.timeoutMs);
          } catch (e) {
            // injectAndRunBundle throws for CDP exceptionDetails OR a relay ws
            // death mid-evaluate (connection.send() fail-fast rejection) —
            // either way this attempt is final (non-retryable). The
            // WS-dead-class check below (after `fileEntry` is assigned)
            // arranges the between-files reconnect (#731).
            return {
              file,
              result: { error: e instanceof Error ? e.message : String(e) },
            };
          }

          if (rpcResult.ok) {
            return { file, result: rpcResult.report };
          }

          // Timed-out evaluates get one retry; other errors are final.
          if (rpcResult.error.includes(EVALUATE_TIMEOUT_MARKER)) {
            return null; // signal "retry"
          }
          return { file, result: { error: rpcResult.error } };
        };

        const firstResult = await attempt();
        if (firstResult !== null) {
          fileEntry = firstResult;
        } else {
          // First attempt timed out — the retry-precheck case (#731): the
          // dead-air during a long timeout is exactly what let the Cloudflare
          // edge idle-drop the relay ws in the observed run (permissions:
          // attempt 1 timed out, the retry then hit an already-dead socket).
          // `enableDomains()` is idempotent (no-op when the ws is already
          // OPEN), so a defensive reconnect attempt here is safe even when
          // the socket never actually died — it only costs a wasted round
          // trip on the common "genuinely just slow" case, and it's the only
          // way to catch this class since `CdpConnection` does not expose a
          // public "is the socket alive" probe.
          await attemptReconnect('retry-precheck');
          // First attempt timed out — retry once.  A transient native dialog
          // (camera picker, location permission sheet, GPS cold-fix) may have
          // cleared by now.
          process.stderr.write(`relay-worker: evaluate timed out for ${file} — retrying once\n`);
          const retryResult = await attempt();
          if (retryResult !== null) {
            fileEntry = retryResult;
          } else {
            // Second timeout: build a final error entry.
            fileEntry = {
              file,
              result: {
                // This fallback must equal rpc.ts DEFAULT_TIMEOUT_MS (60_000)
                // so the displayed budget matches what was actually used when
                // the caller omitted opts.timeoutMs (#731).
                error: `${EVALUATE_TIMEOUT_MARKER} ${opts?.timeoutMs ?? 60_000}ms (after retry)`,
              },
            };
          }
        }
      } catch (e) {
        // Capture bundle errors per-file so subsequent files still run.
        fileEntry = {
          file,
          result: { error: e instanceof Error ? e.message : String(e) },
        };
      }

      // If this file's FINAL result is a WS-dead-class error, arrange for a
      // reconnect attempt before the NEXT file (#731) — do not abort the loop.
      if ('error' in fileEntry.result && isRelayDisconnectMessage(fileEntry.result.error)) {
        pendingReconnectCheck = true;
      }

      fileResults.push(fileEntry);
    }
  } finally {
    // Always remove the live listener — leaking it would accumulate across runs
    // on a reused connection (the Vitest pool keeps one connection for the whole
    // run; the MCP daemon keeps one for the session).
    unsubscribeConsole?.();
  }

  // Convert the accumulated console events to `__AIT_CAPTURE__` lines. Each
  // event's args are rendered to a single line text (inlined console rendering —
  // no tools.ts import, to keep this module off the heavy MCP graph), then the
  // allowlist-prefix parser keeps only genuine capture lines.
  const captures = collectCaptures
    ? parseCaptureLines(liveConsole.map((e) => ({ text: renderConsoleLineText(e) })))
    : [];

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
    captures,
  };
}

/**
 * Renders one `Runtime.consoleAPICalled` event to a single line of text, the
 * same way `tools.ts#normalizeConsoleMessage` does (args rendered + space-
 * joined). Inlined here (≈8 lines) so this module avoids importing `tools.ts`,
 * which would drag the heavy MCP/Node graph (server-lock, parent-watcher, …)
 * onto the test-runner entry.
 *
 * SECRET-HANDLING: this only stringifies console args; the caller's
 * allowlist-prefix parser then discards everything that is not a genuine
 * `__AIT_CAPTURE__` line.
 */
function renderConsoleLineText(event: ConsoleApiCalledEvent): string {
  return event.args
    .map((arg) => {
      if (arg.value !== undefined) {
        if (typeof arg.value === 'string') return arg.value;
        try {
          return JSON.stringify(arg.value);
        } catch {
          return String(arg.value);
        }
      }
      if (arg.description !== undefined) return arg.description;
      if (arg.className !== undefined) return arg.className;
      return arg.subtype ?? arg.type;
    })
    .join(' ');
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
