import { describe, it, expect, beforeEach } from 'vitest';
import { aitState } from '../mock/state.js';
import { appLogin, getIsTossLoginIntegratedService, getUserKeyForGame, appsInTossSignTossCert } from '../mock/auth/index.js';

describe('Auth mock', () => {
  beforeEach(() => {
    aitState.reset();
  });

  it('appLogin: authorizationCode를 반환한다', async () => {
    const result = await appLogin();
    expect(result.authorizationCode).toMatch(/^mock-auth-/);
    expect(result.referrer).toBe('SANDBOX');
  });

  it('appLogin: toss 환경이면 referrer가 DEFAULT', async () => {
    aitState.update({ environment: 'toss' });
    const result = await appLogin();
    expect(result.referrer).toBe('DEFAULT');
  });

  it('getIsTossLoginIntegratedService: 상태 값을 반환한다', async () => {
    expect(await getIsTossLoginIntegratedService()).toBe(true);

    aitState.patch('auth', { isTossLoginIntegrated: false });
    expect(await getIsTossLoginIntegratedService()).toBe(false);
  });

  it('getUserKeyForGame: hash 객체를 반환한다', async () => {
    const result = await getUserKeyForGame();
    expect(result).toEqual({ hash: 'mock-user-hash-abc123', type: 'HASH' });
  });

  it('getUserKeyForGame: userKeyHash가 없으면 undefined', async () => {
    aitState.patch('auth', { userKeyHash: '' });
    const result = await getUserKeyForGame();
    expect(result).toBeUndefined();
  });

  it('appsInTossSignTossCert: 에러 없이 실행된다', async () => {
    await expect(appsInTossSignTossCert({ txId: 'mock-tx' })).resolves.toBeUndefined();
  });
});
