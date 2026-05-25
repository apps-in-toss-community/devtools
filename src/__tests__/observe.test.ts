import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observe } from '../mock/observe.js';
import { aitState } from '../mock/state.js';

describe('observe()', () => {
  beforeEach(() => {
    aitState.reset();
  });

  it('동기 함수를 감싸면 resolved로 기록된다', () => {
    const fn = observe('getPlatformOS', 'faithful', () => 'ios' as const);
    const result = fn();

    expect(result).toBe('ios');
    const log = aitState.state.sdkCallLog;
    expect(log).toHaveLength(1);
    expect(log[0]?.method).toBe('getPlatformOS');
    expect(log[0]?.status).toBe('resolved');
    expect(log[0]?.result).toBe('ios');
    expect(log[0]?.fidelity).toBe('faithful');
    expect(typeof log[0]?.timestamp).toBe('number');
  });

  it('비동기 resolve — resolved 엔트리가 기록된다', async () => {
    const fn = observe('getNetworkStatus', 'partial', async () => 'WIFI' as const);
    const result = await fn();

    expect(result).toBe('WIFI');
    // pending + resolved 두 엔트리가 생긴다
    const log = aitState.state.sdkCallLog;
    const resolved = log.filter((e) => e.status === 'resolved');
    expect(resolved.length).toBeGreaterThanOrEqual(1);
    expect(resolved[0]?.method).toBe('getNetworkStatus');
    expect(resolved[0]?.fidelity).toBe('partial');
  });

  it('비동기 reject — rejected 엔트리가 기록된다', async () => {
    const fn = observe('failingApi', 'inert', async (): Promise<void> => {
      throw new Error('mock error');
    });

    await expect(fn()).rejects.toThrow('mock error');

    const log = aitState.state.sdkCallLog;
    const rejected = log.find((e) => e.status === 'rejected');
    expect(rejected).toBeDefined();
    expect(rejected?.method).toBe('failingApi');
    expect(rejected?.error).toBe('mock error');
    expect(rejected?.fidelity).toBe('inert');
  });

  it('args가 직렬화되어 기록된다', () => {
    const fn = observe(
      'setScreenAwakeMode',
      'inert',
      (opts: { enabled: boolean }): Promise<{ enabled: boolean }> =>
        Promise.resolve({ enabled: opts.enabled }),
    );
    fn({ enabled: true });

    const log = aitState.state.sdkCallLog;
    expect(log[0]?.args).toEqual([{ enabled: true }]);
  });

  it('함수 arg는 [Function: name] 문자열로 직렬화된다', () => {
    const fn = observe('withCallback', 'partial', (_cb: () => void): void => {});
    fn(() => {});

    const log = aitState.state.sdkCallLog;
    expect(log[0]?.args[0]).toMatch(/^\[Function:/);
  });

  it('시그니처가 원본과 동일하게 유지된다 (타입 통과)', () => {
    // 이 테스트는 컴파일 타임 타입 검증으로 충분하지만,
    // 런타임에도 반환값·인자 수가 동일함을 확인한다
    const original = (x: number, y: string): string => `${x}:${y}`;
    const wrapped = observe('original', 'faithful', original);

    // wrapped의 타입은 original과 동일해야 한다
    const r: string = wrapped(1, 'hello');
    expect(r).toBe('1:hello');
  });
});

describe('sdkCallLog ring buffer', () => {
  beforeEach(() => {
    aitState.reset();
  });

  it('200개 초과 시 오래된 항목이 잘려나간다', () => {
    const fn = observe('ringTest', 'faithful', () => undefined);
    for (let i = 0; i < 210; i++) {
      fn();
    }

    const log = aitState.state.sdkCallLog;
    expect(log.length).toBeLessThanOrEqual(200);
    // 가장 최근 항목이 남아야 한다
    expect(log[log.length - 1]?.method).toBe('ringTest');
  });

  it('200개 미만에서는 잘리지 않는다', () => {
    const fn = observe('ringSmall', 'faithful', () => undefined);
    for (let i = 0; i < 50; i++) {
      fn();
    }

    expect(aitState.state.sdkCallLog.length).toBe(50);
  });

  it('reset() 호출 시 sdkCallLog가 비워진다', () => {
    const fn = observe('resetTest', 'faithful', () => undefined);
    fn();
    expect(aitState.state.sdkCallLog.length).toBe(1);

    aitState.reset();
    expect(aitState.state.sdkCallLog.length).toBe(0);
  });
});

describe('logSdkCall() 직접 호출', () => {
  beforeEach(() => {
    aitState.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('엔트리를 정확히 추가한다', () => {
    aitState.logSdkCall({
      method: 'testMethod',
      args: ['a', 'b'],
      timestamp: 12345,
      status: 'resolved',
      result: 'ok',
      fidelity: 'partial',
    });

    const log = aitState.state.sdkCallLog;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      method: 'testMethod',
      args: ['a', 'b'],
      timestamp: 12345,
      status: 'resolved',
      result: 'ok',
      fidelity: 'partial',
    });
  });
});
