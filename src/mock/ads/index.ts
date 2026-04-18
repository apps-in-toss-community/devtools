/**
 * 광고 mock (GoogleAdMob, TossAds, FullScreenAd)
 */

import { createMockProxy } from '../proxy.js';
import { aitState } from '../state.js';

function withIsSupported<T extends (...args: never[]) => unknown>(
  fn: T,
): T & { isSupported: () => boolean } {
  (fn as T & { isSupported: () => boolean }).isSupported = () => true;
  return fn as T & { isSupported: () => boolean };
}

// --- Google AdMob ---

export const GoogleAdMob = createMockProxy('GoogleAdMob', {
  loadAppsInTossAdMob: withIsSupported(
    (args: {
      onEvent: (data: { type: string; data?: unknown }) => void;
      onError: (error: Error) => void;
      options?: { adGroupId?: string };
    }): (() => void) => {
      setTimeout(() => {
        aitState.patch('ads', { isLoaded: true });
        args.onEvent({ type: 'loaded', data: { adGroupId: args.options?.adGroupId } });
      }, 200);
      return () => {};
    },
  ),

  showAppsInTossAdMob: withIsSupported(
    (args: {
      onEvent: (data: { type: string; data?: unknown }) => void;
      onError: (error: Error) => void;
      options?: { adGroupId?: string };
    }): (() => void) => {
      if (!aitState.state.ads.isLoaded) {
        args.onError(new Error('Ad not loaded'));
        return () => {};
      }
      setTimeout(() => args.onEvent({ type: 'requested' }), 50);
      setTimeout(() => args.onEvent({ type: 'show' }), 100);
      setTimeout(() => args.onEvent({ type: 'impression' }), 150);
      setTimeout(() => {
        args.onEvent({ type: 'userEarnedReward', data: { unitType: 'coins', unitAmount: 10 } });
      }, 1000);
      setTimeout(() => {
        args.onEvent({ type: 'dismissed' });
        aitState.patch('ads', { isLoaded: false });
      }, 1500);
      return () => {};
    },
  ),

  isAppsInTossAdMobLoaded: withIsSupported(
    async (_options: { adGroupId?: string }): Promise<boolean> => aitState.state.ads.isLoaded,
  ),
});

// --- TossAds ---

export const TossAds = createMockProxy('TossAds', {
  initialize: withIsSupported((_options: unknown) => {
    console.log('[@ait-co/devtools] TossAds.initialize (mock)');
  }),
  attach: withIsSupported(
    (_adGroupId: string, target: string | HTMLElement, _options?: unknown) => {
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
  attachBanner: withIsSupported(
    (_adGroupId: string, target: string | HTMLElement, _options?: unknown) => {
      const el = typeof target === 'string' ? document.querySelector(target) : target;
      if (el) {
        const placeholder = document.createElement('div');
        placeholder.style.cssText =
          'background:#f0f0f0;border:1px dashed #999;padding:12px;text-align:center;color:#666;font-size:12px;';
        placeholder.textContent = '[@ait-co/devtools] Banner Ad Placeholder';
        el.appendChild(placeholder);
      }
      return { destroy: () => {} };
    },
  ),
  destroy: withIsSupported((_slotId: string) => {}),
  destroyAll: withIsSupported(() => {}),
});

// --- FullScreen Ad ---

export const loadFullScreenAd = withIsSupported(
  (args: {
    onEvent: (data: { type: string; data?: unknown }) => void;
    onError: (error: Error) => void;
    options?: { adGroupId?: string };
  }): (() => void) => {
    setTimeout(() => {
      aitState.patch('ads', { isLoaded: true });
      args.onEvent({ type: 'loaded', data: { adGroupId: args.options?.adGroupId } });
    }, 200);
    return () => {};
  },
);

export const showFullScreenAd = withIsSupported(
  (args: {
    onEvent: (data: { type: string; data?: unknown }) => void;
    onError: (error: Error) => void;
    options?: { adGroupId?: string };
  }): (() => void) => {
    if (!aitState.state.ads.isLoaded) {
      args.onError(new Error('Ad not loaded'));
      return () => {};
    }
    setTimeout(() => args.onEvent({ type: 'show' }), 100);
    setTimeout(() => args.onEvent({ type: 'dismissed' }), 1500);
    return () => {};
  },
);
