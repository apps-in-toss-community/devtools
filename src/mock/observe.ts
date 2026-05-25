/**
 * SDK 호출 관측 래퍼.
 *
 * `observe(apiName, fidelity, fn)` — fn의 시그니처를 그대로 보존하면서
 * 호출 시 args·resolve·reject 결과를 `aitState.sdkCallLog`에 기록한다.
 *
 * **signature 보존 절대 조건**: 제네릭 pass-through로 `__typecheck.ts`의
 * `Assert<Mock, Original>` 불변을 유지한다. observe()로 감싼 함수는
 * 원본과 동일한 타입을 가진다.
 */

import type { AitSdkCallFidelity } from '../mcp/ait-source.js';
import { aitState } from './state.js';

/**
 * fn을 observe로 감싼다.
 *
 * @param apiName  - 로그에 기록할 SDK 메서드 이름 (예: `'setScreenAwakeMode'`)
 * @param fidelity - 이 mock의 fidelity grade ('faithful' | 'partial' | 'inert')
 * @param fn       - 실제 mock 구현체. 시그니처를 그대로 통과시킨다.
 * @returns fn과 동일한 타입의 래퍼 함수
 */
export function observe<TArgs extends unknown[], TReturn>(
  apiName: string,
  fidelity: AitSdkCallFidelity,
  fn: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn {
  return (...args: TArgs): TReturn => {
    const timestamp = Date.now();
    // args를 JSON-safe하게 직렬화한다. 직렬화할 수 없는 값(함수·순환 참조 등)은
    // 문자열 표현으로 대체해 로그가 깨지지 않도록 한다.
    const safeArgs: unknown[] = args.map((a) => safeSerialize(a));

    const result = fn(...args);

    if (result instanceof Promise) {
      // pending 상태로 먼저 기록
      aitState.logSdkCall({
        method: apiName,
        args: safeArgs,
        timestamp,
        status: 'pending',
        fidelity,
      });

      // resolve/reject 결과로 업데이트 (ring buffer에서 마지막 pending 항목 덮어쓰기)
      (result as Promise<unknown>).then(
        (value) => {
          aitState.logSdkCall({
            method: apiName,
            args: safeArgs,
            timestamp,
            status: 'resolved',
            result: safeSerialize(value),
            fidelity,
          });
        },
        (err: unknown) => {
          aitState.logSdkCall({
            method: apiName,
            args: safeArgs,
            timestamp,
            status: 'rejected',
            error: err instanceof Error ? err.message : String(err),
            fidelity,
          });
        },
      );

      return result;
    }

    // 동기 반환 — 즉시 resolved로 기록
    aitState.logSdkCall({
      method: apiName,
      args: safeArgs,
      timestamp,
      status: 'resolved',
      result: safeSerialize(result),
      fidelity,
    });

    return result;
  };
}

/**
 * 값을 JSON-safe한 형태로 변환한다.
 * - null / primitive — 그대로.
 * - 함수 — `'[Function: name]'` 문자열.
 * - 기타 객체 — JSON.stringify 실패 시 `'[unserializable]'`.
 */
function safeSerialize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'function') return `[Function: ${value.name || 'anonymous'}]`;
  if (typeof value !== 'object') return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return '[unserializable]';
  }
}
