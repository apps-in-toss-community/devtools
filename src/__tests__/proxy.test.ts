import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockProxy, resetWarned } from '../mock/proxy.js';

// resetWarned()는 모든 모듈의 WARNED 캐시를 전역으로 초기화한다.
// 다른 테스트 파일에서 createMockProxy 기반 모듈(IAP, Ads 등)을 사용할 경우
// 해당 파일에서도 resetWarned()를 호출해야 경고 관련 테스트가 정확하다.
describe('createMockProxy', () => {
  beforeEach(() => {
    resetWarned();
  });

  it('구현된 프로퍼티는 정상적으로 접근 가능하다', () => {
    const mock = createMockProxy('TestModule', {
      hello: () => 'world',
    });
    expect(mock.hello()).toBe('world');
  });

  it('미구현 프로퍼티 접근 시 경고를 출력하고 no-op 함수를 반환한다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const ref = createMockProxy('TestModule', { existing: () => 42 }) as Record<string, unknown>;
    const fn = ref['unknownMethod'] as () => Promise<undefined>;

    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('TestModule.unknownMethod is not mocked yet'));

    const result = await fn();
    expect(result).toBeUndefined();
  });

  it('같은 미구현 프로퍼티에 대해 경고는 한 번만 출력된다', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const ref = createMockProxy('TestModule', {}) as Record<string, unknown>;
    ref['foo'];
    ref['foo'];

    const fooWarnings = warnSpy.mock.calls.filter(c =>
      (c[0] as string).includes('TestModule.foo'),
    );
    expect(fooWarnings).toHaveLength(1);
  });

  it('미구현 프로퍼티는 호출 가능한 no-op 함수를 반환한다', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ref = createMockProxy('TestModuleInstance', {}) as Record<string, unknown>;
    const fn = ref['bar'];
    expect(typeof fn).toBe('function');
    expect(await (fn as () => Promise<undefined>)()).toBeUndefined();
  });
});
