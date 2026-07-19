import { beforeEach, describe, expect, it } from 'vitest';
import {
  getGameCenterGameProfile,
  grantPromotionReward,
  grantPromotionRewardForGame,
  openGameCenterLeaderboard,
  submitGameCenterLeaderBoardScore,
} from '../mock/game/index.js';
import { aitState } from '../mock/state.js';

describe('Game mock', () => {
  beforeEach(() => {
    aitState.reset();
  });

  // 실기기(2.x×iOS) capture는 { errorCode, message } soft-failure shape를 보였지만
  // 그건 **미등록 promotionCode** 상태의 결과다 — 프로비저닝 의존 실패이지 이 API의
  // 무조건적 계약이 아니다. 그래서 기본값은 SDK 선언대로 성공(`{ key }`)으로 두고,
  // soft-failure 재현은 실패-모드 다이얼로 넘긴다(devtools#785). 기본값을 실패로
  // 뒤집으면 선언된 성공 분기가 mock에서 도달 불가능해진다.
  it('grantPromotionReward: 기본값은 선언 타입대로 { key }로 resolve된다', async () => {
    const result = await grantPromotionReward({
      params: { promotionCode: 'PROMO1', amount: 100 },
    });
    expect(Object.keys(result as object)).toEqual(['key']);
  });

  describe('getGameCenterGameProfile', () => {
    // 실기기(2.x×iOS) capture는 { statusCode, gameSessionId, nickname, profileImageUri }
    // 4개 키로 resolve됨을 보였다(devtools#770).
    it('프로필이 있으면 4개 키(statusCode, gameSessionId, nickname, profileImageUri)로 resolve된다 (실기기 동치)', async () => {
      const result = await getGameCenterGameProfile();
      expect(Object.keys(result as object).sort()).toEqual([
        'gameSessionId',
        'nickname',
        'profileImageUri',
        'statusCode',
      ]);
      expect((result as { nickname: string }).nickname).toBe('MockPlayer');
    });

    it('프로필이 없으면 PROFILE_NOT_FOUND를 반환한다', async () => {
      aitState.patch('game', { profile: null });
      const result = await getGameCenterGameProfile();
      expect(result).toEqual({ statusCode: 'PROFILE_NOT_FOUND' });
    });
  });

  it('submitGameCenterLeaderBoardScore: 점수를 기록하고 SUCCESS를 반환한다', async () => {
    const result = await submitGameCenterLeaderBoardScore({ score: '1000' });
    expect(result).toEqual({ statusCode: 'SUCCESS' });
    expect(aitState.state.game.leaderboardScores).toContainEqual(
      expect.objectContaining({ score: '1000' }),
    );
  });

  it('grantPromotionRewardForGame: 기본값은 선언 타입대로 { key }로 resolve된다', async () => {
    const result = await grantPromotionRewardForGame({
      params: { promotionCode: 'GAME1', amount: 50 },
    });
    expect(Object.keys(result as object)).toEqual(['key']);
  });

  it('openGameCenterLeaderboard: 에러 없이 실행된다', async () => {
    await expect(openGameCenterLeaderboard()).resolves.toBeUndefined();
  });
});
