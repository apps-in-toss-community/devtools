import { beforeEach, describe, expect, it } from 'vitest';
import { createMockProxy } from '../mock/proxy.js';
import { aitState } from '../mock/state.js';

describe('createMockProxy', () => {
  it('구현된 프로퍼티는 정상적으로 접근 가능하다', () => {
    const mock = createMockProxy('TestModule', {
      hello: () => 'world',
    });
    expect(mock.hello()).toBe('world');
  });

  it('미구현 프로퍼티 접근 시 throw한다', () => {
    const ref = createMockProxy('TestModule', { existing: () => 42 }) as Record<string, unknown>;

    expect(() => ref.unknownMethod).toThrow(/TestModule\.unknownMethod is not mocked/);
  });

  it('throw되는 에러 메시지는 고정된 prefix와 이슈 URL을 포함한다', () => {
    const ref = createMockProxy('Ads', {}) as Record<string, unknown>;

    expect(() => ref.someNewApi).toThrow(
      /Ads\.someNewApi is not mocked\..*github\.com\/apps-in-toss-community\/devtools\/issues/,
    );
  });

  it('심볼 접근은 undefined를 반환한다 (throw하지 않음)', () => {
    const ref = createMockProxy('TestModule', {}) as Record<string | symbol, unknown>;
    const anySymbol = Symbol('any');
    expect(ref[anySymbol]).toBeUndefined();
  });

  it('`in` 연산자는 throw하지 않고 존재 여부만 반환한다', () => {
    const ref = createMockProxy('TestModule', { existing: () => 1 });
    expect('existing' in ref).toBe(true);
    expect('missing' in ref).toBe(false);
  });
});

describe('createMockProxy — KNOWN_UNIMPLEMENTED allowlist', () => {
  beforeEach(() => {
    aitState.reset();
  });

  it('KNOWN_UNIMPLEMENTED에 없는 미지의 이름은 여전히 throw한다', () => {
    const ref = createMockProxy('SomeModule', {}) as Record<string, unknown>;
    expect(() => ref.completelyUnknownApi).toThrow(/is not mocked/);
  });

  it('구현된 프로퍼티는 throw하지 않는다', () => {
    const mock = createMockProxy('SomeModule', { implemented: () => 42 });
    expect(mock.implemented()).toBe(42);
  });
});
