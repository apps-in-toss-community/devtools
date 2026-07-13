/**
 * Analytics mock
 */

import { aitState } from '../state.js';

type Primitive = string | number | boolean | null | undefined | symbol;
type LoggerParams = { log_name?: string } & Record<string, Primitive>;

// Analytics methods return `Promise<void> | undefined` to match the original SDK signature,
// so they cannot use `async` (which always returns a Promise).
//
// 실기기(2.x×iOS) capture는 이 네 메서드가 `undefined`가 아니라 `null`로 resolve됨을 보였다
// (devtools#770). 원본 SDK 타입 선언은 여전히 `Promise<void>`이므로 시그니처는 그대로 두고,
// 런타임 반환값만 `null`로 캐스트해 실측과 동치시킨다.
export const Analytics = {
  screen: (params?: LoggerParams): Promise<void> | undefined => {
    aitState.logAnalytics({ type: 'screen', params: params ?? {} });
    return Promise.resolve(null as unknown as void);
  },
  impression: (params?: LoggerParams): Promise<void> | undefined => {
    aitState.logAnalytics({ type: 'impression', params: params ?? {} });
    return Promise.resolve(null as unknown as void);
  },
  click: (params?: LoggerParams): Promise<void> | undefined => {
    aitState.logAnalytics({ type: 'click', params: params ?? {} });
    return Promise.resolve(null as unknown as void);
  },
};

export async function eventLog(params: {
  log_name: string;
  log_type: string;
  params: Record<string, Primitive>;
}): Promise<void> {
  aitState.logAnalytics({
    type: params.log_type,
    params: { log_name: params.log_name, ...params.params },
  });
  return null as unknown as void;
}
