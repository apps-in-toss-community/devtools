/**
 * 미구현 API용 Proxy fallback.
 *
 * 호출되면 throw한다. 이는 "devtools에서는 멀쩡히 돌지만 실 SDK에선 실제로 동작하는"
 * 시나리오를 차단하기 위한 의도적 선택이다. mock이 미구현인 API는 실 SDK에서는
 * 존재할 수 있고, 사용자가 이를 인지하지 못한 채 개발을 이어가면 배포 시점에
 * 놀라게 된다. 에러 메시지에 이슈 URL을 포함해 사용자가 mock 누락을 제보할
 * 수 있게 한다.
 */

const ISSUES_URL = 'https://github.com/apps-in-toss-community/devtools/issues';

export function createMockProxy<T extends Record<string, unknown>>(
  moduleName: string,
  implementations: T,
): T {
  return new Proxy(implementations, {
    get(target, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (prop in target) return target[prop];

      throw new Error(
        `[@ait-co/devtools] ${moduleName}.${prop} is not mocked. ` +
        `This API may exist in the real @apps-in-toss/web-framework SDK, ` +
        `but devtools does not support it yet. ` +
        `Please file an issue: ${ISSUES_URL}`,
      );
    },
  }) as T;
}
