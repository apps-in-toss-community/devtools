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

import { parseArgs } from 'node:util';
import type { AttachDeps, PrepareAttachResult } from '../mcp/attach-orchestrator.js';
import { prepareAttach, renderAndMaybeWait } from '../mcp/attach-orchestrator.js';
import type { CdpConnection } from '../mcp/cdp-connection.js';
import { injectGlobals } from './cell.js';
import { discoverTestFiles } from './discover.js';
import type { RelayRunOptions, RelayRunReport } from './relay-worker.js';
import { runTestFilesOverRelay } from './relay-worker.js';

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
  --timeout <ms>          Per-file evaluate timeout in ms (default: 30000)
  --cell-sdk-line <line>  SDK line to inject as __AIT_CELL__.sdkLine (2.x|3.x)
  --cell-platform <plat>  Platform to inject as __AIT_CELL__.platform
                          (mock|ios|android, default: AIT_CELL_PLATFORM env)
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

  The test files run against the live relay connection started by this process;
  no separate MCP daemon is required.

EXAMPLE
  devtools-test 'src/**/*.ait.test.ts' \\
    --scheme-url "intoss-private://..." \\
    --cell-platform ios \\
    --timeout 60000

`.trimStart();

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
    const { totals } = report;
    process.stdout.write(
      `\ndevtools-test: ${totals.passed} passed, ${totals.failed} failed, ${totals.skipped} skipped (${report.duration}ms)\n`,
    );
  }

  return report;
}

/* -------------------------------------------------------------------------- */
/* main() — CLI entry point                                                    */
/* -------------------------------------------------------------------------- */

/**
 * CLI entry point.
 *
 * Performs a standalone relay attach → run lifecycle:
 *
 * 1. Parse args: globs, --timeout, --cell-sdk-line, --cell-platform,
 *    --scheme-url (required for env3), --headless, --project-root.
 * 2. Discover test files; exit 1 if none.
 * 3. Load .ait_relay secret into AIT_DEBUG_TOTP_SECRET, then boot relay family.
 * 4. Assemble AttachDeps (no qrHttpServer → text QR).
 * 5. prepareAttach(deps, 'relay-dev', { scheme_url }, conn).
 * 6. renderAndMaybeWait(deps, prep, true, timeoutMs, conn) — text QR + wait.
 * 7. If cell flags present, injectGlobals({ __AIT_CELL__: cell }) before run.
 * 8. runWithConnection(conn, files, { timeoutMs, printSummary: true }).
 * 9. family.stop(); process.exitCode = failed > 0 ? 1 : 0.
 *
 * The CLI is not a daemon — no lock, router, SSE, or tools_list is needed.
 * Attach timeout exits with code 1; test failures exit with code 1.
 *
 * SECRET-HANDLING: scheme_url / relay wssUrl / TOTP codes are never written to
 * stdout/stderr directly. text QR renders via renderAndMaybeWait which encodes
 * the TOTP `at=` code inside the QR payload (not in plain log lines).
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
        'scheme-url': { type: 'string' },
        'cell-sdk-line': { type: 'string' },
        'cell-platform': { type: 'string' },
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
  const rawTimeout = typeof vals.timeout === 'string' ? vals.timeout : undefined;
  const timeoutMs = rawTimeout !== undefined ? parseInt(rawTimeout, 10) : 30_000;
  if (Number.isNaN(timeoutMs) || timeoutMs <= 0) {
    process.stderr.write(`devtools-test: --timeout must be a positive integer\n`);
    process.exitCode = 1;
    return;
  }

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

  // Cell: --cell-sdk-line and --cell-platform (fall back to AIT_CELL_PLATFORM env).
  const cellSdkLine = typeof vals['cell-sdk-line'] === 'string' ? vals['cell-sdk-line'] : undefined;
  const cellPlatform =
    typeof vals['cell-platform'] === 'string'
      ? vals['cell-platform']
      : process.env.AIT_CELL_PLATFORM;
  const hasCell = cellSdkLine !== undefined || cellPlatform !== undefined;

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

  // ── Step 3: load .ait_relay secret, then boot relay family ───────────────
  // loadRelaySecretReadOnly reads <projectRoot>/.ait_relay and loads the value
  // into process.env.AIT_DEBUG_TOTP_SECRET (read-only, never mints).
  // Must be called BEFORE bootRelayFamily so assertRelayAuthConfigured() passes.
  // SECRET-HANDLING: the secret value is never logged here.
  const { loadRelaySecretReadOnly } = await import('../mcp/relay-secret-store.js');
  await loadRelaySecretReadOnly({ projectRoot });

  const { bootRelayFamily, buildRelayVerifyAuth } = await import('../mcp/debug-server.js');

  let family: Awaited<ReturnType<typeof bootRelayFamily>>;
  try {
    family = await bootRelayFamily({ verifyAuth: buildRelayVerifyAuth() });
  } catch (e) {
    process.stderr.write(
      `devtools-test: failed to boot relay: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  // Ensure cleanup on early exit.
  let exitCode = 0;
  try {
    // ── Step 4: assemble AttachDeps ─────────────────────────────────────────
    // qrHttpServer=undefined → text QR (no dashboard; CLI is not a daemon).
    // onAttachUrlBuilt=undefined → no SSE push.
    // canOpenBrowser=()=>!headless → respects --headless flag.
    const attachDeps: AttachDeps = {
      getTunnelStatus: family.getTunnelStatus ?? (() => ({ up: false, wssUrl: null })),
      getTotpSecret: () => process.env.AIT_DEBUG_TOTP_SECRET,
      qrHttpServer: undefined,
      onAttachUrlBuilt: undefined,
      canOpenBrowser: () => !headless,
    };

    // ── Step 5: prepareAttach ───────────────────────────────────────────────
    const prep: PrepareAttachResult = await prepareAttach(
      attachDeps,
      'relay-dev',
      { scheme_url: schemeUrl },
      family.connection,
    );

    if (!prep.ok) {
      const errText = prep.error.content
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .map((c) => c.text)
        .join('\n');
      process.stderr.write(`devtools-test: attach preparation failed:\n${errText}\n`);
      // Use the local `exitCode` (not `process.exitCode`) — the `finally`
      // block below sets `process.exitCode = exitCode`, so writing
      // `process.exitCode` directly here would be clobbered back to 0,
      // turning an attach-prep failure into a false success. (Matches the
      // timeout branch below.)
      exitCode = 1;
      return;
    }

    // ── Step 6: renderAndMaybeWait — text QR + wait for phone ──────────────
    // waitForAttach=true → wait until a matching page attaches (or timeout).
    // renderAndMaybeWait handles TOTP re-mint between segments automatically.
    // SECRET-HANDLING: the function never logs scheme/wss/TOTP values.
    const waitResult = await renderAndMaybeWait(
      attachDeps,
      prep,
      true,
      timeoutMs,
      family.connection,
    );

    if (waitResult.isError) {
      // Timeout or attach error — print the diagnostic text and exit.
      const errText = waitResult.content
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .map((c) => c.text)
        .join('\n');
      process.stderr.write(`devtools-test: attach timed out or failed:\n${errText}\n`);
      exitCode = 1;
      return;
    }

    // Print the success output (QR + pages snapshot) from renderAndMaybeWait.
    for (const chunk of waitResult.content) {
      if (chunk.type === 'text') {
        process.stdout.write(`${chunk.text}\n`);
      }
    }

    // ── Step 7: inject cell globals (before first bundle inject) ───────────
    // Cell is session-global: one inject covers all test files in this run.
    // devtools does NOT know the __AIT_CELL__ shape — it passes the object as-is.
    // SECRET-HANDLING: cell values are not secrets; logging them is caller's choice.
    if (hasCell) {
      const cell: Record<string, string> = {};
      if (cellSdkLine !== undefined) cell.sdkLine = cellSdkLine;
      if (cellPlatform !== undefined) cell.platform = cellPlatform;
      process.stderr.write(`devtools-test: injecting __AIT_CELL__ = ${JSON.stringify(cell)}\n`);
      await injectGlobals(family.connection, { __AIT_CELL__: cell });
    }

    // ── Step 8: run test files ──────────────────────────────────────────────
    const report = await runWithConnection(family.connection, files, {
      timeoutMs,
      printSummary: true,
    });

    exitCode = report.totals.failed > 0 ? 1 : 0;
  } finally {
    // ── Step 9: teardown ────────────────────────────────────────────────────
    // family.stop() is synchronous best-effort: closes the CDP connection and
    // shuts down the relay + cloudflared child. No await needed.
    family.stop();
    process.exitCode = exitCode;
  }
}

// Run main() when executed as a binary (not imported as a module).
// Node ESM: `import.meta.url === pathToFileURL(process.argv[1]).href` is the
// canonical "am I the main module?" check.
if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  main().catch((e: unknown) => {
    process.stderr.write(
      `devtools-test: unexpected error: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    process.exitCode = 1;
  });
}
