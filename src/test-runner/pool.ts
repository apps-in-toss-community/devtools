/**
 * Vitest 4.x custom pool: runs mini-app tests on a real device WebView over a
 * CDP relay instead of in a Node child process.
 *
 * Vitest's pool abstraction lets a `PoolRunnerInitializer` create a `PoolWorker`
 * that the core drives via a `WorkerRequest`/`WorkerResponse` message protocol.
 * Built-in pools (`forks`/`threads`) fork a child process; the `typecheck` pool
 * runs in-process and handles messages synchronously. We follow the in-process
 * `TypecheckPoolWorker` shape: a single long-lived "worker" that, on a `run`
 * request, bundles + injects + collects each file over the relay (#644's
 * `runTestFilesOverRelay`), synthesises a Vitest task graph (`task-graph.ts`),
 * and reports it through `vitest.state` so reporters/watch/UI/snapshot all work.
 *
 * Single-attach constraint: the relay supports one active page, so we keep one
 * worker for the whole run (`isolate: false`) rather than starting/stopping per
 * file — per-file start/stop would re-attach the relay on every file.
 *
 * SECRET-HANDLING: the relay connection (wss/TOTP) is supplied by the caller's
 * factory and never logged here; bundle code and result values are not logged.
 */

import type { PoolOptions, PoolWorker, TestProject, WorkerRequest } from 'vitest/node';
import type { CdpConnection } from '../mcp/cdp-connection.js';
import type { RelayRunOptions } from './relay-worker.js';
import { runTestFilesOverRelay } from './relay-worker.js';
import { synthesizeFileTask, toTaskEventPacks, toTaskResultPacks } from './task-graph.js';

/** The pool name Vitest matches against `getFilePoolName(project)`. */
export const RELAY_POOL_NAME = 'ait-relay';

/**
 * Factory the caller provides to open (and later close) the CDP relay
 * connection. Called once per worker lifecycle (`start`). The returned
 * `close` runs on `stop`.
 *
 * Kept as a factory (not a live connection) so the pool can be constructed in
 * config before any device is attached, and so `start`/`stop` own the lifecycle.
 */
export interface RelayConnectionFactory {
  /** Opens the relay connection. Resolves once the page is attached & ready. */
  open(): Promise<CdpConnection>;
  /** Closes the relay connection opened by {@link open}. */
  close(connection: CdpConnection): Promise<void>;
  /**
   * CLI-only session-phase hook (#730) — drives the QR dashboard's `phase`
   * field (`'running'` on run start, `'complete'` on run end) so the
   * dashboard can push an immediate SSE update instead of waiting for a
   * poll/watchdog. The pool (this file) has no equivalent lifecycle and
   * omits it; only `createRelayConnectionFactory` (relay-factory.ts) sets it.
   */
  onSessionPhase?(phase: 'running' | 'complete'): void;
  /**
   * CLI-only manual-blocking prompt hook (devtools#741) — pushes the QR
   * dashboard's `manualPrompt` field before each manual-tagged file is
   * injected, so a human watching the dashboard sees which file is next and
   * how far along the manual queue is. Pass `null` to clear the prompt (the
   * CLI does this once all manual files have run). The pool has no
   * equivalent lifecycle and omits it; only `createRelayConnectionFactory`
   * sets it.
   */
  onManualPrompt?(prompt: { file: string; index: number; total: number } | null): void;
}

/** Options for {@link createRelayPool}. */
export interface RelayPoolOptions {
  /** Opens/closes the relay connection. */
  connection: RelayConnectionFactory;
  /** Forwarded to `runTestFilesOverRelay` (bundle options, per-file timeout). */
  run?: RelayRunOptions;
}

/* -------------------------------------------------------------------------- */
/* WorkerResponse helpers                                                       */
/* -------------------------------------------------------------------------- */

/** Minimal `WorkerResponse` shape we emit. Matches vitest/node's union. */
type EmittedResponse =
  | { __vitest_worker_response__: true; type: 'started'; error?: unknown }
  | { __vitest_worker_response__: true; type: 'stopped'; error?: unknown }
  | { __vitest_worker_response__: true; type: 'testfileFinished'; error?: unknown };

/* -------------------------------------------------------------------------- */
/* The in-process relay PoolWorker                                              */
/* -------------------------------------------------------------------------- */

/**
 * In-process `PoolWorker` backed by a CDP relay. Mirrors `TypecheckPoolWorker`:
 * `send` handles the message in-process and emits a `WorkerResponse` via the
 * `'message'` listener registered by the core's pool driver.
 */
class RelayPoolWorker implements PoolWorker {
  readonly name = RELAY_POOL_NAME;
  readonly cacheFs = false;

  private readonly project: TestProject;
  private readonly factory: RelayConnectionFactory;
  private readonly runOpts: RelayRunOptions | undefined;
  private readonly listeners = new Map<string, Set<(arg: unknown) => void>>();
  private connection: CdpConnection | undefined;

  constructor(project: TestProject, opts: RelayPoolOptions) {
    this.project = project;
    this.factory = opts.connection;
    this.runOpts = opts.run;
  }

  on(event: string, callback: (arg: unknown) => void): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(callback);
  }

  off(event: string, callback: (arg: unknown) => void): void {
    this.listeners.get(event)?.delete(callback);
  }

  private emit(event: string, arg: unknown): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const cb of set) cb(arg);
  }

  deserialize(data: unknown): unknown {
    // Relay results arrive as plain JSON objects already — identity is correct.
    return data;
  }

  async start(): Promise<void> {
    // Lifecycle ownership lives here, but the connection is opened lazily on the
    // first `run`/`collect` so a never-run worker never touches the device.
  }

  async stop(): Promise<void> {
    if (this.connection) {
      const conn = this.connection;
      this.connection = undefined;
      await this.factory.close(conn);
    }
  }

  send(message: WorkerRequest): void {
    // Fire-and-forget like TypecheckPoolWorker: handle async, emit on settle.
    void this.handle(message).then((response) => {
      if (response) this.emit('message', response);
    });
  }

  private async handle(message: WorkerRequest): Promise<EmittedResponse | undefined> {
    switch (message.type) {
      case 'start':
        return { __vitest_worker_response__: true, type: 'started' };
      case 'run':
      case 'collect': {
        const files = message.context.files.map((s) => s.filepath);
        const error = await this.runFiles(files).catch((e) => e);
        return { __vitest_worker_response__: true, type: 'testfileFinished', error };
      }
      case 'stop':
        return { __vitest_worker_response__: true, type: 'stopped' };
      case 'cancel':
        return undefined;
    }
  }

  /**
   * Bundles + injects + collects the given files over the relay, synthesises a
   * Vitest task graph per file, and reports it through `vitest.state` so the
   * reporter/watch/UI ecosystem sees real results.
   *
   * Returns nothing on success; a thrown error is surfaced as the
   * `testfileFinished` error (a whole-pool failure, e.g. relay unreachable).
   */
  private async runFiles(files: string[]): Promise<void> {
    const conn = await this.ensureConnection();
    const report = await runTestFilesOverRelay(conn, files, this.runOpts);

    const root = this.project.config.root;
    const projectName = this.project.name || undefined;
    const state = this.project.vitest.state;

    for (const fileResult of report.files) {
      const perFile =
        'error' in fileResult.result
          ? // Whole-file bundle/inject error → synthesise a failed file with no tests.
            {
              startedAt: report.startedAt,
              duration: 0,
              passed: 0,
              failed: 1,
              skipped: 0,
              tests: [],
            }
          : fileResult.result;

      const fileTask = synthesizeFileTask(
        fileResult.file,
        root,
        projectName,
        RELAY_POOL_NAME,
        perFile,
      );

      state.collectFiles(this.project, [fileTask]);
      state.updateTasks(toTaskResultPacks(fileTask));
      // Event packs drive reporter progress; updateTasks already recorded
      // results, so events are advisory but keep watch/UI output coherent.
      void toTaskEventPacks(fileTask);
    }
  }

  private async ensureConnection(): Promise<CdpConnection> {
    if (!this.connection) {
      this.connection = await this.factory.open();
    }
    return this.connection;
  }
}

/* -------------------------------------------------------------------------- */
/* PoolRunnerInitializer factory                                               */
/* -------------------------------------------------------------------------- */

/**
 * Creates the Vitest `PoolRunnerInitializer` for the relay pool.
 *
 * Wire it into a Vitest config as `pool: createRelayPool({ connection })`.
 * Vitest moves an object `pool` into `config.poolRunner` and dispatches files
 * whose pool name equals `RELAY_POOL_NAME` to our `createPoolWorker`.
 *
 * @example
 *   // vitest.config.ts
 *   import { createRelayPool } from '@ait-co/devtools/test-runner';
 *   export default defineConfig({
 *     test: { pool: createRelayPool({ connection: myFactory }) },
 *   });
 */
export function createRelayPool(opts: RelayPoolOptions): {
  readonly name: string;
  createPoolWorker: (options: PoolOptions) => PoolWorker;
} {
  return {
    name: RELAY_POOL_NAME,
    createPoolWorker(options: PoolOptions): PoolWorker {
      return new RelayPoolWorker(options.project, opts);
    },
  };
}
