/**
 * `devtools-mcp` bin entry.
 *
 * Single bin, two modes selected by `--mode` and one target selected by
 * `--target`:
 *
 *   --mode=debug (default)
 *     --target=relay (default) — CDP/Chii relay + cloudflared quick tunnel.
 *       Attach a running mini-app (real Toss WebView, env 2/3) and read its
 *       console + network over CDP without a human watching a phone.
 *     --target=local — CDP direct-attach to a local Chromium launched by the
 *       MCP server (env 1). No relay or tunnel; the browser is launched
 *       pointing at AIT_DEVTOOLS_URL (default http://localhost:5173).
 *
 *   --mode=dev — dev mode — reads the live browser mock state from a running
 *     Vite dev server (the devtools#130 `devtools_get_mock_state` surface).
 *
 * Node-only stdio process.
 */

import { realpathSync } from 'node:fs';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { runDebugServer, runLocalDebugServer } from './debug-server.js';
import { runDevServer } from './server.js';

type Mode = 'debug' | 'dev';
type Target = 'relay' | 'local';

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

/**
 * Parses `--target=<value>` / `--target <value>` from argv; default `relay`.
 *
 * Only meaningful when `--mode=debug`:
 *   - `relay`  — phone/WebView attach over Chii relay + cloudflared tunnel (env 2/3).
 *   - `local`  — local Chromium CDP attach (env 1, no relay needed).
 */
export function parseTarget(argv: readonly string[]): Target {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg.startsWith('--target=')) {
      return normalizeTarget(arg.slice('--target='.length));
    }
    if (arg === '--target') {
      const next = argv[i + 1];
      if (next === undefined) {
        throw new Error("--target requires a value: 'relay' (default) or 'local'.");
      }
      return normalizeTarget(next);
    }
  }
  return 'relay';
}

function normalizeMode(value: string): Mode {
  if (value === 'dev') return 'dev';
  if (value === 'debug') return 'debug';
  throw new Error(`Unknown --mode '${value}'. Expected 'debug' (default) or 'dev'.`);
}

function normalizeTarget(value: string): Target {
  if (value === 'relay') return 'relay';
  if (value === 'local') return 'local';
  throw new Error(`Unknown --target '${value}'. Expected 'relay' (default) or 'local'.`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = parseMode(args);
  if (mode === 'dev') {
    await runDevServer();
  } else {
    const target = parseTarget(args);
    if (target === 'local') {
      await runLocalDebugServer();
    } else {
      await runDebugServer();
    }
  }
}

/**
 * True when this file is the process entry (the bin), not an import.
 *
 * `argv[1]` is whatever path the OS used to launch node — under `npx`/npm's
 * bin shim that's the symlink in `node_modules/.bin/` (or a wrapper), whereas
 * `import.meta.url` resolves to the realpath inside the package. Comparing
 * the two raw paths gives a false negative on every install that goes through
 * a bin shim — exactly the dominant path for `npx -y @ait-co/devtools
 * devtools-mcp`. Resolve `argv[1]` to its realpath before comparing.
 */
function isEntrypoint(): boolean {
  const entry = argv[1];
  if (entry === undefined) return false;
  try {
    return fileURLToPath(import.meta.url) === realpathSync(entry);
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
