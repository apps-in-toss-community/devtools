/**
 * 인증/로그인 mock
 */

import { aitState } from '../state.js';

export function appLogin(): Promise<{ authorizationCode: string; referrer: 'DEFAULT' | 'SANDBOX' }> {
  return Promise.resolve({
    authorizationCode: `mock-auth-${crypto.randomUUID()}`,
    referrer: aitState.state.environment === 'toss' ? 'DEFAULT' : 'SANDBOX',
  });
}

export function getIsTossLoginIntegratedService(): Promise<boolean | undefined> {
  return Promise.resolve(aitState.state.auth.isTossLoginIntegrated);
}

export function getUserKeyForGame(): Promise<{ hash: string; type: 'HASH' } | 'INVALID_CATEGORY' | 'ERROR' | undefined> {
  if (!aitState.state.auth.userKeyHash) return Promise.resolve(undefined);
  return Promise.resolve({ hash: aitState.state.auth.userKeyHash, type: 'HASH' });
}

export interface AppsInTossSignTossCertParams {
  txId: string;
}

export function appsInTossSignTossCert(_params: AppsInTossSignTossCertParams): Promise<void> {
  console.log('[ait-devtools] appsInTossSignTossCert called (no-op in mock)');
  return Promise.resolve();
}
