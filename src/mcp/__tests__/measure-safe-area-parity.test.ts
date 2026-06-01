/**
 * `measure_safe_area` Tier C parity tests (RFC #277 first big deliverable).
 *
 * The same `Runtime.evaluate` probe expression must run in both `mock` and
 * `relay` envs. The only environment-dependent difference in the result is
 * the `source: 'mock' | 'relay'` provenance field — payload shape, schema, and
 * the script string are identical.
 *
 * Test strategy:
 *   1. Record the `Runtime.evaluate` `expression` param using a stub CDP
 *      connection and confirm the SAME `SAFE_AREA_PROBE_EXPRESSION` string is
 *      sent in both env paths.
 *   2. Confirm the `source` provenance label is set from env on both paths.
 *   3. Confirm the probe SDK-insets priority chain finds `window.__ait`
 *      (mock fallback) when `window.__sdk` is absent.
 */
import { describe, expect, it } from 'vitest';
import type {
  CdpCommandMap,
  CdpCommandName,
  CdpConnection,
  CdpEventMap,
  CdpEventName,
  CdpTarget,
} from '../cdp-connection.js';
import { measureSafeArea, SAFE_AREA_PROBE_EXPRESSION } from '../tools.js';

/**
 * Recording fake — captures every `Runtime.evaluate` invocation so we can
 * assert the same probe string is used regardless of env.
 */
class RecordingCdpConnection implements CdpConnection {
  /** Test fake — relay-kind (issue #348); env is injected so the value is inert here. */
  readonly kind = 'relay' as const;

  public readonly evaluateCalls: Array<{ expression: string }> = [];

  constructor(private readonly probeJson: string) {}

  enableDomains(): Promise<void> {
    return Promise.resolve();
  }
  listTargets(): CdpTarget[] {
    return [];
  }
  getBufferedEvents<E extends CdpEventName>(_e: E): ReadonlyArray<CdpEventMap[E]> {
    return [];
  }
  on(): () => void {
    return () => {};
  }
  send<M extends CdpCommandName>(
    method: M,
    params?: CdpCommandMap[M]['params'],
  ): Promise<CdpCommandMap[M]['result']> {
    if (method === 'Runtime.evaluate') {
      const p = params as CdpCommandMap['Runtime.evaluate']['params'];
      this.evaluateCalls.push({ expression: p.expression });
      const result: CdpCommandMap['Runtime.evaluate']['result'] = {
        result: { type: 'string', value: this.probeJson },
      };
      return Promise.resolve(result as CdpCommandMap[M]['result']);
    }
    return Promise.reject(new Error(`no canned for ${method}`));
  }
}

function relayPayload(): string {
  return JSON.stringify({
    cssEnv: { top: 0, right: 0, bottom: 34, left: 0 },
    sdkInsets: { top: 54, right: 0, bottom: 34, left: 0 },
    sdkInsetsSource: 'window.__sdk',
    navBarHeight: 54,
    navBarHeightSource: 'dom-.ait-navbar',
    innerWidth: 393,
    innerHeight: 754,
    devicePixelRatio: 3,
    userAgent: 'AppsInToss TossApp/5.261.0 iPhone',
  });
}

function mockPayload(): string {
  // Mock environment: probe found window.__ait, not window.__sdk.
  return JSON.stringify({
    cssEnv: { top: 0, right: 0, bottom: 0, left: 0 },
    sdkInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    sdkInsetsSource: 'window.__ait',
    navBarHeight: null,
    navBarHeightSource: 'not-exposed-by-sdk',
    innerWidth: 393,
    innerHeight: 852,
    devicePixelRatio: 3,
    userAgent: 'Mozilla/5.0 (iPhone) Chrome',
  });
}

describe('measure_safe_area Tier C parity (RFC #277)', () => {
  it('uses the SAME Runtime.evaluate expression in mock and relay env', async () => {
    const mockConn = new RecordingCdpConnection(mockPayload());
    const relayConn = new RecordingCdpConnection(relayPayload());

    await measureSafeArea(mockConn, 'mock');
    await measureSafeArea(relayConn, 'relay-dev');

    expect(mockConn.evaluateCalls).toHaveLength(1);
    expect(relayConn.evaluateCalls).toHaveLength(1);
    expect(mockConn.evaluateCalls[0]?.expression).toBe(SAFE_AREA_PROBE_EXPRESSION);
    expect(relayConn.evaluateCalls[0]?.expression).toBe(SAFE_AREA_PROBE_EXPRESSION);
    // And of course the two are equal to each other.
    expect(mockConn.evaluateCalls[0]?.expression).toBe(relayConn.evaluateCalls[0]?.expression);
  });

  it('attaches source: "mock" when caller env is mock', async () => {
    const conn = new RecordingCdpConnection(mockPayload());
    const result = await measureSafeArea(conn, 'mock');
    expect(result.source).toBe('mock');
    expect(result.sdkInsetsSource).toBe('window.__ait');
  });

  it('attaches source: "relay-dev" when caller env is relay-dev', async () => {
    const conn = new RecordingCdpConnection(relayPayload());
    const result = await measureSafeArea(conn, 'relay-dev');
    expect(result.source).toBe('relay-dev');
    expect(result.sdkInsetsSource).toBe('window.__sdk');
  });

  it('attaches source: "relay-live" when caller env is relay-live', async () => {
    const conn = new RecordingCdpConnection(relayPayload());
    const result = await measureSafeArea(conn, 'relay-live');
    expect(result.source).toBe('relay-live');
    expect(result.sdkInsetsSource).toBe('window.__sdk');
  });

  it('preserves identical payload shape across envs', async () => {
    // The two payloads differ in values but the schema (key set) must match.
    const mockConn = new RecordingCdpConnection(mockPayload());
    const relayConn = new RecordingCdpConnection(relayPayload());

    const mockResult = await measureSafeArea(mockConn, 'mock');
    const relayResult = await measureSafeArea(relayConn, 'relay-dev');

    // Same top-level keys — schema parity.
    expect(Object.keys(mockResult).sort()).toEqual(Object.keys(relayResult).sort());
  });
});

describe('SAFE_AREA_PROBE_EXPRESSION — mock fallback chain', () => {
  it('mentions window.__ait fallback (mock env support)', () => {
    expect(SAFE_AREA_PROBE_EXPRESSION).toContain('window.__ait');
    expect(SAFE_AREA_PROBE_EXPRESSION).toContain('window.__sdk');
  });

  it('records sdkInsetsSource so callers can identify which path resolved', () => {
    expect(SAFE_AREA_PROBE_EXPRESSION).toContain('sdkInsetsSource');
  });
});
