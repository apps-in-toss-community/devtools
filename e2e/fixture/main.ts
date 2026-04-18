// E2E fixture consumer app for @ait-co/devtools.
//
// Imports @apps-in-toss/web-framework — at build time the devtools unplugin
// aliases that to @ait-co/devtools/mock via vite.config.ts resolve.alias.
// Panel is imported explicitly here (unplugin transform unreliable under
// rolldown/Vite 8 production build).
import '@ait-co/devtools/panel';

import {
  // auth
  appLogin,
  getIsTossLoginIntegratedService,
  getUserKeyForGame,
  appsInTossSignTossCert,
  // navigation
  closeView,
  openURL,
  share,
  getTossShareLink,
  setIosSwipeGestureEnabled,
  setDeviceOrientation,
  setScreenAwakeMode,
  setSecureScreen,
  requestReview,
  // environment
  getPlatformOS,
  getOperationalEnvironment,
  getTossAppVersion,
  isMinVersionSupported,
  getSchemeUri,
  getLocale,
  getDeviceId,
  getGroupId,
  getNetworkStatus,
  getServerTime,
  SafeAreaInsets,
  // events
  graniteEvent,
  tdsEvent,
  onVisibilityChangedByTransparentServiceWeb,
  // permissions
  getPermission,
  openPermissionDialog,
  requestPermission,
  // device
  Storage,
  Accuracy,
  getCurrentLocation,
  openCamera,
  fetchAlbumPhotos,
  fetchContacts,
  getClipboardText,
  setClipboardText,
  generateHapticFeedback,
  saveBase64Data,
  // iap
  IAP,
  checkoutPayment,
  // ads
  GoogleAdMob,
  TossAds,
  loadFullScreenAd,
  showFullScreenAd,
  // game
  grantPromotionReward,
  grantPromotionRewardForGame,
  submitGameCenterLeaderBoardScore,
  getGameCenterGameProfile,
  openGameCenterLeaderboard,
  contactsViral,
  // analytics
  Analytics,
  eventLog,
  // partner
  partner,
} from '@apps-in-toss/web-framework';
import { apiButton, apiInput, apiSection, apiSubscriber, apiValue } from './helpers.js';

function withTimeout<T>(p: Promise<T>, ms = 3000): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

const app = document.getElementById('app');
if (!app) throw new Error('#app not found');

// --- Auth ---
{
  const s = apiSection(app, 'auth', 'Auth');
  apiButton(s, 'auth-login', async () => await appLogin());
  apiButton(s, 'auth-toss-integrated', async () => await getIsTossLoginIntegratedService());
  apiButton(s, 'auth-userkey', async () => await getUserKeyForGame());
  apiButton(s, 'auth-cert', async () => {
    await appsInTossSignTossCert({ txId: 'mock-tx' });
    return undefined;
  });
}

// --- Navigation ---
{
  const s = apiSection(app, 'navigation', 'Navigation');
  apiButton(s, 'nav-sharelink', async () => await getTossShareLink('intoss://mock'));
  apiButton(s, 'nav-awake', async () => {
    const r = await setScreenAwakeMode({ enabled: true });
    return r;
  });
  apiButton(s, 'nav-secure', async () => {
    const r = await setSecureScreen({ enabled: true });
    return r;
  });
  apiButton(s, 'nav-review', async () => {
    await requestReview();
    return undefined;
  });
  apiButton(s, 'nav-openurl', async () => {
    await openURL('https://example.com');
    return undefined;
  });
  apiButton(s, 'nav-swipe', async () => {
    await setIosSwipeGestureEnabled({ isEnabled: true });
    return undefined;
  });
  apiButton(s, 'nav-orientation', async () => {
    await setDeviceOrientation({ type: 'portrait' });
    return undefined;
  });
  apiButton(s, 'nav-share', async () => {
    await share({ message: 'hello' });
    return undefined;
  });
  apiButton(s, 'nav-close', async () => {
    await closeView();
    return undefined;
  });
}

// --- Environment ---
{
  const s = apiSection(app, 'environment', 'Environment');

  // Read-only values populated on load
  const platform = apiValue(s, 'env-platform', 'platform');
  const operational = apiValue(s, 'env-operational', 'operational');
  const network = apiValue(s, 'env-network', 'network');
  const appVersion = apiValue(s, 'env-app-version', 'appVersion');
  const locale = apiValue(s, 'env-locale', 'locale');
  const deviceId = apiValue(s, 'env-device-id', 'deviceId');
  const groupId = apiValue(s, 'env-group-id', 'groupId');
  const minVersion = apiValue(s, 'env-min-version', 'minVersionOk');
  const schemeUri = apiValue(s, 'env-scheme-uri', 'schemeUri');
  const safeTop = apiValue(s, 'env-safe-area-top', 'safeArea.top');

  async function refreshEnv() {
    platform.textContent = getPlatformOS();
    operational.textContent = getOperationalEnvironment();
    network.textContent = await getNetworkStatus();
    appVersion.textContent = getTossAppVersion();
    locale.textContent = getLocale();
    deviceId.textContent = getDeviceId();
    groupId.textContent = getGroupId();
    minVersion.textContent = String(isMinVersionSupported({ android: '1.0.0', ios: '1.0.0' }));
    schemeUri.textContent = getSchemeUri();
    const insets = SafeAreaInsets.get();
    safeTop.textContent = String(insets.top);
  }
  refreshEnv().catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    platform.textContent = `error:${msg}`;
  });

  // A button that re-reads getPlatformOS so Layer C (env OS bridge) can
  // observe changes after panel-driven state updates.
  apiButton(s, 'env-platform-refresh', () => {
    const v = getPlatformOS();
    platform.textContent = v;
    return v;
  });

  apiButton(s, 'env-server-time', async () => await getServerTime());
}

// --- Permissions ---
{
  const s = apiSection(app, 'permissions', 'Permissions');
  apiButton(s, 'perm-get', async () => await getPermission({ name: 'camera', access: 'access' }));
  apiButton(s, 'perm-dialog', async () =>
    await openPermissionDialog({ name: 'camera', access: 'access' }),
  );
  apiButton(s, 'perm-request', async () =>
    await requestPermission({ name: 'camera', access: 'access' }),
  );
}

// --- Storage ---
{
  const s = apiSection(app, 'storage', 'Storage');
  apiInput(s, 'storage-key', 'key');
  apiInput(s, 'storage-value', 'value');
  apiButton(
    s,
    'storage-set',
    async ({ 'storage-key': k, 'storage-value': v }) => {
      await Storage.setItem(k, v);
      return undefined;
    },
    { withInputs: ['storage-key', 'storage-value'] },
  );
  apiButton(
    s,
    'storage-get',
    async ({ 'storage-key': k }) => {
      const v = await Storage.getItem(k);
      return v ?? '(null)';
    },
    { withInputs: ['storage-key'] },
  );
  apiButton(
    s,
    'storage-remove',
    async ({ 'storage-key': k }) => {
      await Storage.removeItem(k);
      return undefined;
    },
    { withInputs: ['storage-key'] },
  );
  apiButton(s, 'storage-clear', async () => {
    await Storage.clearItems();
    return undefined;
  });
}

// --- Location ---
{
  const s = apiSection(app, 'location', 'Location');
  apiButton(s, 'location-current', async () => {
    const loc = await getCurrentLocation({ accuracy: Accuracy.High });
    return loc;
  });
}

// --- Camera & Photos ---
{
  const s = apiSection(app, 'camera', 'Camera & Photos');
  apiButton(s, 'camera-open', async () => await openCamera());
  apiButton(s, 'photos-fetch', async () => {
    const photos = await fetchAlbumPhotos({ maxCount: 5 });
    return photos.length;
  });
}

// --- Contacts ---
{
  const s = apiSection(app, 'contacts', 'Contacts');
  apiButton(s, 'contacts-fetch', async () => {
    const list = await fetchContacts({ size: 10, offset: 0 });
    return list;
  });
}

// --- Clipboard ---
{
  const s = apiSection(app, 'clipboard', 'Clipboard');
  apiInput(s, 'clipboard', 'text');
  apiButton(
    s,
    'clipboard-set',
    async ({ clipboard: v }) => {
      await setClipboardText(v);
      return undefined;
    },
    { withInputs: ['clipboard'] },
  );
  apiButton(s, 'clipboard-get', async () => (await getClipboardText()) ?? '');
}

// --- Haptic ---
{
  const s = apiSection(app, 'haptic', 'Haptic');
  apiButton(s, 'haptic-tap', async () => {
    await generateHapticFeedback({ type: 'tap' });
    return undefined;
  });
  apiButton(s, 'save-base64', async () => {
    await saveBase64Data({ data: 'iVBOR', fileName: 'x.png', mimeType: 'image/png' });
    return undefined;
  });
}

// --- IAP ---
{
  const s = apiSection(app, 'iap', 'IAP');
  apiButton(s, 'iap-products', async () => {
    const list = await IAP.getProductItemList();
    return list;
  });
  apiButton(s, 'iap-purchase', async () => {
    const result = await withTimeout(
      new Promise<unknown>((resolve, reject) => {
        IAP.createOneTimePurchaseOrder({
          options: {
            sku: 'mock-gem-100',
            processProductGrant: () => true,
          },
          onEvent: (event) => resolve(event.data),
          onError: (error) => reject(error),
        });
      }),
    );
    return `success:${JSON.stringify(result)}`;
  });
  apiButton(s, 'iap-sub', async () => {
    const result = await withTimeout(
      new Promise<unknown>((resolve, reject) => {
        IAP.createSubscriptionPurchaseOrder({
          options: {
            sku: 'mock-sub',
            processProductGrant: () => true,
          },
          onEvent: (event) => resolve(event.data),
          onError: (error) => reject(error),
        });
      }),
    );
    return `success:${JSON.stringify(result)}`;
  });
  apiButton(s, 'iap-pending', async () => await IAP.getPendingOrders());
  apiButton(s, 'iap-completed', async () => await IAP.getCompletedOrRefundedOrders());
  apiButton(s, 'iap-subinfo', async () =>
    await IAP.getSubscriptionInfo({ params: { orderId: 'mock-sub' } }),
  );
  apiButton(s, 'iap-checkout', async () =>
    await checkoutPayment({ params: { payToken: 'mock-token' } }),
  );
}

// --- Ads ---
{
  const s = apiSection(app, 'ads', 'Ads');
  apiButton(s, 'ads-admob-load', async () => {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        GoogleAdMob.loadAppsInTossAdMob({
          options: { adGroupId: 'mock-ad' },
          onEvent: (event) => {
            if (event.type === 'loaded') resolve();
            else reject(new Error(`unexpected event: ${event.type}`));
          },
          onError: (error) => reject(error),
        });
      }),
    );
    return 'loaded';
  });
  apiButton(s, 'ads-admob-show', async () => {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        GoogleAdMob.showAppsInTossAdMob({
          options: { adGroupId: 'mock-ad' },
          onEvent: (event) => {
            if (event.type === 'dismissed') resolve();
            else reject(new Error(`unexpected event: ${event.type}`));
          },
          onError: (error) => reject(error),
        });
      }),
    );
    return 'dismissed';
  });
  apiButton(s, 'ads-admob-isloaded', async () =>
    String(await GoogleAdMob.isAppsInTossAdMobLoaded({ adGroupId: 'mock-ad' })),
  );
  apiButton(s, 'ads-fullscreen-load', async () => {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        loadFullScreenAd({
          options: { adGroupId: 'mock-full' },
          onEvent: (event) => {
            if (event.type === 'loaded') resolve();
            else reject(new Error(`unexpected event: ${event.type}`));
          },
          onError: (error) => reject(error),
        });
      }),
    );
    return 'loaded';
  });
  apiButton(s, 'ads-fullscreen-show', async () => {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        showFullScreenAd({
          options: { adGroupId: 'mock-full' },
          onEvent: (event) => {
            if (event.type === 'dismissed') resolve();
            else reject(new Error(`unexpected event: ${event.type}`));
          },
          onError: (error) => reject(error),
        });
      }),
    );
    return 'dismissed';
  });
  apiButton(s, 'ads-tossads-init', () => {
    TossAds.initialize({ callbacks: {} });
    return undefined;
  });
  apiButton(s, 'ads-tossads-destroy', () => {
    TossAds.destroyAll();
    return undefined;
  });
}

// --- Game ---
{
  const s = apiSection(app, 'game', 'Game');
  apiButton(s, 'game-promo', async () =>
    await grantPromotionReward({ params: { promotionCode: 'mock', amount: 100 } }),
  );
  apiButton(s, 'game-promo-game', async () =>
    await grantPromotionRewardForGame({ params: { promotionCode: 'mock', amount: 100 } }),
  );
  apiButton(s, 'game-score', async () => await submitGameCenterLeaderBoardScore({ score: '100' }));
  apiButton(s, 'game-profile', async () => await getGameCenterGameProfile());
  apiButton(s, 'game-leaderboard', async () => {
    await openGameCenterLeaderboard();
    return undefined;
  });
  apiButton(s, 'game-viral', async () => {
    const type = await withTimeout(
      new Promise<string>((resolve, reject) => {
        contactsViral({
          options: { moduleId: 'mock-module' },
          onEvent: (event) => {
            if (event.type === 'close') resolve('close');
            else reject(new Error(`unexpected event: ${event.type}`));
          },
          onError: (error) => reject(error),
        });
      }),
    );
    return type;
  });
}

// --- Analytics ---
{
  const s = apiSection(app, 'analytics', 'Analytics');
  apiButton(s, 'analytics-click', () => {
    Analytics.click({ log_name: 'e2e-click' });
    return undefined;
  });
  apiButton(s, 'analytics-screen', () => {
    Analytics.screen({ log_name: 'e2e-screen' });
    return undefined;
  });
  apiButton(s, 'analytics-impression', () => {
    Analytics.impression({ log_name: 'e2e-imp' });
    return undefined;
  });
  apiButton(s, 'analytics-eventlog', async () => {
    await eventLog({ log_name: 'e2e-log', log_type: 'event', params: {} });
    return undefined;
  });
}

// --- Partner ---
{
  const s = apiSection(app, 'partner', 'Partner');
  apiButton(s, 'partner-add', async () => {
    await partner.addAccessoryButton({
      id: 'mock',
      title: 'mock',
      icon: { name: 'icon-heart-mono' },
    });
    return undefined;
  });
  apiButton(s, 'partner-remove', async () => {
    await partner.removeAccessoryButton();
    return undefined;
  });
}

// --- Events ---
{
  const s = apiSection(app, 'events', 'Events');
  apiSubscriber(s, 'events-back', (onEvent) => {
    graniteEvent.addEventListener('backEvent', { onEvent: () => onEvent(undefined) });
  });
  apiSubscriber(s, 'events-home', (onEvent) => {
    graniteEvent.addEventListener('homeEvent', { onEvent: () => onEvent(undefined) });
  });
  apiSubscriber(s, 'events-tds', (onEvent) => {
    tdsEvent.addEventListener('navigationAccessoryEvent', { onEvent: (e) => onEvent(e) });
  });
  apiSubscriber(s, 'events-visibility', (onEvent) => {
    onVisibilityChangedByTransparentServiceWeb({
      options: { callbackId: 'fixture-vis' },
      onEvent: (v) => onEvent({ isVisible: v }),
      onError: (e) => onEvent({ error: String(e) }),
    });
  });
}
