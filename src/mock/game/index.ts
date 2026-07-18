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
// 실기기(2.x×iOS) capture는 grantPromotionReward가 선언된 { key } 타입이 아니라
// { errorCode, message } soft-failure shape로 resolve됨을 보였다(devtools#770). 원본 SDK
// 타입 선언은 여전히 { key: string }이므로 시그니처는 그대로 두고, 런타임 반환값만
// 실측과 동치시킨다 — errorCode/message 값 자체는 placeholder(shape만 유효).
export async function grantPromotionReward(
  params: GrantPromotionRewardParams,
): Promise<GrantPromotionRewardResponse> {
  console.log('[@ait-co/devtools] grantPromotionReward:', params.params);
  return {
    errorCode: 'MOCK',
    message: 'mock promotion result',
  } as unknown as GrantPromotionRewardResponse;
}

// SDK: grantPromotionRewardForGame = typeof grantPromotionReward
export async function grantPromotionRewardForGame(
  params: GrantPromotionRewardParams,
): Promise<GrantPromotionRewardResponse> {
  console.log('[@ait-co/devtools] grantPromotionRewardForGame:', params.params);
  return {
    errorCode: 'MOCK',
    message: 'mock promotion result',
  } as unknown as GrantPromotionRewardResponse;
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

// 실기기(2.x×iOS) capture는 getGameCenterGameProfile이 { statusCode, gameSessionId,
// nickname, profileImageUri } 4개 키로 resolve됨을 보였다(devtools#770) — 선언된 SDK
// 타입엔 gameSessionId가 없으므로 시그니처는 그대로 두고 런타임 반환값만 캐스트한다.
export async function getGameCenterGameProfile(): Promise<
  | { statusCode: 'SUCCESS'; nickname: string; profileImageUri: string }
  | { statusCode: 'PROFILE_NOT_FOUND' }
  | undefined
> {
  const profile = aitState.state.game.profile;
  if (!profile) return { statusCode: 'PROFILE_NOT_FOUND' };
  return {
    statusCode: 'SUCCESS',
    gameSessionId: 'mock-session',
    nickname: profile.nickname,
    profileImageUri: profile.profileImageUri,
  } as unknown as { statusCode: 'SUCCESS'; nickname: string; profileImageUri: string };
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
