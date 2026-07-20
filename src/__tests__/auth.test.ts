import { beforeEach, describe, expect, it } from 'vitest';
import {
  appLogin,
  appsInTossSignTossCert,
  getConsentedUserData,
  getIsTossLoginIntegratedService,
  getUserKeyForGame,
} from '../mock/auth/index.js';
import { aitState } from '../mock/state.js';

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

  it('getUserKeyForGame: userKeyHash가 없으면 빈 hash를 반환한다 (SDK 3.0: 항상 객체 반환)', async () => {
    aitState.patch('auth', { userKeyHash: '' });
    const result = await getUserKeyForGame();
    expect(result).toEqual({ hash: '', type: 'HASH' });
  });

  it('appsInTossSignTossCert: 에러 없이 실행된다', async () => {
    await expect(appsInTossSignTossCert({ txId: 'mock-tx' })).resolves.toBeUndefined();
  });

  describe('getConsentedUserData (devtools#798)', () => {
    it('상태에 저장된 동의 데이터 객체를 반환한다', async () => {
      const result = await getConsentedUserData({ consentedUserDataKey: 'cud_delivery' });
      expect(result).toEqual({ USER_NAME: 'mock-user-name' });
    });

    it('호출 파라미터와 무관하게 같은 상태값을 반환한다', async () => {
      aitState.patch('auth', { consentedUserData: { USER_PHONE: '010-0000-0000' } });
      const result = await getConsentedUserData({
        consentedUserDataKey: 'cud_other',
        shouldRequestAgreementWhenUserDeclined: true,
      });
      expect(result).toEqual({ USER_PHONE: '010-0000-0000' });
    });

    it('상태값이 빈 객체면 빈 객체를 반환한다', async () => {
      aitState.patch('auth', { consentedUserData: {} });
      const result = await getConsentedUserData({ consentedUserDataKey: 'cud_delivery' });
      expect(result).toEqual({});
    });
  });

  describe('실패-모드 다이얼 (devtools#770)', () => {
    it('failureModes.appLogin 미설정 시 기존처럼 항상 resolve한다', async () => {
      await expect(appLogin()).resolves.toEqual(expect.objectContaining({ referrer: 'SANDBOX' }));
    });

    it('failureModes.appLogin 설정 시 2.x native envelope으로 reject한다', async () => {
      aitState.patch('failureModes', { appLogin: 'APP_LOGIN' });

      await expect(appLogin()).rejects.toMatchObject({
        name: 'Error',
        code: 'APP_LOGIN',
        userInfo: {},
        __isError: true,
      });
    });

    it('failureModes.sdkLine이 3.x면 맨 Error로 평탄화된 reject를 던진다', async () => {
      aitState.patch('failureModes', { appLogin: 'APP_LOGIN', sdkLine: '3.x' });

      let caught: unknown;
      try {
        await appLogin();
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(Error);
      expect((caught as { code?: string }).code).toBeUndefined();
      expect((caught as { __isError?: boolean }).__isError).toBeUndefined();
    });
  });

  describe('실패-모드 다이얼 (devtools#783)', () => {
    it('failureModes.getIsTossLoginIntegratedService 미설정 시 기존처럼 상태 값을 resolve한다', async () => {
      await expect(getIsTossLoginIntegratedService()).resolves.toBe(true);
    });

    it('failureModes.getIsTossLoginIntegratedService 설정 시 2.x native envelope으로 reject한다 (실측: rejected/Error/EXECUTION_ERROR)', async () => {
      aitState.patch('failureModes', { getIsTossLoginIntegratedService: 'EXECUTION_ERROR' });

      await expect(getIsTossLoginIntegratedService()).rejects.toMatchObject({
        name: 'Error',
        code: 'EXECUTION_ERROR',
        userInfo: {},
        __isError: true,
      });
    });

    it('failureModes.sdkLine이 3.x면 맨 Error로 평탄화된 reject를 던진다', async () => {
      aitState.patch('failureModes', {
        getIsTossLoginIntegratedService: 'EXECUTION_ERROR',
        sdkLine: '3.x',
      });

      let caught: unknown;
      try {
        await getIsTossLoginIntegratedService();
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(Error);
      expect((caught as { code?: string }).code).toBeUndefined();
      expect((caught as { __isError?: boolean }).__isError).toBeUndefined();
    });
  });
});
