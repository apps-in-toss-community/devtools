/**
 * Fidelity QA smoke test
 *
 * Verifies mock SDK surface coverage: 30+ read-only probes run without error
 * in the jsdom environment (vitest.config.ts: environment: 'jsdom').
 *
 * These are the same probe assertions as scripts/fidelity-qa/, but run inline
 * via vitest so they benefit from jsdom setup without crossing the rootDir boundary.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { GoogleAdMob, loadFullScreenAd, TossAds } from '../mock/ads/index.js';
import { Analytics, eventLog } from '../mock/analytics/index.js';
import { getIsTossLoginIntegratedService } from '../mock/auth/index.js';
import { getClipboardText } from '../mock/device/clipboard.js';
import { Accuracy, getCurrentLocation } from '../mock/device/location.js';
import { getNetworkStatusByMode } from '../mock/device/network.js';
import { Storage } from '../mock/device/storage.js';
import { getGameCenterGameProfile } from '../mock/game/index.js';
import { IAP } from '../mock/iap/index.js';
import {
  env,
  getAppsInTossGlobals,
  getDeviceId,
  getGroupId,
  getLocale,
  getNetworkStatus,
  getOperationalEnvironment,
  getPlatformOS,
  getSafeAreaInsets,
  getSchemeUri,
  getServerTime,
  getTossAppVersion,
  getTossShareLink,
  requestReview,
  SafeAreaInsets,
} from '../mock/navigation/index.js';
import { partner } from '../mock/partner/index.js';
import { getPermission } from '../mock/permissions.js';
import { aitState } from '../mock/state.js';

// Each probe returns { id, value } — used to count and verify
async function runProbe(
  id: string,
  fn: () => Promise<unknown>,
): Promise<{ id: string; value: unknown; error?: string }> {
  try {
    return { id, value: await fn() };
  } catch (err) {
    return { id, value: null, error: err instanceof Error ? err.message : String(err) };
  }
}

describe('fidelity-qa — mock runner smoke test', () => {
  beforeEach(() => {
    aitState.reset();
  });

  it('at least 30 read-only probes run without error', async () => {
    const probes = [
      // environment (13)
      runProbe('env.getOperationalEnvironment', async () => getOperationalEnvironment()),
      runProbe('env.getPlatformOS', async () => getPlatformOS()),
      runProbe('env.getTossAppVersion', async () => getTossAppVersion()),
      runProbe('env.getLocale', async () => getLocale()),
      runProbe('env.getSchemeUri', async () => getSchemeUri()),
      runProbe('env.getDeviceId', async () => getDeviceId()),
      runProbe('env.getGroupId', async () => getGroupId()),
      runProbe('env.getServerTime', async () => {
        const t = await getServerTime();
        return typeof t === 'number' ? '<timestamp>' : t;
      }),
      runProbe('env.getAppsInTossGlobals', async () => getAppsInTossGlobals()),
      runProbe('env.envGetDeploymentId', async () => env.getDeploymentId()),
      runProbe('env.isMinVersionSupported', async () => {
        const { isMinVersionSupported } = await import('../mock/navigation/index.js');
        return isMinVersionSupported({ android: '5.0.0', ios: '5.0.0' });
      }),
      runProbe('env.getNetworkStatus', async () => getNetworkStatus()),
      runProbe('env.getIsTossLoginIntegratedService', async () =>
        getIsTossLoginIntegratedService(),
      ),

      // device (3)
      runProbe('device.getNetworkStatusByMode', async () => getNetworkStatusByMode()),
      runProbe('device.getCurrentLocation', async () => {
        const loc = await getCurrentLocation({ accuracy: Accuracy.High });
        return { latitude: loc.coords.latitude, hasTimestamp: typeof loc.timestamp === 'number' };
      }),
      runProbe('device.getClipboardText', async () => getClipboardText()),

      // safe-area (2)
      runProbe('safe-area.SafeAreaInsetsGet', async () => SafeAreaInsets.get()),
      runProbe('safe-area.getSafeAreaInsets', async () => getSafeAreaInsets()),

      // navigation (2)
      // devtools#780: getTossShareLink는 이제 scheme 없는 bare path를 reject한다 —
      // 이 스모크 테스트는 "에러 없이 실행되는지"만 보는 surface probe이므로 유효
      // 입력(scheme 포함)으로 갱신한다.
      runProbe('nav.getTossShareLink', async () => getTossShareLink('intoss://test-path')),
      runProbe('nav.requestReviewIsSupported', async () => requestReview.isSupported()),

      // storage (1 read-only)
      runProbe('storage.getItemUnknownKey', async () =>
        Storage.getItem('__fidelity_qa_probe_unknown_key'),
      ),

      // permissions (6)
      runProbe('permissions.clipboard', async () =>
        getPermission({ name: 'clipboard', access: 'access' }),
      ),
      runProbe('permissions.contacts', async () =>
        getPermission({ name: 'contacts', access: 'access' }),
      ),
      runProbe('permissions.photos', async () =>
        getPermission({ name: 'photos', access: 'access' }),
      ),
      runProbe('permissions.geolocation', async () =>
        getPermission({ name: 'geolocation', access: 'access' }),
      ),
      runProbe('permissions.camera', async () =>
        getPermission({ name: 'camera', access: 'access' }),
      ),
      runProbe('permissions.microphone', async () =>
        getPermission({ name: 'microphone', access: 'access' }),
      ),

      // analytics (4)
      runProbe('analytics.screenExists', async () => typeof Analytics.screen === 'function'),
      runProbe(
        'analytics.impressionExists',
        async () => typeof Analytics.impression === 'function',
      ),
      runProbe('analytics.clickExists', async () => typeof Analytics.click === 'function'),
      runProbe('analytics.eventLogExists', async () => typeof eventLog === 'function'),

      // iap (4)
      runProbe(
        'iap.getProductItemListExists',
        async () => typeof IAP.getProductItemList === 'function',
      ),
      runProbe('iap.getPendingOrdersEmpty', async () =>
        Array.isArray(await IAP.getPendingOrders()),
      ),
      runProbe('iap.getCompletedOrRefundedOrdersEmpty', async () =>
        Array.isArray(await IAP.getCompletedOrRefundedOrders()),
      ),
      runProbe(
        'iap.getSubscriptionInfoExists',
        async () => typeof IAP.getSubscriptionInfo === 'function',
      ),

      // game (1)
      runProbe('game.getGameCenterGameProfileNull', async () => getGameCenterGameProfile()),

      // partner (2)
      runProbe(
        'partner.addAccessoryButtonExists',
        async () => typeof partner.addAccessoryButton === 'function',
      ),
      runProbe(
        'partner.removeAccessoryButtonExists',
        async () => typeof partner.removeAccessoryButton === 'function',
      ),

      // ads (4)
      runProbe(
        'ads.GoogleAdMobIsLoadedExists',
        async () => typeof GoogleAdMob.isAppsInTossAdMobLoaded === 'function',
      ),
      runProbe('ads.GoogleAdMobIsLoaded', async () => GoogleAdMob.isAppsInTossAdMobLoaded({})),
      runProbe('ads.TossAdsInitExists', async () => typeof TossAds.initialize === 'function'),
      runProbe('ads.loadFullScreenAdExists', async () => typeof loadFullScreenAd === 'function'),
    ];

    const results = await Promise.all(probes);
    const errors = results.filter((r) => r.error !== undefined);

    if (errors.length > 0) {
      const messages = errors.map((e) => `${e.id}: ${e.error}`).join('\n');
      throw new Error(`${errors.length} probes threw errors:\n${messages}`);
    }

    expect(results.length).toBeGreaterThanOrEqual(30);
  }, 15000);

  it('environment probes return expected default values', async () => {
    // devtools#795: 실기기 실측이 Promise라 mock도 Promise를 반환한다(#775 원칙 확장).
    expect(await getOperationalEnvironment()).toBe('sandbox');
    expect(await getPlatformOS()).toBe('ios');
    expect(await getLocale()).toBe('ko-KR');
  });

  it('permissions probes return valid PermissionStatus', async () => {
    const names = [
      'clipboard',
      'contacts',
      'photos',
      'geolocation',
      'camera',
      'microphone',
    ] as const;
    for (const name of names) {
      const result = await getPermission({ name, access: 'access' });
      expect(['notDetermined', 'denied', 'allowed']).toContain(result);
    }
  });

  it('SafeAreaInsets.get returns {top, bottom, left, right} shape', () => {
    const insets = SafeAreaInsets.get();
    expect(insets).toMatchObject({
      top: expect.any(Number),
      bottom: expect.any(Number),
      left: expect.any(Number),
      right: expect.any(Number),
    });
  });

  it('storage.getItem returns null for unknown key', async () => {
    const result = await Storage.getItem('__fidelity_qa_probe_unknown_key');
    expect(result).toBeNull();
  });

  it('unique probe ids — no duplicate ids in fidelity-qa system', () => {
    // All probe IDs used in this test (as an inventory check)
    const ids = [
      'env.getOperationalEnvironment',
      'env.getPlatformOS',
      'env.getTossAppVersion',
      'env.getLocale',
      'env.getSchemeUri',
      'env.getDeviceId',
      'env.getGroupId',
      'env.getServerTime',
      'env.getAppsInTossGlobals',
      'env.envGetDeploymentId',
      'env.isMinVersionSupported',
      'env.getNetworkStatus',
      'env.getIsTossLoginIntegratedService',
      'device.getNetworkStatusByMode',
      'device.getCurrentLocation',
      'device.getClipboardText',
      'safe-area.SafeAreaInsetsGet',
      'safe-area.getSafeAreaInsets',
      'nav.getTossShareLink',
      'nav.requestReviewIsSupported',
      'storage.getItemUnknownKey',
      'permissions.clipboard',
      'permissions.contacts',
      'permissions.photos',
      'permissions.geolocation',
      'permissions.camera',
      'permissions.microphone',
      'analytics.screenExists',
      'analytics.impressionExists',
      'analytics.clickExists',
      'analytics.eventLogExists',
      'iap.getProductItemListExists',
      'iap.getPendingOrdersEmpty',
      'iap.getCompletedOrRefundedOrdersEmpty',
      'iap.getSubscriptionInfoExists',
      'game.getGameCenterGameProfileNull',
      'partner.addAccessoryButtonExists',
      'partner.removeAccessoryButtonExists',
      'ads.GoogleAdMobIsLoadedExists',
      'ads.GoogleAdMobIsLoaded',
      'ads.TossAdsInitExists',
      'ads.loadFullScreenAdExists',
    ];
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(30);
  });
});
