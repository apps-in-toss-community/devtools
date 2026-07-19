/**
 * 실패-모드 다이얼 — 네이티브 에러 envelope 조립 (devtools#770).
 *
 * env1(mock)이 env3(실기기)의 프로비저닝-의존 reject 계약을 재현할 수 있게 하는
 * 공용 헬퍼. `aitState.failureModes`(state.ts)에 per-API 코드를 설정하면, 각
 * mock 도메인(auth/ads 등)이 이 모듈의 {@link buildNativeError}로 실기기 캡처와
 * 필드 단위로 일치하는 에러 객체를 만들어 reject/onError한다.
 *
 * 코드 인벤토리와 envelope shape의 정본은 sdk-example#284 2.x↔3.0 diff
 * 매트릭스(2026-07-10 iOS run10 캡처 + 이후 manual 패스)다:
 *
 * - 2.x 라인: 네이티브 브리지가 `{ name, code, userInfo, moduleName, __isError }`
 *   envelope을 얹은 `Error` 인스턴스로 reject한다. `errorKeys` 관측이 이 5개
 *   필드로 고정.
 * - 3.x 라인: 같은 실패가 "맨 Error"(위 envelope 필드 없음)로 평탄화된다 —
 *   sdk-example#284 "패턴 ① 오류 envelope 평탄화" 표.
 *
 * `src/test-runner/bridge-stub.ts`의 `NativeBridgeErrorShape`/`makeNativeError`가
 * 같은 shape을 이미 CI 러너 쪽에서 재현하고 있다(devtools#740) — 이 모듈은 그
 * shape을 mock 소비자 표면(`src/mock/**`)에 대해 재사용 가능한 형태로 옮긴 것이다.
 * 두 모듈은 레이어가 다르다: test-runner 쪽은 env3 blocking-call 인터셉터(빌드에
 * 안 실림, CI 전용), 이쪽은 `@ait-co/devtools` 소비자가 `pnpm dev`에서 실제로
 * import하는 mock 런타임이다 — 서로 import하지 않는다(devtools#740이 test-runner
 * 전용 모듈임을 명시).
 */

import { aitState } from './state.js';

/** 실기기 2.x native bridge가 reject에 얹는 envelope 필드. */
export interface NativeErrorEnvelope {
  name: string;
  code: string;
  message: string;
  userInfo: Record<string, unknown>;
  moduleName: string;
  __isError: true;
}

/**
 * sdk-example#284 매트릭스에 등재된 2.x 네이티브 실패 코드 인벤토리.
 * 새 코드가 매트릭스에 추가되면 여기에도 추가한다.
 */
export type NativeErrorCode =
  | 'APP_LOGIN'
  | 'PLACEMENT_ID_FETCH_FAILED'
  | 'EXECUTION_ERROR'
  | 'NO_PERMISSION'
  | 'INVALID_REQUEST'
  | 'INVALID_DATA'
  | 'FAILED_TO_GET_LOADED_AD'
  | 'APP_BRIDGE_THROTTLED'
  | '1006'
  | '4000';

/** 코드별 기본 message/moduleName — 실기기 캡처 관측값. */
const CODE_META: Record<NativeErrorCode, { message: string; moduleName: string }> = {
  APP_LOGIN: { message: 'Login failed', moduleName: 'RNTossLogin' },
  PLACEMENT_ID_FETCH_FAILED: { message: 'Failed to fetch placement id', moduleName: 'RNAdMob' },
  EXECUTION_ERROR: { message: 'Execution error', moduleName: 'RNFullScreenAd' },
  NO_PERMISSION: { message: 'No permission', moduleName: 'RNPermissions' },
  INVALID_REQUEST: { message: 'Invalid request', moduleName: 'RNPermissions' },
  INVALID_DATA: { message: 'Invalid data', moduleName: 'RNFileSystem' },
  FAILED_TO_GET_LOADED_AD: { message: 'Failed to get loaded ad', moduleName: 'RNAdMob' },
  APP_BRIDGE_THROTTLED: {
    message: 'Too many app bridge calls from this method.',
    moduleName: 'RNBridge',
  },
  '1006': { message: '광고가 로드 중이거나 준비되지 않았습니다', moduleName: 'RNFullScreenAd' },
  '4000': { message: 'Notification agreement failed', moduleName: 'RNNotification' },
};

/**
 * `aitState.failureModes.sdkLine`이 가리키는 라인으로 네이티브 실패를 조립한다.
 *
 * - `'2.x'`(기본): {@link NativeErrorEnvelope} 필드가 실린 `Error` — 실기기 2.x
 *   캡처(`{name, code, userInfo, moduleName, __isError}`)와 필드 단위 일치.
 * - `'3.x'`: 같은 실패가 "맨 Error"로 평탄화된 것을 재현 — envelope 필드 없이
 *   message만 실린 순수 `Error` 인스턴스.
 *
 * 호출부는 두 종류다:
 *
 * - **다이얼 게이트 뒤**(대부분): 프로비저닝처럼 환경에 따라 갈리는 실패는
 *   다이얼이 설정된 경우에만 재현한다 — 미설정 시 기존 동작 무변화
 *   (zero behavior change). 호출 전에 다이얼 값을 명시적으로 확인한다.
 * - **무조건**(입력 검증): 빈 `data`나 알 수 없는 haptic type처럼 환경과 무관하게
 *   실기기가 **항상** 거부하는 입력은 다이얼 없이 바로 던진다. 이건 "가끔 일어나는
 *   실패"의 시뮬레이션이 아니라 결정적 계약이므로 opt-in 대상이 아니다.
 */
export function buildNativeError(code: NativeErrorCode): Error {
  const meta = CODE_META[code];
  const sdkLine = aitState.state.failureModes.sdkLine;

  if (sdkLine === '3.x') {
    // 패턴 ①(sdk-example#284): 3.0 라인은 envelope 없이 맨 Error로 평탄화된다.
    return new Error(meta.message);
  }

  const err = new Error(meta.message) as Error & NativeErrorEnvelope;
  err.name = 'Error';
  err.code = code;
  err.userInfo = {};
  err.moduleName = meta.moduleName;
  err.__isError = true;
  return err;
}
