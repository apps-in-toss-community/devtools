/**
 * 인증/로그인 mock
 */

import { aitState } from '../state.js';

export async function appLogin(): Promise<{ authorizationCode: string; referrer: 'DEFAULT' | 'SANDBOX' }> {
  return {
    authorizationCode: `mock-auth-${crypto.randomUUID()}`,
    referrer: aitState.state.environment === 'toss' ? 'DEFAULT' : 'SANDBOX',
  };
}

export async function getIsTossLoginIntegratedService(): Promise<boolean | undefined> {
  return aitState.state.auth.isTossLoginIntegrated;
}

export async function getUserKeyForGame(): Promise<{ hash: string; type: 'HASH' } | 'INVALID_CATEGORY' | 'ERROR' | undefined> {
  if (!aitState.state.auth.userKeyHash) return undefined;
  return { hash: aitState.state.auth.userKeyHash, type: 'HASH' };
}

export interface AppsInTossSignTossCertParams {
  txId: string;
}

export async function appsInTossSignTossCert(_params: AppsInTossSignTossCertParams): Promise<void> {
  console.log('[@ait-co/devtools] appsInTossSignTossCert called (no-op in mock)');
}
