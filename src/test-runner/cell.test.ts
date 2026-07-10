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
import {
  buildPermissionPreflightExpression,
  injectDebugIndicator,
  injectGlobals,
  runPermissionPreflight,
} from './cell.js';

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

  // #730: the badge is now a LIVE, idempotent controller — re-injection
  // updates the same `window.__ait_indicator` controller/DOM node instead of
  // early-returning on a duplicate-id guard (the old one-shot design).
  it('has an idempotent controller guard (keyed on window.__ait_indicator)', () => {
    const expr = buildIndicatorExpression();
    expect(expr).toContain('W.__ait_indicator');
    expect(expr).toContain('if (!c)');
  });

  it('re-injection updates state via setState rather than duplicating the DOM node', () => {
    const expr = buildIndicatorExpression();
    expect(expr).toContain('function setState(c, next)');
    // The controller is only constructed inside `if (!c) { ... }` — setState
    // is called unconditionally at the end, so a second injection with an
    // existing controller skips DOM creation and only updates state.
    expect(expr).toContain('setState(c, ');
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

  it('uses a red background colour (#e5484d) for the attached state', () => {
    const expr = buildIndicatorExpression();
    expect(expr).toContain('#e5484d');
  });

  it('uses a grey background colour (#8a8f98) for the disconnected state', () => {
    const expr = buildIndicatorExpression();
    expect(expr).toContain('#8a8f98');
  });

  it('embeds the default disconnected label "Debugger Disconnected"', () => {
    const expr = buildIndicatorExpression();
    expect(expr).toContain('Debugger Disconnected');
  });

  it('embeds a custom disconnected label', () => {
    const expr = buildIndicatorExpression({ disconnectedLabel: 'Gone' });
    expect(expr).toContain('"Gone"');
  });

  it('accepts an explicit initial state — disconnected', () => {
    const expr = buildIndicatorExpression({ state: 'disconnected' });
    expect(expr).toContain('setState(c, "disconnected")');
  });

  it('defaults the initial state to attached', () => {
    const expr = buildIndicatorExpression();
    expect(expr).toContain('setState(c, "attached")');
  });

  it('uses a high z-index (2147483647)', () => {
    const expr = buildIndicatorExpression();
    expect(expr).toContain('2147483647');
  });

  // #730: dismiss is NO LONGER terminal — a later setState() call always
  // un-dismisses the badge, so a genuine disconnect after a dismissed tap is
  // still surfaced (gap #3 from the issue).
  it('adds a passive pointerdown listener whose dismiss is non-terminal', () => {
    const expr = buildIndicatorExpression();
    expect(expr).toMatch(/pointerdown/);
    expect(expr).toContain('{ passive: true }');
    // setState always resets `dismissed = false`, proving a later transition
    // un-dismisses the badge rather than leaving it permanently hidden.
    expect(expr).toContain('c.dismissed = false');
  });

  it('observes relay-socket lifecycle via the in-app CustomEvent broadcast, without opening a new connection', () => {
    const expr = buildIndicatorExpression();
    expect(expr).toContain('ait:relay-ws-state');
    expect(expr).toContain('__ait_relay_ws_observed');
  });

  it('falls back to a pathname-scoped WebSocket Proxy (no bare "new WebSocket(" dial)', () => {
    const expr = buildIndicatorExpression();
    expect(expr).toContain('new Proxy(Native');
    expect(expr).toMatch(/\\\/target\\\//);
    // The expression only ever wraps the constructor via Proxy/Reflect — it
    // never dials a socket itself (no literal `new WebSocket(` call).
    expect(expr).not.toMatch(/new WebSocket\(/);
  });

  it('does not contain secret tokens (relay/wss/totp) — load-bearing SECRET-HANDLING guard', () => {
    const expr = buildIndicatorExpression();
    // These strings must never appear in the DOM expression. The relay-socket
    // match is by PATHNAME SHAPE only (`/target/`), never by host/wss value,
    // and the CustomEvent name/detail carry no secret either.
    expect(expr).not.toMatch(/wss:\/\//);
    expect(expr).not.toMatch(/totp/i);
    expect(expr).not.toMatch(/at=/);
    expect(expr).not.toMatch(/AIT_DEBUG_TOTP_SECRET/);
    expect(expr).not.toMatch(/trycloudflare/i);
    expect(expr).not.toMatch(/:\/\//); // no embedded absolute host URL literal
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

/* -------------------------------------------------------------------------- */
/* buildPermissionPreflightExpression (devtools#739)                          */
/* -------------------------------------------------------------------------- */

describe('buildPermissionPreflightExpression', () => {
  const expr = buildPermissionPreflightExpression();

  it('returns a string (pure, no side effects)', () => {
    expect(typeof expr).toBe('string');
    expect(expr.length).toBeGreaterThan(0);
  });

  it('probes all six permission-carrying SDK functions', () => {
    for (const fnName of [
      'getClipboardText',
      'setClipboardText',
      'fetchAlbumPhotos',
      'openCamera',
      'fetchContacts',
      'getCurrentLocation',
    ]) {
      expect(expr).toContain(JSON.stringify(fnName));
    }
  });

  it('writes all six __AIT_PERMS__ contract keys', () => {
    for (const key of [
      'clipboardRead',
      'clipboardWrite',
      'album',
      'camera',
      'contacts',
      'location',
    ]) {
      expect(expr).toContain(JSON.stringify(key));
    }
  });

  it('guards SDK function lookup with optional chaining / defensive checks (never a bare identifier)', () => {
    // The probe reads `globalThis.__sdk && globalThis.__sdk[fnName]` — never a
    // bare `__sdk.foo` that would throw ReferenceError-adjacent on absence.
    expect(expr).toContain('globalThis.__sdk && globalThis.__sdk[fnName]');
    expect(expr).toContain("typeof fn.getPermission !== 'function'");
  });

  it('only calls getPermission() — never openPermissionDialog or requestPermission', () => {
    expect(expr).toContain('.getPermission()');
    expect(expr).not.toContain('openPermissionDialog');
    expect(expr).not.toContain('requestPermission');
  });

  it('wraps every probe in try/catch so a single failing probe cannot throw', () => {
    expect(expr).toContain('try {');
    expect(expr).toContain('} catch (e) {');
    expect(expr).toContain("return 'unavailable';");
  });

  it('normalises any non-tri-state result to "unavailable"', () => {
    expect(expr).toContain(
      "if (status === 'allowed' || status === 'denied' || status === 'notDetermined') return { ok: true, value: status };",
    );
  });

  it('assigns the result to globalThis.__AIT_PERMS__', () => {
    expect(expr).toContain('globalThis.__AIT_PERMS__ = result;');
  });

  it('returns a JSON string (double-serialisation, matching rpc.ts convention)', () => {
    expect(expr).toContain('return JSON.stringify(result);');
  });

  it('is an async IIFE (awaitable via Runtime.evaluate awaitPromise)', () => {
    expect(expr.trim().startsWith('(async () => {')).toBe(true);
    expect(expr.trim().endsWith('})()')).toBe(true);
  });

  it('does not reference undefined bare identifiers outside globalThis/window scoping', () => {
    // Defensive lexical check: every SDK access goes through `globalThis.__sdk`,
    // never a bare `__sdk` identifier that would ReferenceError if unscoped.
    expect(expr).not.toMatch(/[^.]\b__sdk\b(?!\s*[:=])/);
  });

  it('does not contain secret tokens (relay/wss/totp) — SECRET-HANDLING guard', () => {
    expect(expr).not.toMatch(/wss:\/\//);
    expect(expr).not.toMatch(/totp/i);
    expect(expr).not.toMatch(/trycloudflare/i);
  });
});

/* -------------------------------------------------------------------------- */
/* buildPermissionPreflightExpression — sequential + backoff (devtools#767)   */
/* -------------------------------------------------------------------------- */

describe('buildPermissionPreflightExpression — sequential pacing + THROTTLED backoff (devtools#767)', () => {
  const expr = buildPermissionPreflightExpression();

  it('spaces every probe after the first with a sleep(250) call', () => {
    // 6 probes → 5 inter-probe sleeps (none before the first probe).
    const sleepCalls = expr.match(/await sleep\(250\)/g) ?? [];
    expect(sleepCalls).toHaveLength(5);
  });

  it('does NOT sleep before the first probe (clipboardRead/getClipboardText)', () => {
    const firstProbeIdx = expr.indexOf('await probeWithRetry("getClipboardText")');
    const firstSleepIdx = expr.indexOf('await sleep(250)');
    expect(firstProbeIdx).toBeGreaterThan(-1);
    // The first sleep call (if any precedes the SECOND probe) must come AFTER
    // the first probe call in source order.
    expect(firstSleepIdx === -1 || firstSleepIdx > firstProbeIdx).toBe(true);
  });

  it('probes run through probeWithRetry (not the bare probe) — every probe call site', () => {
    for (const fnName of [
      'getClipboardText',
      'setClipboardText',
      'fetchAlbumPhotos',
      'openCamera',
      'fetchContacts',
      'getCurrentLocation',
    ]) {
      expect(expr).toContain(`await probeWithRetry(${JSON.stringify(fnName)})`);
    }
  });

  it('detects APP_BRIDGE_THROTTLED via both the native code AND the message substring', () => {
    expect(expr).toContain('e.code === "APP_BRIDGE_THROTTLED"');
    expect(expr).toContain('Too many app bridge calls');
  });

  it('retries a throttled probe up to 2 times with a [500,1000] backoff ladder', () => {
    expect(expr).toContain('const backoff = [500,1000]');
    // The retry loop bounds attempts by backoff.length (2) — i.e. up to 2 retries.
    expect(expr).toContain('attempt < backoff.length');
    expect(expr).toContain('await sleep(backoff[attempt])');
  });

  it('a non-throttled probe exception still resolves to "unavailable" (no retry)', () => {
    // The catch branch's fallback path — reached when isThrottled(e) is false
    // OR the retry budget is exhausted.
    expect(expr).toMatch(/return 'unavailable';\s*}\s*}\s*return 'unavailable';/);
  });
});

/* -------------------------------------------------------------------------- */
/* runPermissionPreflight (devtools#739)                                      */
/* -------------------------------------------------------------------------- */

describe('runPermissionPreflight', () => {
  it('sends exactly one Runtime.evaluate and returns the parsed permissions map', async () => {
    const permissions = { clipboardRead: 'allowed', camera: 'denied' };
    const conn: CdpConnection = {
      kind: 'relay' as const,
      enableDomains: () => Promise.resolve(),
      listTargets: () => [],
      getBufferedEvents: <E extends CdpEventName>(_e: E): ReadonlyArray<CdpEventMap[E]> => [],
      on:
        <E extends CdpEventName>(_e: E, _l: (p: CdpEventMap[E]) => void) =>
        () => {},
      send: vi.fn(
        <M extends CdpCommandName>(): Promise<CdpCommandMap[M]['result']> =>
          Promise.resolve({
            result: { type: 'string', value: JSON.stringify(permissions) },
          } as unknown as CdpCommandMap[M]['result']),
      ),
    };

    const result = await runPermissionPreflight(conn);

    expect(conn.send).toHaveBeenCalledTimes(1);
    expect(result).toEqual(permissions);
  });

  it('returns undefined when Runtime.evaluate resolves with exceptionDetails (non-fatal)', async () => {
    const conn: CdpConnection = {
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
          exceptionDetails: { text: 'Uncaught', exception: { description: 'boom' } },
        } as unknown as CdpCommandMap[M]['result']),
    };

    await expect(runPermissionPreflight(conn)).resolves.toBeUndefined();
  });

  it('returns undefined when conn.send rejects (non-fatal)', async () => {
    const conn: CdpConnection = {
      kind: 'relay' as const,
      enableDomains: () => Promise.resolve(),
      listTargets: () => [],
      getBufferedEvents: <E extends CdpEventName>(_e: E): ReadonlyArray<CdpEventMap[E]> => [],
      on:
        <E extends CdpEventName>(_e: E, _l: (p: CdpEventMap[E]) => void) =>
        () => {},
      send: () => Promise.reject(new Error('CDP: page detached')),
    };

    await expect(runPermissionPreflight(conn)).resolves.toBeUndefined();
  });

  it('returns undefined on timeout without hanging the caller', async () => {
    vi.useFakeTimers();
    try {
      const conn: CdpConnection = {
        kind: 'relay' as const,
        enableDomains: () => Promise.resolve(),
        listTargets: () => [],
        getBufferedEvents: <E extends CdpEventName>(_e: E): ReadonlyArray<CdpEventMap[E]> => [],
        on:
          <E extends CdpEventName>(_e: E, _l: (p: CdpEventMap[E]) => void) =>
          () => {},
        // Never resolves — simulates a hung page.
        send: () => new Promise(() => {}),
      };

      const resultPromise = runPermissionPreflight(conn, 1_000);
      await vi.advanceTimersByTimeAsync(1_000);

      await expect(resultPromise).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns undefined when the returned value is not a JSON string', async () => {
    const conn: CdpConnection = {
      kind: 'relay' as const,
      enableDomains: () => Promise.resolve(),
      listTargets: () => [],
      getBufferedEvents: <E extends CdpEventName>(_e: E): ReadonlyArray<CdpEventMap[E]> => [],
      on:
        <E extends CdpEventName>(_e: E, _l: (p: CdpEventMap[E]) => void) =>
        () => {},
      send: <M extends CdpCommandName>(): Promise<CdpCommandMap[M]['result']> =>
        Promise.resolve({
          result: { type: 'boolean', value: true },
        } as unknown as CdpCommandMap[M]['result']),
    };

    await expect(runPermissionPreflight(conn)).resolves.toBeUndefined();
  });
});
