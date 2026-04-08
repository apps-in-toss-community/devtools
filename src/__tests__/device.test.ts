import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aitState } from '../mock/state.js';
import {
  getCurrentLocation, generateHapticFeedback, saveBase64Data, Accuracy,
  getClipboardText, setClipboardText, getNetworkStatusByMode, getDefaultPlaceholderImages,
  openCamera,
} from '../mock/device/index.js';

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

    it('상태를 변경하면 새 좌표를 반환한다', async () => {
      aitState.patch('location', {
        coords: { ...aitState.state.location.coords, latitude: 35.0, longitude: 129.0 },
      });
      const loc = await getCurrentLocation({ accuracy: Accuracy.High });
      expect(loc.coords.latitude).toBe(35.0);
      expect(loc.coords.longitude).toBe(129.0);
    });

    it('geolocation 권한이 denied이면 에러를 throw한다', async () => {
      aitState.patch('permissions', { geolocation: 'denied' });
      await expect(getCurrentLocation({ accuracy: Accuracy.High })).rejects.toThrow('denied');
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
        images.forEach(img => {
          expect(img).toMatch(/^data:image\/png;base64,/);
        });
      });

      it('동일한 참조를 반환한다 (캐시)', () => {
        const a = getDefaultPlaceholderImages();
        const b = getDefaultPlaceholderImages();
        expect(a).toBe(b);
      });
    });

    describe('prompt mode timeout', () => {
      it('waitForPromptResponse는 30초 후 reject된다', async () => {
        vi.useFakeTimers();
        aitState.patch('deviceModes', { camera: 'prompt' });
        aitState.patch('permissions', { camera: 'allowed' });

        const promise = openCamera();

        vi.advanceTimersByTime(30_000);
        await expect(promise).rejects.toThrow('Prompt timeout');

        vi.useRealTimers();
      });
    });
  });
});
