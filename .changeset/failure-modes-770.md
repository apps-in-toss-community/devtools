---
'@ait-co/devtools': patch
---

env1 실패-모드 다이얼을 추가해 env3의 프로비저닝-의존 native reject 계약을 재현한다 (#770). `aitState.patch('failureModes', { appLogin: 'APP_LOGIN' })`처럼 API별로 실패 코드를 지정하면 다음 호출이 성공 대신 reject하고, 다이얼을 건드리지 않으면 기존 낙관적 동작이 zero behavior change로 유지된다. 코드 인벤토리(`APP_LOGIN`, `PLACEMENT_ID_FETCH_FAILED`, `EXECUTION_ERROR`, `NO_PERMISSION`, `INVALID_REQUEST`, `INVALID_DATA`, `FAILED_TO_GET_LOADED_AD`, `APP_BRIDGE_THROTTLED`, `'1006'`, `'4000'`)와 envelope 조립(`buildNativeError()`, `src/mock/native-error.ts`)은 sdk-example#284에서 실측한 실 네이티브 rejection shape을 따른다. `failureModes.sdkLine`(`'2.x' | '3.x'`, 기본 `'2.x'`) 축으로 라인별 envelope 형태(2.x는 `{name, code, userInfo, moduleName, __isError}` 필드 포함 Error, 3.x는 message만 있는 맨 Error)를 분기한다. 1차 배선 대상은 `appLogin`, `GoogleAdMob.loadAppsInTossAdMob`, `loadFullScreenAd` 3곳.
