---
'@ait-co/devtools': patch
---

env1↔env3 valueKeys 동치 — 반환 객체 키 구성 12건 실측 정렬 (#770). env1(mock)↔env3(실기기 2.x×iOS) capture 전수 diff(#770)의 확장 검증에서 확인된 12건의 반환-shape(키 구성) 불일치를 실기기 관측에 맞춘다: `getCurrentLocation`은 `accessLocation`을 반환값에서 제외(상태 모델은 유지), `getGameCenterGameProfile`은 `{ statusCode, gameSessionId, nickname, profileImageUri }` 4키, `grantPromotionReward`/`grantPromotionRewardForGame`은 `{ errorCode, message }` soft-failure shape, `IAP.getCompletedOrRefundedOrders`는 `{ hasNext, orders }`, `IAP.getPendingOrders`는 `{ orders, orderIds }`, `IAP.getSubscriptionInfo`는 빈 객체 `{}`, `checkoutPayment`/`requestTossPayPaysBilling`은 성공 시에도 항상 `{ success, reason }` 2키로 정렬했다. 원본 SDK 타입 선언은 그대로 유지하고 런타임 반환값만 캐스트했다 — 두 typecheck 라인(`tsc`, `tsc -p tsconfig.2x.json`) 모두 통과 확인.
