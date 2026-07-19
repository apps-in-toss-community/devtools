import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Accuracy,
  fetchAlbumItems,
  generateHapticFeedback,
  getClipboardText,
  getCurrentLocation,
  getDefaultPlaceholderImages,
  getNetworkStatusByMode,
  openCamera,
  openPDFViewer,
  saveBase64Data,
  setClipboardText,
  startUpdateLocation,
} from '../mock/device/index.js';
import {
  FetchAlbumPhotosPermissionError,
  GetCurrentLocationPermissionError,
  PermissionError,
} from '../mock/permissions.js';
import { aitState } from '../mock/state.js';

describe('Device mock', () => {
  beforeEach(() => {
    aitState.reset();
  });

  describe('getCurrentLocation', () => {
    it('상태에 설정된 좌표를 반환한다', async () => {
      const loc = await getCurrentLocation({ accuracy: Accuracy.High });
      expect(loc.coords.latitude).toBe(37.5665);
      expect(loc.coords.longitude).toBe(126.978);
      expect(typeof loc.timestamp).toBe('number');
    });

    it('prompt 모드에서도 mock 모드와 같은 2키 shape를 반환한다', async () => {
      // 반환 shape는 모드와 무관해야 한다 — mock/web/prompt는 우리 내부 개념이고
      // 실기기엔 그런 구분이 없다. 패널 prompt 응답은 startUpdateLocation과 채널을
      // 공유해 accessLocation을 실어 오므로, 여기서 걷어내지 않으면 같은 API가
      // 모드에 따라 다른 키 구성을 내게 된다.
      aitState.patch('deviceModes', { ...aitState.state.deviceModes, location: 'prompt' });
      const pending = getCurrentLocation({ accuracy: Accuracy.High });
      window.dispatchEvent(
        new CustomEvent('__ait:prompt-response:location', {
          detail: {
            coords: {
              latitude: 1,
              longitude: 2,
              altitude: 0,
              accuracy: 10,
              altitudeAccuracy: 0,
              heading: 0,
            },
            timestamp: 123,
            accessLocation: 'FINE',
          },
        }),
      );
      expect(Object.keys(await pending).sort()).toEqual(['coords', 'timestamp']);
    });

    it('상태를 변경하면 새 좌표를 반환한다', async () => {
      aitState.patch('location', {
        coords: { ...aitState.state.location.coords, latitude: 35.0, longitude: 129.0 },
      });
      const loc = await getCurrentLocation({ accuracy: Accuracy.High });
      expect(loc.coords.latitude).toBe(35.0);
      expect(loc.coords.longitude).toBe(129.0);
    });

    it('geolocation 권한이 denied이면 GetCurrentLocationPermissionError를 throw한다', async () => {
      aitState.patch('permissions', { geolocation: 'denied' });
      await expect(getCurrentLocation({ accuracy: Accuracy.High })).rejects.toThrow(
        GetCurrentLocationPermissionError,
      );
      await expect(getCurrentLocation({ accuracy: Accuracy.High })).rejects.toThrow(
        PermissionError,
      );
    });
  });

  describe('startUpdateLocation', () => {
    it('getPermission이 부착되어 있다', async () => {
      expect(typeof startUpdateLocation.getPermission).toBe('function');
      const status = await startUpdateLocation.getPermission();
      expect(status).toBe('allowed');
    });

    it('openPermissionDialog가 부착되어 있다', async () => {
      expect(typeof startUpdateLocation.openPermissionDialog).toBe('function');
      const result = await startUpdateLocation.openPermissionDialog();
      expect(result).toBe('allowed');
    });
  });

  describe('generateHapticFeedback', () => {
    it('analytics 로그에 기록된다', async () => {
      await generateHapticFeedback({ type: 'success' });
      const logs = aitState.state.analyticsLog;
      expect(logs).toHaveLength(1);
      expect(logs[0].type).toBe('haptic');
      expect(logs[0].params).toEqual({ hapticType: 'success' });
    });
  });

  describe('saveBase64Data', () => {
    // vi.spyOn은 vitest.config.ts의 restoreMocks: true에 의해 자동 복원된다
    it('에러 없이 실행된다', async () => {
      const clickSpy = vi.fn();
      const originalCreateElement = document.createElement.bind(document);
      vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        if (tag === 'a') {
          return {
            set href(_v: string) {},
            set download(_v: string) {},
            click: clickSpy,
          } as unknown as HTMLAnchorElement;
        }
        return originalCreateElement(tag);
      });

      await saveBase64Data({
        data: 'dGVzdA==',
        fileName: 'test.txt',
        mimeType: 'text/plain',
      });
      expect(clickSpy).toHaveBeenCalled();
    });
  });

  describe('Device API Modes', () => {
    describe('clipboard mock mode', () => {
      beforeEach(() => {
        aitState.patch('deviceModes', { clipboard: 'mock' });
      });

      it('mock 모드에서 setClipboardText/getClipboardText는 state를 사용한다', async () => {
        await setClipboardText('hello');
        expect(aitState.state.mockData.clipboardText).toBe('hello');
        const text = await getClipboardText();
        expect(text).toBe('hello');
      });

      it('reset 후 clipboardText가 초기화된다', async () => {
        await setClipboardText('test');
        aitState.reset();
        aitState.patch('deviceModes', { clipboard: 'mock' });
        const text = await getClipboardText();
        expect(text).toBe('');
      });
    });

    describe('getNetworkStatusByMode', () => {
      it('mock 모드에서 null을 반환한다', () => {
        aitState.patch('deviceModes', { network: 'mock' });
        expect(getNetworkStatusByMode()).toBeNull();
      });

      it('web 모드에서 navigator.onLine이 false이면 OFFLINE을 반환한다', () => {
        aitState.patch('deviceModes', { network: 'web' });
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        expect(getNetworkStatusByMode()).toBe('OFFLINE');
      });

      it('web 모드에서 navigator.onLine이 true이면 state 기반 값을 반환한다', () => {
        aitState.patch('deviceModes', { network: 'web' });
        vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
        // navigator.connection이 없으면 state 기반 값
        const result = getNetworkStatusByMode();
        expect(result).toBe(aitState.state.networkStatus);
      });
    });

    describe('getDefaultPlaceholderImages', () => {
      it('3개의 data URI를 반환한다', () => {
        const images = getDefaultPlaceholderImages();
        expect(images).toHaveLength(3);
        images.forEach((img) => {
          expect(img).toMatch(/^data:image\/(png|svg\+xml);base64,/);
        });
      });

      it('동일한 내용의 새 배열을 반환한다 (캐시된 데이터의 방어적 복사)', () => {
        const a = getDefaultPlaceholderImages();
        const b = getDefaultPlaceholderImages();
        expect(a).not.toBe(b); // 서로 다른 참조
        expect(a).toEqual(b); // 동일한 내용
      });
    });

    describe('prompt mode timeout', () => {
      it('패널이 없으면 import 안내 메시지를 표시한다', async () => {
        vi.useFakeTimers();
        aitState.patch('deviceModes', { camera: 'prompt' });
        aitState.patch('permissions', { camera: 'allowed' });

        try {
          const promise = openCamera();

          vi.advanceTimersByTime(30_000);
          await expect(promise).rejects.toThrow('Is @ait-co/devtools/panel imported?');
        } finally {
          vi.useRealTimers();
        }
      });

      it('패널이 있으면 사용자 액션 안내 메시지를 표시한다', async () => {
        vi.useFakeTimers();
        aitState.patch('deviceModes', { camera: 'prompt' });
        aitState.patch('permissions', { camera: 'allowed' });

        // .ait-panel 요소를 DOM에 추가
        const panel = document.createElement('div');
        panel.className = 'ait-panel';
        document.body.appendChild(panel);

        try {
          const promise = openCamera();

          vi.advanceTimersByTime(30_000);
          await expect(promise).rejects.toThrow('Please provide input via the DevTools panel.');
        } finally {
          panel.remove();
          vi.useRealTimers();
        }
      });
    });
  });

  describe('fetchAlbumItems', () => {
    beforeEach(() => {
      aitState.reset();
      aitState.patch('permissions', { photos: 'allowed' });
      aitState.patch('deviceModes', { photos: 'mock' });
    });

    it('mock 모드에서 AlbumItemResponse 배열을 반환한다', async () => {
      const items = await fetchAlbumItems();
      expect(Array.isArray(items)).toBe(true);
      items.forEach((item) => {
        expect(typeof item.id).toBe('string');
        expect(typeof item.dataUri).toBe('string');
        expect(item.type).toBe('PHOTO');
      });
    });

    it('maxCount를 지정하면 해당 개수 이하로 반환한다', async () => {
      const items = await fetchAlbumItems({ maxCount: 1 });
      expect(items.length).toBeLessThanOrEqual(1);
    });

    it('options 없이 호출하면 기본값(maxCount=10)으로 동작한다', async () => {
      const items = await fetchAlbumItems();
      expect(items.length).toBeLessThanOrEqual(10);
    });

    it('types에 PHOTO만 있으면 PHOTO 타입 항목만 반환한다', async () => {
      const items = await fetchAlbumItems({ types: ['PHOTO'] });
      items.forEach((item) => {
        expect(item.type).toBe('PHOTO');
      });
    });

    it('photos 권한이 denied이면 FetchAlbumPhotosPermissionError를 throw한다', async () => {
      aitState.patch('permissions', { photos: 'denied' });
      await expect(fetchAlbumItems()).rejects.toThrow(FetchAlbumPhotosPermissionError);
      await expect(fetchAlbumItems()).rejects.toThrow(PermissionError);
    });

    it('prompt 모드에서 타임아웃 시 reject한다', async () => {
      vi.useFakeTimers();
      aitState.patch('deviceModes', { photos: 'prompt' });

      try {
        const promise = fetchAlbumItems();
        vi.advanceTimersByTime(30_000);
        await expect(promise).rejects.toThrow();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('openPDFViewer', () => {
    it('"CLOSE"를 반환한다', async () => {
      const result = await openPDFViewer({ data: 'JVBERi0xLjQK' });
      expect(result).toBe('CLOSE');
    });

    it('filename 없이도 동작한다', async () => {
      const result = await openPDFViewer({ data: 'JVBERi0xLjQK' });
      expect(result).toBe('CLOSE');
    });

    it('빈 data 문자열로 호출해도 "CLOSE"를 반환한다 (mock은 실 SDK보다 엄격하지 않음)', async () => {
      const result = await openPDFViewer({ data: '' });
      expect(result).toBe('CLOSE');
    });
  });
});
