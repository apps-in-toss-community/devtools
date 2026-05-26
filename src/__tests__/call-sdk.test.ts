/**
 * Unit tests for `evaluate` and `call_sdk` MCP tools (devtools#222).
 *
 * Tests use a fake `CdpConnection` that returns canned `Runtime.evaluate`
 * results. No phone, no relay, no running server needed.
 *
 * SECRET-HANDLING: tests confirm that expression text and result values are
 * not included in thrown error messages (only CDP engine error strings are).
 */

import { describe, expect, it } from 'vitest';
import type {
  CdpCommandMap,
  CdpCommandName,
  CdpConnection,
  CdpEventMap,
  CdpEventName,
  CdpTarget,
} from '../mcp/cdp-connection.js';
import { buildCallSdkExpression, callSdk, evaluate, normalizeCallSdkResult } from '../mcp/tools.js';

/* -------------------------------------------------------------------------- */
/* Fake CdpConnection                                                          */
/* -------------------------------------------------------------------------- */

type CannedResults = Partial<{
  [M in CdpCommandName]: CdpCommandMap[M]['result'];
}>;

/**
 * Minimal fake `CdpConnection` that returns canned `send()` results.
 * Mirrors the pattern used in `measure-safe-area.test.ts`.
 */
function makeFakeConnection(canned: CannedResults = {}): CdpConnection {
  return {
    enableDomains: () => Promise.resolve(),
    listTargets: (): CdpTarget[] => [],
    getBufferedEvents: <E extends CdpEventName>(_event: E): ReadonlyArray<CdpEventMap[E]> => [],
    on:
      <E extends CdpEventName>(
        _event: E,
        _listener: (payload: CdpEventMap[E]) => void,
      ): (() => void) =>
      () => {},
    send: <M extends CdpCommandName>(
      method: M,
      _params?: CdpCommandMap[M]['params'],
    ): Promise<CdpCommandMap[M]['result']> => {
      if (method in canned) {
        return Promise.resolve(canned[method] as CdpCommandMap[M]['result']);
      }
      return Promise.reject(new Error(`FakeCdpConnection: no canned result for ${method}`));
    },
  };
}

/** Builds a canned `Runtime.evaluate` success result wrapping a raw value. */
function cannedEvalValue(
  value: unknown,
  type = 'string',
): CdpCommandMap['Runtime.evaluate']['result'] {
  return { result: { type, value } };
}

/** Builds a canned `Runtime.evaluate` result with exceptionDetails. */
function cannedEvalException(text: string): CdpCommandMap['Runtime.evaluate']['result'] {
  return {
    result: { type: 'undefined' },
    exceptionDetails: {
      text,
      exception: { type: 'object', description: text },
    },
  };
}

/* -------------------------------------------------------------------------- */
/* evaluate — success and exception paths                                      */
/* -------------------------------------------------------------------------- */

describe('evaluate', () => {
  it('returns value and type on success', async () => {
    const conn = makeFakeConnection({
      'Runtime.evaluate': cannedEvalValue(42, 'number'),
    });
    const result = await evaluate(conn, '21 + 21');
    expect(result.value).toBe(42);
    expect(result.type).toBe('number');
  });

  it('returns a string value', async () => {
    const conn = makeFakeConnection({
      'Runtime.evaluate': cannedEvalValue('hello', 'string'),
    });
    const result = await evaluate(conn, '"hello"');
    expect(result.value).toBe('hello');
    expect(result.type).toBe('string');
  });

  it('throws when exceptionDetails is present', async () => {
    const conn = makeFakeConnection({
      'Runtime.evaluate': cannedEvalException('ReferenceError: x is not defined'),
    });
    await expect(evaluate(conn, 'x')).rejects.toThrow('evaluate failed');
  });

  it('error message contains the CDP engine error string, not the expression', async () => {
    const secretExpression = 'secret_token_in_expr';
    const conn = makeFakeConnection({
      'Runtime.evaluate': cannedEvalException('SyntaxError: Unexpected token'),
    });
    let thrownMessage = '';
    try {
      await evaluate(conn, secretExpression);
    } catch (e) {
      thrownMessage = e instanceof Error ? e.message : String(e);
    }
    // Engine error string should be present
    expect(thrownMessage).toContain('SyntaxError');
    // The expression must NOT appear in the error message (SECRET-HANDLING)
    expect(thrownMessage).not.toContain(secretExpression);
  });

  it('rejects when Runtime.evaluate is not in canned results', async () => {
    const conn = makeFakeConnection({});
    await expect(evaluate(conn, '1+1')).rejects.toThrow('no canned result for Runtime.evaluate');
  });
});

/* -------------------------------------------------------------------------- */
/* normalizeCallSdkResult — pure parsing layer                                */
/* -------------------------------------------------------------------------- */

describe('normalizeCallSdkResult', () => {
  it('parses ok:true result', () => {
    const raw = JSON.stringify({ ok: true, value: { foo: 'bar' } });
    const result = normalizeCallSdkResult(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ foo: 'bar' });
    }
  });

  it('parses ok:false result', () => {
    const raw = JSON.stringify({ ok: false, error: 'method not found' });
    const result = normalizeCallSdkResult(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('method not found');
    }
  });

  it('parses ok:false with bridge-absent error', () => {
    const raw = JSON.stringify({
      ok: false,
      error: 'window.__sdkCall is not available — is this a dogfood (__DEBUG_BUILD__) bundle?',
    });
    const result = normalizeCallSdkResult(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('window.__sdkCall');
    }
  });

  it('throws on non-string input', () => {
    expect(() => normalizeCallSdkResult(42)).toThrow('unexpected type');
    expect(() => normalizeCallSdkResult(null)).toThrow('unexpected type');
    expect(() => normalizeCallSdkResult(undefined)).toThrow('unexpected type');
  });

  it('throws on non-JSON string without echoing the raw value', () => {
    // The error must not echo the raw string (SECRET-HANDLING)
    const secret = 'not-json-but-might-be-a-token';
    let msg = '';
    try {
      normalizeCallSdkResult(secret);
    } catch (e) {
      msg = e instanceof Error ? e.message : String(e);
    }
    expect(msg).toContain('non-JSON string');
    expect(msg).not.toContain(secret);
  });

  it('throws on JSON that is not an object', () => {
    expect(() => normalizeCallSdkResult(JSON.stringify([1, 2]))).toThrow('not an object');
  });

  it('throws when ok field is missing', () => {
    expect(() => normalizeCallSdkResult(JSON.stringify({ result: 'something' }))).toThrow(
      'missing "ok" field',
    );
  });
});

/* -------------------------------------------------------------------------- */
/* buildCallSdkExpression — expression construction                           */
/* -------------------------------------------------------------------------- */

describe('buildCallSdkExpression', () => {
  it('embeds name via JSON.stringify', () => {
    const expr = buildCallSdkExpression('getOperationalEnvironment', []);
    expect(expr).toContain('"getOperationalEnvironment"');
  });

  it('embeds args via JSON.stringify', () => {
    const expr = buildCallSdkExpression('foo', [{ key: 'value' }, 42]);
    expect(expr).toContain(JSON.stringify([{ key: 'value' }, 42]));
  });

  it('includes bridge-absent guard', () => {
    const expr = buildCallSdkExpression('foo', []);
    expect(expr).toContain('window.__sdkCall');
    expect(expr).toContain('is not available');
  });

  it('uses spread to pass args', () => {
    const expr = buildCallSdkExpression('foo', []);
    expect(expr).toContain('...');
  });

  it('safely escapes special characters in name', () => {
    const tricky = 'name"with"quotes';
    const expr = buildCallSdkExpression(tricky, []);
    // JSON.stringify escapes the quotes — the raw string must not appear verbatim
    expect(expr).not.toContain(tricky);
    expect(expr).toContain(JSON.stringify(tricky));
  });
});

/* -------------------------------------------------------------------------- */
/* callSdk — integration with fake CdpConnection                              */
/* -------------------------------------------------------------------------- */

describe('callSdk', () => {
  it('returns ok:true when the bridge resolves', async () => {
    const bridgeResult = { environment: 'production' };
    const conn = makeFakeConnection({
      'Runtime.evaluate': cannedEvalValue(JSON.stringify({ ok: true, value: bridgeResult })),
    });
    const result = await callSdk(conn, 'getOperationalEnvironment', []);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual(bridgeResult);
    }
  });

  it('returns ok:false when the bridge rejects', async () => {
    const conn = makeFakeConnection({
      'Runtime.evaluate': cannedEvalValue(
        JSON.stringify({ ok: false, error: 'SDK method threw: not supported' }),
      ),
    });
    const result = await callSdk(conn, 'someMethod', []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('not supported');
    }
  });

  it('returns ok:false when window.__sdkCall is absent', async () => {
    const absenceMsg =
      'window.__sdkCall is not available — is this a dogfood (__DEBUG_BUILD__) bundle?';
    const conn = makeFakeConnection({
      'Runtime.evaluate': cannedEvalValue(JSON.stringify({ ok: false, error: absenceMsg })),
    });
    const result = await callSdk(conn, 'anything', []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('window.__sdkCall');
      expect(result.error).toContain('__DEBUG_BUILD__');
    }
  });

  it('throws when the CDP evaluate itself throws (exceptionDetails present)', async () => {
    const conn = makeFakeConnection({
      'Runtime.evaluate': cannedEvalException('TypeError: cannot read property'),
    });
    await expect(callSdk(conn, 'foo', [])).rejects.toThrow('call_sdk threw');
  });

  it('error message from CDP exception does not include name or args (SECRET-HANDLING)', async () => {
    const sensitiveMethod = 'secretSdkMethod';
    const sensitiveArg = 'secret-argument-value';
    const conn = makeFakeConnection({
      'Runtime.evaluate': cannedEvalException('EvalError: something broke'),
    });
    let thrownMessage = '';
    try {
      await callSdk(conn, sensitiveMethod, [sensitiveArg]);
    } catch (e) {
      thrownMessage = e instanceof Error ? e.message : String(e);
    }
    expect(thrownMessage).toContain('call_sdk threw');
    // Must NOT echo method name or args (SECRET-HANDLING)
    expect(thrownMessage).not.toContain(sensitiveMethod);
    expect(thrownMessage).not.toContain(sensitiveArg);
  });

  it('passes args correctly (array is forwarded)', async () => {
    // Confirm callSdk accepts args array without error
    const conn = makeFakeConnection({
      'Runtime.evaluate': cannedEvalValue(JSON.stringify({ ok: true, value: 'done' })),
    });
    const result = await callSdk(conn, 'doSomething', ['arg1', 123, { nested: true }]);
    expect(result.ok).toBe(true);
  });

  it('rejects when Runtime.evaluate is not in canned results', async () => {
    const conn = makeFakeConnection({});
    await expect(callSdk(conn, 'foo', [])).rejects.toThrow('no canned result for Runtime.evaluate');
  });
});
