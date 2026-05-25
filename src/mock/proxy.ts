/**
 * 미구현 API용 Proxy 트립와이어.
 *
 * 미구현 프로퍼티에 접근하면 throw한다. 이는 "devtools에서는 멀쩡히 돌지만
 * 실 SDK에선 실제로 동작하는" 시나리오를 차단하기 위한 의도적 선택이다.
 * mock이 미구현인 API는 실 SDK에서는 존재할 수 있고, 사용자가 이를 인지하지
 * 못한 채 개발을 이어가면 배포 시점에 놀라게 된다. 에러 메시지에 이슈 URL을
 * 포함해 사용자가 mock 누락을 제보할 수 있게 한다.
 *
 * ## KNOWN_UNIMPLEMENTED 정책
 * SDK에 존재하는 것으로 알려져 있으나 현재 mock이 없는 API 이름만 이 집합에 둔다.
 * 이 경우에만 throw 대신 🔴 inert no-op을 반환하고 sdkCallLog에 기록한다.
 * 완전히 미지의 이름은 여전히 throw — "잘 되는 척" 방지.
 */

import { aitState } from './state.js';

const ISSUES_URL = 'https://github.com/apps-in-toss-community/devtools/issues';

/**
 * SDK에 존재하나 mock이 아직 없는 것으로 확인된 이름 목록.
 * 새 API가 SDK에 추가되면 여기에 추가하고 별도 PR에서 mock 구현으로 이동한다.
 * 확인되지 않은 이름은 절대 여기에 추가하지 않는다 — throw가 더 안전하다.
 */
const KNOWN_UNIMPLEMENTED = new Set<string>([
  // 예: 'someNewSdkApi',
]);

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

      const name = String(prop);

      // SDK에 존재하나 mock 미구현으로 확인된 API — throw 대신 🔴 inert no-op 반환.
      if (KNOWN_UNIMPLEMENTED.has(name)) {
        return (...args: unknown[]): undefined => {
          console.warn(
            `[@ait-co/devtools] ${moduleName}.${name} is known-unimplemented (🔴 inert). ` +
              `Returning undefined. Please file or upvote an issue: ${ISSUES_URL}`,
          );
          aitState.logSdkCall({
            method: `${moduleName}.${name}`,
            args: args,
            timestamp: Date.now(),
            status: 'resolved',
            result: undefined,
            fidelity: 'inert',
          });
          return undefined;
        };
      }

      throw new Error(
        `[@ait-co/devtools] ${moduleName}.${prop} is not mocked. ` +
          `This API may exist in @apps-in-toss/web-framework, ` +
          `but devtools' mock does not cover it yet. ` +
          `Please file an issue: ${ISSUES_URL}`,
      );
    },
  }) as T;
}
