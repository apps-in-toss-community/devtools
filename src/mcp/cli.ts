/**
 * `devtools-mcp` bin entry.
 *
 * Single bin, two transports selected by `--mode`:
 *   - (default, no flag) debug mode — CDP/Chii relay + cloudflared quick tunnel.
 *     Attach a running mini-app (real Toss WebView or a browser) and read its
 *     console + network over CDP without a human watching a phone.
 *   - `--mode=dev` — dev mode — reads the live browser mock state from a running
 *     Vite dev server (the devtools#130 `devtools_get_mock_state` surface).
 *
 * Node-only stdio process.
 */

import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { runDebugServer } from './debug-server.js';
import { runDevServer } from './server.js';

type Mode = 'debug' | 'dev';

/** Parses `--mode=<value>` / `--mode <value>` from argv; default `debug`. */
export function parseMode(argv: readonly string[]): Mode {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg.startsWith('--mode=')) {
      return normalizeMode(arg.slice('--mode='.length));
    }
    if (arg === '--mode') {
      const next = argv[i + 1];
      if (next === undefined) {
        throw new Error("--mode requires a value: 'debug' (default) or 'dev'.");
      }
      return normalizeMode(next);
    }
  }
  return 'debug';
}

function normalizeMode(value: string): Mode {
  if (value === 'dev') return 'dev';
  if (value === 'debug') return 'debug';
  throw new Error(`Unknown --mode '${value}'. Expected 'debug' (default) or 'dev'.`);
}

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  if (mode === 'dev') {
    await runDevServer();
  } else {
    await runDebugServer();
  }
}

/** True when this file is the process entry (the bin), not an import. */
function isEntrypoint(): boolean {
  const entry = argv[1];
  if (entry === undefined) return false;
  try {
    return fileURLToPath(import.meta.url) === entry;
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[devtools-mcp] fatal: ${message}\n`);
    process.exitCode = 1;
  });
}
