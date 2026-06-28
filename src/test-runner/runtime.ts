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
/* Asymmetric matchers (devtools#692)                                          */
/* -------------------------------------------------------------------------- */

/**
 * Brand property that tags asymmetric matcher markers (`expect.any(String)`,
 * `expect.objectContaining(...)`, etc). A reserved string key is used as the
 * brand so the guard stays a plain own-property check — markers are only ever
 * compared in-process by reference, so no cross-realm Symbol coordination is
 * needed.
 */
const ASYMMETRIC_BRAND = '$$asymmetricMatch' as const;

/**
 * An asymmetric matcher: a placeholder that, when found on the `expected` side
 * of a deep comparison, runs its own `asymmetricMatch(actual)` predicate
 * instead of being structurally compared as a plain object. This is what makes
 * `toMatchObject({ hash: expect.any(String) })` match any string `hash`.
 */
interface AsymmetricMatcher {
  /** Brand discriminator — present only on asymmetric markers. */
  [ASYMMETRIC_BRAND]: true;
  /** Human-readable label used in failure messages. */
  toString(): string;
  /** Returns true when `actual` satisfies this matcher. */
  asymmetricMatch(actual: unknown): boolean;
}

/** Narrowing guard: is `v` an asymmetric matcher marker? */
function isAsymmetric(v: unknown): v is AsymmetricMatcher {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as Record<string, unknown>)[ASYMMETRIC_BRAND] === true &&
    typeof (v as { asymmetricMatch?: unknown }).asymmetricMatch === 'function'
  );
}

/** The widest constructor type TypeScript allows without `any` (see toBeInstanceOf). */
type AnyCtor = abstract new (...args: never) => unknown;

/**
 * `expect.any(Ctor)` — matches a value by its constructor. Primitive wrappers
 * (`String`/`Number`/`Boolean`) are matched by `typeof` (so the unboxed
 * primitive matches) AND by `instanceof` (so a boxed wrapper instance also
 * matches). `BigInt`/`Symbol` match by `typeof`. `Object` matches any object or
 * function, `Array` uses `Array.isArray`, `Function` uses `typeof ===
 * 'function'`, and any other constructor (user classes) falls back to
 * `instanceof`.
 */
function makeAny(ctor: AnyCtor): AsymmetricMatcher {
  const name = (ctor as { name?: string }).name ?? String(ctor);
  const ctorAsFn = ctor as unknown as (new (...args: unknown[]) => unknown) | undefined;
  return {
    [ASYMMETRIC_BRAND]: true,
    toString: () => `Any<${name}>`,
    asymmetricMatch(actual: unknown): boolean {
      if (actual === null || actual === undefined) return false;
      switch (ctor as unknown) {
        case String:
          return typeof actual === 'string' || actual instanceof String;
        case Number:
          return typeof actual === 'number' || actual instanceof Number;
        case Boolean:
          return typeof actual === 'boolean' || actual instanceof Boolean;
        case BigInt:
          return typeof actual === 'bigint';
        case Symbol:
          return typeof actual === 'symbol';
        case Function:
          return typeof actual === 'function';
        case Object:
          return typeof actual === 'object' || typeof actual === 'function';
        case Array:
          return Array.isArray(actual);
        default:
          return ctorAsFn ? actual instanceof ctorAsFn : false;
      }
    },
  };
}

/** `expect.anything()` — matches any value except `null`/`undefined`. */
function makeAnything(): AsymmetricMatcher {
  return {
    [ASYMMETRIC_BRAND]: true,
    toString: () => 'Anything',
    asymmetricMatch: (actual: unknown): boolean => actual !== null && actual !== undefined,
  };
}

/** `expect.objectContaining(obj)` — partial-match every key of `obj` on `actual`. */
function makeObjectContaining(expected: Record<string, unknown>): AsymmetricMatcher {
  return {
    [ASYMMETRIC_BRAND]: true,
    toString: () => `ObjectContaining<${safeStringify(expected)}>`,
    asymmetricMatch: (actual: unknown): boolean => deepMatchObject(actual, expected),
  };
}

/** `expect.arrayContaining(arr)` — `actual` is an array containing each element of `arr`. */
function makeArrayContaining(expected: unknown[]): AsymmetricMatcher {
  return {
    [ASYMMETRIC_BRAND]: true,
    toString: () => `ArrayContaining<${safeStringify(expected)}>`,
    asymmetricMatch(actual: unknown): boolean {
      if (!Array.isArray(actual)) return false;
      return expected.every((exp) =>
        actual.some((act) => (isAsymmetric(exp) ? exp.asymmetricMatch(act) : deepEqual(act, exp))),
      );
    },
  };
}

/** `expect.stringContaining(sub)` — `actual` is a string containing `sub`. */
function makeStringContaining(sub: string): AsymmetricMatcher {
  return {
    [ASYMMETRIC_BRAND]: true,
    toString: () => `StringContaining<${sub}>`,
    asymmetricMatch: (actual: unknown): boolean =>
      typeof actual === 'string' && actual.includes(sub),
  };
}

/** `expect.stringMatching(re)` — `actual` is a string matching `re` (string or RegExp). */
function makeStringMatching(re: string | RegExp): AsymmetricMatcher {
  const pattern = typeof re === 'string' ? new RegExp(re) : re;
  return {
    [ASYMMETRIC_BRAND]: true,
    toString: () => `StringMatching<${String(pattern)}>`,
    asymmetricMatch: (actual: unknown): boolean =>
      typeof actual === 'string' && pattern.test(actual),
  };
}

/* -------------------------------------------------------------------------- */
/* Deep equality helpers                                                        */
/* -------------------------------------------------------------------------- */

/** JSON.stringify that never throws (cycles/BigInt) — for failure messages. */
function safeStringify(v: unknown): string {
  try {
    return (
      JSON.stringify(v, (_k, val) =>
        isAsymmetric(val) ? val.toString() : typeof val === 'bigint' ? `${val}n` : val,
      ) ?? String(v)
    );
  } catch {
    return String(v);
  }
}

/**
 * Recursive structural equality — replaces JSON.stringify comparison to
 * handle key-order differences and undefined values correctly.
 *
 * When the `b` (expected) side is an asymmetric marker, its `asymmetricMatch`
 * predicate decides the result instead of structural comparison — markers are
 * placeholders, not plain objects, so deep-comparing them never matches.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (isAsymmetric(b)) return b.asymmetricMatch(a);
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
 *
 * As in `deepEqual`, an asymmetric marker on the `expected` side delegates to
 * its `asymmetricMatch` predicate rather than being compared structurally.
 */
function deepMatchObject(received: unknown, expected: unknown): boolean {
  if (isAsymmetric(expected)) return expected.asymmetricMatch(received);
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

/**
 * The `expect` callable plus its asymmetric-matcher static surface
 * (`expect.any`, `expect.objectContaining`, …). The user file accesses these as
 * `expect.any(String)`; the vitest redirect (`bundle.ts`) re-exports `expect` by
 * reading `globalThis.expect`, so attaching the statics to this function object
 * makes them reachable through the getter (a function's own properties survive
 * the getter that returns the function itself).
 */
interface ExpectStatic {
  (received: unknown): Expectation;
  any(ctor: AnyCtor): AsymmetricMatcher;
  anything(): AsymmetricMatcher;
  objectContaining(expected: Record<string, unknown>): AsymmetricMatcher;
  arrayContaining(expected: unknown[]): AsymmetricMatcher;
  stringContaining(sub: string): AsymmetricMatcher;
  stringMatching(re: string | RegExp): AsymmetricMatcher;
}

/** The `expect` function installed as a global. */
const expect: ExpectStatic = ((received: unknown): Expectation =>
  new Expectation(received)) as ExpectStatic;

// Asymmetric matcher statics — vitest-compatible surface (devtools#692).
expect.any = makeAny;
expect.anything = makeAnything;
expect.objectContaining = makeObjectContaining;
expect.arrayContaining = makeArrayContaining;
expect.stringContaining = makeStringContaining;
expect.stringMatching = makeStringMatching;

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

/**
 * `it.skipIf(cond)(name, fn)` / `it.runIf(cond)(name, fn)` — conditional test
 * registration. `skipIf` skips when `cond` is truthy; `runIf` runs only when
 * `cond` is truthy (skips otherwise). sdk-example uses
 * `it.skipIf(cell.platform === 'mock')(...)` to skip real-SDK-only cases in env1.
 */
type ItRegistrar = (name: string, fn: () => void | Promise<void>) => void;
function _conditionalIt(skip: boolean): ItRegistrar {
  return (name, fn) => {
    _pendingTests.push({ suitePath: [..._suiteStack], name, fn, skip });
  };
}
it.skipIf = (cond: unknown): ItRegistrar => _conditionalIt(Boolean(cond));
it.runIf = (cond: unknown): ItRegistrar => _conditionalIt(!cond);
test.skipIf = it.skipIf;
test.runIf = it.runIf;

/**
 * `describe.skipIf(cond)(name, fn)` / `describe.runIf(cond)(name, fn)`.
 * When skipped, the suite body still runs to register its tests but every test
 * inside is marked skipped (collected via a temporary skip flag is overkill —
 * a skipped describe simply does not invoke its body, mirroring `describe.skip`).
 */
type DescribeRegistrar = (name: string, fn: () => void) => void;
describe.skipIf = (cond: unknown): DescribeRegistrar =>
  cond ? (name, _fn) => void name : (name, fn) => describe(name, fn);
describe.runIf = (cond: unknown): DescribeRegistrar =>
  cond ? (name, fn) => describe(name, fn) : (name, _fn) => void name;

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
