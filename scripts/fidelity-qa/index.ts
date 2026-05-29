/**
 * fidelity-qa CLI entry
 *
 * Usage:
 *   pnpm qa:fidelity [--runner=mock|relay|both] [--diff] [--include-writes]
 *                    [--scenario-parity] [--output=<file>]
 *
 * Examples:
 *   pnpm qa:fidelity --runner=mock              # CI regression mode (mock-only, exits 0 on clean state)
 *   pnpm qa:fidelity --runner=relay             # requires attached phone + devtools MCP
 *   pnpm qa:fidelity --runner=both --diff       # compare mock vs relay, print diff
 *   pnpm qa:fidelity --include-writes           # include Storage write+read+delete cycle
 *   pnpm qa:fidelity --output=results.json      # write JSON output to file
 *   pnpm qa:fidelity --scenario-parity          # 4-scenario MCP tool schema parity probes (mock only)
 *   WSS_URL=wss://... pnpm qa:fidelity --scenario-parity --runner=both --diff
 *                                               # parity probes + mock vs relay diff
 *
 * Environment variables:
 *   WSS_URL   WebSocket relay URL (wss://...). When set, relay runner is available.
 *             When absent, --runner=relay and --runner=both are silently downgraded to mock-only
 *             so CI can always run without a real device attached.
 */

import { writeFileSync } from 'node:fs';
import { diffResults, hasUnexpected } from './diff.js';
import { PROBES, SCENARIO_PARITY_PROBES } from './probes/index.js';
import { runMockProbes } from './runners/mock.js';
import { runRelayProbes } from './runners/relay.js';
import type { Probe, ProbeResult, RunSummary } from './types.js';

// ---------------------------------------------------------------------------
// WSS_URL detection — when absent relay is not available (CI-safe)
// ---------------------------------------------------------------------------

const WSS_URL = process.env.WSS_URL ?? null;

// ---------------------------------------------------------------------------
// Minimal argument parsing (no new dependencies)
// ---------------------------------------------------------------------------

interface CliOptions {
  runner: 'mock' | 'relay' | 'both';
  diff: boolean;
  includeWrites: boolean;
  scenarioParity: boolean;
  output: string | null;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    runner: 'mock',
    diff: false,
    includeWrites: false,
    scenarioParity: false,
    output: null,
  };

  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--runner=')) {
      const val = arg.slice('--runner='.length);
      if (val === 'mock' || val === 'relay' || val === 'both') {
        opts.runner = val;
      } else {
        console.error(`Unknown runner: ${val}. Use mock|relay|both.`);
        process.exit(1);
      }
    } else if (arg === '--diff') {
      opts.diff = true;
    } else if (arg === '--include-writes') {
      opts.includeWrites = true;
    } else if (arg === '--scenario-parity') {
      opts.scenarioParity = true;
    } else if (arg.startsWith('--output=')) {
      opts.output = arg.slice('--output='.length);
    }
  }

  // --diff is implied when runner=both
  if (opts.runner === 'both') opts.diff = true;

  // Downgrade relay/both to mock when WSS_URL is absent (CI-safe)
  if (!WSS_URL && (opts.runner === 'relay' || opts.runner === 'both')) {
    console.warn(
      `[fidelity-qa] WSS_URL not set — downgrading runner from "${opts.runner}" to "mock". ` +
        'Set WSS_URL=wss://... to enable relay runner.',
    );
    opts.runner = 'mock';
    opts.diff = false;
  }

  return opts;
}

// --- Formatting helpers ---

function formatValue(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function printSummary(summary: RunSummary): void {
  const label = `== ${summary.runner.charAt(0).toUpperCase() + summary.runner.slice(1)} runner (${summary.results.length} probes, ${summary.durationMs}ms) ==`;
  console.log(label);

  for (const result of summary.results) {
    const tag = `[${result.domain}]`.padEnd(22);
    const id = result.id.padEnd(48);
    if (result.error) {
      console.log(`  ${tag} ${id} ERROR: ${result.error}`);
    } else {
      console.log(`  ${tag} ${id} → ${formatValue(result.value)}`);
    }
  }

  console.log('');
  console.log(`== Summary: ${summary.results.length} probes run, ${summary.errors} errors ==`);
  console.log('');
}

function printDiff(mockResults: ProbeResult[], relayResults: ProbeResult[]): boolean {
  const diffs = diffResults(mockResults, relayResults);
  const unexpected = diffs.filter((d) => d.label === 'UNEXPECTED');
  const expectedMismatch = diffs.filter((d) => d.label === 'EXPECTED_MISMATCH');
  const matches = diffs.filter((d) => d.label === 'MATCH');

  console.log('== Diff (mock vs relay) ==');
  for (const d of diffs) {
    const tag = `[${d.domain}]`.padEnd(22);
    const id = d.id.padEnd(48);
    if (d.label === 'MATCH') {
      console.log(`  ✓ ${tag} ${id} MATCH`);
    } else if (d.label === 'EXPECTED_MISMATCH') {
      console.log(
        `  ~ ${tag} ${id} EXPECTED_MISMATCH  mock=${formatValue(d.mockValue)} relay=${formatValue(d.relayValue)}`,
      );
      if (d.whitelistReason) console.log(`       reason: ${d.whitelistReason}`);
    } else {
      console.log(
        `  ✗ ${tag} ${id} UNEXPECTED  mock=${formatValue(d.mockValue)} relay=${formatValue(d.relayValue)}`,
      );
    }
  }

  console.log('');
  console.log(
    `== Diff summary: ${matches.length} MATCH, ${expectedMismatch.length} EXPECTED_MISMATCH, ${unexpected.length} UNEXPECTED ==`,
  );
  console.log('');

  return hasUnexpected(diffs);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function runProbeSet(
  probes: Probe[],
  runner: 'mock' | 'relay' | 'both',
  runnerOptions: { includeWrites: boolean },
  label: string,
): Promise<{ mockResults: ProbeResult[]; relayResults: ProbeResult[]; exitWithError: boolean }> {
  let mockResults: ProbeResult[] = [];
  let relayResults: ProbeResult[] = [];
  let exitWithError = false;

  if (runner === 'mock' || runner === 'both') {
    const start = Date.now();
    mockResults = await runMockProbes(probes, runnerOptions);
    const summary: RunSummary = {
      runner: `mock (${label})`,
      results: mockResults,
      errors: mockResults.filter((r) => r.error !== undefined).length,
      durationMs: Date.now() - start,
    };
    printSummary(summary);
    if (summary.errors > 0) exitWithError = true;
  }

  if (runner === 'relay' || runner === 'both') {
    const start = Date.now();
    relayResults = await runRelayProbes(probes, runnerOptions);
    const summary: RunSummary = {
      runner: `relay (${label})`,
      results: relayResults,
      errors: relayResults.filter((r) => r.error !== undefined).length,
      durationMs: Date.now() - start,
    };
    printSummary(summary);
    if (summary.errors > 0) exitWithError = true;
  }

  return { mockResults, relayResults, exitWithError };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  const runnerOptions = { includeWrites: opts.includeWrites };

  let exitWithError = false;

  // --- Standard fidelity probes ---
  const {
    mockResults,
    relayResults,
    exitWithError: stdError,
  } = await runProbeSet(PROBES, opts.runner, runnerOptions, 'standard');
  if (stdError) exitWithError = true;

  if (opts.diff && mockResults.length > 0 && relayResults.length > 0) {
    const hadUnexpected = printDiff(mockResults, relayResults);
    if (hadUnexpected) exitWithError = true;
  }

  // --- Scenario parity probes (--scenario-parity) ---
  let parityMockResults: ProbeResult[] = [];
  let parityRelayResults: ProbeResult[] = [];

  if (opts.scenarioParity) {
    console.log('== Scenario parity probes (list_pages / measure_safe_area / call_sdk schema) ==');
    console.log('');

    const {
      mockResults: pm,
      relayResults: pr,
      exitWithError: parityError,
    } = await runProbeSet(SCENARIO_PARITY_PROBES, opts.runner, runnerOptions, 'scenario-parity');
    parityMockResults = pm;
    parityRelayResults = pr;
    if (parityError) exitWithError = true;

    if (opts.diff && parityMockResults.length > 0 && parityRelayResults.length > 0) {
      console.log('== Scenario parity diff (mock vs relay) ==');
      const hadUnexpected = printDiff(parityMockResults, parityRelayResults);
      if (hadUnexpected) exitWithError = true;
    }
  }

  if (opts.output) {
    const output = {
      timestamp: new Date().toISOString(),
      options: opts,
      wssUrl: WSS_URL ?? null,
      mock: mockResults,
      relay: relayResults,
      parityMock: parityMockResults,
      parityRelay: parityRelayResults,
    };
    writeFileSync(opts.output, JSON.stringify(output, null, 2));
    console.log(`Results written to: ${opts.output}`);
  }

  if (exitWithError) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
