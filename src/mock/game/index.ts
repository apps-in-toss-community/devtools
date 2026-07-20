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
//
// 실기기(2.x×iOS) capture는 선언된 { key }가 아니라 { errorCode, message }
// soft-failure shape를 보였다(devtools#770). 다만 그 캡처는 **미등록
// promotionCode** 시나리오였다 — 즉 프로비저닝에 의존하는 실패지 이 API의
// 무조건적 계약이 아니다. 그래서 기본값은 선언 타입대로 성공(`{ key }`)으로
// 두고, soft-failure 재현은 실패-모드 다이얼(#777의 failureModes)에 붙인다.
// 기본값을 실패로 뒤집으면 SDK가 선언한 성공 분기가 mock에서 영구히 도달
// 불가능해지고, "다이얼 미사용 시 zero behavior change"라는 #770의 acceptance도
// 깨진다. 다이얼 배선은 soft-resolve 모드(#789)로 구현됨 — #785 close.
export async function grantPromotionReward(
  params: GrantPromotionRewardParams,
): Promise<GrantPromotionRewardResponse> {
  console.log('[@ait-co/devtools] grantPromotionReward:', params.params);
  if (aitState.state.failureModes.softResolve?.grantPromotionReward) {
    // env3 미등록 promotion soft-resolve 재현: { errorCode, message }.
    // 선언 타입 { key }와 다른 off-contract shape라 cast가 불가피하다 — 실기기가
    // SDK 선언보다 낙관적이지 않다는 사실 자체가 이 shape의 근거다. valueKeys=
    // ['errorCode','message']만 실측이고 문자열 값은 예시다(#789).
    return {
      errorCode: 'PROMOTION_NOT_FOUND',
      message: 'no active promotion',
    } as unknown as GrantPromotionRewardResponse;
  }
  return { key: `mock-reward-${Date.now()}` };
}

// SDK: grantPromotionRewardForGame = typeof grantPromotionReward
export async function grantPromotionRewardForGame(
  params: GrantPromotionRewardParams,
): Promise<GrantPromotionRewardResponse> {
  console.log('[@ait-co/devtools] grantPromotionRewardForGame:', params.params);
  if (aitState.state.failureModes.softResolve?.grantPromotionRewardForGame) {
    // env3 미등록 promotion soft-resolve 재현: { errorCode, message }.
    // 선언 타입 { key }와 다른 off-contract shape라 cast가 불가피하다 — 실기기가
    // SDK 선언보다 낙관적이지 않다는 사실 자체가 이 shape의 근거다. valueKeys=
    // ['errorCode','message']만 실측이고 문자열 값은 예시다(#789).
    return {
      errorCode: 'PROMOTION_NOT_FOUND',
      message: 'no active promotion',
    } as unknown as GrantPromotionRewardResponse;
  }
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
