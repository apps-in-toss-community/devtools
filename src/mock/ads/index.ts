/**
 * 광고 mock (GoogleAdMob, TossAds, FullScreenAd)
 *
 * 변경 이력 (#196):
 * - slot 레지스트리로 TossAds destroy/destroyAll 누수 수정 (🟡→🟢)
 * - attachBanner BannerSlotCallbacks 발화 (onAdRendered/onAdImpression/onNoFill 등)
 * - initialize onInitialized/onInitializationFailed 발화
 * - AdMob reward 파라미터화 (state.ads.rewardUnitType/rewardAmount)
 * - 모든 호출 observe()로 sdkCallLog에 기록
 */

import type {
  LoadAdMobEvent,
  LoadAdMobOptions,
  LoadFullScreenAdEvent,
  LoadFullScreenAdOptions,
  ShowAdMobEvent,
  ShowAdMobOptions,
  ShowFullScreenAdEvent,
  ShowFullScreenAdOptions,
} from '@apps-in-toss/web-framework';
import { buildNativeError } from '../native-error.js';
import { observe } from '../observe.js';
import { createMockProxy } from '../proxy.js';
import { aitState } from '../state.js';

function withIsSupported<T extends (...args: never[]) => unknown>(
  fn: T,
): T & { isSupported: () => boolean } {
  (fn as T & { isSupported: () => boolean }).isSupported = () => true;
  return fn as T & { isSupported: () => boolean };
}

// --- slot 레지스트리 (TossAds destroy 누수 수정) ---
// attachBanner가 생성한 placeholder를 slotId로 추적해서
// destroy/destroyAll이 실제 el.remove()를 수행할 수 있게 한다.
const _slotRegistry = new Map<string, HTMLElement>();

let _slotCounter = 0;
function _nextSlotId(adGroupId: string): string {
  _slotCounter += 1;
  return `mock-slot-${adGroupId}-${_slotCounter}`;
}

/** 테스트에서 레지스트리를 초기화할 수 있게 export */
export function _resetSlotRegistry(): void {
  _slotRegistry.clear();
  _slotCounter = 0;
}

// --- Google AdMob ---

export const GoogleAdMob = createMockProxy('GoogleAdMob', {
  loadAppsInTossAdMob: withIsSupported(
    observe(
      'GoogleAdMob.loadAppsInTossAdMob',
      'faithful',
      (args: {
        options: LoadAdMobOptions;
        onEvent: (event: LoadAdMobEvent) => void;
        onError: (error: unknown) => void;
      }): (() => void) => {
        setTimeout(() => {
          // 실패-모드 다이얼 (devtools#770): aitState.patch('failureModes',
          // { loadAdMob: 'PLACEMENT_ID_FETCH_FAILED' })로 실기기 프로비저닝 실패를
          // 재현한다. 미설정 시 forceNoFill/happy-load 기존 동작 그대로.
          const failureCode = aitState.state.failureModes.loadAdMob;
          if (failureCode) {
            args.onError(buildNativeError(failureCode));
            return;
          }
          if (aitState.state.ads.forceNoFill) {
            args.onError(new Error('No fill'));
            return;
          }
          aitState.patch('ads', { isLoaded: true });
          args.onEvent({
            type: 'loaded',
            data: { responseInfo: { responseId: `mock-response-${args.options.adGroupId}` } },
          });
        }, 200);
        return () => {};
      },
    ),
  ),

  showAppsInTossAdMob: withIsSupported(
    observe(
      'GoogleAdMob.showAppsInTossAdMob',
      'faithful',
      (args: {
        options: ShowAdMobOptions;
        onEvent: (event: ShowAdMobEvent) => void;
        onError: (error: unknown) => void;
      }): (() => void) => {
        if (!aitState.state.ads.isLoaded) {
          args.onError(new Error('Ad not loaded'));
          return () => {};
        }
        const { rewardUnitType, rewardAmount } = aitState.state.ads;
        setTimeout(
          () =>
            args.onEvent({
              type: 'userEarnedReward',
              data: { unitType: rewardUnitType, unitAmount: rewardAmount },
            }),
          1000,
        );
        setTimeout(() => {
          args.onEvent({ type: 'dismissed' });
          aitState.patch('ads', { isLoaded: false });
        }, 1500);
        return () => {};
      },
    ),
  ),

  isAppsInTossAdMobLoaded: withIsSupported(
    observe(
      'GoogleAdMob.isAppsInTossAdMobLoaded',
      'faithful',
      async (_options: { adGroupId?: string }): Promise<boolean> => aitState.state.ads.isLoaded,
    ),
  ),
});

// --- TossAds ---

export const TossAds = createMockProxy('TossAds', {
  initialize: withIsSupported(
    observe(
      'TossAds.initialize',
      'partial',
      (options: {
        callbacks?: { onInitialized?: () => void; onInitializationFailed?: (error: Error) => void };
      }): void => {
        // forceNoFill을 initialization failure로도 활용한다
        if (aitState.state.ads.forceNoFill) {
          options.callbacks?.onInitializationFailed?.(new Error('No fill'));
          return;
        }
        options.callbacks?.onInitialized?.();
      },
    ),
  ),

  attach: withIsSupported(
    observe(
      'TossAds.attach',
      'partial',
      (_adGroupId: string, target: string | HTMLElement, _options?: unknown): void => {
        const el = typeof target === 'string' ? document.querySelector(target) : target;
        if (el) {
          const placeholder = document.createElement('div');
          placeholder.style.cssText =
            'background:#f0f0f0;border:1px dashed #999;padding:16px;text-align:center;color:#666;font-size:14px;';
          placeholder.textContent = '[@ait-co/devtools] TossAds Placeholder';
          el.appendChild(placeholder);
        }
      },
    ),
  ),

  attachBanner: withIsSupported(
    observe(
      'TossAds.attachBanner',
      'faithful',
      (
        adGroupId: string,
        target: string | HTMLElement,
        options?: {
          theme?: 'auto' | 'light' | 'dark';
          tone?: 'blackAndWhite' | 'grey';
          variant?: 'card' | 'expanded';
          callbacks?: {
            onAdRendered?: (payload: {
              slotId: string;
              adGroupId: string;
              adMetadata: { creativeId: string; requestId: string };
            }) => void;
            onAdViewable?: (payload: {
              slotId: string;
              adGroupId: string;
              adMetadata: { creativeId: string; requestId: string };
            }) => void;
            onAdClicked?: (payload: {
              slotId: string;
              adGroupId: string;
              adMetadata: { creativeId: string; requestId: string };
            }) => void;
            onAdImpression?: (payload: {
              slotId: string;
              adGroupId: string;
              adMetadata: { creativeId: string; requestId: string };
            }) => void;
            onAdFailedToRender?: (payload: {
              slotId: string;
              adGroupId: string;
              adMetadata: Record<string, never>;
              error: { code: number; message: string; domain?: string };
            }) => void;
            onNoFill?: (payload: {
              slotId: string;
              adGroupId: string;
              adMetadata: Record<string, never>;
            }) => void;
          };
        },
      ): { destroy: () => void } => {
        const el = typeof target === 'string' ? document.querySelector(target) : target;
        const slotId = _nextSlotId(adGroupId);

        const placeholder = document.createElement('div');

        // AttachBannerOptions를 placeholder 스타일에 반영
        const theme = options?.theme ?? 'auto';
        const variant = options?.variant ?? 'card';
        const isDark =
          theme === 'dark' ||
          (theme === 'auto' &&
            typeof window !== 'undefined' &&
            window.matchMedia?.('(prefers-color-scheme: dark)').matches);
        const bg = isDark ? '#1a1a1a' : '#f0f0f0';
        const textColor = isDark ? '#aaa' : '#666';
        const borderColor = isDark ? '#555' : '#999';
        const height = variant === 'expanded' ? '120px' : '60px';

        placeholder.dataset.aitSlotId = slotId;
        placeholder.style.cssText = `background:${bg};border:1px dashed ${borderColor};padding:8px 12px;text-align:center;color:${textColor};font-size:12px;min-height:${height};display:flex;align-items:center;justify-content:center;`;
        placeholder.textContent = `[@ait-co/devtools] Banner Ad (${variant})`;

        if (el) {
          el.appendChild(placeholder);
          _slotRegistry.set(slotId, placeholder);
        }

        const destroySlot = () => {
          const registered = _slotRegistry.get(slotId);
          if (registered) {
            registered.remove();
            _slotRegistry.delete(slotId);
          }
        };

        // 콜백 발화 (setTimeout으로 비동기 — 실 SDK와 동일하게 렌더 완료 후)
        setTimeout(() => {
          if (aitState.state.ads.forceNoFill) {
            options?.callbacks?.onNoFill?.({
              slotId,
              adGroupId,
              adMetadata: {},
            });
            options?.callbacks?.onAdFailedToRender?.({
              slotId,
              adGroupId,
              adMetadata: {},
              error: { code: 0, message: 'No fill' },
            });
            return;
          }

          const eventPayload = {
            slotId,
            adGroupId,
            adMetadata: { creativeId: `mock-creative-${slotId}`, requestId: `mock-req-${slotId}` },
          };
          options?.callbacks?.onAdRendered?.(eventPayload);
          options?.callbacks?.onAdImpression?.(eventPayload);
        }, 100);

        return { destroy: destroySlot };
      },
    ),
  ),

  destroy: withIsSupported(
    observe('TossAds.destroy', 'faithful', (slotId: string): void => {
      const el = _slotRegistry.get(slotId);
      if (el) {
        el.remove();
        _slotRegistry.delete(slotId);
      }
    }),
  ),

  destroyAll: withIsSupported(
    observe('TossAds.destroyAll', 'faithful', (): void => {
      for (const el of _slotRegistry.values()) {
        el.remove();
      }
      _slotRegistry.clear();
    }),
  ),
});

// --- FullScreen Ad ---

export const loadFullScreenAd = withIsSupported(
  observe(
    'loadFullScreenAd',
    'faithful',
    (args: {
      options: LoadFullScreenAdOptions;
      onEvent: (event: LoadFullScreenAdEvent) => void;
      onError: (error: unknown) => void;
    }): (() => void) => {
      setTimeout(() => {
        // 실패-모드 다이얼 (devtools#770): aitState.patch('failureModes',
        // { loadFullScreenAd: 'EXECUTION_ERROR' })로 실기기 프로비저닝 실패를 재현한다.
        // 미설정 시 forceNoFill/happy-load 기존 동작 그대로.
        const failureCode = aitState.state.failureModes.loadFullScreenAd;
        if (failureCode) {
          args.onError(buildNativeError(failureCode));
          return;
        }
        if (aitState.state.ads.forceNoFill) {
          args.onError(new Error('No fill'));
          return;
        }
        aitState.patch('ads', { isLoaded: true });
        args.onEvent({ type: 'loaded' });
      }, 200);
      return () => {};
    },
  ),
);

export const showFullScreenAd = withIsSupported(
  observe(
    'showFullScreenAd',
    'faithful',
    (args: {
      options: ShowFullScreenAdOptions;
      onEvent: (event: ShowFullScreenAdEvent) => void;
      onError: (error: unknown) => void;
    }): (() => void) => {
      if (!aitState.state.ads.isLoaded) {
        args.onError(new Error('Ad not loaded'));
        return () => {};
      }
      setTimeout(() => args.onEvent({ type: 'clicked' }), 100);
      setTimeout(() => args.onEvent({ type: 'dismissed' }), 1500);
      return () => {};
    },
  ),
);
