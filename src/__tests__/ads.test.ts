import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import {
  _resetSlotRegistry,
  GoogleAdMob,
  loadFullScreenAd,
  showFullScreenAd,
  TossAds,
} from '../mock/ads/index.js';
import { aitState } from '../mock/state.js';

function extractEventTypes(spy: Mock) {
  return spy.mock.calls.map((c) => (c[0] as { type: string }).type);
}

describe('Ads mock', () => {
  beforeEach(() => {
    aitState.reset();
    _resetSlotRegistry();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('GoogleAdMob', () => {
    it('loadAppsInTossAdMob: loaded 이벤트를 발생시킨다', async () => {
      const onEvent = vi.fn();
      const onError = vi.fn();

      GoogleAdMob.loadAppsInTossAdMob({ options: { adGroupId: 'mock-group' }, onEvent, onError });
      await vi.advanceTimersByTimeAsync(200);

      expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'loaded' }));
      expect(aitState.state.ads.isLoaded).toBe(true);
    });

    it('showAppsInTossAdMob: 로드되지 않았으면 에러를 반환한다', () => {
      const onEvent = vi.fn();
      const onError = vi.fn();

      GoogleAdMob.showAppsInTossAdMob({ options: { adGroupId: 'mock-group' }, onEvent, onError });
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    // setTimeout 지연 값은 ads/index.ts의 showAppsInTossAdMob 구현과 일치해야 한다
    // source delays: userEarnedReward@1000, dismissed@1500
    it('showAppsInTossAdMob: 로드 후 이벤트 시퀀스가 발생한다', async () => {
      // load first
      const loadEvent = vi.fn();
      GoogleAdMob.loadAppsInTossAdMob({
        options: { adGroupId: 'mock-group' },
        onEvent: loadEvent,
        onError: vi.fn(),
      });
      await vi.advanceTimersByTimeAsync(200);
      expect(aitState.state.ads.isLoaded).toBe(true);

      // show — advance to 1500ms to flush all events at once
      const showEvent = vi.fn();
      GoogleAdMob.showAppsInTossAdMob({
        options: { adGroupId: 'mock-group' },
        onEvent: showEvent,
        onError: vi.fn(),
      });
      await vi.advanceTimersByTimeAsync(1500);

      const eventTypes = extractEventTypes(showEvent);
      expect(eventTypes).toEqual(['userEarnedReward', 'dismissed']);
      expect(aitState.state.ads.isLoaded).toBe(false);
    });

    it('loadAppsInTossAdMob.isSupported: true를 반환한다', () => {
      expect(GoogleAdMob.loadAppsInTossAdMob.isSupported()).toBe(true);
    });

    it('showAppsInTossAdMob: reward 이벤트가 state.ads.rewardUnitType/rewardAmount를 반영한다', async () => {
      aitState.patch('ads', { rewardUnitType: 'gems', rewardAmount: 50 });

      const loadEvent = vi.fn();
      GoogleAdMob.loadAppsInTossAdMob({
        options: { adGroupId: 'mock-group' },
        onEvent: loadEvent,
        onError: vi.fn(),
      });
      await vi.advanceTimersByTimeAsync(200);

      const showEvent = vi.fn();
      GoogleAdMob.showAppsInTossAdMob({
        options: { adGroupId: 'mock-group' },
        onEvent: showEvent,
        onError: vi.fn(),
      });
      await vi.advanceTimersByTimeAsync(1500);

      const rewardCall = showEvent.mock.calls.find(
        (c) => (c[0] as { type: string }).type === 'userEarnedReward',
      );
      expect(rewardCall).toBeDefined();
      expect(rewardCall?.[0]).toMatchObject({
        type: 'userEarnedReward',
        data: { unitType: 'gems', unitAmount: 50 },
      });
    });

    it('showAppsInTossAdMob: sdkCallLog에 기록된다', async () => {
      aitState.patch('ads', { isLoaded: true });
      const showEvent = vi.fn();
      GoogleAdMob.showAppsInTossAdMob({
        options: { adGroupId: 'mock-group' },
        onEvent: showEvent,
        onError: vi.fn(),
      });

      expect(
        aitState.state.sdkCallLog.some((e) => e.method === 'GoogleAdMob.showAppsInTossAdMob'),
      ).toBe(true);
    });
  });

  describe('TossAds', () => {
    it('initialize: 에러 없이 실행된다', () => {
      expect(() => TossAds.initialize({})).not.toThrow();
    });

    it('initialize: onInitialized 콜백을 발화한다', () => {
      const onInitialized = vi.fn();
      TossAds.initialize({ callbacks: { onInitialized } });
      expect(onInitialized).toHaveBeenCalledTimes(1);
    });

    it('initialize: forceNoFill=true이면 onInitializationFailed 콜백을 발화한다', () => {
      aitState.patch('ads', { forceNoFill: true });
      const onInitialized = vi.fn();
      const onInitializationFailed = vi.fn();
      TossAds.initialize({ callbacks: { onInitialized, onInitializationFailed } });
      expect(onInitialized).not.toHaveBeenCalled();
      expect(onInitializationFailed).toHaveBeenCalledWith(expect.any(Error));
    });

    it('initialize: sdkCallLog에 기록된다', () => {
      TossAds.initialize({});
      expect(aitState.state.sdkCallLog.some((e) => e.method === 'TossAds.initialize')).toBe(true);
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

    describe('attachBanner', () => {
      it('DOM에 placeholder를 삽입하고 { destroy } 핸들을 반환한다', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        try {
          const handle = TossAds.attachBanner('group-1', container);
          expect(container.children).toHaveLength(1);
          expect(handle).toHaveProperty('destroy');
          expect(typeof handle.destroy).toBe('function');
          await vi.advanceTimersByTimeAsync(200);
        } finally {
          container.remove();
        }
      });

      it('기본 동작: onAdRendered + onAdImpression을 발화한다', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        const onAdRendered = vi.fn();
        const onAdImpression = vi.fn();
        try {
          TossAds.attachBanner('group-1', container, {
            callbacks: { onAdRendered, onAdImpression },
          });
          await vi.advanceTimersByTimeAsync(200);
          expect(onAdRendered).toHaveBeenCalledTimes(1);
          expect(onAdImpression).toHaveBeenCalledTimes(1);
          expect(onAdRendered.mock.calls[0][0]).toMatchObject({
            slotId: expect.stringContaining('mock-slot-'),
            adGroupId: 'group-1',
          });
        } finally {
          container.remove();
        }
      });

      it('forceNoFill=true: onNoFill + onAdFailedToRender을 발화하고 onAdRendered는 미발화', async () => {
        aitState.patch('ads', { forceNoFill: true });
        const container = document.createElement('div');
        document.body.appendChild(container);
        const onAdRendered = vi.fn();
        const onNoFill = vi.fn();
        const onAdFailedToRender = vi.fn();
        try {
          TossAds.attachBanner('group-1', container, {
            callbacks: { onAdRendered, onNoFill, onAdFailedToRender },
          });
          await vi.advanceTimersByTimeAsync(200);
          expect(onAdRendered).not.toHaveBeenCalled();
          expect(onNoFill).toHaveBeenCalledTimes(1);
          expect(onAdFailedToRender).toHaveBeenCalledTimes(1);
          expect(onNoFill.mock.calls[0][0]).toMatchObject({
            slotId: expect.stringContaining('mock-slot-'),
            adGroupId: 'group-1',
          });
        } finally {
          container.remove();
        }
      });

      it('handle.destroy()가 placeholder를 실제 제거한다 (누수 수정)', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        try {
          const handle = TossAds.attachBanner('group-1', container);
          expect(container.children).toHaveLength(1);
          handle.destroy();
          expect(container.children).toHaveLength(0);
          await vi.advanceTimersByTimeAsync(200);
        } finally {
          container.remove();
        }
      });

      it('attachBanner: sdkCallLog에 기록된다', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        try {
          TossAds.attachBanner('group-1', container);
          expect(aitState.state.sdkCallLog.some((e) => e.method === 'TossAds.attachBanner')).toBe(
            true,
          );
          await vi.advanceTimersByTimeAsync(200);
        } finally {
          container.remove();
        }
      });
    });

    describe('destroy / destroyAll (slot 레지스트리)', () => {
      it('TossAds.destroy: slotId로 특정 placeholder를 제거한다', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        try {
          TossAds.attachBanner('g-1', container);
          const slotId = container
            .querySelector('[data-ait-slot-id]')
            ?.getAttribute('data-ait-slot-id');
          expect(slotId).toBeTruthy();
          expect(container.children).toHaveLength(1);

          TossAds.destroy(slotId ?? '');
          expect(container.children).toHaveLength(0);
          await vi.advanceTimersByTimeAsync(200);
        } finally {
          container.remove();
        }
      });

      it('TossAds.destroyAll: 모든 placeholder를 제거한다', async () => {
        const c1 = document.createElement('div');
        const c2 = document.createElement('div');
        document.body.appendChild(c1);
        document.body.appendChild(c2);
        try {
          TossAds.attachBanner('g-1', c1);
          TossAds.attachBanner('g-2', c2);
          expect(c1.children).toHaveLength(1);
          expect(c2.children).toHaveLength(1);

          TossAds.destroyAll();
          expect(c1.children).toHaveLength(0);
          expect(c2.children).toHaveLength(0);
          await vi.advanceTimersByTimeAsync(200);
        } finally {
          c1.remove();
          c2.remove();
        }
      });

      it('destroy: sdkCallLog에 기록된다', async () => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        try {
          TossAds.attachBanner('g-1', container);
          const slotId =
            container.querySelector('[data-ait-slot-id]')?.getAttribute('data-ait-slot-id') ?? '';
          TossAds.destroy(slotId);
          expect(aitState.state.sdkCallLog.some((e) => e.method === 'TossAds.destroy')).toBe(true);
          await vi.advanceTimersByTimeAsync(200);
        } finally {
          container.remove();
        }
      });
    });
  });

  describe('loadFullScreenAd / showFullScreenAd', () => {
    // source delays: clicked@100, dismissed@1500
    it('loadFullScreenAd 후 showFullScreenAd 전체 이벤트 시퀀스', async () => {
      const loadEvent = vi.fn();
      loadFullScreenAd({
        options: { adGroupId: 'mock-group' },
        onEvent: loadEvent,
        onError: vi.fn(),
      });
      await vi.advanceTimersByTimeAsync(200);
      expect(loadEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'loaded' }));

      const showEvent = vi.fn();
      showFullScreenAd({
        options: { adGroupId: 'mock-group' },
        onEvent: showEvent,
        onError: vi.fn(),
      });
      await vi.advanceTimersByTimeAsync(1500);

      const eventTypes = extractEventTypes(showEvent);
      expect(eventTypes).toEqual(['clicked', 'dismissed']);
    });

    it('showFullScreenAd: 로드되지 않았으면 에러를 반환한다', () => {
      const onEvent = vi.fn();
      const onError = vi.fn();

      showFullScreenAd({ options: { adGroupId: 'mock-group' }, onEvent, onError });
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('loadFullScreenAd: sdkCallLog에 기록된다', async () => {
      loadFullScreenAd({
        options: { adGroupId: 'mock-group' },
        onEvent: vi.fn(),
        onError: vi.fn(),
      });
      await vi.advanceTimersByTimeAsync(200);
      expect(aitState.state.sdkCallLog.some((e) => e.method === 'loadFullScreenAd')).toBe(true);
    });
  });
});
