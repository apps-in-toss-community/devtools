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
import { discoverTestFiles, MANUAL_TEST_SUFFIX, partitionManualTests } from './discover.js';
import { createRelayConnectionFactory } from './relay-factory.js';
import type { RelayRunOptions, RelayRunReport } from './relay-worker.js';
import { runTestFilesOverRelay } from './relay-worker.js';
import { writeCaptureArtifacts, writeReportArtifact } from './report.js';
import { armExitBackstop, runTeardownSteps } from './teardown.js';

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
                          their phone. Omit (default) to wait indefinitely — the
                          runner stays up until you stop it (Ctrl-C/SIGTERM).
                          Pass a value to bound the wait for CI/headless runs.
  --cell-sdk-line <line>  SDK line to inject as __AIT_CELL__.sdkLine (2.x|3.x)
  --cell-platform <plat>  Platform to inject as __AIT_CELL__.platform
                          (mock|ios|android, default: AIT_CELL_PLATFORM env)
  --report-dir <dir>      Persist a runner-agnostic report + captures to <dir>
                          (report: <sdkLine>.<platform>.json; captures:
                          <dir>/.ait-capture/<category>.<sdkLine>.<platform>.json).
                          Omitted = nothing saved. Enables console capture.
  --dashboard-port <port> Base port for the QR dashboard HTTP server. On
                          EADDRINUSE it increments (+1, up to 20 tries) before
                          falling back to an ephemeral port. Omit to use
                          AIT_DEBUG_HTTP_PORT env or the built-in default
                          (8317) — pass 0 to force a random ephemeral port.
  --no-qr-stdout          Suppress the QR/attach block on stdout (auto-on for
                          non-interactive stdout / CI / AIT_NO_QR_STDOUT)
  --headless              Disable browser auto-open (text QR only)
  --project-root <dir>    Project root for .ait_relay secret lookup
                          (default: current working directory)
  --pace <ms>             Minimum delay in ms between test-to-test AND
                          file-to-file bridge calls (default: 0, i.e. no
                          added delay — today's behavior byte-for-byte).
                          Falls back to the AIT_PACE env var when omitted
                          (--pace takes precedence over the env var when both
                          are given). Use on a 2.x cell scan when the native
                          per-method bridge rate limit (APP_BRIDGE_THROTTLED,
                          devtools#767) is rejecting rapid same-method calls —
                          3.x cells are unaffected by that limiter and do not
                          need this flag.
  --pace-method <ms>      Minimum delay in ms BETWEEN calls to the SAME named
                          SDK function — paces a same-method burst WITHIN a
                          single test body (e.g. a clipboard happy-path loop
                          calling setClipboardText/getClipboardText 8 times
                          back to back), which --pace's test/file spacing
                          cannot reach (devtools#769). Falls back to the
                          AIT_PACE_METHOD env var when omitted (--pace-method
                          takes precedence over the env var when both are
                          given). Default: 250ms when --cell-sdk-line is 2.x
                          (unset --cell-sdk-line also defaults to 2.x — see
                          --cell-sdk-line), 0 (no added delay) otherwise. Pass
                          --pace-method 0 to opt out even on a 2.x cell.
  --manual-blocking       Run manual-tagged test files (*.manual.ait.test.ts)
                          LAST, after all regular files, with a human present.
                          Before each manual file, the QR dashboard is pushed
                          a step-by-step Korean prompt naming the file + its
                          progress (k/n), and the same line is printed to
                          stdout. Manual files get a 5-minute per-file evaluate
                          timeout (vs. --timeout for everything else) since a
                          human is expected to tap through a native sheet
                          (photo picker, permission dialog, fullscreen ad).
                          Without this flag (default off), *.manual.ait.test.ts
                          files are EXCLUDED from the glob expansion entirely —
                          existing unattended runs are byte-for-byte unaffected.
                          With --report-dir, a run that included manual files
                          ALSO writes <sdkLine>.<platform>.manual.json
                          alongside (never replacing) the standard report, and
                          each manual file's report entry is stamped
                          mode: 'manual' — never diff a manual run against an
                          unattended baseline as if they were equivalent.
  --stub-blocking         Run manual-tagged test files (*.manual.ait.test.ts)
                          UNATTENDED (devtools#740, DT-2) by intercepting a
                          fixed allowlist of blocking-UI SDK calls (ads
                          show*, openPermissionDialog/requestPermission,
                          saveBase64Data) in the page and answering them from
                          fixtures captured by a real --manual-blocking run,
                          instead of forwarding them to native UI. Implies
                          --manual-blocking (manual files are included in the
                          run); no human presence or QR-dashboard prompt is
                          needed for them. HYBRID cell, not pure env3 — every
                          other SDK call in the same run still hits the real
                          native bridge. With --report-dir, files that ran
                          under the stub are written to a SEPARATE
                          <sdkLine>.<platform>.stubbed.json artifact (never
                          merged into the standard or .manual.json report) and
                          the report body is stamped cell.bridgeStub: true —
                          never diff a stubbed run against a real device
                          baseline (manual or unattended) as if equivalent.
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

/**
 * Grace period (ms) for the exit backstop armed around Step 6 teardown
 * (devtools#755). See `teardown.ts`'s module doc for the root-cause writeup
 * — the two upstream `http.Server#close()` hangs are fixed at the source, so
 * this backstop is a last-mile safety net that should never fire in
 * practice. Exported so tests can assert the backstop is armed with the
 * expected value without hardcoding the literal twice.
 */
export const EXIT_BACKSTOP_GRACE_MS = 3_000;

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
   * supplied. `undefined` signals "let relay-factory.ts's default govern" —
   * which is an UNBOUNDED wait (devtools#735): the runner stays up until the
   * user stops it (Ctrl-C/SIGTERM). We intentionally do not inline that
   * default here so the factory remains the single source of truth for it.
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

/**
 * Parses the `--dashboard-port` raw string value into a validated port
 * number, or `undefined` when the flag was omitted (letting relay-factory /
 * qr-http-server resolve their own default — env then the built-in fixed
 * default, devtools#752).
 *
 * `0` is a valid, meaningful value (explicit opt-out to pure ephemeral) and
 * is passed through as-is — it must NOT be confused with "omitted".
 *
 * Returns an error string on invalid input (non-integer, negative, or
 * >65535), or the resolved port on success. Exported for unit testing.
 */
export function resolveDashboardPort(raw: string | undefined): number | undefined | string {
  if (raw === undefined) return undefined;
  const port = parseInt(raw, 10);
  if (Number.isNaN(port) || port < 0 || port > 65535) {
    return '--dashboard-port must be an integer between 0 and 65535';
  }
  return port;
}

/**
 * Rewrites a lone `--pace <value>` or `--pace-method <value>` pair from space
 * syntax to `=` syntax (`--pace=<value>` / `--pace-method=<value>`) when
 * `<value>` starts with `-` (devtools#768 review; extended to `--pace-method`
 * in devtools#769).
 *
 * Node's `util.parseArgs` treats a `type: 'string'` option's value as
 * "ambiguous" and throws its OWN parser error whenever that value starts with
 * a dash and was passed via the space form (`--pace -1`) — it never reaches
 * this module's `resolvePace`/`resolvePaceMethod`, so the friendly
 * `'--pace must be a non-negative integer'` message (and its unit-tested path)
 * was unreachable from the real CLI entry point for the single most natural
 * way a user would try a negative value, even though every other flag in
 * {@link USAGE} is documented in space syntax.
 *
 * Scoped narrowly to `--pace`/`--pace=...` and `--pace-method`/
 * `--pace-method=...` tokens only — every other flag is untouched, and
 * positionals/other options keep flowing through `parseArgs` unchanged. Only
 * rewrites the space form; `--pace=-1`/`--pace-method=-1` already parse fine
 * and are passed through untouched.
 *
 * Exported for unit testing.
 */
export function normalizePaceArgv(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (
      (arg === '--pace' || arg === '--pace-method') &&
      next !== undefined &&
      next.startsWith('-') &&
      next !== '--'
    ) {
      out.push(`${arg}=${next}`);
      i++; // consume the value token too
      continue;
    }
    out.push(arg);
  }
  return out;
}

/**
 * Parses `--pace` (falling back to the `AIT_PACE` env var when the flag is
 * omitted) into a validated millisecond delay (devtools#767).
 *
 * Opt-in, zero-diff-when-absent: BOTH omitted resolves to `0` — no pacing —
 * which is byte-for-byte today's behavior (`runtime.ts` treats `0`/absent
 * `__AIT_PACE_MS__` identically, and `relay-worker.ts`'s file-to-file gap is
 * skipped entirely when the resolved value is 0). `--pace` takes precedence
 * over `AIT_PACE` when both are present, mirroring `--cell-platform` /
 * `AIT_CELL_PLATFORM`'s existing flag-over-env precedent.
 *
 * Returns an error string on invalid input (non-integer or negative), or the
 * resolved delay (`>= 0`) on success. Exported for unit testing.
 */
export function resolvePace(
  rawFlag: string | undefined,
  rawEnv: string | undefined,
): number | string {
  const raw = rawFlag ?? rawEnv;
  if (raw === undefined) return 0;
  const ms = parseInt(raw, 10);
  if (Number.isNaN(ms) || ms < 0) {
    return '--pace must be a non-negative integer';
  }
  return ms;
}

/**
 * The sdkLine-aware default for `--pace-method` when the flag AND
 * `AIT_PACE_METHOD` are both omitted (devtools#769 acceptance criteria):
 * `250` for a 2.x cell, `0` (no added delay) for everything else. This is the
 * SAME 250ms preflight-proven-safe value `cell.ts#PROBE_INTER_CALL_DELAY_MS`
 * uses — not re-derived, just referenced by value, since `cell.ts` is not
 * imported here to avoid pulling its heavier CDP-typed graph onto this
 * string-only resolver. `resolvedCellSdkLine` mirrors the same '2.x' fallback
 * `main()` applies when `--cell-sdk-line` is omitted (`cell.sdkLine`, below)
 * — an unspecified cell is treated as 2.x, the conservative default that also
 * governs the permission preflight's own pacing (`cell.ts`'s
 * `preflightSdkLine` doc).
 *
 * Exported for unit testing.
 */
export const DEFAULT_PACE_METHOD_MS_2X = 250;

/**
 * Parses `--pace-method` (falling back to the `AIT_PACE_METHOD` env var when
 * the flag is omitted) into a validated millisecond per-method minimum
 * interval (devtools#769).
 *
 * Precedence, highest first: `--pace-method` flag > `AIT_PACE_METHOD` env >
 * sdkLine-aware default (`{@link DEFAULT_PACE_METHOD_MS_2X}` for a 2.x cell,
 * `0` otherwise) — an EXPLICIT flag or env value always wins, including
 * `--pace-method 0` to opt out on a 2.x cell. Mirrors `resolvePace`'s
 * flag-over-env precedent, with the sdkLine default spliced in only when
 * BOTH are absent.
 *
 * Returns an error string on invalid input (non-integer or negative), or the
 * resolved delay (`>= 0`) on success. Exported for unit testing.
 *
 * @param rawFlag        - The raw `--pace-method` string value, if passed.
 * @param rawEnv         - The raw `AIT_PACE_METHOD` env value, if set.
 * @param resolvedCellSdkLine - The effective `cell.sdkLine` value (already
 *   defaulted to '2.x' by the caller when `--cell-sdk-line` was omitted — see
 *   `main()`'s `cell` construction) — used ONLY to pick the sdkLine-aware
 *   default when both `rawFlag` and `rawEnv` are absent.
 */
export function resolvePaceMethod(
  rawFlag: string | undefined,
  rawEnv: string | undefined,
  resolvedCellSdkLine: string,
): number | string {
  const raw = rawFlag ?? rawEnv;
  if (raw === undefined) {
    return resolvedCellSdkLine === '2.x' ? DEFAULT_PACE_METHOD_MS_2X : 0;
  }
  const ms = parseInt(raw, 10);
  if (Number.isNaN(ms) || ms < 0) {
    return '--pace-method must be a non-negative integer';
  }
  return ms;
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
 *    env3), --report-dir, --dashboard-port, --no-qr-stdout, --headless,
 *    --project-root.
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
      // devtools#768 review: rewrite `--pace -1` (space syntax) to
      // `--pace=-1` before parseArgs sees it — otherwise Node's parser throws
      // its own "ambiguous option" error for a leading-dash value passed via
      // space syntax, and resolvePace's friendly validation message (below)
      // is never reached for that natural invocation. See normalizePaceArgv.
      args: normalizePaceArgv(argv),
      options: {
        help: { type: 'boolean', short: 'h' },
        timeout: { type: 'string' },
        'attach-timeout': { type: 'string' },
        'scheme-url': { type: 'string' },
        'cell-sdk-line': { type: 'string' },
        'cell-platform': { type: 'string' },
        'report-dir': { type: 'string' },
        'dashboard-port': { type: 'string' },
        'no-qr-stdout': { type: 'boolean' },
        headless: { type: 'boolean' },
        'project-root': { type: 'string' },
        pace: { type: 'string' },
        'pace-method': { type: 'string' },
        'manual-blocking': { type: 'boolean' },
        'stub-blocking': { type: 'boolean' },
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
  const dashboardPort = resolveDashboardPort(
    typeof vals['dashboard-port'] === 'string' ? vals['dashboard-port'] : undefined,
  );
  if (typeof dashboardPort === 'string') {
    process.stderr.write(`devtools-test: ${dashboardPort}\n`);
    process.exitCode = 1;
    return;
  }
  const paceMs = resolvePace(
    typeof vals.pace === 'string' ? vals.pace : undefined,
    process.env.AIT_PACE,
  );
  if (typeof paceMs === 'string') {
    process.stderr.write(`devtools-test: ${paceMs}\n`);
    process.exitCode = 1;
    return;
  }
  const suppressQr = shouldSuppressQr(vals['no-qr-stdout'] === true);
  // devtools#740 (DT-2): --stub-blocking IMPLIES --manual-blocking (manual
  // files must be discovered/included for there to be anything to stub) —
  // a user who passes --stub-blocking alone should not have to also
  // remember --manual-blocking for it to do anything.
  const stubBlocking = vals['stub-blocking'] === true;
  const manualBlocking = vals['manual-blocking'] === true || stubBlocking;

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

  // devtools#769: sdkLine-aware default (250ms on a 2.x cell, 0 otherwise) —
  // resolved AFTER `cell` above so `cell.sdkLine`'s own '2.x' fallback (when
  // --cell-sdk-line is omitted) feeds the default. An explicit --pace-method
  // flag or AIT_PACE_METHOD env always takes precedence over that default,
  // including --pace-method 0 to opt out on a 2.x cell.
  const paceMethodMs = resolvePaceMethod(
    typeof vals['pace-method'] === 'string' ? vals['pace-method'] : undefined,
    process.env.AIT_PACE_METHOD,
    cell.sdkLine,
  );
  if (typeof paceMethodMs === 'string') {
    process.stderr.write(`devtools-test: ${paceMethodMs}\n`);
    process.exitCode = 1;
    return;
  }

  // ── Step 2: discover test files ───────────────────────────────────────────
  const globs = parsed.positionals;
  if (globs.length === 0) {
    process.stderr.write(`devtools-test: at least one glob pattern is required\n`);
    process.stdout.write(USAGE);
    process.exitCode = 1;
    return;
  }

  // Tagging contract (devtools#741): *.manual.ait.test.ts files are excluded
  // from discovery unless --manual-blocking is passed, in which case they are
  // included and then scheduled strictly AFTER every regular file below —
  // this is the entire "manual-variant" ordering guarantee.
  const discovered = await discoverTestFiles(globs, process.cwd(), {
    includeManual: manualBlocking,
  });
  if (discovered.length === 0) {
    process.stderr.write(`devtools-test: no test files matched ${globs.join(', ')}\n`);
    process.exitCode = 1;
    return;
  }
  const { regular, manual } = partitionManualTests(discovered);
  // Manual files always run LAST, regardless of the discovery/glob order —
  // `files` below is what's actually injected, in run order.
  const files = manualBlocking ? [...regular, ...manual] : regular;
  const manualFileSet = new Set(manual);
  process.stderr.write(
    manualBlocking && manual.length > 0
      ? `devtools-test: found ${regular.length} regular + ${manual.length} manual (${MANUAL_TEST_SUFFIX}) test file(s)\n`
      : `devtools-test: found ${files.length} test file(s)\n`,
  );

  // ── Step 3: open the relay connection via the shared factory ──────────────
  // The factory boots the relay, renders the QR, waits for the phone, injects
  // the cell, and enables CDP domains — the same assembly the Vitest pool uses.
  // We pass `onQrContent` so the CLI owns the stdout decision: suppress the whole
  // QR block on non-interactive stdout (it encodes the relay wss + TOTP code).
  // SECRET-HANDLING: scheme_url / wss / TOTP are never logged by the factory.
  if (hasCell) {
    process.stderr.write(`devtools-test: injecting __AIT_CELL__ = ${JSON.stringify(cell)}\n`);
  }
  if (stubBlocking) {
    process.stderr.write(
      'devtools-test: --stub-blocking enabled — blocking-UI calls in manual-tagged ' +
        'files will be answered from fixtures (devtools#740), not forwarded to native UI\n',
    );
  }
  if (paceMs > 0) {
    process.stderr.write(`devtools-test: --pace ${paceMs}ms enabled (devtools#767)\n`);
  }
  if (paceMethodMs > 0) {
    process.stderr.write(`devtools-test: --pace-method ${paceMethodMs}ms enabled (devtools#769)\n`);
  }
  const factory = createRelayConnectionFactory({
    schemeUrl,
    projectRoot,
    // attachTimeoutMs is only forwarded when the user explicitly passed
    // --attach-timeout; otherwise we omit it so relay-factory.ts's built-in
    // UNBOUNDED default governs (devtools#735) — single source of truth.
    ...(attachTimeoutMs !== undefined ? { timeoutMs: attachTimeoutMs } : {}),
    // dashboardPort is only forwarded when the user explicitly passed
    // --dashboard-port; otherwise omit so relay-factory/qr-http-server's own
    // default resolution governs (env → fixed default, devtools#752).
    ...(dashboardPort !== undefined ? { dashboardPort } : {}),
    headless,
    cell: hasCell ? cell : undefined,
    stubBlocking,
    paceMs,
    paceMethodMs,
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
      // devtools#767: runner-side (file-to-file) half of --pace. 0 (default)
      // is forwarded as-is — relay-worker.ts's own `paceMs > 0` guard treats
      // it identically to omitted.
      paceMs,
      // devtools#767 acceptance criteria 2: tells the permission preflight
      // whether to pace its probes. `cell.sdkLine` defaults to '2.x' (see
      // above) when the user didn't pass --cell-sdk-line, which keeps pacing
      // ON by default — only an explicit '3.x' cell skips it.
      preflightSdkLine: cell.sdkLine,
      manualFiles: manualBlocking && manualFileSet.size > 0 ? manualFileSet : undefined,
      // devtools#740 (DT-2): same file set as manualFiles when --stub-blocking
      // is on — stubBlockingFiles takes precedence in relay-worker.ts, so
      // these files run unattended (regular timeout, no dashboard prompt,
      // mode: 'stubbed') even though they are also present in manualFileSet.
      stubBlockingFiles: stubBlocking && manualFileSet.size > 0 ? manualFileSet : undefined,
      // #741: before each manual file, push the dashboard prompt AND print
      // the same Korean instruction line to stdout (human may be watching
      // either surface). Clearing the prompt (dashboard only) happens once
      // the whole run ends, in the finally block below — a manual file is
      // always the tail of `files`, so there is no "next regular file" to
      // clear it for mid-run.
      onManualFile: (file, index, total) => {
        const name = basename(file);
        process.stdout.write(
          `수동 단계: ${name} — 폰에서 네이티브 시트가 뜨면 안내에 따라 조작하세요 (${index}/${total})\n`,
        );
        factory.onManualPrompt?.({ file: name, index, total });
      },
    });

    // Clear the dashboard's manual prompt now that the run (including any
    // manual tail) has finished — leaves no stale "수동 단계" banner up once
    // the human is done.
    if (manualBlocking && manualFileSet.size > 0) {
      factory.onManualPrompt?.(null);
    }

    // ── Step 5: persist artifacts (only with --report-dir) ──────────────────
    if (reportDir !== undefined) {
      try {
        const reportPaths = await writeReportArtifact(report, reportDir, {
          sdkLine: cell.sdkLine,
          platform: cell.platform,
          projectRoot,
        });
        for (const reportPath of reportPaths) {
          process.stderr.write(`devtools-test: wrote report ${reportPath}\n`);
        }
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
    // ── Step 6: teardown (devtools#755) ─────────────────────────────────────
    // #730: mark the dashboard 'complete' BEFORE close() so the terminal SSE
    // frame reaches any open dashboard tab before the HTTP server is closed.
    // Redundant-but-safe with close()'s own internal push (belt-and-suspenders
    // so the frame flushes even if the two ever run in a different order).
    factory.onSessionPhase?.('complete');

    // Bounded backstop (devtools#755): arm BEFORE the teardown steps run, so
    // even a step that hangs past its own per-step timeout cannot leave the
    // process running forever. The two known root causes of the run7~10 hang
    // (dashboard SSE tab + relay WS leg blocking http.Server#close()) are
    // fixed at the source (qr-http-server.ts, chii-relay.ts) — this backstop
    // exists for any OTHER handle outside those two files' control and
    // should not fire in normal operation.
    const backstop = armExitBackstop({ graceMs: EXIT_BACKSTOP_GRACE_MS, exitCode });

    // factory.close() stops the relay family (closes the CDP connection +
    // shuts down the relay + cloudflared child) and closes the QR HTTP
    // server. Wrapped in a single named step so a hang here cannot silently
    // block process exit — runTeardownSteps bounds it and the outer backstop
    // covers anything runTeardownSteps itself cannot enumerate.
    await runTeardownSteps([
      {
        name: 'factory.close',
        close: () => factory.close(connection),
      },
    ]);

    // Happy path: teardown finished within its own bounds — disarm the
    // backstop so the process exits naturally at process.exitCode instead of
    // waiting out the full grace period.
    backstop.disarm();
    process.exitCode = exitCode;
  }
}
