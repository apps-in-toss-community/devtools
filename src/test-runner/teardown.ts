/**
 * Bounded teardown orchestrator for the `devtools-test` CLI (devtools#755).
 *
 * ## Symptom (run7~run10, 4 consecutive real-device reproductions)
 * The CLI writes the report + capture artifacts ("devtools-test: wrote report
 * …", "wrote N capture file(s)") and the QR dashboard HTTP server goes down
 * (port no longer listening), but the Node process stays alive indefinitely —
 * a human had to `SIGTERM`/`pkill` it every run.
 *
 * ## Root cause (confirmed via `process.getActiveResourcesInfo()`, not guessed)
 * Two independent `http.Server#close()` call sites never resolved their
 * callback while a socket was still attached — verified with a standalone
 * repro script before writing this module (see PR body for the diagnostic
 * transcript, not committed here since it's throwaway):
 *
 *   1. `qr-http-server.ts`'s dashboard HTTP server: a still-open browser tab
 *      on the QR dashboard holds a `GET /events` SSE connection
 *      (`Connection: keep-alive`, no `res.end()` — that's by design, it's a
 *      live push stream). `server.close(cb)` only stops accepting NEW
 *      connections; it does not touch already-open sockets, so `cb` never
 *      fired while that tab stayed open. Fixed by calling
 *      `server.closeAllConnections()` immediately before `close()`.
 *   2. `chii-relay.ts`'s relay HTTP+WS server: once a WebSocket connection
 *      completes the `upgrade` handshake, Node removes that socket from the
 *      HTTP server's own connection tracking — `closeAllConnections()` does
 *      NOT reach it (verified: still hangs even with that call added). An
 *      open CDP WS leg (phone target or relay-worker client) therefore also
 *      blocked `close(cb)` forever. Fixed by terminating every live socket
 *      in chii's captured `_wss.clients` set before calling `close()`.
 *
 * Both are fixed at the source in those two files — this module is NOT a
 * workaround for either leak; with both source fixes in place the backstop
 * below never fires in practice (asserted by the "process exits on its own"
 * e2e-style test in `teardown.test.ts`). This module exists as the CLI's
 * last-mile safety net for any OTHER handle outside our control (a
 * third-party dependency — `cloudflared`, `chii`, `ws` — holding something
 * we don't own the lifecycle of) and as a single, testable teardown
 * sequence with per-step timeouts so one hung close() cannot prevent the
 * rest from running.
 */

/** A single teardown action — e.g. "close the CDP connection", "stop the relay family". */
export interface TeardownStep {
  /** Short label used only in the returned report (never logged with secrets). */
  name: string;
  /** Performs the close. Must be idempotent — may be invoked defensively more than once. */
  close(): Promise<void> | void;
}

/** Outcome of a single step, as reported by {@link runTeardownSteps}. */
export interface TeardownStepResult {
  name: string;
  /** `'ok'` = resolved within its slice. `'error'` = threw/rejected. `'timeout'` = did not settle in time. */
  status: 'ok' | 'error' | 'timeout';
  /** Present when status is 'error'. */
  error?: string;
}

/** Options for {@link runTeardownSteps}. */
export interface RunTeardownStepsOptions {
  /** Per-step timeout in ms — a hung step is abandoned (marked 'timeout') so later steps still run. Default 5000. */
  perStepTimeoutMs?: number;
  /** Injectable clock for tests — defaults to the real `setTimeout`/`clearTimeout`. */
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

/**
 * Runs `steps` in strict order, each bounded by `perStepTimeoutMs` so a
 * single hung `close()` cannot block the rest — a later step (e.g. "close
 * the QR HTTP server") still runs even if an earlier one (e.g. "flip the
 * on-phone badge over CDP") times out.
 *
 * Order is load-bearing: `relay-factory.ts`'s existing `close()` already
 * encodes "badge over still-open channel, THEN close that channel" — this
 * function does not reorder or parallelize, it just bounds+reports whatever
 * sequence the caller provides.
 */
export async function runTeardownSteps(
  steps: TeardownStep[],
  options: RunTeardownStepsOptions = {},
): Promise<TeardownStepResult[]> {
  const {
    perStepTimeoutMs = 5_000,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = options;

  const results: TeardownStepResult[] = [];
  for (const step of steps) {
    results.push(await runOneStep(step, perStepTimeoutMs, setTimeoutFn, clearTimeoutFn));
  }
  return results;
}

async function runOneStep(
  step: TeardownStep,
  perStepTimeoutMs: number,
  setTimeoutFn: typeof setTimeout,
  clearTimeoutFn: typeof clearTimeout,
): Promise<TeardownStepResult> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<'timeout'>((resolve) => {
    timeoutHandle = setTimeoutFn(() => resolve('timeout'), perStepTimeoutMs);
  });

  try {
    const outcome = await Promise.race([
      Promise.resolve()
        .then(() => step.close())
        .then(() => 'ok' as const),
      timeoutPromise,
    ]);
    if (timeoutHandle !== undefined) clearTimeoutFn(timeoutHandle);
    return { name: step.name, status: outcome };
  } catch (e) {
    if (timeoutHandle !== undefined) clearTimeoutFn(timeoutHandle);
    return { name: step.name, status: 'error', error: e instanceof Error ? e.message : String(e) };
  }
}

/** Options for {@link armExitBackstop}. */
export interface ArmExitBackstopOptions {
  /**
   * Grace period (ms) after teardown completes before forcing exit if the
   * process has not already exited on its own. This is a LAST resort for
   * handles outside `runTeardownSteps`'s enumerated steps — with the
   * upstream leaks fixed (see module doc), this should never fire in
   * practice. Default 3000.
   */
  graceMs?: number;
  /** The exit code to pass to `process.exit`. */
  exitCode: number;
  /** Injectable clock for tests. */
  setTimeoutFn?: typeof setTimeout;
  /** Injectable exit for tests — defaults to `process.exit`. Never call this directly in a test assertion without overriding it. */
  exitFn?: (code: number) => void;
}

/** Handle returned by {@link armExitBackstop} so the happy path can disarm it. */
export interface ExitBackstop {
  /** Cancels the pending forced exit — call this once the process is expected to drain naturally. */
  disarm(): void;
  /** True once the backstop has fired (only meaningful in tests — production calls `process.exit`). */
  readonly fired: boolean;
}

/**
 * Arms a grace-period timer that force-exits the process if it has not
 * already exited on its own by the time the timer fires. The timer is
 * deliberately NOT `.unref()`'d — its entire purpose is to hold the event
 * loop open long enough to fire if nothing else does, so unref'ing it would
 * defeat the backstop. `disarm()` clears it — the CLI calls `disarm()`
 * immediately once `main()`'s own teardown (Step 6, cli.ts) has finished,
 * so on the happy path the timer never fires (Node drains the loop and
 * exits naturally at whatever `process.exitCode` was already set to).
 *
 * SECRET-HANDLING: this function never touches stdout/stderr content — the
 * caller (cli.ts) is responsible for flushing any final output before the
 * backstop's `exitFn` runs.
 */
export function armExitBackstop(options: ArmExitBackstopOptions): ExitBackstop {
  const {
    graceMs = 3_000,
    exitCode,
    setTimeoutFn = setTimeout,
    exitFn = (code: number) => process.exit(code),
  } = options;

  let fired = false;
  const handle = setTimeoutFn(() => {
    fired = true;
    exitFn(exitCode);
  }, graceMs);

  return {
    disarm(): void {
      clearTimeout(handle);
    },
    get fired(): boolean {
      return fired;
    },
  };
}
