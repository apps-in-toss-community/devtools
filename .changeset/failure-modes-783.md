---
'@ait-co/devtools': patch
---

env1 실패-모드 다이얼을 3개 API로 확장한다 (#783). #770이 배선한 `appLogin`/`GoogleAdMob.loadAppsInTossAdMob`/`loadFullScreenAd`에 이어 `getIsTossLoginIntegratedService`(`EXECUTION_ERROR`)·`requestNotificationAgreement`(`4000`)·`getPermission`을 추가한다. 코드값은 sdk-example#301 프로비저닝 미러가 재현해야 할 env3 실측(run11, 2.x/iOS)을 그대로 따른다. `getPermission`은 전역 on/off가 아니라 `Partial<Record<PermissionName, NativeErrorCode>>` 권한 이름별 맵이다 — 실측에서 `clipboard`/`contacts`/`photos`는 resolve하고 `geolocation`/`camera`/`microphone`만 `NO_PERMISSION`으로 reject했기 때문이다(31146 `granite.config.ts`의 `permissions: []` 미선언 권한만 거부되는 그림과 정합). `withPermission()`이 부착하는 `.getPermission()`도 같은 `getPermission()` 함수를 호출하므로 배선 지점은 하나다. 다이얼 미설정 시 기존 동작 무변화(zero behavior change), `access` 축(`read`/`write`/`access`) 불일치는 이번 스코프 밖으로 남긴다.
