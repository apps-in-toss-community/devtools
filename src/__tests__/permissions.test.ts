import { beforeEach, describe, expect, it } from 'vitest';
import {
  checkPermission,
  FetchAlbumPhotosPermissionError,
  FetchContactsPermissionError,
  GetClipboardTextPermissionError,
  GetCurrentLocationPermissionError,
  getPermission,
  OpenCameraPermissionError,
  openPermissionDialog,
  PermissionError,
  requestPermission,
  SetClipboardTextPermissionError,
  withPermission,
} from '../mock/permissions.js';
import { aitState } from '../mock/state.js';

describe('Permissions mock', () => {
  beforeEach(() => {
    aitState.reset();
  });

  it('getPermission: 상태의 권한 값을 반환한다', async () => {
    expect(await getPermission({ name: 'camera', access: 'access' })).toBe('allowed');
    expect(await getPermission({ name: 'microphone', access: 'access' })).toBe('notDetermined');
  });

  it('openPermissionDialog: 이미 allowed면 그대로 반환', async () => {
    expect(await openPermissionDialog({ name: 'camera', access: 'access' })).toBe('allowed');
  });

  it('openPermissionDialog: notDetermined를 allowed로 전환한다', async () => {
    expect(await openPermissionDialog({ name: 'microphone', access: 'access' })).toBe('allowed');
    expect(aitState.state.permissions.microphone).toBe('allowed');
  });

  it('checkPermission: denied일 때 에러를 throw한다', () => {
    aitState.patch('permissions', { camera: 'denied' });
    expect(() => checkPermission('camera', 'openCamera')).toThrow(PermissionError);
  });

  it('checkPermission: allowed일 때 에러 없이 통과한다', () => {
    expect(() => checkPermission('camera', 'openCamera')).not.toThrow();
  });

  it('openPermissionDialog: denied를 allowed로 전환한다', async () => {
    aitState.patch('permissions', { camera: 'denied' });
    expect(await openPermissionDialog({ name: 'camera', access: 'access' })).toBe('allowed');
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
    expect(await requestPermission({ name: 'microphone', access: 'access' })).toBe('allowed');
    expect(aitState.state.permissions.microphone).toBe('allowed');
  });

  // --- per-API *PermissionError throw 검증 (#372) ---

  describe('checkPermission: per-API *PermissionError 서브클래스를 throw한다', () => {
    it('openCamera → OpenCameraPermissionError', () => {
      aitState.patch('permissions', { camera: 'denied' });
      expect(() => checkPermission('camera', 'openCamera')).toThrow(OpenCameraPermissionError);
      expect(() => checkPermission('camera', 'openCamera')).toThrow(PermissionError);
    });

    it('fetchAlbumPhotos → FetchAlbumPhotosPermissionError', () => {
      aitState.patch('permissions', { photos: 'denied' });
      expect(() => checkPermission('photos', 'fetchAlbumPhotos')).toThrow(
        FetchAlbumPhotosPermissionError,
      );
      expect(() => checkPermission('photos', 'fetchAlbumPhotos')).toThrow(PermissionError);
    });

    it('fetchAlbumItems → FetchAlbumPhotosPermissionError (photos 권한 공유)', () => {
      aitState.patch('permissions', { photos: 'denied' });
      expect(() => checkPermission('photos', 'fetchAlbumItems')).toThrow(
        FetchAlbumPhotosPermissionError,
      );
      expect(() => checkPermission('photos', 'fetchAlbumItems')).toThrow(PermissionError);
    });

    it('fetchContacts → FetchContactsPermissionError', () => {
      aitState.patch('permissions', { contacts: 'denied' });
      expect(() => checkPermission('contacts', 'fetchContacts')).toThrow(
        FetchContactsPermissionError,
      );
      expect(() => checkPermission('contacts', 'fetchContacts')).toThrow(PermissionError);
    });

    it('getCurrentLocation → GetCurrentLocationPermissionError', () => {
      aitState.patch('permissions', { geolocation: 'denied' });
      expect(() => checkPermission('geolocation', 'getCurrentLocation')).toThrow(
        GetCurrentLocationPermissionError,
      );
      expect(() => checkPermission('geolocation', 'getCurrentLocation')).toThrow(PermissionError);
    });

    it('getClipboardText → GetClipboardTextPermissionError', () => {
      aitState.patch('permissions', { clipboard: 'denied' });
      expect(() => checkPermission('clipboard', 'getClipboardText')).toThrow(
        GetClipboardTextPermissionError,
      );
      expect(() => checkPermission('clipboard', 'getClipboardText')).toThrow(PermissionError);
    });

    it('setClipboardText → SetClipboardTextPermissionError', () => {
      aitState.patch('permissions', { clipboard: 'denied' });
      expect(() => checkPermission('clipboard', 'setClipboardText')).toThrow(
        SetClipboardTextPermissionError,
      );
      expect(() => checkPermission('clipboard', 'setClipboardText')).toThrow(PermissionError);
    });

    it('매핑에 없는 fnName은 기반 PermissionError로 fallback', () => {
      aitState.patch('permissions', { microphone: 'denied' });
      expect(() => checkPermission('microphone', 'unknownApi')).toThrow(PermissionError);
    });
  });

  describe('실패-모드 다이얼 (devtools#783)', () => {
    it('failureModes.getPermission 미설정 시 기존처럼 상태 값을 resolve한다', async () => {
      await expect(getPermission({ name: 'geolocation', access: 'access' })).resolves.toBe(
        'allowed',
      );
    });

    it('failureModes.getPermission 설정 시 다이얼이 걸린 이름만 2.x native envelope으로 reject한다 (실측: geolocation/camera/microphone → rejected/Error/NO_PERMISSION, clipboard/contacts/photos → resolved)', async () => {
      aitState.patch('failureModes', {
        getPermission: {
          geolocation: 'NO_PERMISSION',
          camera: 'NO_PERMISSION',
          microphone: 'NO_PERMISSION',
        },
      });

      // 다이얼이 걸린 이름 — reject
      await expect(getPermission({ name: 'geolocation', access: 'access' })).rejects.toMatchObject({
        name: 'Error',
        code: 'NO_PERMISSION',
        userInfo: {},
        __isError: true,
      });
      await expect(getPermission({ name: 'camera', access: 'access' })).rejects.toMatchObject({
        name: 'Error',
        code: 'NO_PERMISSION',
      });
      await expect(getPermission({ name: 'microphone', access: 'access' })).rejects.toMatchObject({
        name: 'Error',
        code: 'NO_PERMISSION',
      });

      // 다이얼이 안 걸린 이름 — 전역 차단 회귀 방지: 기존처럼 resolve
      await expect(getPermission({ name: 'clipboard', access: 'access' })).resolves.toBe('allowed');
      await expect(getPermission({ name: 'contacts', access: 'access' })).resolves.toBe('allowed');
      await expect(getPermission({ name: 'photos', access: 'access' })).resolves.toBe('allowed');
    });

    it('failureModes.sdkLine이 3.x면 맨 Error로 평탄화된 reject를 던진다', async () => {
      aitState.patch('failureModes', {
        getPermission: { geolocation: 'NO_PERMISSION' },
        sdkLine: '3.x',
      });

      let caught: unknown;
      try {
        await getPermission({ name: 'geolocation', access: 'access' });
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(Error);
      expect((caught as { code?: string }).code).toBeUndefined();
      expect((caught as { __isError?: boolean }).__isError).toBeUndefined();
    });

    it('withPermission이 부착한 .getPermission()도 같은 배선을 탄다', async () => {
      aitState.patch('failureModes', { getPermission: { camera: 'NO_PERMISSION' } });
      const fn = async () => 'result';
      const enhanced = withPermission(fn, 'camera');

      await expect(enhanced.getPermission()).rejects.toMatchObject({ code: 'NO_PERMISSION' });
    });
  });
});
