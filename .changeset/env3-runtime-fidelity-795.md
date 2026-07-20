---
'@ait-co/devtools': patch
---

env3(실기기) 런타임 실측과 mock 사이의 잔여 8건 불일치를 닫음(#775 원칙 확장) — 전부 상류 SDK의 type↔runtime 불일치, mock 품질 결함 아님.

- (A) `getPlatformOS`/`getOperationalEnvironment`/`getLocale`/`getDeviceId`/`isMinVersionSupported`/`getSafeAreaInsets`(`src/mock/navigation/index.ts`) — 상류 타입 선언은 동기지만 실기기(2.x×iOS)는 Promise를 반환한다. 선언 타입은 그대로 두고 반환값만 `Promise.resolve(...)`로 감싸 캐스트.
- (B) `fetchContacts.getPermission`(`src/mock/device/contacts.ts`) — 상류가 타입에는 선언하지만 실기기 런타임에는 부착하지 않는다. `withPermission()` 대신 bare async fn을 상류 타입으로 캐스트해 접근 시 `undefined`, 호출 시 native `TypeError`로 떨어지도록 재현(`openPermissionDialog` 부재는 측정 근거 없는 합리적 추론으로 별도 표기, 다른 `withPermission` API로는 확장하지 않음 — #783).

Refs #795, #775, #770, #783.
