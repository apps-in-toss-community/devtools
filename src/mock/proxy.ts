/**
 * 미구현 API용 Proxy 트립와이어.
 *
 * 미구현 프로퍼티에 접근하면 throw한다. 이는 "devtools에서는 멀쩡히 돌지만
 * 실 SDK에선 실제로 동작하는" 시나리오를 차단하기 위한 의도적 선택이다.
 * mock이 미구현인 API는 실 SDK에서는 존재할 수 있고, 사용자가 이를 인지하지
 * 못한 채 개발을 이어가면 배포 시점에 놀라게 된다. 에러 메시지에 이슈 URL을
 * 포함해 사용자가 mock 누락을 제보할 수 있게 한다.
 */

const ISSUES_URL = 'https://github.com/apps-in-toss-community/devtools/issues';

export function createMockProxy<T extends Record<string, unknown>>(
  moduleName: string,
  implementations: T,
): T {
  return new Proxy(implementations, {
    get(target, prop) {
      // 심볼 접근(Symbol.toPrimitive, Symbol.iterator 등)은 프레임워크/런타임이
      // 내부적으로 호출하므로 throw하면 console.log, 구조분해 등이 깨진다.
      if (typeof prop === 'symbol') return undefined;
      if (prop in target) return target[prop];

      throw new Error(
        `[@ait-co/devtools] ${moduleName}.${prop} is not mocked. ` +
        `This API may exist in @apps-in-toss/web-framework, ` +
        `but devtools' mock does not cover it yet. ` +
        `Please file an issue: ${ISSUES_URL}`,
      );
    },
  }) as T;
}
