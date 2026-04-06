import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aitState } from '../mock/state.js';
import { getCurrentLocation, generateHapticFeedback, saveBase64Data, Accuracy } from '../mock/device/index.js';

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
});
