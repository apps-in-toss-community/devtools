/**
 * Unit tests for the test-runner RPC layer (devtools#644).
 *
 * Uses a fake CdpConnection (same pattern as call-sdk.test.ts) so no phone
 * or relay is required. Tests verify:
 *  - `buildRunTestsExpression` wraps bundle code in an async IIFE envelope.
 *  - `parseRunTestsResult` correctly parses ok:true and ok:false envelopes.
 *  - `injectAndRunBundle` surfaces CDP engine errors without leaking bundle code.
 *  - Secrets (relay URLs, bundle content) do NOT appear in error messages.
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
import {
  buildRunTestsExpression,
  injectAndRunBundle,
  parseRunTestsResult,
} from '../test-runner/rpc.js';
import type { RunReport } from '../test-runner/runtime.js';

/* -------------------------------------------------------------------------- */
/* Fake CdpConnection (copied from call-sdk.test.ts pattern)                  */
/* -------------------------------------------------------------------------- */

type CannedResults = Partial<{
  [M in CdpCommandName]: CdpCommandMap[M]['result'];
}>;

function makeFakeConnection(canned: CannedResults = {}): CdpConnection {
  return {
    kind: 'relay' as const,
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

/** Builds a canned Runtime.evaluate success result wrapping a JSON string. */
function cannedEvalValue(value: unknown): CdpCommandMap['Runtime.evaluate']['result'] {
  return { result: { type: 'string', value } };
}

/** Builds a canned Runtime.evaluate result with exceptionDetails. */
function cannedEvalException(text: string): CdpCommandMap['Runtime.evaluate']['result'] {
  return {
    result: { type: 'undefined' },
    exceptionDetails: {
      text,
      exception: { type: 'object', description: text },
    },
  };
}

/** Minimal RunReport for canning. */
function makeRunReport(overrides?: Partial<RunReport>): RunReport {
  return {
    startedAt: '2024-01-01T00:00:00.000Z',
    duration: 10,
    passed: 1,
    failed: 0,
    skipped: 0,
    tests: [{ name: 'example test', status: 'pass', duration: 5 }],
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */
/* buildRunTestsExpression                                                     */
/* -------------------------------------------------------------------------- */

describe('buildRunTestsExpression', () => {
  it('wraps bundle code in an async IIFE', () => {
    const expr = buildRunTestsExpression('var x = 1;');
    expect(expr).toContain('(async ()');
    expect(expr).toContain('var x = 1;');
    expect(expr).toContain('__testBundle');
    expect(expr).toContain('runTestModule');
    // Factory must be passed so globals are installed before test registration.
    expect(expr).toContain('__userFactory');
  });

  it('returns JSON.stringify-wrapped result', () => {
    const expr = buildRunTestsExpression('/* bundle */');
    expect(expr).toContain('JSON.stringify');
    // The expression uses object literal keys without quotes
    expect(expr).toContain('ok:');
  });

  it('ends with () to immediately invoke', () => {
    const expr = buildRunTestsExpression('').trim();
    expect(expr).toMatch(/\)\(\)$/);
  });
});

/* -------------------------------------------------------------------------- */
/* parseRunTestsResult                                                         */
/* -------------------------------------------------------------------------- */

describe('parseRunTestsResult', () => {
  it('returns ok:true with report on success envelope', () => {
    const report = makeRunReport();
    const raw = JSON.stringify({ ok: true, value: report });
    const result = parseRunTestsResult(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.passed).toBe(1);
      expect(result.report.tests[0].name).toBe('example test');
    }
  });

  it('returns ok:false with error on failure envelope', () => {
    const raw = JSON.stringify({ ok: false, error: 'test-run: something broke' });
    const result = parseRunTestsResult(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('something broke');
    }
  });

  it('throws on non-string input', () => {
    expect(() => parseRunTestsResult(42)).toThrow('unexpected return type');
  });

  it('throws on non-JSON string without exposing raw value', () => {
    const secretRaw = 'wss://secret-relay.example.com:1234/nonsense';
    let thrown = '';
    try {
      parseRunTestsResult(secretRaw);
    } catch (e) {
      thrown = e instanceof Error ? e.message : String(e);
    }
    expect(thrown).toContain('non-JSON');
    // The raw secret value must NOT appear in the error message
    expect(thrown).not.toContain('secret-relay.example.com');
  });

  it('throws on missing ok field', () => {
    const raw = JSON.stringify({ data: 'nope' });
    expect(() => parseRunTestsResult(raw)).toThrow('missing "ok" field');
  });
});

/* -------------------------------------------------------------------------- */
/* injectAndRunBundle                                                          */
/* -------------------------------------------------------------------------- */

describe('injectAndRunBundle', () => {
  it('returns ok:true report from a successful evaluate', async () => {
    const report = makeRunReport({ passed: 3, failed: 0 });
    const raw = JSON.stringify({ ok: true, value: report });
    const conn = makeFakeConnection({ 'Runtime.evaluate': cannedEvalValue(raw) });
    const result = await injectAndRunBundle(conn, '/* bundle code */');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.report.passed).toBe(3);
    }
  });

  it('returns ok:false when the page bundle errors', async () => {
    const raw = JSON.stringify({
      ok: false,
      error: 'bundle-eval: ReferenceError: x is not defined',
    });
    const conn = makeFakeConnection({ 'Runtime.evaluate': cannedEvalValue(raw) });
    const result = await injectAndRunBundle(conn, '/* bad bundle */');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('ReferenceError');
    }
  });

  it('throws on CDP exceptionDetails and does not leak bundle code', async () => {
    const secretBundle = 'SECRET_BUNDLE_CONTENT_xyz123';
    const conn = makeFakeConnection({
      'Runtime.evaluate': cannedEvalException('SyntaxError: Unexpected token'),
    });
    let thrown = '';
    try {
      await injectAndRunBundle(conn, secretBundle);
    } catch (e) {
      thrown = e instanceof Error ? e.message : String(e);
    }
    expect(thrown).toContain('SyntaxError');
    // Bundle code must NOT appear in the error message (SECRET-HANDLING)
    expect(thrown).not.toContain(secretBundle);
  });

  it('rejects with timeout error when evaluate hangs', async () => {
    // Use a connection that never resolves
    const hangingConn: CdpConnection = {
      ...makeFakeConnection(),
      send: () => new Promise(() => {}), // never resolves
    };
    await expect(injectAndRunBundle(hangingConn, '/* bundle */', 50 /* 50ms */)).rejects.toThrow(
      'timed out',
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Secret-handling: relay URL does not appear in errors                        */
/* -------------------------------------------------------------------------- */

describe('SECRET-HANDLING', () => {
  it('relay URL does not appear in parseRunTestsResult error messages', () => {
    const relayUrl = 'wss://secret-relay.trycloudflare.com:12345/ws';
    let thrown = '';
    try {
      parseRunTestsResult(relayUrl);
    } catch (e) {
      thrown = e instanceof Error ? e.message : String(e);
    }
    // The relay URL value must not leak into the error
    expect(thrown).not.toContain('secret-relay');
    expect(thrown).not.toContain('trycloudflare');
  });
});
