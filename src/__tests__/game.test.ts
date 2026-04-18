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

  it('grantPromotionReward: reward key를 반환한다', async () => {
    const result = await grantPromotionReward({
      params: { promotionCode: 'PROMO1', amount: 100 },
    });
    expect(result).toHaveProperty('key', expect.stringMatching(/^mock-reward-/));
  });

  describe('getGameCenterGameProfile', () => {
    it('프로필이 있으면 SUCCESS와 함께 반환한다', async () => {
      const result = await getGameCenterGameProfile();
      expect(result).toMatchObject({ statusCode: 'SUCCESS', nickname: 'MockPlayer' });
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

  it('grantPromotionRewardForGame: reward key를 반환한다', async () => {
    const result = await grantPromotionRewardForGame({
      params: { promotionCode: 'GAME1', amount: 50 },
    });
    expect(result).toHaveProperty('key', expect.stringMatching(/^mock-reward-/));
  });

  it('openGameCenterLeaderboard: 에러 없이 실행된다', async () => {
    await expect(openGameCenterLeaderboard()).resolves.toBeUndefined();
  });
});
