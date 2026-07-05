/**
 * Unit tests for the bounded teardown orchestrator (devtools#755).
 *
 * SECRET-HANDLING: all fixtures are synthetic — no real TOTP codes, relay
 * wss URLs, or scheme URLs appear anywhere in this file.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { armExitBackstop, runTeardownSteps, type TeardownStep } from './teardown.js';

describe('runTeardownSteps', () => {
  it('calls each step close() exactly once, in order', async () => {
    const order: string[] = [];
    const steps: TeardownStep[] = [
      {
        name: 'a',
        close: vi.fn(() => {
          order.push('a');
        }),
      },
      {
        name: 'b',
        close: vi.fn(() => {
          order.push('b');
        }),
      },
      {
        name: 'c',
        close: vi.fn(() => {
          order.push('c');
        }),
      },
    ];

    const results = await runTeardownSteps(steps);

    for (const step of steps) {
      expect(step.close).toHaveBeenCalledTimes(1);
    }
    expect(order).toEqual(['a', 'b', 'c']);
    expect(results).toEqual([
      { name: 'a', status: 'ok' },
      { name: 'b', status: 'ok' },
      { name: 'c', status: 'ok' },
    ]);
  });

  it('is safe to run the same idempotent step twice across two calls', async () => {
    let callCount = 0;
    const idempotentClose = vi.fn(() => {
      callCount += 1;
      // Idempotent: no-op on the second call, same observable outcome.
    });
    const steps: TeardownStep[] = [{ name: 'idempotent', close: idempotentClose }];

    await runTeardownSteps(steps);
    await runTeardownSteps(steps);

    expect(callCount).toBe(2);
    expect(idempotentClose).toHaveBeenCalledTimes(2);
  });

  it('marks a step "error" when close() throws, but still runs later steps', async () => {
    const laterClose = vi.fn();
    const steps: TeardownStep[] = [
      {
        name: 'throws',
        close: () => {
          throw new Error('boom');
        },
      },
      { name: 'later', close: laterClose },
    ];

    const results = await runTeardownSteps(steps);

    expect(results[0]).toEqual({ name: 'throws', status: 'error', error: 'boom' });
    expect(results[1]).toEqual({ name: 'later', status: 'ok' });
    expect(laterClose).toHaveBeenCalledTimes(1);
  });

  it('marks a step "error" when close() rejects, but still runs later steps', async () => {
    const laterClose = vi.fn();
    const steps: TeardownStep[] = [
      { name: 'rejects', close: () => Promise.reject(new Error('async boom')) },
      { name: 'later', close: laterClose },
    ];

    const results = await runTeardownSteps(steps);

    expect(results[0]).toEqual({ name: 'rejects', status: 'error', error: 'async boom' });
    expect(results[1]).toEqual({ name: 'later', status: 'ok' });
  });

  it('marks a stuck (never-resolving) step "timeout" after perStepTimeoutMs, and still runs later steps', async () => {
    const laterClose = vi.fn();
    const steps: TeardownStep[] = [
      {
        name: 'stuck',
        // Simulates a hung close() — e.g. a fake handle whose close() never
        // resolves (mirrors the pre-fix qr-http-server.ts server.close()
        // behaviour with an open SSE tab, devtools#755).
        close: () => new Promise<void>(() => {}),
      },
      { name: 'later', close: laterClose },
    ];

    const results = await runTeardownSteps(steps, { perStepTimeoutMs: 20 });

    expect(results[0]).toEqual({ name: 'stuck', status: 'timeout' });
    expect(results[1]).toEqual({ name: 'later', status: 'ok' });
    expect(laterClose).toHaveBeenCalledTimes(1);
  });
});

describe('armExitBackstop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does NOT fire when disarmed before graceMs elapses (happy path)', () => {
    const exitFn = vi.fn();
    const backstop = armExitBackstop({ graceMs: 3_000, exitCode: 0, exitFn });

    backstop.disarm();
    vi.advanceTimersByTime(10_000);

    expect(exitFn).not.toHaveBeenCalled();
    expect(backstop.fired).toBe(false);
  });

  it('fires exitFn(exitCode) when graceMs elapses without disarm (stuck handle)', () => {
    const exitFn = vi.fn();
    const backstop = armExitBackstop({ graceMs: 3_000, exitCode: 1, exitFn });

    vi.advanceTimersByTime(2_999);
    expect(exitFn).not.toHaveBeenCalled();
    expect(backstop.fired).toBe(false);

    vi.advanceTimersByTime(1);
    expect(exitFn).toHaveBeenCalledExactlyOnceWith(1);
    expect(backstop.fired).toBe(true);
  });

  it('passes through the exact exit code given at arm time', () => {
    const exitFn = vi.fn();
    armExitBackstop({ graceMs: 100, exitCode: 42, exitFn });

    vi.advanceTimersByTime(100);

    expect(exitFn).toHaveBeenCalledExactlyOnceWith(42);
  });

  it('disarm() is safe to call more than once (idempotent)', () => {
    const exitFn = vi.fn();
    const backstop = armExitBackstop({ graceMs: 100, exitCode: 0, exitFn });

    backstop.disarm();
    backstop.disarm();
    vi.advanceTimersByTime(1_000);

    expect(exitFn).not.toHaveBeenCalled();
  });
});

describe('runTeardownSteps + armExitBackstop integration — the CLI wiring shape', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('backstop never fires when every teardown step behaves (mirrors cli.ts Step 6 happy path)', async () => {
    const exitFn = vi.fn();
    const backstop = armExitBackstop({ graceMs: 3_000, exitCode: 0, exitFn });

    const closeMock = vi.fn(() => Promise.resolve());
    await runTeardownSteps([{ name: 'factory.close', close: closeMock }]);
    backstop.disarm();

    vi.advanceTimersByTime(10_000);

    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(exitFn).not.toHaveBeenCalled();
  });

  it('backstop fires when a step is stuck past its own per-step timeout AND the caller never disarms', async () => {
    // Simulates the pre-fix bug: factory.close() never resolves because an
    // underlying http.Server#close() callback never fires (devtools#755).
    const exitFn = vi.fn();
    const backstop = armExitBackstop({ graceMs: 3_000, exitCode: 1, exitFn });

    const stuckClose = () => new Promise<void>(() => {});
    // runTeardownSteps bounds the stuck step at perStepTimeoutMs and moves on
    // — it resolves its own promise either way, so this await always returns.
    const resultsPromise = runTeardownSteps([{ name: 'factory.close', close: stuckClose }], {
      perStepTimeoutMs: 50,
    });
    await vi.advanceTimersByTimeAsync(50);
    const results = await resultsPromise;
    expect(results).toEqual([{ name: 'factory.close', status: 'timeout' }]);

    // The caller (cli.ts) would normally call backstop.disarm() right after —
    // here we deliberately do NOT, to assert the backstop is the last line
    // of defense when something stays stuck beyond what runTeardownSteps can
    // bound (e.g. a handle outside the enumerated steps).
    vi.advanceTimersByTime(3_000);

    expect(exitFn).toHaveBeenCalledExactlyOnceWith(1);
    expect(backstop.fired).toBe(true);
  });
});
