/**
 * Thin test runtime for WebView execution.
 *
 * This file is bundled by `bundle.ts` together with the user's test file
 * into a single IIFE injected into the WebView via `Runtime.evaluate`.
 * It MUST stay browser-compatible — no Node.js APIs allowed.
 *
 * Design: rather than shipping @vitest/runner verbatim into a WebView (where
 * its Node-side internals cause issues), this runtime provides a minimal
 * compatible API surface — describe/it/test/expect globals — collects results
 * into a plain JSON-safe object, and exports `runTestModule` as the entry point.
 *
 * @vitest/runner and @vitest/expect are listed as dependencies so that the
 * package's type contracts are available and so the browser-compatible subsets
 * can be referenced. The Vitest custom pool that drives this runtime through
 * Vitest's `PoolRunnerInitializer` lives in `pool.ts`.
 *
 * NOTE: this file is imported by type from Node-side code (rpc.ts / relay-worker.ts)
 * for the RunReport / TestResult type shapes. The runtime ITSELF is not imported
 * at runtime on the Node side — only the types are used.
 */

/* -------------------------------------------------------------------------- */
/* Public result types (used by rpc.ts and relay-worker.ts)                   */
/* -------------------------------------------------------------------------- */

/**
 * Result of a single test case.
 * All fields are JSON-serialisable.
 */
export interface TestResult {
  /** Full dot-joined test name including nested suite names. */
  name: string;
  /** `'pass'` or `'fail'`. `'skip'` for skipped tests. */
  status: 'pass' | 'fail' | 'skip';
  /** Duration in milliseconds. */
  duration: number;
  /** Error message (fail only). Does NOT include the expression/secret. */
  error?: string;
}

/** Aggregate report returned by `runTestModule`. */
export interface RunReport {
  /** ISO timestamp of when `runTestModule` was called. */
  startedAt: string;
  /** Total elapsed milliseconds (wall-clock). */
  duration: number;
  passed: number;
  failed: number;
  skipped: number;
  tests: TestResult[];
}

/* -------------------------------------------------------------------------- */
/* Lightweight expect implementation                                           */
/* -------------------------------------------------------------------------- */

/** Thrown by expect matchers on failure. */
class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}

/** Minimal expect builder compatible with Vitest's jest-style API. */
class Expectation {
  #received: unknown;
  #negated = false;

  constructor(received: unknown) {
    this.#received = received;
  }

  get not(): this {
    const neg = new Expectation(this.#received) as this;
    neg.#negated = true;
    return neg;
  }

  #assert(pass: boolean, msg: string): void {
    const actual = this.#negated ? !pass : pass;
    if (!actual) {
      throw new AssertionError(this.#negated ? `Expected NOT: ${msg}` : msg);
    }
  }

  toBe(expected: unknown): void {
    this.#assert(
      Object.is(this.#received, expected),
      `Expected ${String(expected)}, received ${String(this.#received)}`,
    );
  }

  toEqual(expected: unknown): void {
    this.#assert(
      JSON.stringify(this.#received) === JSON.stringify(expected),
      `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(this.#received)}`,
    );
  }

  toBeTruthy(): void {
    this.#assert(Boolean(this.#received), `Expected truthy, received ${String(this.#received)}`);
  }

  toBeFalsy(): void {
    this.#assert(!this.#received, `Expected falsy, received ${String(this.#received)}`);
  }

  toBeNull(): void {
    this.#assert(this.#received === null, `Expected null, received ${String(this.#received)}`);
  }

  toBeUndefined(): void {
    this.#assert(
      this.#received === undefined,
      `Expected undefined, received ${String(this.#received)}`,
    );
  }

  toBeGreaterThan(n: number): void {
    this.#assert(
      typeof this.#received === 'number' && this.#received > n,
      `Expected > ${n}, received ${String(this.#received)}`,
    );
  }

  toBeLessThan(n: number): void {
    this.#assert(
      typeof this.#received === 'number' && this.#received < n,
      `Expected < ${n}, received ${String(this.#received)}`,
    );
  }

  toContain(sub: string): void {
    this.#assert(
      typeof this.#received === 'string' && this.#received.includes(sub),
      `Expected to contain "${sub}", received "${String(this.#received)}"`,
    );
  }

  toThrow(msgFragment?: string): void {
    if (typeof this.#received !== 'function') {
      throw new AssertionError('toThrow: expected a function');
    }
    let threw = false;
    let errorMsg = '';
    try {
      (this.#received as () => unknown)();
    } catch (e) {
      threw = true;
      errorMsg = e instanceof Error ? e.message : String(e);
    }
    if (msgFragment !== undefined) {
      this.#assert(
        threw && errorMsg.includes(msgFragment),
        `Expected to throw containing "${msgFragment}", got "${errorMsg}"`,
      );
    } else {
      this.#assert(threw, 'Expected function to throw');
    }
  }
}

/** The `expect` function installed as a global. */
function expect(received: unknown): Expectation {
  return new Expectation(received);
}

/* -------------------------------------------------------------------------- */
/* describe / it / test registry                                               */
/* -------------------------------------------------------------------------- */

interface PendingTest {
  suitePath: string[];
  name: string;
  fn: () => void | Promise<void>;
  skip: boolean;
}

const _pendingTests: PendingTest[] = [];
const _suiteStack: string[] = [];

/** Registers a suite scope; calls `fn` synchronously to collect inner tests. */
function describe(name: string, fn: () => void): void {
  _suiteStack.push(name);
  fn();
  _suiteStack.pop();
}

/** Registers a test. */
function it(name: string, fn: () => void | Promise<void>): void {
  _pendingTests.push({ suitePath: [..._suiteStack], name, fn, skip: false });
}

/** Alias for `it`. */
const test = it;

/** Skipped test — registered but not executed. */
describe.skip = (name: string, _fn: () => void): void => {
  void name;
};
it.skip = (name: string, _fn?: () => void | Promise<void>): void => {
  _pendingTests.push({ suitePath: [..._suiteStack], name, fn: () => {}, skip: true });
};
test.skip = it.skip;

/* -------------------------------------------------------------------------- */
/* Runtime entry point                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Installs describe/it/test/expect as globals, invokes `moduleFactory` to
 * register the user's tests, then executes them and returns a RunReport.
 *
 * This function is exported as `__testBundle.runTestModule` by the IIFE wrapper
 * that bundle.ts generates. The Node-side rpc.ts calls it via `Runtime.evaluate`.
 *
 * @param moduleFactory - A zero-argument function that contains the user's
 *   top-level test code (describe/it/test calls). The bundler wraps the entire
 *   test module so that its top-level statements become the body of this factory.
 */
export async function runTestModule(
  moduleFactory?: () => void | Promise<void>,
): Promise<RunReport> {
  // Reset state for re-entrant calls within the same page context.
  _pendingTests.length = 0;
  _suiteStack.length = 0;

  // Install globals that user test code expects.
  type G = typeof globalThis & {
    describe: typeof describe;
    it: typeof it;
    test: typeof test;
    expect: typeof expect;
  };
  const g = globalThis as G;
  g.describe = describe;
  g.it = it;
  g.test = test;
  g.expect = expect;

  // Run the factory (which registers describe/it/test blocks via globals).
  if (moduleFactory) {
    await moduleFactory();
  }

  const wallStart = Date.now();
  const startedAt = new Date(wallStart).toISOString();
  const results: TestResult[] = [];

  for (const pending of _pendingTests) {
    const fullName = [...pending.suitePath, pending.name].join(' > ');
    if (pending.skip) {
      results.push({ name: fullName, status: 'skip', duration: 0 });
      continue;
    }
    const tStart = Date.now();
    try {
      await pending.fn();
      results.push({ name: fullName, status: 'pass', duration: Date.now() - tStart });
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      results.push({
        name: fullName,
        status: 'fail',
        duration: Date.now() - tStart,
        error: errorMsg,
      });
    }
  }

  const duration = Date.now() - wallStart;
  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const skipped = results.filter((r) => r.status === 'skip').length;

  return { startedAt, duration, passed, failed, skipped, tests: results };
}
