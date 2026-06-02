/**
 * 권한 시스템 mock
 * 각 디바이스 API (.getPermission, .openPermissionDialog)에 부착된다.
 */

import { aitState } from './state.js';
import type { PermissionName, PermissionStatus } from './types.js';

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

export async function getPermission(name: PermissionName): Promise<PermissionStatus> {
  return aitState.state.permissions[name];
}

export async function openPermissionDialog(name: PermissionName): Promise<'allowed' | 'denied'> {
  const current = aitState.state.permissions[name];
  if (current === 'allowed') return 'allowed';
  // notDetermined나 denied일 때 — Panel에서 설정된 값을 사용
  // 기본적으로는 allowed로 전환
  aitState.patch('permissions', { [name]: 'allowed' });
  return 'allowed';
}

export async function requestPermission(permission: {
  name: PermissionName;
  access: string;
}): Promise<'allowed' | 'denied'> {
  return openPermissionDialog(permission.name);
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
  enhanced.getPermission = () => getPermission(permissionName);
  enhanced.openPermissionDialog = () => openPermissionDialog(permissionName);
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
