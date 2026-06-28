/**
 * Unit tests for the WebView test runtime (devtools#683).
 *
 * Verifies: new matchers, lifecycle hooks (beforeAll/afterAll/beforeEach/afterEach),
 * async hooks, afterAll side-effects, and the vi spy/restoreAllMocks shim.
 *
 * The runtime is browser-compatible code but can run fine under Node/jsdom
 * since it uses no browser-specific APIs internally.
 *
 * Factory functions passed to `runTestModule` use `rg` (runtimeGlobals) to call
 * runtime's own `it`/`expect`/`beforeAll`/etc. directly — this avoids the
 * ambiguity between Vitest's imported globals and the runtime's globals that
 * `runTestModule` installs on `globalThis`.
 *
 * @vitest-environment node
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { RunReport } from '../test-runner/runtime.js';
import { runtimeGlobals as rg, runTestModule } from '../test-runner/runtime.js';

/* -------------------------------------------------------------------------- */
/* Helper                                                                      */
/* -------------------------------------------------------------------------- */

async function run(factory: () => void | Promise<void>): Promise<RunReport> {
  return runTestModule(factory);
}

/* -------------------------------------------------------------------------- */
/* New matchers — toMatchObject                                                */
/* -------------------------------------------------------------------------- */

describe('Expectation.toMatchObject — partial match passes', () => {
  let report: RunReport;
  beforeAll(async () => {
    report = await run(() => {
      rg.it('partial match', () => {
        rg.expect({ a: 1, b: 2, c: 3 }).toMatchObject({ a: 1, b: 2 });
      });
    });
  });
  it('1 passed', () => {
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(0);
  });
});

describe('Expectation.toMatchObject — value mismatch fails', () => {
  let report: RunReport;
  beforeAll(async () => {
    report = await run(() => {
      rg.it('mismatch', () => {
        rg.expect({ a: 1 }).toMatchObject({ a: 2 });
      });
    });
  });
  it('1 failed', () => {
    expect(report.failed).toBe(1);
  });
});

describe('Expectation.toMatchObject — missing key fails', () => {
  let report: RunReport;
  beforeAll(async () => {
    report = await run(() => {
      rg.it('missing', () => {
        rg.expect({ a: 1 }).toMatchObject({ b: 1 });
      });
    });
  });
  it('1 failed', () => {
    expect(report.failed).toBe(1);
  });
});

describe('Expectation.toMatchObject — not.toMatchObject passes', () => {
  let report: RunReport;
  beforeAll(async () => {
    report = await run(() => {
      rg.it('not match', () => {
        rg.expect({ a: 1 }).not.toMatchObject({ b: 2 });
      });
    });
  });
  it('1 passed', () => {
    expect(report.passed).toBe(1);
  });
});

describe('Expectation.toMatchObject — nested partial match', () => {
  let report: RunReport;
  beforeAll(async () => {
    report = await run(() => {
      rg.it('nested', () => {
        rg.expect({ a: { b: 1, c: 2 } }).toMatchObject({ a: { b: 1 } });
      });
    });
  });
  it('1 passed', () => {
    expect(report.passed).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* New matchers — toHaveProperty                                               */
/* -------------------------------------------------------------------------- */

describe('Expectation.toHaveProperty — existing key passes', () => {
  let report: RunReport;
  beforeAll(async () => {
    report = await run(() => {
      rg.it('has x', () => {
        rg.expect({ x: 42 }).toHaveProperty('x');
      });
    });
  });
  it('1 passed', () => {
    expect(report.passed).toBe(1);
  });
});

describe('Expectation.toHaveProperty — matching value passes', () => {
  let report: RunReport;
  beforeAll(async () => {
    report = await run(() => {
      rg.it('x=42', () => {
        rg.expect({ x: 42 }).toHaveProperty('x', 42);
      });
    });
  });
  it('1 passed', () => {
    expect(report.passed).toBe(1);
  });
});

describe('Expectation.toHaveProperty — wrong value fails', () => {
  let report: RunReport;
  beforeAll(async () => {
    report = await run(() => {
      rg.it('x=99 fails', () => {
        rg.expect({ x: 42 }).toHaveProperty('x', 99);
      });
    });
  });
  it('1 failed', () => {
    expect(report.failed).toBe(1);
  });
});

describe('Expectation.toHaveProperty — dot-path traversal', () => {
  let report: RunReport;
  beforeAll(async () => {
    report = await run(() => {
      rg.it('a.b=7', () => {
        rg.expect({ a: { b: 7 } }).toHaveProperty('a.b', 7);
      });
    });
  });
  it('1 passed', () => {
    expect(report.passed).toBe(1);
  });
});

describe('Expectation.toHaveProperty — missing nested key fails', () => {
  let report: RunReport;
  beforeAll(async () => {
    report = await run(() => {
      rg.it('missing', () => {
        rg.expect({ a: {} }).toHaveProperty('a.missing');
      });
    });
  });
  it('1 failed', () => {
    expect(report.failed).toBe(1);
  });
});

describe('Expectation.toHaveProperty — not.toHaveProperty passes', () => {
  let report: RunReport;
  beforeAll(async () => {
    report = await run(() => {
      rg.it('no b', () => {
        rg.expect({ a: 1 }).not.toHaveProperty('b');
      });
    });
  });
  it('1 passed', () => {
    expect(report.passed).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* New matchers — toBeInstanceOf                                               */
/* -------------------------------------------------------------------------- */

describe('Expectation.toBeInstanceOf — correct class passes', () => {
  let report: RunReport;
  beforeAll(async () => {
    report = await run(() => {
      rg.it('Error instance', () => {
        rg.expect(new Error('x')).toBeInstanceOf(Error);
      });
    });
  });
  it('1 passed', () => {
    expect(report.passed).toBe(1);
  });
});

describe('Expectation.toBeInstanceOf — wrong class fails', () => {
  let report: RunReport;
  beforeAll(async () => {
    report = await run(() => {
      rg.it('string not Error', () => {
        rg.expect('string').toBeInstanceOf(Error);
      });
    });
  });
  it('1 failed', () => {
    expect(report.failed).toBe(1);
  });
});

describe('Expectation.toBeInstanceOf — not.toBeInstanceOf passes', () => {
  let report: RunReport;
  beforeAll(async () => {
    report = await run(() => {
      rg.it('string not Error', () => {
        rg.expect('string').not.toBeInstanceOf(Error);
      });
    });
  });
  it('1 passed', () => {
    expect(report.passed).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* New matchers — toBeTypeOf                                                   */
/* -------------------------------------------------------------------------- */

describe('Expectation.toBeTypeOf — correct type passes', () => {
  let report: RunReport;
  beforeAll(async () => {
    report = await run(() => {
      rg.it('42 is number', () => {
        rg.expect(42).toBeTypeOf('number');
      });
    });
  });
  it('1 passed', () => {
    expect(report.passed).toBe(1);
  });
});

describe('Expectation.toBeTypeOf — wrong type fails', () => {
  let report: RunReport;
  beforeAll(async () => {
    report = await run(() => {
      rg.it('42 is not string', () => {
        rg.expect(42).toBeTypeOf('string');
      });
    });
  });
  it('1 failed', () => {
    expect(report.failed).toBe(1);
  });
});

describe('Expectation.toBeTypeOf — not.toBeTypeOf passes', () => {
  let report: RunReport;
  beforeAll(async () => {
    report = await run(() => {
      rg.it('hi not number', () => {
        rg.expect('hi').not.toBeTypeOf('number');
      });
    });
  });
  it('1 passed', () => {
    expect(report.passed).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Lifecycle hooks — beforeAll + afterAll fire once                            */
/* -------------------------------------------------------------------------- */

describe('lifecycle hooks — beforeAll + afterAll', () => {
  const order: string[] = [];
  let report: RunReport;
  beforeAll(async () => {
    order.length = 0;
    report = await run(() => {
      rg.beforeAll(() => {
        order.push('beforeAll');
      });
      rg.afterAll(() => {
        order.push('afterAll');
      });
      rg.it('test1', () => {
        order.push('test1');
      });
      rg.it('test2', () => {
        order.push('test2');
      });
    });
  });
  it('passes 2 tests', () => {
    expect(report.passed).toBe(2);
  });
  it('fires beforeAll once before tests and afterAll once after', () => {
    expect(order).toEqual(['beforeAll', 'test1', 'test2', 'afterAll']);
  });
});

/* -------------------------------------------------------------------------- */
/* Lifecycle hooks — beforeEach + afterEach fire per test                      */
/* -------------------------------------------------------------------------- */

describe('lifecycle hooks — beforeEach + afterEach', () => {
  const order: string[] = [];
  let report: RunReport;
  beforeAll(async () => {
    order.length = 0;
    report = await run(() => {
      rg.beforeEach(() => {
        order.push('beforeEach');
      });
      rg.afterEach(() => {
        order.push('afterEach');
      });
      rg.it('t1', () => {
        order.push('t1');
      });
      rg.it('t2', () => {
        order.push('t2');
      });
    });
  });
  it('passes 2 tests', () => {
    expect(report.passed).toBe(2);
  });
  it('fires beforeEach+afterEach around each test', () => {
    expect(order).toEqual(['beforeEach', 't1', 'afterEach', 'beforeEach', 't2', 'afterEach']);
  });
});

/* -------------------------------------------------------------------------- */
/* Lifecycle hooks — full order                                                */
/* -------------------------------------------------------------------------- */

describe('lifecycle hooks — full BA/BE/AE/AA order', () => {
  const order: string[] = [];
  let report: RunReport;
  beforeAll(async () => {
    order.length = 0;
    report = await run(() => {
      rg.beforeAll(() => {
        order.push('BA');
      });
      rg.afterAll(() => {
        order.push('AA');
      });
      rg.beforeEach(() => {
        order.push('BE');
      });
      rg.afterEach(() => {
        order.push('AE');
      });
      rg.it('x', () => {
        order.push('x');
      });
      rg.it('y', () => {
        order.push('y');
      });
    });
  });
  it('passes 2 tests', () => {
    expect(report.passed).toBe(2);
  });
  it('fires in the correct order', () => {
    expect(order).toEqual(['BA', 'BE', 'x', 'AE', 'BE', 'y', 'AE', 'AA']);
  });
});

/* -------------------------------------------------------------------------- */
/* Lifecycle hooks — async hooks are awaited                                   */
/* -------------------------------------------------------------------------- */

describe('lifecycle hooks — async hooks', () => {
  const order: string[] = [];
  let report: RunReport;
  beforeAll(async () => {
    order.length = 0;
    report = await run(() => {
      rg.beforeAll(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 1));
        order.push('asyncBeforeAll');
      });
      rg.afterAll(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 1));
        order.push('asyncAfterAll');
      });
      rg.it('t', () => {
        order.push('t');
      });
    });
  });
  it('passes 1 test', () => {
    expect(report.passed).toBe(1);
  });
  it('awaits async hooks in order', () => {
    expect(order).toEqual(['asyncBeforeAll', 't', 'asyncAfterAll']);
  });
});

/* -------------------------------------------------------------------------- */
/* Lifecycle hooks — afterAll runs even after failures                         */
/* -------------------------------------------------------------------------- */

describe('lifecycle hooks — afterAll runs after failures', () => {
  let flushed = false;
  let report: RunReport;
  beforeAll(async () => {
    flushed = false;
    report = await run(() => {
      rg.afterAll(() => {
        flushed = true;
      });
      rg.it('failing test', () => {
        throw new Error('intentional');
      });
    });
  });
  it('marks 1 test failed', () => {
    expect(report.failed).toBe(1);
  });
  it('afterAll side-effect executed', () => {
    expect(flushed).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* vi shim                                                                     */
/* -------------------------------------------------------------------------- */

describe('vi.spyOn — replaces and records calls', () => {
  it('mockImplementation overrides return value and records calls', () => {
    const obj: { greet: () => string } = { greet: () => 'real' };
    const spy = rg.vi.spyOn(obj, 'greet').mockImplementation(() => 'mock');
    const result = obj.greet();
    expect(result).toBe('mock');
    expect(spy.mock.calls.length).toBe(1);
    rg.vi.restoreAllMocks();
    expect(obj.greet()).toBe('real');
  });
});

describe('vi.restoreAllMocks — reverts multiple spies', () => {
  it('restores all spied methods to their originals', () => {
    const a: { fn: () => string } = { fn: () => 'a' };
    const b: { fn: () => string } = { fn: () => 'b' };
    rg.vi.spyOn(a, 'fn').mockImplementation(() => 'mocked-a');
    rg.vi.spyOn(b, 'fn').mockImplementation(() => 'mocked-b');
    expect(a.fn()).toBe('mocked-a');
    expect(b.fn()).toBe('mocked-b');
    rg.vi.restoreAllMocks();
    expect(a.fn()).toBe('a');
    expect(b.fn()).toBe('b');
  });
});

describe('vi.fn — standalone mock function', () => {
  it('records calls and uses implementation', () => {
    const mock = rg.vi.fn((x: number) => x * 2);
    const result = mock(3);
    expect(result).toBe(6);
    expect(mock.mock.calls.length).toBe(1);
  });

  it('mockReturnValue overrides return value', () => {
    const mock = rg.vi.fn(() => 'original');
    mock.mockReturnValue('overridden');
    expect(mock()).toBe('overridden');
  });
});

/* -------------------------------------------------------------------------- */
/* Conditional test registration — it.skipIf / it.runIf                        */
/* -------------------------------------------------------------------------- */

describe('it.skipIf — registers as skipped when condition is truthy', () => {
  let report: RunReport;
  let ran = false;
  beforeAll(async () => {
    ran = false;
    report = await run(() => {
      rg.it.skipIf(true)('skipped', () => {
        ran = true;
      });
    });
  });
  it('marks the test skipped', () => {
    expect(report.skipped).toBe(1);
    expect(report.passed).toBe(0);
  });
  it('does not execute the body', () => {
    expect(ran).toBe(false);
  });
});

describe('it.skipIf — runs normally when condition is falsy', () => {
  let report: RunReport;
  let ran = false;
  beforeAll(async () => {
    ran = false;
    report = await run(() => {
      rg.it.skipIf(false)('runs', () => {
        ran = true;
      });
    });
  });
  it('runs the test', () => {
    expect(report.passed).toBe(1);
    expect(report.skipped).toBe(0);
  });
  it('executes the body', () => {
    expect(ran).toBe(true);
  });
});

describe('it.runIf — runs only when condition is truthy', () => {
  let runReport: RunReport;
  let skipReport: RunReport;
  beforeAll(async () => {
    runReport = await run(() => {
      rg.it.runIf(true)('runs', () => {});
    });
    skipReport = await run(() => {
      rg.it.runIf(false)('skipped', () => {});
    });
  });
  it('runs when truthy', () => {
    expect(runReport.passed).toBe(1);
  });
  it('skips when falsy', () => {
    expect(skipReport.skipped).toBe(1);
  });
});

/* -------------------------------------------------------------------------- */
/* State reset between runTestModule calls                                     */
/* -------------------------------------------------------------------------- */

describe('state reset between runTestModule calls', () => {
  it('pendingTests and hooks do not bleed between calls', async () => {
    let callCount = 0;
    // First run — registers a beforeAll that increments callCount
    await runTestModule(() => {
      rg.beforeAll(() => {
        callCount++;
      });
      rg.it('a', () => {});
    });
    // Second run — no hooks registered; callCount must stay at 1
    await runTestModule(() => {
      rg.it('b', () => {});
    });
    expect(callCount).toBe(1);
  });
});
