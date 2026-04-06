import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { aitState } from '../mock/state.js';
import { GoogleAdMob, TossAds, loadFullScreenAd, showFullScreenAd } from '../mock/ads/index.js';

describe('Ads mock', () => {
  beforeEach(() => {
    aitState.reset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('GoogleAdMob', () => {
    it('loadAppsInTossAdMob: loaded 이벤트를 발생시킨다', async () => {
      const onEvent = vi.fn();
      const onError = vi.fn();

      GoogleAdMob.loadAppsInTossAdMob({ onEvent, onError });
      await vi.advanceTimersByTimeAsync(200);

      expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'loaded' }));
      expect(aitState.state.ads.isLoaded).toBe(true);
    });

    it('showAppsInTossAdMob: 로드되지 않았으면 에러를 반환한다', () => {
      const onEvent = vi.fn();
      const onError = vi.fn();

      GoogleAdMob.showAppsInTossAdMob({ onEvent, onError });
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    // setTimeout 지연 값은 ads/index.ts의 showAppsInTossAdMob 구현과 일치해야 한다
    // source delays: requested@50, show@100, impression@150, userEarnedReward@1000, dismissed@1500
    it('showAppsInTossAdMob: 로드 후 이벤트 시퀀스가 발생한다', async () => {
      // load first
      const loadEvent = vi.fn();
      GoogleAdMob.loadAppsInTossAdMob({ onEvent: loadEvent, onError: vi.fn() });
      await vi.advanceTimersByTimeAsync(200);
      expect(aitState.state.ads.isLoaded).toBe(true);

      // show — advance to 1500ms to flush all events at once
      const showEvent = vi.fn();
      GoogleAdMob.showAppsInTossAdMob({ onEvent: showEvent, onError: vi.fn() });
      await vi.advanceTimersByTimeAsync(1500);

      const eventTypes = showEvent.mock.calls.map((c: unknown[]) => (c[0] as { type: string }).type);
      expect(eventTypes).toEqual(['requested', 'show', 'impression', 'userEarnedReward', 'dismissed']);
      expect(aitState.state.ads.isLoaded).toBe(false);
    });

    it('loadAppsInTossAdMob.isSupported: true를 반환한다', () => {
      expect(GoogleAdMob.loadAppsInTossAdMob.isSupported()).toBe(true);
    });
  });

  describe('TossAds', () => {
    it('initialize: 에러 없이 실행된다', () => {
      expect(() => TossAds.initialize({})).not.toThrow();
    });

    it('attach: DOM 요소에 placeholder를 추가한다', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);

      try {
        TossAds.attach('ad-group-1', container);
        expect(container.children).toHaveLength(1);
        expect(container.children[0].textContent).toContain('TossAds Placeholder');
      } finally {
        container.remove();
      }
    });
  });

  describe('loadFullScreenAd / showFullScreenAd', () => {
    it('loadFullScreenAd 후 showFullScreenAd가 동작한다', async () => {
      const loadEvent = vi.fn();
      const loadError = vi.fn();

      loadFullScreenAd({ onEvent: loadEvent, onError: loadError });
      await vi.advanceTimersByTimeAsync(200);

      expect(loadEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'loaded' }));

      const showEvent = vi.fn();
      const showError = vi.fn();

      showFullScreenAd({ onEvent: showEvent, onError: showError });
      await vi.advanceTimersByTimeAsync(100);

      expect(showEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'show' }));
    });

    it('showFullScreenAd: 로드되지 않았으면 에러를 반환한다', () => {
      const onEvent = vi.fn();
      const onError = vi.fn();

      showFullScreenAd({ onEvent, onError });
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });
  });
});
