import { describe, it, expect, beforeEach } from 'vitest';
import { aitState } from '../mock/state.js';
import { getPermission, openPermissionDialog, checkPermission, withPermission, requestPermission } from '../mock/permissions.js';

describe('Permissions mock', () => {
  beforeEach(() => {
    aitState.reset();
  });

  it('getPermission: 상태의 권한 값을 반환한다', async () => {
    expect(await getPermission('camera')).toBe('allowed');
    expect(await getPermission('microphone')).toBe('notDetermined');
  });

  it('openPermissionDialog: 이미 allowed면 그대로 반환', async () => {
    expect(await openPermissionDialog('camera')).toBe('allowed');
  });

  it('openPermissionDialog: notDetermined를 allowed로 전환한다', async () => {
    expect(await openPermissionDialog('microphone')).toBe('allowed');
    expect(aitState.state.permissions.microphone).toBe('allowed');
  });

  it('checkPermission: denied일 때 에러를 throw한다', () => {
    aitState.patch('permissions', { camera: 'denied' });
    expect(() => checkPermission('camera', 'openCamera')).toThrow('denied');
  });

  it('checkPermission: allowed일 때 에러 없이 통과한다', () => {
    expect(() => checkPermission('camera', 'openCamera')).not.toThrow();
  });

  it('openPermissionDialog: denied를 allowed로 전환한다', async () => {
    aitState.patch('permissions', { camera: 'denied' });
    expect(await openPermissionDialog('camera')).toBe('allowed');
    expect(aitState.state.permissions.camera).toBe('allowed');
  });

  it('withPermission: 함수에 getPermission/openPermissionDialog를 부착한다', async () => {
    const fn = async () => 'result';
    const enhanced = withPermission(fn, 'camera');

    expect(typeof enhanced.getPermission).toBe('function');
    expect(typeof enhanced.openPermissionDialog).toBe('function');
    expect(await enhanced.getPermission()).toBe('allowed');
    expect(await enhanced.openPermissionDialog()).toBe('allowed');
  });

  it('requestPermission: openPermissionDialog에 위임한다', async () => {
    aitState.patch('permissions', { microphone: 'notDetermined' });
    expect(await requestPermission({ name: 'microphone', access: 'record' })).toBe('allowed');
    expect(aitState.state.permissions.microphone).toBe('allowed');
  });
});
