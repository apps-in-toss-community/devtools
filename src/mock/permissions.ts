/**
 * 권한 시스템 mock
 * 각 디바이스 API (.getPermission, .openPermissionDialog)에 부착된다.
 */

import type {
  PermissionAccess,
  PermissionName,
  PermissionStatus,
} from '@apps-in-toss/web-framework';
import { buildNativeError, type NativeErrorCode } from './native-error.js';
import { aitState } from './state.js';

// --- PermissionError 계층 (web-framework 3.0+ 신규) ---
// checkPermission()이 권한 거부 시 per-API *PermissionError 서브클래스를 throw한다 (#372).

/**
 * web-framework 3.0+ 권한 에러 기반 클래스.
 * `instanceof PermissionError`로 체크하는 코드와 호환된다.
 */
export class PermissionError extends Error {
  constructor({ methodName, message }: { methodName: string; message?: string }) {
    super(message ?? `${methodName}: permission denied`);
    this.name = `${methodName}PermissionError`;
  }
}

/** openCamera 권한 에러 */
export class OpenCameraPermissionError extends PermissionError {
  constructor() {
    super({ methodName: 'openCamera' });
  }
}

/** fetchAlbumPhotos 권한 에러 */
export class FetchAlbumPhotosPermissionError extends PermissionError {
  constructor() {
    super({ methodName: 'fetchAlbumPhotos' });
  }
}

/** fetchContacts 권한 에러 */
export class FetchContactsPermissionError extends PermissionError {
  constructor() {
    super({ methodName: 'fetchContacts' });
  }
}

/** getCurrentLocation 권한 에러 */
export class GetCurrentLocationPermissionError extends PermissionError {
  constructor() {
    super({ methodName: 'getCurrentLocation' });
  }
}

/** getClipboardText 권한 에러 */
export class GetClipboardTextPermissionError extends PermissionError {
  constructor() {
    super({ methodName: 'getClipboardText' });
  }
}

/** setClipboardText 권한 에러 */
export class SetClipboardTextPermissionError extends PermissionError {
  constructor() {
    super({ methodName: 'setClipboardText' });
  }
}

/**
 * startUpdateLocation 권한 에러.
 * web-framework 3.0에서 GetCurrentLocationPermissionError의 alias.
 */
export const StartUpdateLocationPermissionError = GetCurrentLocationPermissionError;

// --- API 이름 → PermissionError 매핑 (web-framework 3.0 표면 기준) ---
// 실 SDK가 각 API 거부 시 throw하는 클래스와 1:1 대응. SDK에 없는 API(fetchAlbumItems)는
// 동일한 'photos' 권한을 공유하는 FetchAlbumPhotosPermissionError를 사용한다.

const permissionErrorMap: Record<string, new () => PermissionError> = {
  openCamera: OpenCameraPermissionError,
  fetchAlbumPhotos: FetchAlbumPhotosPermissionError,
  // fetchAlbumItems는 SDK에 별도 PermissionError 없음 — photos 권한을 공유하므로 동일 클래스.
  fetchAlbumItems: FetchAlbumPhotosPermissionError,
  fetchContacts: FetchContactsPermissionError,
  getCurrentLocation: GetCurrentLocationPermissionError,
  getClipboardText: GetClipboardTextPermissionError,
  setClipboardText: SetClipboardTextPermissionError,
};

// SDK 시그니처: getPermission(permission: { name: PermissionName; access: PermissionAccess }): Promise<PermissionStatus>
export async function getPermission(permission: {
  name: PermissionName;
  access: PermissionAccess;
}): Promise<PermissionStatus> {
  // 실패-모드 다이얼 (devtools#783): aitState.patch('failureModes',
  // { getPermission: { geolocation: 'NO_PERMISSION' } })로 실기기 실측(env3 run11,
  // 2.x/iOS — geolocation/camera/microphone만 rejected/`Error`/`NO_PERMISSION`,
  // clipboard/contacts/photos는 resolved)을 권한 이름별로 재현한다. 전역 on/off가
  // 아니라 이름 단위 맵 — 다이얼이 걸린 이름만 reject하고 나머지는 기존대로
  // resolve (zero behavior change). withPermission()이 부착하는 `.getPermission()`
  // 도 이 함수를 그대로 호출하므로 배선 지점은 여기 하나뿐이다.
  //
  // `access` 축 (devtools#783 잔여 해소): 다이얼은 `read`/`write`에만 건다.
  // 실측(env3 run11, `happy-each-access` — geolocation 고정 + access 3종 순회):
  //   { geolocation, read }   → rejected NO_PERMISSION
  //   { geolocation, write }  → rejected NO_PERMISSION
  //   { geolocation, access } → resolved
  // `PermissionAccess`는 `'read' | 'write' | 'access'`이고, `'access'`만 통과하는
  // 그림은 "권한 *상태 조회*는 선언 여부와 무관하게 허용, 실제 capability 요구
  // (`read`/`write`)만 선언 게이트를 탄다"로 읽힌다. 그래서 이름 단위 맵을
  // access 축과 곱하지 않고, `'access'`일 때 다이얼 자체를 건너뛴다 —
  // 이름×access 2차원 맵으로 확장할 근거(이름별로 access 프로파일이 다르다는
  // 관측)는 아직 없고, 근거 없는 확장은 #783에서 이름 단위 맵을 택한 원칙에
  // 어긋난다.
  const failureCode = permissionFailureCode(permission);
  if (failureCode) {
    throw buildNativeError(failureCode);
  }

  return aitState.state.permissions[permission.name];
}

/**
 * 선언 게이트에 걸리는 이름·access 조합이면 native errorCode를 돌려준다.
 *
 * `getPermission`뿐 아니라 `openPermissionDialog`(및 그것에 위임하는
 * `requestPermission`)도 같은 게이트를 탄다 — 실기기가 그렇게 동작하기 때문이다.
 * env3 run11 실측(sdk-example#313에서 시나리오 키가 통일되며 비교 대상에 들어온 값):
 *
 *   openPermissionDialog { camera, access }      → resolved
 *   openPermissionDialog { geolocation, read }   → rejected
 *   requestPermission    { geolocation, read }   → rejected
 *
 * `getPermission`의 access 축(위 주석)과 정확히 같은 그림이다 — 상태 조회는
 * 통과하고 실제 capability 요구만 막힌다. 게이트가 `getPermission`에만 걸려
 * 있었을 때 env1은 이 셋을 전부 resolve해 실기기와 2건 어긋났고, 그 발산은
 * 시나리오 이름이 갈려 있어 커버리지 갭 뒤에 가려져 있었다.
 */
function permissionFailureCode(permission: {
  name: PermissionName;
  access: PermissionAccess;
}): NativeErrorCode | undefined {
  if (permission.access === 'access') {
    return undefined;
  }
  return aitState.state.failureModes.getPermission?.[permission.name];
}

// SDK 시그니처: openPermissionDialog(permission: { name: PermissionName; access: PermissionAccess }): Promise<Exclude<PermissionStatus, "notDetermined">>
export async function openPermissionDialog(permission: {
  name: PermissionName;
  access: PermissionAccess;
}): Promise<'allowed' | 'denied'> {
  // 선언 게이트는 다이얼로그를 열기 **전에** 탄다 — 미선언 권한은 실기기에서
  // 프롬프트 자체가 뜨지 않고 native 오류로 떨어진다(`permissionFailureCode` 참조).
  const failureCode = permissionFailureCode(permission);
  if (failureCode) {
    throw buildNativeError(failureCode);
  }

  const current = aitState.state.permissions[permission.name];
  if (current === 'allowed') return 'allowed';
  // notDetermined나 denied일 때 — Panel에서 설정된 값을 사용
  // 기본적으로는 allowed로 전환
  aitState.patch('permissions', { [permission.name]: 'allowed' });
  return 'allowed';
}

// SDK 시그니처: requestPermission(permission: { name: PermissionName; access: PermissionAccess }): Promise<Exclude<PermissionStatus, "notDetermined">>
export async function requestPermission(permission: {
  name: PermissionName;
  access: PermissionAccess;
}): Promise<'allowed' | 'denied'> {
  return openPermissionDialog(permission);
}

/** 권한이 필요한 함수에 .getPermission(), .openPermissionDialog()를 부착 */
export function withPermission<T extends (...args: never[]) => unknown>(
  fn: T,
  permissionName: PermissionName,
): T & {
  getPermission: () => Promise<PermissionStatus>;
  openPermissionDialog: () => Promise<'allowed' | 'denied'>;
} {
  const enhanced = fn as T & {
    getPermission: () => Promise<PermissionStatus>;
    openPermissionDialog: () => Promise<'allowed' | 'denied'>;
  };
  enhanced.getPermission = () => getPermission({ name: permissionName, access: 'access' });
  enhanced.openPermissionDialog = () =>
    openPermissionDialog({ name: permissionName, access: 'access' });
  return enhanced;
}

/**
 * 권한 체크 후 denied면 per-API *PermissionError 서브클래스를 throw한다.
 * 실 3.0 SDK 동작과 일치 — `instanceof PermissionError` 분기가 mock에서도 동작한다 (#372).
 */
export function checkPermission(name: PermissionName, fnName: string): void {
  const status = aitState.state.permissions[name];
  if (status === 'denied') {
    const ErrorClass = permissionErrorMap[fnName];
    if (ErrorClass) {
      throw new ErrorClass();
    }
    // 매핑에 없는 fnName은 기반 클래스로 fallback (SDK 표면 밖의 경로 보호)
    throw new PermissionError({ methodName: fnName });
  }
}
