/**
 * 인증/로그인 mock
 */

import { aitState } from '../state.js';

export async function appLogin(): Promise<{
  authorizationCode: string;
  referrer: 'DEFAULT' | 'SANDBOX';
}> {
  return {
    authorizationCode: `mock-auth-${crypto.randomUUID()}`,
    referrer: aitState.state.environment === 'toss' ? 'DEFAULT' : 'SANDBOX',
  };
}

export async function getIsTossLoginIntegratedService(): Promise<boolean | undefined> {
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
