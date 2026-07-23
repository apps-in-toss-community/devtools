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

    describe('실패-모드 다이얼 (devtools#770)', () => {
      it('failureModes.loadAdMob 미설정 시 기존처럼 happy-load된다', async () => {
        const onEvent = vi.fn();
        const onError = vi.fn();
        GoogleAdMob.loadAppsInTossAdMob({
          options: { adGroupId: 'mock-group' },
          onEvent,
          onError,
        });
        await vi.advanceTimersByTimeAsync(200);

        expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'loaded' }));
        expect(onError).not.toHaveBeenCalled();
      });

      it('failureModes.loadAdMob 설정 시 2.x native envelope으로 onError한다', async () => {
        aitState.patch('failureModes', { loadAdMob: 'PLACEMENT_ID_FETCH_FAILED' });
        const onEvent = vi.fn();
        const onError = vi.fn();
        GoogleAdMob.loadAppsInTossAdMob({
          options: { adGroupId: 'mock-group' },
          onEvent,
          onError,
        });
        await vi.advanceTimersByTimeAsync(200);

        expect(onEvent).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith(
          expect.objectContaining({
            code: 'PLACEMENT_ID_FETCH_FAILED',
            __isError: true,
          }),
        );
        expect(aitState.state.ads.isLoaded).toBe(false);
      });

      it('failureModes.sdkLine이 3.x면 맨 Error로 onError한다', async () => {
        aitState.patch('failureModes', {
          loadAdMob: 'PLACEMENT_ID_FETCH_FAILED',
          sdkLine: '3.x',
        });
        const onError = vi.fn();
        GoogleAdMob.loadAppsInTossAdMob({
          options: { adGroupId: 'mock-group' },
          onEvent: vi.fn(),
          onError,
        });
        await vi.advanceTimersByTimeAsync(200);

        expect(onError).toHaveBeenCalledTimes(1);
        const err = onError.mock.calls[0][0] as Error & { code?: string };
        expect(err).toBeInstanceOf(Error);
        expect(err.code).toBeUndefined();
      });
    });

    // devtools#780: 실기기(env3)는 형식이 잘못된 adGroupId를 reject한다
    // (code: INVALID_REQUEST). mock은 과거 어떤 값이든 조용히 boolean을
    // resolve했다 — env1↔env3 capture diff 실측에 맞춰 reject로 갱신.
    describe('isAppsInTossAdMobLoaded — 형식이 잘못된 adGroupId (devtools#780)', () => {
      it('adGroupId가 빈 문자열이면 INVALID_REQUEST로 reject된다', async () => {
        await expect(GoogleAdMob.isAppsInTossAdMobLoaded({ adGroupId: '' })).rejects.toThrow();

        try {
          await GoogleAdMob.isAppsInTossAdMobLoaded({ adGroupId: '' });
          expect.unreachable('reject되어야 한다');
        } catch (err) {
          // 캡처 하네스(aitCapture.extractErrorShape)는 errorName을
          // err.constructor.name, errorCode를 err.code ?? err.errorCode에서 뽑는다.
          // 실기기 실측이 errorName: "Error"이므로 서브클래스가 아닌 평범한
          // Error여야 한다.
          expect(err).toBeInstanceOf(Error);
          expect((err as Error).constructor.name).toBe('Error');
          expect((err as Error & { code?: string }).code).toBe('INVALID_REQUEST');
          // devtools#788: 손수 만든 `{errorCode}` 대신 buildNativeError의 실기기
          // 2.x native envelope을 얹으므로, key-set도 env3 캡처와 필드 단위로
          // 일치해야 한다 (Object.keys 발산이 sdk-example capture-diff가 잡아낸 회귀).
          expect(Object.keys(err as object).sort()).toEqual([
            '__isError',
            'code',
            'moduleName',
            'name',
            'userInfo',
          ]);
        }
      });

      it('adGroupId가 공백뿐이면 INVALID_REQUEST로 reject된다', async () => {
        await expect(
          GoogleAdMob.isAppsInTossAdMobLoaded({ adGroupId: '   ' }),
        ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      });

      it('유효한 adGroupId는 여전히 boolean으로 resolve된다', async () => {
        await expect(
          GoogleAdMob.isAppsInTossAdMobLoaded({ adGroupId: 'mock-group' }),
        ).resolves.toBe(false);
      });

      it('adGroupId 자체가 없는 호출은 하위호환으로 계속 통과한다', async () => {
        await expect(GoogleAdMob.isAppsInTossAdMobLoaded({})).resolves.toBe(false);
      });

      it('인자 없는 호출도 TypeError로 죽지 않고 하위호환으로 통과한다', async () => {
        // 이 검사가 들어오기 전에는 구현이 `_options`를 아예 안 건드려서
        // 인자 없는 호출이 그냥 resolve됐다. 옵션을 dereference하게 되면서
        // `Cannot read properties of undefined`로 죽을 수 있게 됐으므로,
        // 잘못된 입력을 거부하는 것과 별개로 기존 호출을 깨지 않는지 못박는다.
        const callWithNoArgs =
          GoogleAdMob.isAppsInTossAdMobLoaded as unknown as () => Promise<boolean>;
        await expect(callWithNoArgs()).resolves.toBe(false);
      });
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

    // devtools#806: 실기기(2.x×iOS)엔 loadFullScreenAd에 .isSupported가 런타임에
    // 붙어있지 않다 — 상류가 타입에만 선언하고 런타임엔 부착하지 않는 type↔runtime
    // 불일치(fetchContacts.getPermission 부재, devtools#795 (B)와 동일 family).
    // showFullScreenAd/GoogleAdMob.*의 isSupported 부재는 측정 밖 추론이라
    // 건드리지 않는다(#783).
    it('isSupported가 부착되어 있지 않다 (실기기 실측)', () => {
      expect((loadFullScreenAd as { isSupported?: unknown }).isSupported).toBeUndefined();
    });

    it('isSupported() 호출은 native TypeError를 던진다 (실기기 실측)', () => {
      expect(() =>
        (loadFullScreenAd as unknown as { isSupported: () => boolean }).isSupported(),
      ).toThrow(TypeError);
    });

    describe('실패-모드 다이얼 (devtools#770)', () => {
      it('failureModes.loadFullScreenAd 미설정 시 기존처럼 happy-load된다', async () => {
        const onEvent = vi.fn();
        const onError = vi.fn();
        loadFullScreenAd({ options: { adGroupId: 'mock-group' }, onEvent, onError });
        await vi.advanceTimersByTimeAsync(200);

        expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'loaded' }));
        expect(onError).not.toHaveBeenCalled();
      });

      it('failureModes.loadFullScreenAd 설정 시 2.x native envelope으로 onError한다', async () => {
        aitState.patch('failureModes', { loadFullScreenAd: 'EXECUTION_ERROR' });
        const onEvent = vi.fn();
        const onError = vi.fn();
        loadFullScreenAd({ options: { adGroupId: 'mock-group' }, onEvent, onError });
        await vi.advanceTimersByTimeAsync(200);

        expect(onEvent).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledWith(
          expect.objectContaining({ code: 'EXECUTION_ERROR', __isError: true }),
        );
        expect(aitState.state.ads.isLoaded).toBe(false);
      });

      it('failureModes.sdkLine이 3.x면 맨 Error로 onError한다', async () => {
        aitState.patch('failureModes', {
          loadFullScreenAd: 'EXECUTION_ERROR',
          sdkLine: '3.x',
        });
        const onError = vi.fn();
        loadFullScreenAd({ options: { adGroupId: 'mock-group' }, onEvent: vi.fn(), onError });
        await vi.advanceTimersByTimeAsync(200);

        expect(onError).toHaveBeenCalledTimes(1);
        const err = onError.mock.calls[0][0] as Error & { code?: string };
        expect(err).toBeInstanceOf(Error);
        expect(err.code).toBeUndefined();
      });
    });
  });
});
