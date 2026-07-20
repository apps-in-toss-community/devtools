---
'@ait-co/devtools': patch
---

`getConsentedUserData` mock 추가 — `@apps-in-toss/web-framework` 2.x stable 라인에만 존재하는 export(3.0-beta 표면엔 부재, `PermissionError`의 역비대칭)를 mock 표면에 반영. `appLogin`/`getAnonymousKey` async-bridge 패턴을 미러해 `aitState.state.auth.consentedUserData`(기본 `{ USER_NAME: 'mock-user-name' }`, `aitState.patch('auth', …)`로 dial)를 resolve. 타입 asymmetry는 기존 `AssertIfPresent`로 처리(3.0-beta는 skip, 2.x는 strict `AssertCompat` 게이트) — `as unknown as` 캐스트 불필요(선언 shape를 로컬 재선언, 반환값이 선언 타입 내부라 구조적 호환). 다운스트림 sdk-example 배선은 sdk-example#331. Closes #798.
