/**
 * 인증/로그인 mock
 */

import { buildNativeError } from '../native-error.js';
import { aitState } from '../state.js';
import type { ConsentedUserData } from '../types.js';

export async function appLogin(): Promise<{
  authorizationCode: string;
  referrer: 'DEFAULT' | 'SANDBOX';
}> {
  // 실패-모드 다이얼 (devtools#770): aitState.patch('failureModes', { appLogin: 'APP_LOGIN' })
  // 로 설정하면 실기기 프로비저닝 실패(APP_LOGIN)를 그대로 재현한다. 미설정 시 기존처럼
  // 항상 resolve (zero behavior change).
  const failureCode = aitState.state.failureModes.appLogin;
  if (failureCode) {
    throw buildNativeError(failureCode);
  }

  return {
    authorizationCode: `mock-auth-${crypto.randomUUID()}`,
    referrer: aitState.state.environment === 'toss' ? 'DEFAULT' : 'SANDBOX',
  };
}

export async function getIsTossLoginIntegratedService(): Promise<boolean | undefined> {
  // 실패-모드 다이얼 (devtools#783): aitState.patch('failureModes',
  // { getIsTossLoginIntegratedService: 'EXECUTION_ERROR' })로 실기기 실측(env3 run11,
  // 2.x/iOS `A1-awaited-is-boolean` → rejected/`Error`/`EXECUTION_ERROR`)을 재현한다.
  // 미설정 시 기존처럼 항상 resolve (zero behavior change).
  const failureCode = aitState.state.failureModes.getIsTossLoginIntegratedService;
  if (failureCode) {
    throw buildNativeError(failureCode);
  }

  return aitState.state.auth.isTossLoginIntegrated;
}

// SDK 3.0에서 getUserKeyForGame = typeof getAnonymousKey → Promise<{ hash: string; type: 'HASH' }>
// 이전의 'INVALID_CATEGORY'|'ERROR'|undefined sentinel은 실제 SDK 타입에 없으므로 제거.
export async function getUserKeyForGame(): Promise<{ hash: string; type: 'HASH' }> {
  return { hash: aitState.state.auth.userKeyHash ?? '', type: 'HASH' };
}

export async function getAnonymousKey(): Promise<
  { hash: string; type: 'HASH' } | 'ERROR' | undefined
> {
  if (!aitState.state.auth.anonymousKeyHash) return undefined;
  return { hash: aitState.state.auth.anonymousKeyHash, type: 'HASH' };
}

export interface AppsInTossSignTossCertParams {
  txId: string;
}

export async function appsInTossSignTossCert(_params: AppsInTossSignTossCertParams): Promise<void> {
  console.log('[@ait-co/devtools] appsInTossSignTossCert called (no-op in mock)');
}

/**
 * `getConsentedUserData` 옵션. SDK 선언(`@apps-in-toss/web-bridge` 경유, web-framework
 * 2.x 라인)의 `GetConsentedUserDataOptions`와 shape 동일.
 */
export interface GetConsentedUserDataOptions {
  consentedUserDataKey: string;
  shouldRequestAgreementWhenUserDeclined?: boolean;
}

/**
 * 사용자 동의 기반 데이터 mock (devtools#798 — env1에 배선 부재였던 실 export).
 *
 * SDK는 이 API를 web-framework 2.x 라인에서만 노출한다(`@apps-in-toss/web-bridge`
 * 경유) — 3.0-beta 라인엔 대응 export가 없다(`__typecheck.ts`/`__typecheck-2x.ts`
 * 양쪽 모두 `AssertIfPresent`로 capability-gate: PermissionError의 반대 방향
 * 비대칭). 선언 시그니처는 `Promise<Partial<Record<ConsentedUserDataKey, string>>
 * | undefined>` — appLogin과 같은 async bridge 모양이라 항상 resolve하는 낙관적
 * 패턴을 따른다.
 *
 * 어떤 키가 채워지는지는 콘솔에 등록된 동의문/데이터 묶음(`consentedUserDataKey`)에
 * 달려 있고 그 매핑은 서버 쪽 설정이라 mock이 알 수 없다 — 호출 파라미터와 무관하게
 * 상태에 저장된 최소 plausible 객체를 그대로 resolve한다. SDK 선언 밖의 필드는
 * 추가하지 않는다(devtools#783 — 실측/타입 밖 추정 금지).
 */
export async function getConsentedUserData(
  _options: GetConsentedUserDataOptions,
): Promise<ConsentedUserData | undefined> {
  return aitState.state.auth.consentedUserData;
}
