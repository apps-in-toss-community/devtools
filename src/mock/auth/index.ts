/**
 * 인증/로그인 mock
 */

import { buildNativeError } from '../native-error.js';
import { aitState } from '../state.js';

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
