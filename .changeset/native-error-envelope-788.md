---
'@ait-co/devtools': patch
---

mock의 결정적 입력-계약 reject 3건이 손수 만든 `{errorCode}` 대신 실기기 2.x native envelope(`{name, code, userInfo, moduleName, __isError}`)로 던지도록 수정 (#788). `GoogleAdMob.isAppsInTossAdMobLoaded`(빈/공백 `adGroupId`, `INVALID_REQUEST`), `generateHapticFeedback`(알 수 없는 haptic `type`, `EXECUTION_ERROR`), `getTossShareLink`(scheme 없는 bare path, `EXECUTION_ERROR`) 세 곳 모두 `err.errorCode`만 붙인 평범한 `Error`로 reject해왔는데, `Object.keys(err)`가 env1(mock)과 env3(실기기)에서 달라져 sdk-example의 capture-diff 계측이 발산을 잡아냈다. 이미 존재하던 `buildNativeError(code)`(devtools#770)로 shape만 교체했다 — 세 throw 모두 환경과 무관하게 항상 거부하는 결정적 입력 검증이라 다이얼 뒤로 옮기지 않았고 동작 자체는 그대로다.
