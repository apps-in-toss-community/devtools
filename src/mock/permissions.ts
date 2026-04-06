/**
 * 권한 시스템 mock
 * 각 디바이스 API (.getPermission, .openPermissionDialog)에 부착된다.
 */

import { aitState, type PermissionName, type PermissionStatus } from './state.js';

export function getPermission(name: PermissionName): Promise<PermissionStatus> {
  return Promise.resolve(aitState.state.permissions[name]);
}

export function openPermissionDialog(name: PermissionName): Promise<'allowed' | 'denied'> {
  const current = aitState.state.permissions[name];
  if (current === 'allowed') return Promise.resolve('allowed');
  // notDetermined나 denied일 때 — Panel에서 설정된 값을 사용
  // 기본적으로는 allowed로 전환
  aitState.patch('permissions', { [name]: 'allowed' });
  return Promise.resolve('allowed');
}

export function requestPermission(permission: { name: PermissionName; access: string }): Promise<'allowed' | 'denied'> {
  return openPermissionDialog(permission.name);
}

/** 권한이 필요한 함수에 .getPermission(), .openPermissionDialog()를 부착 */
export function withPermission<T extends (...args: never[]) => unknown>(
  fn: T,
  permissionName: PermissionName,
): T & { getPermission: () => Promise<PermissionStatus>; openPermissionDialog: () => Promise<'allowed' | 'denied'> } {
  const enhanced = fn as T & {
    getPermission: () => Promise<PermissionStatus>;
    openPermissionDialog: () => Promise<'allowed' | 'denied'>;
  };
  enhanced.getPermission = () => getPermission(permissionName);
  enhanced.openPermissionDialog = () => openPermissionDialog(permissionName);
  return enhanced;
}

/** 권한 체크 후 denied면 에러 throw */
export function checkPermission(name: PermissionName, fnName: string): void {
  const status = aitState.state.permissions[name];
  if (status === 'denied') {
    throw new Error(`[ait-devtools] ${fnName}: Permission "${name}" is denied. Change it in the DevTools panel.`);
  }
}
