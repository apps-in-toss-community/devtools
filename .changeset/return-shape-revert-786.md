---
'@ait-co/devtools': patch
---

IAP.getSubscriptionInfo·TossPay 반환-shape 되돌림 — 0.1.138의 정정 (#786). 같은 CHANGELOG에 실리는 `return-shape-valuekeys-770.md`(#778)가 아래 세 반환값을 "실기기 관측에 맞춘 정렬"이라고 서술했으나, 그중 두 API는 무조건적 정렬이 아니었다 — 이 changeset이 그 서술을 바로잡는다.

- `IAP.getSubscriptionInfo`: 선언 타입대로 populated `{ subscription: { catalogId, status: 'ACTIVE', expiresAt, isAutoRenew, gracePeriodExpiresAt, isAccessible } }` 성공 shape로 되돌린다. #778이 근거로 든 env3 capture(`valueKeys=[]`)는 **31146에 구독이 프로비저닝되지 않은 상태**에서 얻은 결과다 — 프로비저닝 의존 실패지 API의 무조건적 계약이 아니다. `subscription`은 선언 타입에서 optional이 아니므로, 빈 객체를 기본값으로 굳히면 `const { subscription } = await IAP.getSubscriptionInfo(...)` 이후 모든 접근이 `TypeError`로 깨진다 — SDK가 선언한 성공 분기가 mock에서 영구히 도달 불가능해지는 회귀였다. `grantPromotionReward`(#778 리뷰 중 되돌림, devtools#785)와 같은 판정 기준을 뒤늦게 적용한다.
- `checkoutPayment`/`requestTossPayPaysBilling`: 성공 분기를 `{ success: true, reason: 'mock' }`에서 선언 타입대로 `{ success: true }`로 되돌린다(실패 분기 `{ success: false, reason }`은 그대로). #778이 근거로 든 env3 capture는 `result-success-examined`/`I2-result-success-examined` 시나리오를 포함해 **전부 결제가 실패한 레코드**(`valueKeys=['false','reason']`)였다 — env3는 성공 경로 shape를 한 번도 보여준 적이 없어, 실패 shape를 성공 분기에 일반화한 건 미측정 셀에 대한 근거 없는 추정이었다. 게다가 그 일반화로 주장한 key-set 동치도 실제로는 달성되지 않았다 — env3의 첫 키는 `'success'`가 아니라 `'false'`라(하네스 버그가 아니라 실기기 shape로 별도 확정된 사안) reason을 더해도 여전히 어긋난다.

두 되돌림 모두 다이얼 미설정 시 zero behavior change 원칙을 회복한다. 미프로비저닝 재현이 필요하면 `failureModes` 다이얼에 붙이는 게 맞는 설계이고(devtools#785와 같은 성격), 이번 PR은 그 배선까지는 하지 않는다 — 잘못 굳혀진 기본값만 되돌린다.
