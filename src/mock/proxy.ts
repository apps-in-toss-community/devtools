/**
 * 미구현 API용 Proxy fallback
 * SDK에 새 메서드가 추가되었을 때 크래시 없이 경고만 출력한다.
 */

const WARNED = new Set<string>();

/** 테스트에서 WARNED 캐시를 초기화할 때 사용 */
export function resetWarned(): void {
  WARNED.clear();
}

export function createMockProxy<T extends Record<string, unknown>>(
  moduleName: string,
  implementations: T,
): T {
  return new Proxy(implementations, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (typeof prop === 'symbol') return undefined;

      if (!WARNED.has(`${moduleName}.${prop}`)) {
        console.warn(
          `[ait-devtools] ${moduleName}.${prop} is not mocked yet. Returning no-op. ` +
          `Please update ait-devtools or file an issue.`,
        );
        WARNED.add(`${moduleName}.${prop}`);
      }
      return async () => undefined;
    },
  }) as T;
}
