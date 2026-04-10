/**
 * 게임/프로모션 mock
 */

import { aitState } from '../state.js';

export async function grantPromotionReward(params: {
  params: { promotionCode: string; amount: number };
}): Promise<{ key: string } | { errorCode: string; message: string } | 'ERROR' | undefined> {
  console.log('[@ait-co/devtools] grantPromotionReward:', params.params);
  return { key: `mock-reward-${Date.now()}` };
}

export async function grantPromotionRewardForGame(params: {
  params: { promotionCode: string; amount: number };
}): Promise<{ key: string } | { errorCode: string; message: string } | 'ERROR' | undefined> {
  console.log('[@ait-co/devtools] grantPromotionRewardForGame:', params.params);
  return { key: `mock-reward-${Date.now()}` };
}

export async function submitGameCenterLeaderBoardScore(params: {
  score: string;
}): Promise<{ statusCode: 'SUCCESS' | 'LEADERBOARD_NOT_FOUND' | 'PROFILE_NOT_FOUND' | 'UNPARSABLE_SCORE' } | undefined> {
  aitState.patch('game', {
    leaderboardScores: [...aitState.state.game.leaderboardScores, { score: params.score, timestamp: Date.now() }],
  });
  return { statusCode: 'SUCCESS' };
}

export async function getGameCenterGameProfile(): Promise<
  { statusCode: 'SUCCESS'; nickname: string; profileImageUri: string } |
  { statusCode: 'PROFILE_NOT_FOUND' } |
  undefined
> {
  const profile = aitState.state.game.profile;
  if (!profile) return { statusCode: 'PROFILE_NOT_FOUND' };
  return {
    statusCode: 'SUCCESS',
    nickname: profile.nickname,
    profileImageUri: profile.profileImageUri,
  };
}

export async function openGameCenterLeaderboard(): Promise<void> {
  console.log('[@ait-co/devtools] openGameCenterLeaderboard (no-op in browser)');
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
