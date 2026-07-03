/**
 * `devtools-test` CLI.
 *
 * Shares test-file discovery with the `run_tests` MCP tool (`discoverTestFiles`)
 * and exposes `runWithConnection` — the pure run core that bundles, injects, and
 * collects each file over a CDP connection. The CLI's `main()` performs a
 * standalone relay attach (boot relay → QR → phone scan → cell inject → run).
 *
 * NOTE: no shebang in this source file — the tsdown entry's `banner` option
 * injects `#!/usr/bin/env node` into the compiled output (same pattern as
 * `src/mcp/cli.ts`).
 */

import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import type { CdpConnection } from '../mcp/cdp-connection.js';
import { discoverTestFiles } from './discover.js';
import { createRelayConnectionFactory } from './relay-factory.js';
import type { RelayRunOptions, RelayRunReport } from './relay-worker.js';
import { runTestFilesOverRelay } from './relay-worker.js';
import { writeCaptureArtifacts, writeReportArtifact } from './report.js';

/* -------------------------------------------------------------------------- */
/* CLI help                                                                    */
/* -------------------------------------------------------------------------- */

const USAGE = `
devtools-test — run mini-app tests on a real device WebView over the CDP relay

USAGE
  devtools-test <glob> [<glob> ...] [options]

OPTIONS
  --scheme-url <url>      intoss-private:// URL from \`ait deploy --scheme-only\`
                          (required for standalone relay attach / env3)
  --timeout <ms>          Per-file evaluate timeout in ms (default: 60000).
                          Controls how long a single test file is allowed to run
                          before it is considered hung. Does NOT affect how long
                          the CLI waits for a human to scan the QR code — use
                          --attach-timeout for that.
  --attach-timeout <ms>   How long to wait for a human to scan the QR code with
                          their phone (default: 600000 — 10 minutes). Omit to
                          use the relay factory's generous default. Decrease for
                          CI environments where a scan should arrive quickly.
  --cell-sdk-line <line>  SDK line to inject as __AIT_CELL__.sdkLine (2.x|3.x)
  --cell-platform <plat>  Platform to inject as __AIT_CELL__.platform
                          (mock|ios|android, default: AIT_CELL_PLATFORM env)
  --report-dir <dir>      Persist a runner-agnostic report + captures to <dir>
                          (report: <sdkLine>.<platform>.json; captures:
                          <dir>/.ait-capture/<category>.<sdkLine>.<platform>.json).
                          Omitted = nothing saved. Enables console capture.
  --no-qr-stdout          Suppress the QR/attach block on stdout (auto-on for
                          non-interactive stdout / CI / AIT_NO_QR_STDOUT)
  --headless              Disable browser auto-open (text QR only)
  --project-root <dir>    Project root for .ait_relay secret lookup
                          (default: current working directory)
  --help, -h              Show this help message

DESCRIPTION
  Boots a Chii relay + cloudflared tunnel, renders a QR code, waits for a real
  device to scan and attach, injects the cell globals (__AIT_CELL__), bundles
  each matched test file with esbuild (SDK imports redirected to window.__sdk),
  injects the bundle into the attached WebView via Runtime.evaluate, and prints
  a summary.

  With --report-dir, also harvests __AIT_CAPTURE__ console lines and writes a
  runner-agnostic report + per-category capture files so 2.x↔3.0 runs can be
  compared offline.

  The test files run against the live relay connection started by this process;
  no separate MCP daemon is required.

EXAMPLE
  devtools-test 'src/**/*.ait.test.ts' \\
    --scheme-url "intoss-private://..." \\
    --cell-sdk-line 3.x \\
    --cell-platform ios \\
    --report-dir .ait-report \\
    --timeout 60000

`.trimStart();

/* -------------------------------------------------------------------------- */
/* Timeout resolution (exported for unit tests)                                */
/* -------------------------------------------------------------------------- */

/**
 * Resolved timeout values derived from raw CLI flag strings.
 *
 * Exported so unit tests can assert the two clocks in isolation without
 * spawning a subprocess.
 */
export interface ResolvedTimeouts {
  /** Per-file evaluate timeout (ms). From --timeout; default 60 000. */
  evaluateTimeoutMs: number;
  /**
   * QR-scan wait timeout (ms), or `undefined` when --attach-timeout was not
   * supplied. `undefined` signals "let relay-factory.ts's 600 000 ms default
   * govern" — we intentionally do not inline that default here so the factory
   * remains the single source of truth for it.
   */
  attachTimeoutMs: number | undefined;
}

/**
 * Parses --timeout and --attach-timeout raw string values into the two
 * distinct clocks.
 *
 * Returns an error string on invalid input, or the resolved timeouts on
 * success. The caller (main) writes the error to stderr and exits 1.
 *
 * Exported for unit testing — main() is the only other caller.
 */
export function resolveTimeouts(
  rawTimeout: string | undefined,
  rawAttachTimeout: string | undefined,
): ResolvedTimeouts | string {
  // Default must match rpc.ts DEFAULT_TIMEOUT_MS (60_000) — the CLI's own
  // fallback used to be 30_000, which silently overrode rpc.ts's 60s bump
  // (#726) on every CLI invocation that omitted --timeout (#731).
  const evaluateTimeoutMs = rawTimeout !== undefined ? parseInt(rawTimeout, 10) : 60_000;
  if (Number.isNaN(evaluateTimeoutMs) || evaluateTimeoutMs <= 0) {
    return '--timeout must be a positive integer';
  }

  const attachTimeoutMs =
    rawAttachTimeout !== undefined ? parseInt(rawAttachTimeout, 10) : undefined;
  if (attachTimeoutMs !== undefined && (Number.isNaN(attachTimeoutMs) || attachTimeoutMs <= 0)) {
    return '--attach-timeout must be a positive integer';
  }

  return { evaluateTimeoutMs, attachTimeoutMs };
}

/* -------------------------------------------------------------------------- */
/* Per-file summary rendering (exported for unit tests)                        */
/* -------------------------------------------------------------------------- */

/**
 * Renders per-file result lines and the aggregate totals line to a string.
 *
 * Each file gets one line:
 *   - Error/timeout:  `FAIL <basename>: <error-class>`
 *   - Pass (0 tests): `OK   <basename>: 0 passed (empty file)`
 *   - Pass:           `OK   <basename>: N passed[, M failed][, K skipped]`
 *
 * The aggregate totals line always follows.
 *
 * SECRET-HANDLING: only `basename(file)` is used — no absolute paths, relay
 * URLs, wss URLs, scheme URLs, or TOTP codes appear in the output. The error
 * string comes from `result.error` which is already secret-free (relay-worker
 * produces only error-class messages like "rpc: evaluate timed out after
 * 30000ms").
 *
 * Exported so unit tests can assert the per-file lines without spawning a
 * subprocess or going through the full relay attach flow.
 */
export function renderSummary(report: RelayRunReport): string {
  const lines: string[] = [];

  for (const { file, result } of report.files) {
    const name = basename(file);
    if ('error' in result) {
      // Timed-out or errored file — the error string is already secret-free
      // (relay-worker only surfaces error-class text, never URLs or codes).
      lines.push(`FAIL ${name}: ${result.error}`);
    } else {
      const parts: string[] = [`${result.passed} passed`];
      if (result.failed > 0) parts.push(`${result.failed} failed`);
      if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
      const suffix = result.passed + result.failed + result.skipped === 0 ? ' (empty file)' : '';
      lines.push(`OK   ${name}: ${parts.join(', ')}${suffix}`);
    }
  }

  const { totals, duration } = report;
  lines.push(
    `\ndevtools-test: ${totals.passed} passed, ${totals.failed} failed, ${totals.skipped} skipped (${duration}ms)`,
  );

  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/* Pure run function (testable without a real relay)                           */
/* -------------------------------------------------------------------------- */

/** Options for `runWithConnection`. */
export interface RunWithConnectionOptions extends RelayRunOptions {
  /** If true, print a summary to stdout. Defaults to false in tests. */
  printSummary?: boolean;
}

/**
 * Runs `files` over `connection` and returns the aggregate report.
 * This pure function is the testable core of the CLI (and is what the
 * `run_tests` MCP tool calls against the daemon's attached connection); it is
 * separate from `main()` so tests can call it without spawning a subprocess.
 */
export async function runWithConnection(
  connection: CdpConnection,
  files: string[],
  opts?: RunWithConnectionOptions,
): Promise<RelayRunReport> {
  const report = await runTestFilesOverRelay(connection, files, opts);

  if (opts?.printSummary) {
    process.stdout.write(`\n${renderSummary(report)}\n`);
  }

  return report;
}

/* -------------------------------------------------------------------------- */
/* main() — CLI entry point                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Decides whether to suppress the QR/attach block on stdout.
 *
 * Suppress when EITHER the user passed `--no-qr-stdout`, OR stdout is not a TTY
 * / `CI` is set / `AIT_NO_QR_STDOUT` is set (non-interactive — a captured stdout
 * must not leak the relay wss + TOTP `at=` code that the QR block encodes). The
 * suppression is whole-chunk: `attachUrl` AND `relayUrl` ride in the same block.
 *
 * Exported for unit testing.
 */
export function shouldSuppressQr(noQrFlag: boolean): boolean {
  return (
    noQrFlag ||
    !process.stdout.isTTY ||
    process.env.CI !== undefined ||
    process.env.AIT_NO_QR_STDOUT !== undefined
  );
}

/**
 * CLI entry point.
 *
 * Performs a standalone relay attach → run lifecycle, sharing the attach
 * assembly with the Vitest pool via `createRelayConnectionFactory` (single
 * source — no drift):
 *
 * 1. Parse args: globs, --timeout (per-file evaluate), --attach-timeout (QR
 *    scan wait), --cell-sdk-line, --cell-platform, --scheme-url (required for
 *    env3), --report-dir, --no-qr-stdout, --headless, --project-root.
 * 2. Discover test files; exit 1 if none.
 * 3. factory.open() — boot relay → render QR (suppressed on non-interactive
 *    stdout) → wait for phone (up to attachTimeoutMs) → inject cell →
 *    enableDomains. Returns the conn.
 * 4. runWithConnection(conn, files, { evaluateTimeoutMs, collectCaptures,
 *    printSummary }).
 * 5. With --report-dir: write the runner-agnostic report + capture files.
 * 6. factory.close(); process.exitCode = failed > 0 ? 1 : 0.
 *
 * The CLI is not a daemon — no lock, router, SSE, or tools_list is needed.
 * Attach timeout exits with code 1; test failures exit with code 1.
 *
 * SECRET-HANDLING: scheme_url / relay wssUrl / TOTP codes are never written to
 * stdout/stderr directly. The QR block (which encodes the TOTP `at=` code) is
 * printed only when stdout is interactive AND not suppressed.
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  // ── Step 1: parse arguments ───────────────────────────────────────────────
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        help: { type: 'boolean', short: 'h' },
        timeout: { type: 'string' },
        'attach-timeout': { type: 'string' },
        'scheme-url': { type: 'string' },
        'cell-sdk-line': { type: 'string' },
        'cell-platform': { type: 'string' },
        'report-dir': { type: 'string' },
        'no-qr-stdout': { type: 'boolean' },
        headless: { type: 'boolean' },
        'project-root': { type: 'string' },
      } as const,
      allowPositionals: true,
    });
  } catch (e) {
    process.stderr.write(`devtools-test: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
    return;
  }

  if (parsed.values.help || argv.length === 0) {
    process.stdout.write(USAGE);
    return;
  }

  // Extract string-typed flags explicitly — parseArgs returns `string | boolean | (string | boolean)[]`
  // for the union `values` type when options have mixed `type` fields, so we
  // narrow each flag here.
  const vals = parsed.values;

  // Resolve the two timeout clocks via the exported pure helper (unit-tested).
  const timeouts = resolveTimeouts(
    typeof vals.timeout === 'string' ? vals.timeout : undefined,
    typeof vals['attach-timeout'] === 'string' ? vals['attach-timeout'] : undefined,
  );
  if (typeof timeouts === 'string') {
    process.stderr.write(`devtools-test: ${timeouts}\n`);
    process.exitCode = 1;
    return;
  }
  const { evaluateTimeoutMs, attachTimeoutMs } = timeouts;

  const schemeUrl = typeof vals['scheme-url'] === 'string' ? vals['scheme-url'] : '';
  if (schemeUrl === '') {
    process.stderr.write(
      `devtools-test: --scheme-url is required for standalone relay attach.\n` +
        `  Pass the intoss-private:// URL from \`ait deploy --scheme-only\`.\n`,
    );
    process.exitCode = 1;
    return;
  }

  const headless = vals.headless === true;
  const projectRoot =
    typeof vals['project-root'] === 'string' ? vals['project-root'] : process.cwd();
  const reportDir = typeof vals['report-dir'] === 'string' ? vals['report-dir'] : undefined;
  const suppressQr = shouldSuppressQr(vals['no-qr-stdout'] === true);

  // Cell: --cell-sdk-line and --cell-platform (fall back to AIT_CELL_PLATFORM env).
  const cellSdkLine = typeof vals['cell-sdk-line'] === 'string' ? vals['cell-sdk-line'] : undefined;
  const cellPlatform =
    typeof vals['cell-platform'] === 'string'
      ? vals['cell-platform']
      : process.env.AIT_CELL_PLATFORM;
  const hasCell = cellSdkLine !== undefined || cellPlatform !== undefined;
  // The cell injected onto the page and the report/capture filename suffix.
  // sdk-example's own fallbacks are '2.x'/'mock'; mirror them when a flag is
  // absent so artifacts still get a stable, meaningful cell suffix.
  const cell = { sdkLine: cellSdkLine ?? '2.x', platform: cellPlatform ?? 'mock' };

  // ── Step 2: discover test files ───────────────────────────────────────────
  const globs = parsed.positionals;
  if (globs.length === 0) {
    process.stderr.write(`devtools-test: at least one glob pattern is required\n`);
    process.stdout.write(USAGE);
    process.exitCode = 1;
    return;
  }

  const files = await discoverTestFiles(globs, process.cwd());
  if (files.length === 0) {
    process.stderr.write(`devtools-test: no test files matched ${globs.join(', ')}\n`);
    process.exitCode = 1;
    return;
  }
  process.stderr.write(`devtools-test: found ${files.length} test file(s)\n`);

  // ── Step 3: open the relay connection via the shared factory ──────────────
  // The factory boots the relay, renders the QR, waits for the phone, injects
  // the cell, and enables CDP domains — the same assembly the Vitest pool uses.
  // We pass `onQrContent` so the CLI owns the stdout decision: suppress the whole
  // QR block on non-interactive stdout (it encodes the relay wss + TOTP code).
  // SECRET-HANDLING: scheme_url / wss / TOTP are never logged by the factory.
  if (hasCell) {
    process.stderr.write(`devtools-test: injecting __AIT_CELL__ = ${JSON.stringify(cell)}\n`);
  }
  const factory = createRelayConnectionFactory({
    schemeUrl,
    projectRoot,
    // attachTimeoutMs is only forwarded when the user explicitly passed
    // --attach-timeout; otherwise we omit it so relay-factory.ts's built-in
    // 600 000 ms default governs (single source of truth for that value).
    ...(attachTimeoutMs !== undefined ? { timeoutMs: attachTimeoutMs } : {}),
    headless,
    cell: hasCell ? cell : undefined,
    onQrContent: (chunks) => {
      if (suppressQr) {
        process.stdout.write('QR suppressed (non-interactive)\n');
        return;
      }
      for (const chunk of chunks) process.stdout.write(`${chunk}\n`);
    },
  });

  let connection: CdpConnection;
  try {
    connection = await factory.open();
  } catch (e) {
    process.stderr.write(`devtools-test: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
    return;
  }

  // Ensure cleanup on early exit.
  let exitCode = 0;
  try {
    // ── Step 4: run test files ──────────────────────────────────────────────
    // #730: mark the dashboard as 'running' before the run starts so the QR
    // page reflects an in-progress session rather than staying 'active' the
    // whole time. collectCaptures is enabled only when a report dir is given
    // (the only sink for captures) — keeps the no-report path free of
    // listener overhead.
    factory.onSessionPhase?.('running');
    const report = await runWithConnection(connection, files, {
      timeoutMs: evaluateTimeoutMs,
      printSummary: true,
      collectCaptures: reportDir !== undefined,
    });

    // ── Step 5: persist artifacts (only with --report-dir) ──────────────────
    if (reportDir !== undefined) {
      try {
        const reportPath = await writeReportArtifact(report, reportDir, {
          sdkLine: cell.sdkLine,
          platform: cell.platform,
          projectRoot,
        });
        process.stderr.write(`devtools-test: wrote report ${reportPath}\n`);
        const capturePaths = await writeCaptureArtifacts(
          report.captures,
          `${reportDir}/.ait-capture`,
          cell,
        );
        if (capturePaths.length > 0) {
          process.stderr.write(`devtools-test: wrote ${capturePaths.length} capture file(s)\n`);
        }
      } catch (e) {
        // Artifact write failure must not mask the test result.
        process.stderr.write(
          `devtools-test: failed to write report artifacts: ${e instanceof Error ? e.message : String(e)}\n`,
        );
      }
    }

    exitCode = report.totals.failed > 0 ? 1 : 0;
  } finally {
    // ── Step 6: teardown ────────────────────────────────────────────────────
    // #730: mark the dashboard 'complete' BEFORE close() so the terminal SSE
    // frame reaches any open dashboard tab before the HTTP server is closed.
    // Redundant-but-safe with close()'s own internal push (belt-and-suspenders
    // so the frame flushes even if the two ever run in a different order).
    factory.onSessionPhase?.('complete');
    // factory.close() stops the relay family (closes the CDP connection +
    // shuts down the relay + cloudflared child).
    await factory.close(connection);
    process.exitCode = exitCode;
  }
}
