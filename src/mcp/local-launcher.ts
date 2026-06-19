/**
 * Chromium launcher for the local debug mode (env 1).
 *
 * Launch decision rationale:
 *   - `chrome-launcher` (npm) is purpose-built and finds installed Chrome, but
 *     adds a runtime dependency to the MCP bundle. The repo already has a clear
 *     "external dependency minimization" policy; `chrome-launcher` is not worth
 *     pulling in for what is essentially `spawn(chromeBin, [...flags])`.
 *   - Playwright is a devDependency used for E2E only — pulling `chromium.launch`
 *     into the runtime MCP path would add ~100 MB of bundled Chromium to the
 *     production install and break the "devDep = e2e only" boundary.
 *   - `child_process.spawn` with a platform-aware binary search is the lightest
 *     option: zero new dependencies, portable across macOS/Linux/Windows, and
 *     trivially testable by injecting a `spawnFn`.
 *
 * The launcher finds an installed Chrome/Chromium using a prioritized list of
 * well-known binary paths per platform, then spawns it with:
 *   --remote-debugging-port=<port>
 *   --no-first-run
 *   --no-default-browser-check
 *   <devUrl>
 *
 * `pnpm dev` is started by the user; the MCP only launches the browser pointing
 * at it.
 *
 * Node-only.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { platform } from 'node:os';

/** A handle returned by `launchChromium`. */
export interface ChromiumHandle {
  /** The port Chromium is listening on for CDP (`--remote-debugging-port`). */
  port: number;
  /** Devtools HTTP base URL, e.g. `http://127.0.0.1:9222`. */
  devtoolsUrl: string;
  /** Stop the Chromium child process. */
  stop(): void;
}

export interface LaunchChromiumOptions {
  /**
   * CDP remote debugging port. If 0 or omitted, an ephemeral free port is
   * chosen automatically.
   */
  port?: number;
  /**
   * URL to open in the browser. Defaults to `AIT_DEVTOOLS_URL` env var or
   * `http://localhost:5173`.
   */
  devUrl?: string;
  /**
   * Extra Chromium flags appended to the spawn command. Use with caution.
   */
  extraArgs?: string[];
  /**
   * Injectable `spawn` function for unit testing — defaults to Node's
   * `child_process.spawn`. Tests inject a fake to avoid launching a real browser.
   */
  spawnFn?: typeof spawn;
}

/**
 * Find an ephemeral free TCP port by briefly binding a server on port 0.
 * Resolves with the OS-assigned port number.
 */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : null;
      server.close(() => {
        if (port === null) {
          reject(new Error('Failed to determine free port from net.Server.'));
        } else {
          resolve(port);
        }
      });
    });
    // net.Server는 EventEmitter를 상속하므로 런타임에 on/once가 있다.
    // TypeScript 6 + @types/node 없는 환경에서 타입 해석이 누락되므로 unknown cast로 우회.
    (server as unknown as { on: (ev: string, fn: (err: unknown) => void) => void }).on(
      'error',
      reject,
    );
  });
}

/**
 * Returns an ordered list of Chromium/Chrome binary paths to try for the
 * current platform.
 */
export function candidateChromePaths(): string[] {
  const os = platform();
  if (os === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ];
  }
  if (os === 'linux') {
    return [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/local/bin/google-chrome',
      '/usr/local/bin/chromium',
      '/snap/bin/chromium',
    ];
  }
  if (os === 'win32') {
    const programFiles = process.env.PROGRAMFILES ?? 'C:\\Program Files';
    const programFilesX86 = process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)';
    return [
      `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`,
      `${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`,
      `${programFiles}\\Chromium\\Application\\chrome.exe`,
    ];
  }
  return [];
}

/** Find the first Chrome/Chromium binary that exists on this machine. */
export function findChromeBinary(): string | null {
  for (const p of candidateChromePaths()) {
    if (existsSync(p)) return p;
  }
  return null;
}

/**
 * Launch a local Chromium instance with CDP remote debugging enabled.
 *
 * The caller is responsible for calling `handle.stop()` when done.
 *
 * @throws if no Chrome/Chromium binary is found on the system.
 */
export async function launchChromium(options: LaunchChromiumOptions = {}): Promise<ChromiumHandle> {
  const spawnImpl = options.spawnFn ?? spawn;

  // Resolve the CDP port — find a free one if not specified.
  const requestedPort = options.port ?? 0;
  const port = requestedPort === 0 ? await findFreePort() : requestedPort;

  const devUrl = options.devUrl ?? process.env.AIT_DEVTOOLS_URL ?? 'http://localhost:5173';

  const binary = findChromeBinary();
  if (binary === null) {
    throw new Error(
      'No Chrome/Chromium binary found on this system. ' +
        'Install Google Chrome or Chromium and try again. ' +
        'Searched: ' +
        candidateChromePaths().join(', '),
    );
  }

  const args = [
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    // Use a separate profile dir so the debugged instance doesn't interfere
    // with the user's regular Chrome profile.
    '--user-data-dir=/tmp/ait-devtools-chromium-profile',
    ...(options.extraArgs ?? []),
    devUrl,
  ];

  const child: ChildProcess = spawnImpl(binary, args, {
    // Detach stdio so the MCP server's stdio transport is not contaminated.
    stdio: 'ignore',
    detached: false,
  });

  // Allow the Node process to exit even if the child is still running.
  child.unref();

  const devtoolsUrl = `http://127.0.0.1:${port}`;

  process.stderr.write(
    `[ait-local-debug] Launched Chromium: ${binary}\n` +
      `[ait-local-debug] CDP endpoint: ${devtoolsUrl}\n` +
      `[ait-local-debug] Opening: ${devUrl}\n`,
  );

  return {
    port,
    devtoolsUrl,
    stop(): void {
      try {
        child.kill();
      } catch {
        // Ignore — the child may have already exited.
      }
    },
  };
}
