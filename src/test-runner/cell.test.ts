/**
 * Unit tests for `injectGlobals`, `buildIndicatorExpression`, and
 * `injectDebugIndicator`.
 *
 * Verifies that:
 *   - Each key in `globals` is assigned onto `globalThis` via a single
 *     `Runtime.evaluate` round-trip.
 *   - The expression uses `Object.assign(globalThis, ...)`.
 *   - An empty `globals` object results in zero CDP sends (short-circuit).
 *   - The function returns `void` (no return-value leakage).
 *   - JSON-serialisable values (strings, numbers, objects) are embedded
 *     correctly in the generated expression.
 *   - `buildIndicatorExpression` is a pure function that returns a DOM
 *     expression with the expected structural tokens.
 *   - `injectDebugIndicator` calls `Runtime.evaluate` once and never rejects,
 *     even when the CDP send throws.
 *
 * Uses a spy-based fake CdpConnection so no phone or relay is required.
 *
 * react-free invariant: this test file imports ONLY from `../mcp/cdp-connection`
 * (types), `../mcp/attach-orchestrator`, and `./cell` — all react-free modules.
 */

import { describe, expect, it, vi } from 'vitest';
import { buildIndicatorExpression } from '../mcp/attach-orchestrator.js';
import type {
  CdpCommandMap,
  CdpCommandName,
  CdpConnection,
  CdpEventMap,
  CdpEventName,
  CdpTarget,
} from '../mcp/cdp-connection.js';
import { injectDebugIndicator, injectGlobals } from './cell.js';

/* -------------------------------------------------------------------------- */
/* Spy fake                                                                    */
/* -------------------------------------------------------------------------- */

function makeSpyConnection(): {
  conn: CdpConnection;
  sentExpressions: string[];
} {
  const sentExpressions: string[] = [];

  const conn: CdpConnection = {
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
    send: vi.fn(
      <M extends CdpCommandName>(
        method: M,
        params?: CdpCommandMap[M]['params'],
      ): Promise<CdpCommandMap[M]['result']> => {
        if (method === 'Runtime.evaluate') {
          const p = params as { expression: string } | undefined;
          if (p?.expression) sentExpressions.push(p.expression);
        }
        return Promise.resolve({
          result: { type: 'boolean', value: true },
        } as CdpCommandMap[M]['result']);
      },
    ),
  };

  return { conn, sentExpressions };
}

/* -------------------------------------------------------------------------- */
/* Tests                                                                       */
/* -------------------------------------------------------------------------- */

describe('injectGlobals', () => {
  it('sends exactly one Runtime.evaluate for a non-empty globals map', async () => {
    const { conn, sentExpressions } = makeSpyConnection();

    await injectGlobals(conn, { __AIT_CELL__: { sdkLine: '2.x', platform: 'ios' } });

    expect(conn.send).toHaveBeenCalledTimes(1);
    expect(sentExpressions).toHaveLength(1);
  });

  it('sends one (harmless) Runtime.evaluate for an empty globals map', async () => {
    const { conn, sentExpressions } = makeSpyConnection();

    await injectGlobals(conn, {});

    // No short-circuit: an empty map still evaluates `Object.assign(globalThis, {})`,
    // which is a harmless no-op on the page. (Callers that care guard upstream.)
    expect(conn.send).toHaveBeenCalledTimes(1);
    expect(sentExpressions[0]).toContain('Object.assign(globalThis, {})');
  });

  it('expression uses Object.assign(globalThis, ...) pattern', async () => {
    const { conn: realConn, sentExpressions: exprs } = makeSpyConnection();
    await injectGlobals(realConn, { myKey: 'myVal' });

    expect(exprs[0]).toContain('Object.assign(globalThis,');
  });

  it('encodes string values via JSON.stringify (no raw interpolation)', async () => {
    const { conn, sentExpressions } = makeSpyConnection();

    // A value with quotes/backslashes — must be JSON-encoded safely.
    await injectGlobals(conn, { dangerKey: 'with "quotes" and \\backslash' });

    const expr = sentExpressions[0];
    expect(expr).toBeDefined();
    // The serialised JSON string should appear safely quoted, not raw.
    expect(expr).toContain('"dangerKey"');
    // Actual JSON encoding of the value.
    expect(expr).toContain(JSON.stringify({ dangerKey: 'with "quotes" and \\backslash' }));
  });

  it('encodes object values correctly (nested AIT_CELL shape)', async () => {
    const { conn, sentExpressions } = makeSpyConnection();

    const cell = { sdkLine: '2.x', platform: 'android' };
    await injectGlobals(conn, { __AIT_CELL__: cell });

    const expr = sentExpressions[0];
    expect(expr).toContain(JSON.stringify({ __AIT_CELL__: cell }));
  });

  it('encodes multiple keys in a single evaluate', async () => {
    const { conn, sentExpressions } = makeSpyConnection();

    await injectGlobals(conn, { alpha: 1, beta: 'two', gamma: { deep: true } });

    // Only one evaluate, not one per key.
    expect(conn.send).toHaveBeenCalledTimes(1);
    const expr = sentExpressions[0];
    expect(expr).toContain('"alpha"');
    expect(expr).toContain('"beta"');
    expect(expr).toContain('"gamma"');
  });

  it('returns void (no return value leakage)', async () => {
    const { conn } = makeSpyConnection();

    const result = await injectGlobals(conn, { k: 'v' });

    // injectGlobals is typed as Promise<void>; the resolved value is undefined.
    expect(result).toBeUndefined();
  });

  it('propagates a CDP send() rejection (e.g. page detached mid-inject)', async () => {
    const failConn: CdpConnection = {
      kind: 'relay' as const,
      enableDomains: () => Promise.resolve(),
      listTargets: () => [],
      getBufferedEvents: <E extends CdpEventName>(_e: E): ReadonlyArray<CdpEventMap[E]> => [],
      on:
        <E extends CdpEventName>(_e: E, _l: (p: CdpEventMap[E]) => void) =>
        () => {},
      send: () => Promise.reject(new Error('CDP: page detached')),
    };

    await expect(injectGlobals(failConn, { k: 'v' })).rejects.toThrow('CDP: page detached');
  });

  it('throws when Runtime.evaluate resolves with exceptionDetails (page-side throw)', async () => {
    // CDP does NOT reject on a page-side exception — it resolves with an
    // `exceptionDetails` payload. injectGlobals must surface that as an error,
    // otherwise a failed injection looks like success.
    const throwingConn: CdpConnection = {
      kind: 'relay' as const,
      enableDomains: () => Promise.resolve(),
      listTargets: () => [],
      getBufferedEvents: <E extends CdpEventName>(_e: E): ReadonlyArray<CdpEventMap[E]> => [],
      on:
        <E extends CdpEventName>(_e: E, _l: (p: CdpEventMap[E]) => void) =>
        () => {},
      send: <M extends CdpCommandName>(): Promise<CdpCommandMap[M]['result']> =>
        Promise.resolve({
          result: { type: 'object' },
          exceptionDetails: {
            text: 'Uncaught',
            exception: { description: 'ReferenceError: boom is not defined' },
          },
        } as unknown as CdpCommandMap[M]['result']),
    };

    await expect(injectGlobals(throwingConn, { k: 'v' })).rejects.toThrow(
      /injectGlobals: Runtime\.evaluate threw: ReferenceError: boom/,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* buildIndicatorExpression                                                    */
/* -------------------------------------------------------------------------- */

describe('buildIndicatorExpression', () => {
  it('returns a string (pure, no side effects)', () => {
    const expr = buildIndicatorExpression();
    expect(typeof expr).toBe('string');
    expect(expr.length).toBeGreaterThan(0);
  });

  it('embeds the default label "Debugger Connected"', () => {
    const expr = buildIndicatorExpression();
    expect(expr).toContain('Debugger Connected');
  });

  it('embeds a custom label', () => {
    const expr = buildIndicatorExpression({ label: 'My Custom Label' });
    expect(expr).toContain('My Custom Label');
    expect(expr).not.toContain('Debugger Connected');
  });

  it('escapes label via JSON.stringify (quotes and backslashes)', () => {
    const expr = buildIndicatorExpression({ label: 'Has "quotes" and \\backslash' });
    // JSON.stringify produces a quoted string — raw unescaped quote must not appear
    // as a bare string literal.
    expect(expr).toContain(JSON.stringify('Has "quotes" and \\backslash'));
  });

  it('includes __ait_debug_indicator element id', () => {
    const expr = buildIndicatorExpression();
    expect(expr).toContain('__ait_debug_indicator');
  });

  it('has an idempotent guard (getElementById early-return)', () => {
    const expr = buildIndicatorExpression();
    expect(expr).toContain("getElementById('__ait_debug_indicator')");
    expect(expr).toContain('return');
  });

  it('uses position:fixed for fixed overlay', () => {
    const expr = buildIndicatorExpression();
    expect(expr).toContain('position:fixed');
  });

  it('positions element at the bottom-left (bottom + left tokens)', () => {
    const expr = buildIndicatorExpression();
    expect(expr).toContain('bottom');
    expect(expr).toContain('left');
  });

  it('uses a red background colour (#e5484d)', () => {
    const expr = buildIndicatorExpression();
    expect(expr).toContain('#e5484d');
  });

  it('uses a high z-index (2147483647)', () => {
    const expr = buildIndicatorExpression();
    expect(expr).toContain('2147483647');
  });

  it('adds a pointerdown listener with { once: true }', () => {
    const expr = buildIndicatorExpression();
    expect(expr).toMatch(/pointerdown/);
    expect(expr).toContain('once: true');
  });

  it('does not contain secret tokens (relay/wss/totp)', () => {
    const expr = buildIndicatorExpression();
    // These strings must never appear in the DOM expression.
    expect(expr).not.toMatch(/wss:\/\//);
    expect(expr).not.toMatch(/relay/i);
    expect(expr).not.toMatch(/totp/i);
    expect(expr).not.toMatch(/at=/);
    expect(expr).not.toMatch(/AIT_DEBUG_TOTP_SECRET/);
  });
});

/* -------------------------------------------------------------------------- */
/* injectDebugIndicator                                                        */
/* -------------------------------------------------------------------------- */

describe('injectDebugIndicator', () => {
  it('calls conn.send with Runtime.evaluate once', async () => {
    const { conn, sentExpressions } = makeSpyConnection();
    await injectDebugIndicator(conn);

    expect(conn.send).toHaveBeenCalledTimes(1);
    expect(sentExpressions).toHaveLength(1);
    expect(sentExpressions[0]).toContain('__ait_debug_indicator');
  });

  it('resolves (does NOT reject) even when conn.send throws', async () => {
    const failConn: CdpConnection = {
      kind: 'relay' as const,
      enableDomains: () => Promise.resolve(),
      listTargets: () => [],
      getBufferedEvents: <E extends CdpEventName>(_e: E): ReadonlyArray<CdpEventMap[E]> => [],
      on:
        <E extends CdpEventName>(_e: E, _l: (p: CdpEventMap[E]) => void) =>
        () => {},
      send: () => Promise.reject(new Error('CDP: page detached')),
    };

    // Must not throw — isolation guarantee.
    await expect(injectDebugIndicator(failConn)).resolves.toBeUndefined();
  });

  it('resolves (does NOT reject) when conn.send rejects with any error', async () => {
    const conn: CdpConnection = {
      kind: 'relay' as const,
      enableDomains: () => Promise.resolve(),
      listTargets: () => [],
      getBufferedEvents: <E extends CdpEventName>(_e: E): ReadonlyArray<CdpEventMap[E]> => [],
      on:
        <E extends CdpEventName>(_e: E, _l: (p: CdpEventMap[E]) => void) =>
        () => {},
      send: () => Promise.reject(new TypeError('network error')),
    };

    await expect(injectDebugIndicator(conn)).resolves.toBeUndefined();
  });

  it('forwards a custom label to the expression', async () => {
    const { conn, sentExpressions } = makeSpyConnection();
    await injectDebugIndicator(conn, { label: 'Custom Badge' });

    expect(sentExpressions[0]).toContain('Custom Badge');
  });

  it('returns void (no return value leakage)', async () => {
    const { conn } = makeSpyConnection();
    const result = await injectDebugIndicator(conn);
    expect(result).toBeUndefined();
  });
});
