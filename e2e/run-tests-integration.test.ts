/**
 * Integration test for the run_tests pipeline (real Chromium + real bundle + real runtime).
 *
 * ## What this test verifies
 *
 * The FULL pipeline end-to-end without mocking any of the moving parts:
 *   bundleTestFile(fixture) → IIFE code → Runtime.evaluate → RunReport
 *
 * Specifically:
 *   1. `bundleTestFile` produces a bundle that includes `runtime.ts` and exposes
 *      both `runTestModule` and `__userFactory` on `__testBundle`.
 *   2. `buildRunTestsExpression` wraps the bundle and calls
 *      `runTestModule(__userFactory)` correctly.
 *   3. `runTestModule` installs globals, invokes the factory, runs the tests,
 *      and returns a well-formed `RunReport`.
 *   4. `injectAndRunBundle` / `runTestFilesOverRelay` ferry the report back to Node.
 *
 * ## Why mocking is forbidden here
 *
 * The original bug (devtools#656) — `describe is not defined` — shipped
 * undetected because every unit test mocked `bundleTestFile`. Mocking the
 * bundler in tests that are supposed to validate the bundle is the direct cause
 * of the regression. This test intentionally uses a real Chromium page, a real
 * `LocalCdpConnection`, and the real `runWithConnection` so the same gap cannot
 * reopen silently.
 *
 * ## How Chromium is obtained
 *
 * We launch the Playwright-managed Chromium binary directly via `child_process.spawn`
 * with `--remote-debugging-port=0` and parse the assigned port from stderr.
 * This gives us a real Chromium with a known CDP HTTP endpoint that
 * `LocalCdpConnection` can connect to — the same path as the real local-debug flow.
 *
 * ## Fixture file
 *
 * `e2e/fixtures/ait-test-fixture.ts` — uses bare `describe/it/test/expect`
 * globals (installed by the runtime). Expected outcome:
 *   passed=3, failed=1, skipped=1, total=5
 */

import { spawn } from 'node:child_process';
import * as http from 'node:http';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';
import { LocalCdpConnection } from '../src/mcp/local-connection.js';
import { runWithConnection } from '../src/test-runner/cli.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Absolute path to the fixture test file bundled and evaluated by the pipeline. */
const FIXTURE_TEST_FILE = path.resolve(__dirname, 'fixtures/ait-test-fixture.ts');

/**
 * Spin up a minimal HTTP server that serves a non-blank HTML page.
 * LocalCdpConnection's enableDomains() selects the first non-blank page target;
 * we navigate to this server so there is a real page target to attach to.
 */
async function startMinimalServer(): Promise<{ url: string; close(): Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>run_tests integration fixture</h1></body></html>');
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to get server address'));
        return;
      }
      const url = `http://127.0.0.1:${addr.port}/`;
      resolve({
        url,
        close: () => new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res()))),
      });
    });
    server.on('error', reject);
  });
}

/**
 * Launches a headless Chromium with --remote-debugging-port=0 and returns the
 * assigned devtools HTTP endpoint URL and a kill function. The browser opens a
 * page at the given URL so that LocalCdpConnection can find a non-blank target.
 *
 * Parses the port from the stderr line:
 *   "DevTools listening on ws://127.0.0.1:<port>/devtools/browser/..."
 */
async function launchHeadlessChromium(initialUrl: string): Promise<{
  devtoolsHttpUrl: string;
  kill(): void;
}> {
  const execPath = chromium.executablePath();
  return new Promise((resolve, reject) => {
    const browser = spawn(execPath, [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--remote-debugging-port=0',
      initialUrl,
    ]);

    let resolved = false;

    const onData = (chunk: Buffer) => {
      if (resolved) return;
      const text = chunk.toString();
      const m = text.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+)/);
      if (m) {
        resolved = true;
        const wsUrl = m[1]; // e.g. ws://127.0.0.1:PORT
        const httpUrl = wsUrl.replace(/^ws:/, 'http:').replace(/\/devtools\/browser\/.*$/, '');
        resolve({ devtoolsHttpUrl: httpUrl, kill: () => browser.kill() });
      }
    };

    browser.stderr.on('data', onData);
    browser.stdout.on('data', onData);

    browser.on('error', reject);

    // Safety timeout in case the expected stderr line never arrives.
    setTimeout(() => {
      if (!resolved) {
        browser.kill();
        reject(new Error('Timed out waiting for Chromium DevTools listening line'));
      }
    }, 10_000);
  });
}

test.describe('run_tests pipeline integration', () => {
  /**
   * This test is the canonical regression guard for the `describe is not defined`
   * class of bugs. Do NOT mock bundleTestFile, LocalCdpConnection, or
   * runWithConnection here — that is precisely how the original bug shipped.
   */
  test('real bundle + real Chromium + real LocalCdpConnection executes fixture correctly', async () => {
    const server = await startMinimalServer();
    // Launch Chromium with the fixture server URL as the initial page so
    // LocalCdpConnection can find a non-blank (http://) page target.
    const { devtoolsHttpUrl, kill } = await launchHeadlessChromium(server.url);

    try {
      // Allow the page to be fully registered in /json before we attach.
      await new Promise((r) => setTimeout(r, 300));

      const conn = new LocalCdpConnection({ devtoolsHttpUrl });

      try {
        // enableDomains() discovers all page targets, picks the non-blank one,
        // attaches via CDP WebSocket, and enables Runtime/Network/Page domains.
        await conn.enableDomains();

        // Run the fixture through the full pipeline.
        const report = await runWithConnection(conn, [FIXTURE_TEST_FILE]);

        // ── Structure assertions ────────────────────────────────────────────
        expect(report.files).toHaveLength(1);
        expect(typeof report.duration).toBe('number');
        expect(report.duration).toBeGreaterThanOrEqual(0);
        expect(report.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

        // ── Totals must match the fixture ───────────────────────────────────
        // fixture: addition✓ subtraction✓ top-level✓ = 3 passed
        //          fails-intentionally✗             = 1 failed
        //          skipped-test (it.skip)           = 1 skipped
        expect(report.totals.passed).toBe(3);
        expect(report.totals.failed).toBe(1);
        expect(report.totals.skipped).toBe(1);
        expect(report.totals.total).toBe(5);

        // ── Per-file result must be a RunReport, not an error ───────────────
        const fileResult = report.files[0].result;
        expect('error' in fileResult).toBe(false);

        if (!('error' in fileResult)) {
          // The deliberately-failing test must have an error string.
          const failedTest = fileResult.tests.find((t) => t.status === 'fail');
          expect(failedTest).toBeDefined();
          expect(typeof failedTest?.error).toBe('string');
          expect((failedTest?.error ?? '').length).toBeGreaterThan(0);

          // All tests must have numeric durations.
          for (const t of fileResult.tests) {
            expect(typeof t.duration).toBe('number');
          }

          expect(typeof fileResult.duration).toBe('number');
          expect(fileResult.duration).toBeGreaterThanOrEqual(0);
        }
      } finally {
        conn.close();
      }
    } finally {
      kill();
      await server.close();
    }
  });
});
