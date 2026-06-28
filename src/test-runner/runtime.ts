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
/* Deep equality helpers                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Recursive structural equality — replaces JSON.stringify comparison to
 * handle key-order differences and undefined values correctly.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) return false;

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.hasOwn(bObj, key)) return false;
    if (!deepEqual(aObj[key], bObj[key])) return false;
  }
  return true;
}

/**
 * Partial-match: every key in `expected` must exist in `received` with a
 * recursively matching value. Extra keys in `received` are ignored.
 */
function deepMatchObject(received: unknown, expected: unknown): boolean {
  if (Object.is(received, expected)) return true;
  if (expected === null || received === null) return Object.is(received, expected);
  if (typeof expected !== 'object' || typeof received !== 'object')
    return Object.is(received, expected);

  if (Array.isArray(expected) && Array.isArray(received)) {
    if (expected.length !== received.length) return false;
    for (let i = 0; i < expected.length; i++) {
      if (!deepMatchObject(received[i], expected[i])) return false;
    }
    return true;
  }
  if (Array.isArray(expected) || Array.isArray(received)) return false;

  const expObj = expected as Record<string, unknown>;
  const recObj = received as Record<string, unknown>;
  for (const key of Object.keys(expObj)) {
    if (!Object.hasOwn(recObj, key)) return false;
    if (!deepMatchObject(recObj[key], expObj[key])) return false;
  }
  return true;
}

/**
 * Resolves a dot-separated property path on an object.
 * Returns `{ found: true, value }` or `{ found: false }`.
 */
function resolvePath(obj: unknown, dotPath: string): { found: boolean; value?: unknown } {
  const parts = dotPath.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return { found: false };
    const record = cur as Record<string, unknown>;
    if (!Object.hasOwn(record, part)) return { found: false };
    cur = record[part];
  }
  return { found: true, value: cur };
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
      deepEqual(this.#received, expected),
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

  // ---- New matchers (devtools#683) -----------------------------------------

  toMatchObject(expected: Record<string, unknown>): void {
    this.#assert(
      deepMatchObject(this.#received, expected),
      `Expected object to match ${JSON.stringify(expected)}, received ${JSON.stringify(this.#received)}`,
    );
  }

  toHaveProperty(dotPath: string, ...rest: unknown[]): void {
    const { found, value: actual } = resolvePath(this.#received, dotPath);
    if (rest.length > 0) {
      const value = rest[0];
      this.#assert(
        found && deepEqual(actual, value),
        `Expected property "${dotPath}" to equal ${JSON.stringify(value)}, got ${JSON.stringify(actual)}`,
      );
    } else {
      this.#assert(found, `Expected property "${dotPath}" to exist`);
    }
  }

  // The `abstract new (...args: never) => unknown` signature is the widest
  // constructor type that TypeScript allows without explicit `any`. Real-world
  // constructors like `ErrorConstructor` are assignable to it because `never`
  // in parameter position is contravariant (any arg list satisfies `never[]`).
  toBeInstanceOf(ctor: abstract new (...args: never) => unknown): void {
    this.#assert(
      this.#received instanceof (ctor as new (...args: unknown[]) => unknown),
      `Expected instance of ${(ctor as { name?: string }).name ?? String(ctor)}, received ${String(this.#received)}`,
    );
  }

  toBeTypeOf(typeStr: string): void {
    this.#assert(
      typeof this.#received === typeStr,
      `Expected typeof "${typeStr}", received "${typeof this.#received}"`,
    );
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
/* Lifecycle hooks (devtools#683)                                              */
/* -------------------------------------------------------------------------- */

type HookType = 'beforeAll' | 'afterAll' | 'beforeEach' | 'afterEach';

interface HookEntry {
  /** Suite path at the time of registration ([] = module scope). */
  suitePath: string[];
  type: HookType;
  fn: () => void | Promise<void>;
}

const _hooks: HookEntry[] = [];

function _registerHook(type: HookType, fn: () => void | Promise<void>): void {
  _hooks.push({ suitePath: [..._suiteStack], type, fn });
}

/**
 * Returns hooks whose suitePath is a prefix of `testSuitePath`
 * (i.e. the hook's scope contains the test).
 */
function _hooksFor(type: HookType, testSuitePath: string[]): Array<() => void | Promise<void>> {
  return _hooks
    .filter((h) => {
      if (h.type !== type) return false;
      // Hook scope must be a prefix of the test's suite path
      if (h.suitePath.length > testSuitePath.length) return false;
      for (let i = 0; i < h.suitePath.length; i++) {
        if (h.suitePath[i] !== testSuitePath[i]) return false;
      }
      return true;
    })
    .map((h) => h.fn);
}

/** Runs an array of hook functions in order, awaiting each. */
async function _runHooks(fns: Array<() => void | Promise<void>>): Promise<Error | null> {
  for (const fn of fns) {
    try {
      await fn();
    } catch (e) {
      return e instanceof Error ? e : new Error(String(e));
    }
  }
  return null;
}

function beforeAll(fn: () => void | Promise<void>): void {
  _registerHook('beforeAll', fn);
}
function afterAll(fn: () => void | Promise<void>): void {
  _registerHook('afterAll', fn);
}
function beforeEach(fn: () => void | Promise<void>): void {
  _registerHook('beforeEach', fn);
}
function afterEach(fn: () => void | Promise<void>): void {
  _registerHook('afterEach', fn);
}

/* -------------------------------------------------------------------------- */
/* vi shim (devtools#683)                                                      */
/* -------------------------------------------------------------------------- */

interface SpyCall {
  args: unknown[];
  returnValue: unknown;
}

interface MockFn<T extends unknown[], R> {
  (...args: T): R;
  mock: { calls: SpyCall[] };
  mockImplementation(fn: (...args: T) => R): this;
  mockReturnValue(value: R): this;
  mockRestore(): void;
}

interface SpyRecord {
  obj: Record<string, unknown>;
  method: string;
  original: unknown;
}

const _spyRegistry: SpyRecord[] = [];

function _createMockFn<T extends unknown[], R>(impl?: (...args: T) => R): MockFn<T, R> {
  let currentImpl: ((...args: T) => R) | undefined = impl;
  const calls: SpyCall[] = [];

  const mockFn = ((...args: T): R => {
    const returnValue = currentImpl ? currentImpl(...args) : (undefined as unknown as R);
    calls.push({ args, returnValue });
    return returnValue;
  }) as MockFn<T, R>;

  mockFn.mock = { calls };

  mockFn.mockImplementation = function (fn: (...args: T) => R): typeof mockFn {
    currentImpl = fn;
    return this;
  };

  mockFn.mockReturnValue = function (value: R): typeof mockFn {
    currentImpl = () => value;
    return this;
  };

  // No-op restore for standalone fn (only spyOn-created fns have a real restore)
  mockFn.mockRestore = (): void => {};

  return mockFn;
}

const vi = {
  /** Creates a spy on `obj[method]`, replacing it with a mock function. */
  spyOn<T extends Record<string, unknown>, K extends keyof T>(
    obj: T,
    method: K,
  ): MockFn<unknown[], unknown> {
    const original = obj[method];
    const spy = _createMockFn<unknown[], unknown>(
      typeof original === 'function' ? (original as (...args: unknown[]) => unknown) : undefined,
    );

    spy.mockRestore = (): void => {
      obj[method] = original as T[K];
    };

    _spyRegistry.push({ obj: obj as Record<string, unknown>, method: method as string, original });
    obj[method] = spy as unknown as T[K];
    return spy;
  },

  /** Creates a standalone mock function, optionally wrapping `impl`. */
  fn<T extends unknown[], R>(impl?: (...args: T) => R): MockFn<T, R> {
    return _createMockFn(impl);
  },

  /** Restores all spies created via `vi.spyOn` to their original values. */
  restoreAllMocks(): void {
    for (const { obj, method, original } of _spyRegistry) {
      obj[method] = original;
    }
    _spyRegistry.length = 0;
  },
};

/* -------------------------------------------------------------------------- */
/* Runtime entry point                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Runtime globals object — exported for direct use in unit tests so that
 * test factories can reference runtime's own `it`/`expect`/`beforeAll`/etc.
 * without depending on `globalThis` injection.
 *
 * In a real WebView bundle these are accessed via globals installed by
 * `runTestModule`; in Node tests, import from here directly.
 */
export const runtimeGlobals = {
  describe,
  it,
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} as const;

/**
 * Installs describe/it/test/expect/afterAll/afterEach/beforeAll/beforeEach/vi
 * as globals, invokes `moduleFactory` to register the user's tests, then
 * executes them and returns a RunReport.
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
  _hooks.length = 0;
  _spyRegistry.length = 0;

  // Install globals that user test code expects.
  type G = typeof globalThis & {
    describe: typeof describe;
    it: typeof it;
    test: typeof test;
    expect: typeof expect;
    beforeAll: typeof beforeAll;
    afterAll: typeof afterAll;
    beforeEach: typeof beforeEach;
    afterEach: typeof afterEach;
    vi: typeof vi;
  };
  const g = globalThis as G;
  g.describe = describe;
  g.it = it;
  g.test = test;
  g.expect = expect;
  g.beforeAll = beforeAll;
  g.afterAll = afterAll;
  g.beforeEach = beforeEach;
  g.afterEach = afterEach;
  g.vi = vi;

  // Run the factory (which registers describe/it/test blocks via globals).
  if (moduleFactory) {
    await moduleFactory();
  }

  const wallStart = Date.now();
  const startedAt = new Date(wallStart).toISOString();
  const results: TestResult[] = [];

  // Determine unique suite scopes from registered tests, in discovery order.
  // We need to fire beforeAll/afterAll once per scope (grouped by suitePath).
  //
  // Simplified model: we run beforeAll hooks before the first test in a scope
  // and afterAll hooks after the last test in a scope. Scope identity is the
  // entire suitePath string (e.g. "Suite A > Suite B").
  //
  // For module-scope hooks (suitePath=[]), they wrap the entire test run.

  // Group tests by their suite key to track beforeAll/afterAll per scope.
  // We keep a Set of scopes for which beforeAll has been fired.
  const firedBeforeAll = new Set<string>();
  // Map from scope key → last index in _pendingTests that belongs to that scope.
  const lastIndexForScope = new Map<string, number>();
  for (let i = 0; i < _pendingTests.length; i++) {
    const key = _pendingTests[i].suitePath.join('\0');
    lastIndexForScope.set(key, i);
    // Also compute for parent scopes (module scope = '')
    const path = _pendingTests[i].suitePath;
    for (let depth = 0; depth < path.length; depth++) {
      const parentKey = path.slice(0, depth).join('\0');
      const cur = lastIndexForScope.get(parentKey) ?? -1;
      if (i > cur) lastIndexForScope.set(parentKey, i);
    }
  }
  // Module scope key
  const MODULE_KEY = '';
  if (!lastIndexForScope.has(MODULE_KEY) && _pendingTests.length > 0) {
    lastIndexForScope.set(MODULE_KEY, _pendingTests.length - 1);
  }

  // Fire module-scope beforeAll before any tests
  if (_pendingTests.length > 0) {
    const baFns = _hooksFor('beforeAll', []);
    const baErr = await _runHooks(baFns);
    firedBeforeAll.add(MODULE_KEY);
    if (baErr) {
      // If module beforeAll fails, mark all tests as failed.
      for (const pending of _pendingTests) {
        const fullName = [...pending.suitePath, pending.name].join(' > ');
        results.push({
          name: fullName,
          status: 'fail',
          duration: 0,
          error: `beforeAll failed: ${baErr.message}`,
        });
      }
      const duration = Date.now() - wallStart;
      const passed = results.filter((r) => r.status === 'pass').length;
      const failed = results.filter((r) => r.status === 'fail').length;
      const skipped = results.filter((r) => r.status === 'skip').length;
      // Still run module afterAll for cleanup (e.g. flushCapture)
      const aaFns = _hooksFor('afterAll', []);
      await _runHooks(aaFns);
      return { startedAt, duration, passed, failed, skipped, tests: results };
    }
  }

  for (let i = 0; i < _pendingTests.length; i++) {
    const pending = _pendingTests[i];
    const fullName = [...pending.suitePath, pending.name].join(' > ');

    if (pending.skip) {
      results.push({ name: fullName, status: 'skip', duration: 0 });
      continue;
    }

    // Fire suite-scoped beforeAll for any new scopes entered by this test
    for (let depth = 1; depth <= pending.suitePath.length; depth++) {
      const scopePath = pending.suitePath.slice(0, depth);
      const scopeKey = scopePath.join('\0');
      if (!firedBeforeAll.has(scopeKey)) {
        // Only hooks registered exactly at this scope (not broader/narrower)
        const scopedFns = _hooks
          .filter((h) => h.type === 'beforeAll' && h.suitePath.join('\0') === scopeKey)
          .map((h) => h.fn);
        const baErr = await _runHooks(scopedFns);
        firedBeforeAll.add(scopeKey);
        if (baErr) {
          // Mark remaining tests in this scope as failed
          results.push({
            name: fullName,
            status: 'fail',
            duration: 0,
            error: `beforeAll failed: ${baErr.message}`,
          });
        }
      }
    }

    // beforeEach
    const beFns = _hooksFor('beforeEach', pending.suitePath);
    const beErr = await _runHooks(beFns);

    const tStart = Date.now();
    let testErr: string | undefined;

    if (beErr) {
      testErr = `beforeEach failed: ${beErr.message}`;
    } else {
      try {
        await pending.fn();
      } catch (e) {
        testErr = e instanceof Error ? e.message : String(e);
      }
    }

    // afterEach — always run even if test failed
    const aeFns = _hooksFor('afterEach', pending.suitePath);
    const aeErr = await _runHooks(aeFns);
    if (aeErr && !testErr) testErr = `afterEach failed: ${aeErr.message}`;

    if (testErr !== undefined) {
      results.push({
        name: fullName,
        status: 'fail',
        duration: Date.now() - tStart,
        error: testErr,
      });
    } else {
      results.push({ name: fullName, status: 'pass', duration: Date.now() - tStart });
    }

    // Fire suite-scoped afterAll when this is the last test in each scope
    for (let depth = pending.suitePath.length; depth >= 1; depth--) {
      const scopePath = pending.suitePath.slice(0, depth);
      const scopeKey = scopePath.join('\0');
      const lastIdx = lastIndexForScope.get(scopeKey) ?? -1;
      if (lastIdx === i) {
        const scopedFns = _hooks
          .filter((h) => h.type === 'afterAll' && h.suitePath.join('\0') === scopeKey)
          .map((h) => h.fn);
        await _runHooks(scopedFns);
      }
    }
  }

  // Fire module-scope afterAll after all tests — critical for flushCapture
  const moduleAfterAllFns = _hooks
    .filter((h) => h.type === 'afterAll' && h.suitePath.length === 0)
    .map((h) => h.fn);
  await _runHooks(moduleAfterAllFns);

  const duration = Date.now() - wallStart;
  const passed = results.filter((r) => r.status === 'pass').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const skipped = results.filter((r) => r.status === 'skip').length;

  return { startedAt, duration, passed, failed, skipped, tests: results };
}
