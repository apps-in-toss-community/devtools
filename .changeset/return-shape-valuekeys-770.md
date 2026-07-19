---
'@ait-co/devtools': patch
---

env1↔env3 valueKeys 동치 — 반환 객체 키 구성 12건 실측 정렬 (#770). env1(mock)↔env3(실기기 2.x×iOS) capture 전수 diff(#770)의 확장 검증에서 확인된 12건의 반환-shape(키 구성) 불일치를 실기기 관측에 맞춘다: `getCurrentLocation`은 `accessLocation`을 반환값에서 제외(상태 모델은 유지, mock·web·prompt 세 모드 모두 — 모드는 우리 내부 개념이고 실기기엔 없으므로 같은 API면 shape가 같아야 한다. 별개 API인 `startUpdateLocation`은 실측 데이터가 없어 건드리지 않았다), `getGameCenterGameProfile`은 `{ statusCode, gameSessionId, nickname, profileImageUri }` 4키, `IAP.getCompletedOrRefundedOrders`는 `{ hasNext, orders }`, `IAP.getPendingOrders`는 `{ orders, orderIds }`, `IAP.getSubscriptionInfo`는 빈 객체 `{}`, `checkoutPayment`/`requestTossPayPaysBilling`은 성공 시에도 항상 `{ success, reason }` 2키로 정렬했다. 원본 SDK 타입 선언은 그대로 유지하고 런타임 반환값만 캐스트했다 — 두 typecheck 라인(`tsc`, `tsc -p tsconfig.2x.json`) 모두 통과 확인.

`grantPromotionReward`/`grantPromotionRewardForGame`은 이번 정렬에서 뺐다. 실기기 캡처가 보인 `{ errorCode, message }`는 **미등록 promotionCode** 상태의 결과라 프로비저닝 의존 실패이지 이 API의 무조건적 계약이 아니다 — 기본값을 그리로 뒤집으면 SDK가 선언한 성공 분기(`{ key }`)가 mock에서 영구히 도달 불가능해지고 "다이얼 미사용 시 zero behavior change" 원칙도 깨진다. 실패-모드 다이얼에 붙이는 작업은 devtools#785.
