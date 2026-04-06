/**
 * 게임/프로모션 mock
 */

import { aitState } from '../state.js';

export function grantPromotionReward(params: {
  params: { promotionCode: string; amount: number };
}): Promise<{ key: string } | { errorCode: string; message: string } | 'ERROR' | undefined> {
  console.log('[ait-devtools] grantPromotionReward:', params.params);
  return Promise.resolve({ key: `mock-reward-${Date.now()}` });
}

export function grantPromotionRewardForGame(params: {
  params: { promotionCode: string; amount: number };
}): Promise<{ key: string } | { errorCode: string; message: string } | 'ERROR' | undefined> {
  console.log('[ait-devtools] grantPromotionRewardForGame:', params.params);
  return Promise.resolve({ key: `mock-reward-${Date.now()}` });
}

export function submitGameCenterLeaderBoardScore(params: {
  score: string;
}): Promise<{ statusCode: 'SUCCESS' | 'LEADERBOARD_NOT_FOUND' | 'PROFILE_NOT_FOUND' | 'UNPARSABLE_SCORE' } | undefined> {
  aitState.state.game.leaderboardScores.push({ score: params.score, timestamp: Date.now() });
  return Promise.resolve({ statusCode: 'SUCCESS' });
}

export function getGameCenterGameProfile(): Promise<
  { statusCode: 'SUCCESS'; nickname: string; profileImageUri: string } |
  { statusCode: 'PROFILE_NOT_FOUND' } |
  undefined
> {
  const profile = aitState.state.game.profile;
  if (!profile) return Promise.resolve({ statusCode: 'PROFILE_NOT_FOUND' });
  return Promise.resolve({
    statusCode: 'SUCCESS',
    nickname: profile.nickname,
    profileImageUri: profile.profileImageUri,
  });
}

export function openGameCenterLeaderboard(): Promise<void> {
  console.log('[ait-devtools] openGameCenterLeaderboard (no-op in browser)');
  return Promise.resolve();
}

interface ContactsViralEvent {
  type: string;
  data: Record<string, unknown>;
}

export function contactsViral(params: {
  options: { moduleId: string };
  onEvent: (event: ContactsViralEvent) => void;
  onError: (error: unknown) => void;
}): () => void {
  setTimeout(() => {
    params.onEvent({
      type: 'close',
      data: {
        closeReason: 'noReward',
        sentRewardsCount: 0,
      },
    });
  }, 500);
  return () => {};
}
