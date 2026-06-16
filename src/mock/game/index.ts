/**
 * 게임/프로모션 mock
 */

import type {
  ContactsViralEvent,
  GrantPromotionRewardParams,
  GrantPromotionRewardResponse,
} from '@apps-in-toss/web-framework';
import { aitState } from '../state.js';

// SDK: grantPromotionReward(params: GrantPromotionRewardParams): Promise<GrantPromotionRewardResponse>
// 이전 mock의 sentinel('ERROR'|undefined) 리턴값은 실제 SDK 타입에 없는 것이었으므로 제거.
export async function grantPromotionReward(
  params: GrantPromotionRewardParams,
): Promise<GrantPromotionRewardResponse> {
  console.log('[@ait-co/devtools] grantPromotionReward:', params.params);
  return { key: `mock-reward-${Date.now()}` };
}

// SDK: grantPromotionRewardForGame = typeof grantPromotionReward
export async function grantPromotionRewardForGame(
  params: GrantPromotionRewardParams,
): Promise<GrantPromotionRewardResponse> {
  console.log('[@ait-co/devtools] grantPromotionRewardForGame:', params.params);
  return { key: `mock-reward-${Date.now()}` };
}

export async function submitGameCenterLeaderBoardScore(params: {
  score: string;
}): Promise<
  | { statusCode: 'SUCCESS' | 'LEADERBOARD_NOT_FOUND' | 'PROFILE_NOT_FOUND' | 'UNPARSABLE_SCORE' }
  | undefined
> {
  aitState.patch('game', {
    leaderboardScores: [
      ...aitState.state.game.leaderboardScores,
      { score: params.score, timestamp: Date.now() },
    ],
  });
  return { statusCode: 'SUCCESS' };
}

export async function getGameCenterGameProfile(): Promise<
  | { statusCode: 'SUCCESS'; nickname: string; profileImageUri: string }
  | { statusCode: 'PROFILE_NOT_FOUND' }
  | undefined
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

export function contactsViral(params: {
  options: { moduleId: string };
  onEvent: (event: ContactsViralEvent) => void;
  onError: (error: unknown) => void;
}): () => void {
  setTimeout(() => {
    const event: ContactsViralEvent = {
      type: 'close',
      data: { closeReason: 'noReward', sentRewardsCount: 0 },
    };
    params.onEvent(event);
  }, 500);
  return () => {};
}
