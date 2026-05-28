/**
 * Unit tests for the `recentException` triage window in `callSdk` (#267).
 *
 * Coverage:
 *   - When an exception is in the buffer with a timestamp inside
 *     [callStart-50ms, callEnd+200ms], `callSdk` attaches it as `recentException`.
 *   - When no exception falls in the window, `recentException` is absent.
 *   - Only the most-recent exception in the window is attached (not all of them).
 */

import { describe, expect, it } from 'vitest';
import type {
  CdpCommandMap,
  CdpCommandName,
  CdpConnection,
  CdpEventMap,
  CdpEventName,
  CdpTarget,
  RuntimeExceptionThrownEvent,
} from '../cdp-connection.js';
import { callSdk, normalizeCallSdkResult } from '../tools.js';

/** Minimal successful `Runtime.evaluate` result simulating a `window.__sdkCall` envelope. */
function makeSdkEvalResult(ok: boolean, value: unknown = null) {
  return {
    result: {
      type: 'string' as const,
      value: JSON.stringify(ok ? { ok: true, value } : { ok: false, error: String(value) }),
    },
  };
}

/**
 * A fake CDP connection that:
 *   - Immediately resolves `Runtime.evaluate` with the given result.
 *   - Reports the given exception events from the buffer.
 */
class FakeSdkCdpConnection implements CdpConnection {
  private readonly evalResult: CdpCommandMap['Runtime.evaluate']['result'];
  private readonly exceptionBuffer: RuntimeExceptionThrownEvent[];

  constructor(
    evalResult: CdpCommandMap['Runtime.evaluate']['result'],
    exceptionBuffer: RuntimeExceptionThrownEvent[] = [],
  ) {
    this.evalResult = evalResult;
    this.exceptionBuffer = exceptionBuffer;
  }

  enableDomains(): Promise<void> {
    return Promise.resolve();
  }

  listTargets(): CdpTarget[] {
    return [];
  }

  getBufferedEvents<E extends CdpEventName>(event: E): ReadonlyArray<CdpEventMap[E]> {
    if (event === 'Runtime.exceptionThrown') {
      return this.exceptionBuffer as unknown as ReadonlyArray<CdpEventMap[E]>;
    }
    return [];
  }

  on(): () => void {
    return () => {};
  }

  send<M extends CdpCommandName>(method: M): Promise<CdpCommandMap[M]['result']> {
    if (method === 'Runtime.evaluate') {
      return Promise.resolve(this.evalResult as CdpCommandMap[M]['result']);
    }
    return Promise.reject(new Error(`Unexpected command: ${method}`));
  }
}

/** Builds a fake `Runtime.exceptionThrown` event at the given timestamp. */
function makeException(timestamp: number): RuntimeExceptionThrownEvent {
  return {
    timestamp,
    exceptionDetails: {
      exceptionId: 1,
      text: 'TypeError: bad call',
      lineNumber: 1,
      columnNumber: 0,
      exception: { type: 'object', subtype: 'error', description: 'TypeError: bad call' },
    },
  };
}

describe('callSdk — recentException triage window', () => {
  it('attaches recentException when an exception timestamp falls in the window', async () => {
    // We cannot control Date.now() precisely in this test, but we can place an
    // exception with a timestamp far in the future so it is always "within" the
    // window relative to the call. Using Date.now() + 0ms means the exception
    // is within [callStart-50ms, callEnd+200ms].
    const nowApprox = Date.now();
    const conn = new FakeSdkCdpConnection(makeSdkEvalResult(true, 'ok'), [
      makeException(nowApprox), // timestamp ≈ callStart → within window
    ]);

    const result = await callSdk(conn, 'testMethod', []);
    expect(result.ok).toBe(true);
    expect(result.recentException).toBeDefined();
    expect(result.recentException?.text).toBe('TypeError: bad call');
  });

  it('does NOT attach recentException when the exception is well outside the window', async () => {
    // Place the exception at timestamp=1 (epoch ms) — far before any reasonable callStart.
    const conn = new FakeSdkCdpConnection(makeSdkEvalResult(true, 'ok'), [makeException(1)]);

    const result = await callSdk(conn, 'testMethod', []);
    expect(result.ok).toBe(true);
    expect(result.recentException).toBeUndefined();
  });

  it('does NOT attach recentException when the buffer is empty', async () => {
    const conn = new FakeSdkCdpConnection(makeSdkEvalResult(true, 'ok'), []);

    const result = await callSdk(conn, 'testMethod', []);
    expect(result.ok).toBe(true);
    expect(result.recentException).toBeUndefined();
  });

  it('attaches recentException on ok:false result when exception is in window', async () => {
    const nowApprox = Date.now();
    const conn = new FakeSdkCdpConnection(makeSdkEvalResult(false, 'permission denied'), [
      makeException(nowApprox),
    ]);

    const result = await callSdk(conn, 'testMethod', []);
    expect(result.ok).toBe(false);
    expect(result.recentException).toBeDefined();
  });

  it('attaches only the most-recent exception when multiple are in the window', async () => {
    const nowApprox = Date.now();
    const conn = new FakeSdkCdpConnection(makeSdkEvalResult(true, 'ok'), [
      makeException(nowApprox - 10), // older
      makeException(nowApprox), // newer
    ]);

    const result = await callSdk(conn, 'testMethod', []);
    expect(result.recentException?.timestamp).toBe(nowApprox); // most recent wins
  });
});

// Smoke-test normalizeCallSdkResult is unaffected (regression guard).
describe('normalizeCallSdkResult (regression)', () => {
  it('parses ok:true', () => {
    expect(normalizeCallSdkResult(JSON.stringify({ ok: true, value: 42 }))).toEqual({
      ok: true,
      value: 42,
    });
  });
  it('parses ok:false', () => {
    expect(normalizeCallSdkResult(JSON.stringify({ ok: false, error: 'nope' }))).toEqual({
      ok: false,
      error: 'nope',
    });
  });
});
