/**
 * `devtools-test` CLI — MVP skeleton.
 *
 * Parses argv, prints usage, and delegates to `runTestFilesOverRelay` when
 * a live CDP connection is provided. The relay connection wiring
 * (attach → run → detach) is tracked in issue #645 / #646.
 *
 * MVP contract: `--help` works, `runWithConnection` is a testable pure
 * function, and the binary entry exists in package.json.
 *
 * NOTE: no shebang in this source file — the tsdown entry's `banner` option
 * injects `#!/usr/bin/env node` into the compiled output (same pattern as
 * `src/mcp/cli.ts`).
 */

import { parseArgs } from 'node:util';
import type { CdpConnection } from '../mcp/cdp-connection.js';
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
  --timeout <ms>    Per-file evaluate timeout in ms (default: 30000)
  --help, -h        Show this help message

DESCRIPTION
  Bundles each matched test file with esbuild (SDK imports redirected to
  window.__sdk), injects the bundle into the attached WebView via
  Runtime.evaluate, and returns a RunReport.

  A live CDP relay connection must be active before running tests.
  Use \`/ait debug\` (devtools-mcp) to attach and then call this CLI from
  the same process context.

  Full Vitest pool integration and the \`run_tests\` MCP tool are tracked in
  issues #645 and #646 respectively. This MVP provides the transport layer.

EXAMPLE
  devtools-test 'src/**/*.phone.test.ts' --timeout 60000

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
 * This pure function is the testable core of the CLI; it is separate from
 * `main()` so tests can call it without spawning a subprocess.
 *
 * TODO (#645): add real relay attach/detach lifecycle here (connect via
 * Chii relay URL, call enableDomains, run, then close).
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
 * MVP: prints usage and a "relay attach required" notice. Real relay wiring
 * (resolve CDP URL, attach, run, close) is tracked in issues #645 / #646.
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        help: { type: 'boolean', short: 'h' },
        timeout: { type: 'string' },
      },
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

  // Discovery is shared with the `run_tests` MCP tool (#646) via
  // `discoverTestFiles`, so both expand patterns identically. We resolve the
  // matched files here to give the operator concrete feedback before the
  // (still-pending) relay attach wiring.
  const files = await discoverTestFiles(parsed.positionals, process.cwd());
  if (files.length === 0) {
    process.stderr.write(`devtools-test: no test files matched ${parsed.positionals.join(', ')}\n`);
    process.exitCode = 1;
    return;
  }

  // Relay attach lifecycle (resolve CDP URL, attach, close) is tracked in #645;
  // until then the CLI cannot run on its own. The `run_tests` MCP tool (#646)
  // already runs these files against the daemon's attached connection.
  process.stderr.write(
    `devtools-test: matched ${files.length} test file(s), but direct CLI relay attach is not yet wired.\n` +
      `  Use the devtools-mcp server (\`devtools-mcp\`) to start a debug session,\n` +
      `  then the \`run_tests\` MCP tool to run these files against the attached page.\n` +
      `  Direct CLI relay wiring is tracked in issue #645.\n`,
  );
  process.exitCode = 1;
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
