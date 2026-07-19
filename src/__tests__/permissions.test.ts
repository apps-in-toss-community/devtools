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

      // 다이얼이 걸린 이름 — reject. `access: 'read'`로 검사한다: `'access'`는
      // 상태 조회라 다이얼을 아예 안 타기 때문이다(아래 access 축 테스트 참조).
      await expect(getPermission({ name: 'geolocation', access: 'read' })).rejects.toMatchObject({
        name: 'Error',
        code: 'NO_PERMISSION',
        userInfo: {},
        __isError: true,
      });
      await expect(getPermission({ name: 'camera', access: 'read' })).rejects.toMatchObject({
        name: 'Error',
        code: 'NO_PERMISSION',
      });
      await expect(getPermission({ name: 'microphone', access: 'read' })).rejects.toMatchObject({
        name: 'Error',
        code: 'NO_PERMISSION',
      });

      // 다이얼이 안 걸린 이름 — 전역 차단 회귀 방지: 기존처럼 resolve
      await expect(getPermission({ name: 'clipboard', access: 'read' })).resolves.toBe('allowed');
      await expect(getPermission({ name: 'contacts', access: 'read' })).resolves.toBe('allowed');
      await expect(getPermission({ name: 'photos', access: 'read' })).resolves.toBe('allowed');
    });

    it("access 축: 다이얼이 걸린 이름이라도 access: 'access'는 통과하고 read/write만 거부한다 (실측: env3 happy-each-access)", async () => {
      // env3 run11 실측 — geolocation 고정 + PermissionAccess 3종 순회:
      //   read → rejected NO_PERMISSION / write → rejected NO_PERMISSION / access → resolved
      // "상태 조회는 선언 여부와 무관하게 허용, 실제 capability 요구만 게이트"라는
      // 읽기다. 이게 없으면 env1이 3회 전부 거부해 env3와 1건 어긋난다.
      aitState.patch('failureModes', {
        getPermission: { geolocation: 'NO_PERMISSION' },
      });

      await expect(getPermission({ name: 'geolocation', access: 'read' })).rejects.toMatchObject({
        code: 'NO_PERMISSION',
      });
      await expect(getPermission({ name: 'geolocation', access: 'write' })).rejects.toMatchObject({
        code: 'NO_PERMISSION',
      });
      await expect(getPermission({ name: 'geolocation', access: 'access' })).resolves.toBe(
        'allowed',
      );
    });

    it('failureModes.sdkLine이 3.x면 맨 Error로 평탄화된 reject를 던진다', async () => {
      aitState.patch('failureModes', {
        getPermission: { geolocation: 'NO_PERMISSION' },
        sdkLine: '3.x',
      });

      let caught: unknown;
      try {
        await getPermission({ name: 'geolocation', access: 'read' });
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(Error);
      expect((caught as { code?: string }).code).toBeUndefined();
      expect((caught as { __isError?: boolean }).__isError).toBeUndefined();
    });

    it('openPermissionDialog/requestPermission도 같은 선언 게이트를 탄다 (실측: env3 run11)', async () => {
      // env3 실측 — sdk-example#313에서 시나리오 키가 통일되며 비교 대상에 들어왔다:
      //   openPermissionDialog { camera, access }    → resolved
      //   openPermissionDialog { geolocation, read } → rejected
      //   requestPermission    { geolocation, read } → rejected
      // getPermission의 access 축과 같은 그림이다. 게이트가 getPermission에만
      // 걸려 있으면 env1이 셋을 전부 resolve해 실기기와 2건 어긋난다.
      aitState.patch('failureModes', {
        getPermission: { geolocation: 'NO_PERMISSION', camera: 'NO_PERMISSION' },
      });

      await expect(openPermissionDialog({ name: 'geolocation', access: 'read' })).rejects.toThrow();
      await expect(requestPermission({ name: 'geolocation', access: 'read' })).rejects.toThrow();

      // access 축: 상태 조회는 다이얼이 걸린 이름이라도 통과한다.
      await expect(openPermissionDialog({ name: 'camera', access: 'access' })).resolves.toBe(
        'allowed',
      );
    });

    it('형제 API는 게이트 조건은 공유하되 errorCode는 갈린다 (실측: env3 run11)', async () => {
      // 세 API가 같은 입력 `{ geolocation, read }`에 서로 다른 코드로 떨어진다:
      //   getPermission        → NO_PERMISSION
      //   requestPermission    → NO_PERMISSION
      //   openPermissionDialog → INVALID_REQUEST
      //
      // 처음엔 requestPermission이 openPermissionDialog에 위임하니 게이트도
      // 위임하면 된다고 보고 한 지점에만 배선했는데, 그 모델은 코드 층위에서
      // 실측과 어긋났다(env1↔env3 capture diff가 잡아냈다). 위임 구조를 다시
      // 좁히면 이 발산이 조용히 되살아나므로 여기서 못박는다.
      aitState.patch('failureModes', { getPermission: { geolocation: 'NO_PERMISSION' } });

      await expect(getPermission({ name: 'geolocation', access: 'read' })).rejects.toMatchObject({
        code: 'NO_PERMISSION',
      });
      await expect(
        requestPermission({ name: 'geolocation', access: 'read' }),
      ).rejects.toMatchObject({ code: 'NO_PERMISSION' });
      await expect(
        openPermissionDialog({ name: 'geolocation', access: 'read' }),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    });

    it('게이트에 걸리면 권한 상태를 변이시키지 않는다 — 다이얼로그가 뜨기 전에 떨어지므로', async () => {
      aitState.patch('permissions', { geolocation: 'notDetermined' });
      aitState.patch('failureModes', { getPermission: { geolocation: 'NO_PERMISSION' } });

      await expect(
        openPermissionDialog({ name: 'geolocation', access: 'write' }),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });

      expect(aitState.state.permissions.geolocation).toBe('notDetermined');
    });

    it("withPermission이 부착한 .getPermission()은 access: 'access' 경로라 다이얼을 타지 않는다", async () => {
      // `withPermission(...).getPermission()`은 `access: 'access'`로 고정 호출한다
      // (= 상태 조회 편의 헬퍼). 위 access 축 계약대로 상태 조회는 선언 게이트를
      // 안 타므로, 다이얼이 걸린 이름이라도 여기서는 resolve하는 게 맞다 — 실기기도
      // 같은 경로를 통과시킨다. 다이얼이 이 헬퍼를 통해 거부되길 원한다면 그건
      // access 축 모델을 어기는 것이므로, 그 기대를 여기서 못박아 둔다.
      aitState.patch('failureModes', { getPermission: { camera: 'NO_PERMISSION' } });
      const fn = async () => 'result';
      const enhanced = withPermission(fn, 'camera');

      await expect(enhanced.getPermission()).resolves.toBe('allowed');
    });
  });
});
