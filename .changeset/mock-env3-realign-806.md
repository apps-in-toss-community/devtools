---
'@ait-co/devtools': patch
---

env3(실기기) 재캡처(web-framework 2.10.0 × iOS)에서 실측된 mock↔런타임 불일치 3건을 닫음(#775 원칙 확장) — 전부 상류 SDK의 type↔runtime 불일치, mock 품질 결함 아님.

- (A) `getSchemeUri`(`src/mock/navigation/index.ts`) — 상류 타입 선언은 동기지만 실기기는 Promise를 반환한다. 선언 타입은 그대로 두고 반환값만 `Promise.resolve(...)`로 감싸 캐스트(#796과 동일 패턴). 같은 accessor군의 `getGroupId`/`getTossAppVersion`/`getAppsInTossGlobals`/`env.getDeploymentId`는 이번 run에서도 미측정이라 손대지 않음(#783).
- (B) `loadFullScreenAd.isSupported`(`src/mock/ads/index.ts`) — 상류가 타입에는 선언하지만 실기기 런타임에는 부착하지 않는다(`fetchContacts.getPermission` 부재, #795 (B)와 동일 family). `withIsSupported()` 대신 bare fn을 상류 타입으로 캐스트해 접근 시 `undefined`, 호출 시 native `TypeError`로 떨어지도록 재현. `showFullScreenAd`/`GoogleAdMob.*`은 미측정이라 확장하지 않음(#783).
- (C) `requestNotificationAgreement`(`src/mock/notification.ts`) — 실기기는 cancel 함수가 아니라 object를 반환한다. 반환 object의 내부 shape은 미측정이라 "함수가 아니라 object"까지만 정렬, 빈-계약 object로 캐스트.

Refs #806, #775, #795, #796, #783.
