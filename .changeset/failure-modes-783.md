---
'@ait-co/devtools': patch
---

env1 실패-모드 다이얼을 3개 API로 확장한다 (#783). #770이 배선한 `appLogin`/`GoogleAdMob.loadAppsInTossAdMob`/`loadFullScreenAd`에 이어 `getIsTossLoginIntegratedService`(`EXECUTION_ERROR`)·`requestNotificationAgreement`(`4000`)·`getPermission`을 추가한다. 코드값은 sdk-example#301 프로비저닝 미러가 재현해야 할 env3 실측(run11, 2.x/iOS)을 그대로 따른다. `getPermission`은 전역 on/off가 아니라 `Partial<Record<PermissionName, NativeErrorCode>>` 권한 이름별 맵이다 — 실측에서 `clipboard`/`contacts`/`photos`는 resolve하고 `geolocation`/`camera`/`microphone`만 `NO_PERMISSION`으로 reject했기 때문이다(31146 `granite.config.ts`의 `permissions: []` 미선언 권한만 거부되는 그림과 정합). `withPermission()`이 부착하는 `.getPermission()`도 같은 `getPermission()` 함수를 호출하므로 배선 지점은 하나다. 다이얼 미설정 시 기존 동작 무변화(zero behavior change).

`access` 축(`read`/`write`/`access`)도 같이 반영한다 — `access`는 선언 게이트를 우회하는 상태 조회라 다이얼이 걸려 있어도 resolve하고, 게이트를 받는 건 실제 권한 요청인 `read`/`write`뿐이다.

게이트는 `getPermission` 하나가 아니라 권한 API 3형제(`getPermission`/`requestPermission`/`openPermissionDialog`) 전부에 걸린다. 셋은 게이트 조건은 공유하되 errorCode는 갈린다 — 앞 둘은 `NO_PERMISSION`, `openPermissionDialog`는 `INVALID_REQUEST`로 거부한다. 실측(run11, 2.x/iOS)이 그래서이고, `requestPermission`은 `openPermissionDialog`에 위임하기 전에 자기 게이트를 먼저 잡아 위임 경로로 `INVALID_REQUEST`가 새지 않게 한다.
