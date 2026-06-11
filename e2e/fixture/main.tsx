// E2E fixture consumer app for @ait-co/devtools — React 19 rendering.
//
// NOTE: @ait-co/devtools/panel MUST remain the very first import in this file.
// Panel mounts and initialises aitState before any mock API call runs at module
// evaluation time. Do NOT let a linter's organizeImports reorder it below the
// SDK block.
import '@ait-co/devtools/panel';
// Polyfill auto-install: replaces standard Web APIs (navigator.clipboard, etc.)
// with SDK-routing shims. When devtools mock is active, @apps-in-toss/web-framework
// resolves to the mock, so isTossEnvironment() detects "toss present" and routes
// navigator.clipboard.writeText → mock setClipboardText. This is the
// mock-via-polyfill composition path verified by shim-composition.test.ts.
import '@ait-co/polyfill/auto';

// ENV-2 CDP gate (issue #378 — gap #1):
// When the page is loaded with ?debug=1&relay=<wss> (the launcher deep-link
// forwarded from env-2 QR), dynamically import the in-app attach module so
// the Chii target.js injection runs without statically bundling the in-app
// code into every fixture build.
//
// NOTE: the in-app gate (Layer B1 in src/in-app/gate.ts) BLOCKS localhost — it
// only allows *.trycloudflare.com and *.private-apps.tossmini.com hostnames.
// In a real env-2 session the fixture is served from a trycloudflare.com tunnel
// and the gate passes. In local development / Playwright e2e, localhost is
// blocked — see e2e/launcher-cdp.test.ts for the documented manual residue.
if (typeof window !== 'undefined') {
  const _p = new URLSearchParams(window.location.search);
  if (_p.get('debug') === '1' && _p.get('relay')) {
    import('@ait-co/devtools/in-app').then(({ maybeAttach }) => {
      maybeAttach();
    });
  }
}

import {
  Accuracy,
  // analytics
  Analytics,
  // auth
  appLogin,
  appsInTossSignTossCert,
  checkoutPayment,
  // navigation
  closeView,
  contactsViral,
  eventLog,
  fetchAlbumPhotos,
  fetchContacts,
  // ads
  GoogleAdMob,
  generateHapticFeedback,
  getClipboardText,
  getCurrentLocation,
  getDeviceId,
  getGameCenterGameProfile,
  getGroupId,
  getIsTossLoginIntegratedService,
  getLocale,
  getNetworkStatus,
  getOperationalEnvironment,
  // permissions
  getPermission,
  // environment
  getPlatformOS,
  getSchemeUri,
  getServerTime,
  getTossAppVersion,
  getTossShareLink,
  getUserKeyForGame,
  // events
  graniteEvent,
  // game
  grantPromotionReward,
  grantPromotionRewardForGame,
  // iap
  IAP,
  isMinVersionSupported,
  loadFullScreenAd,
  openCamera,
  openGameCenterLeaderboard,
  openPermissionDialog,
  openURL,
  // partner
  partner,
  // notification
  requestNotificationAgreement,
  requestPermission,
  requestReview,
  SafeAreaInsets,
  // device
  Storage,
  saveBase64Data,
  setClipboardText,
  setDeviceOrientation,
  setIosSwipeGestureEnabled,
  setScreenAwakeMode,
  setSecureScreen,
  share,
  showFullScreenAd,
  submitGameCenterLeaderBoardScore,
  TossAds,
  tdsEvent,
} from '@apps-in-toss/web-framework';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiButton, ApiInput, ApiSection, ApiSubscriber, ApiValue } from './components.js';

function withTimeout<T>(p: Promise<T>, ms = 3000): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

// ---------------------------------------------------------------------------
// Environment section — needs reactive state for values populated on load
// ---------------------------------------------------------------------------

interface EnvValues {
  platform: string;
  operational: string;
  network: string;
  appVersion: string;
  locale: string;
  deviceId: string;
  groupId: string;
  minVersion: string;
  schemeUri: string;
  safeTop: string;
}

function EnvironmentSection(): React.JSX.Element {
  const [env, setEnv] = useState<EnvValues>({
    platform: '',
    operational: '',
    network: '',
    appVersion: '',
    locale: '',
    deviceId: '',
    groupId: '',
    minVersion: '',
    schemeUri: '',
    safeTop: '',
  });

  useEffect(() => {
    async function refreshEnv() {
      const network = await getNetworkStatus();
      const insets = SafeAreaInsets.get();
      setEnv({
        platform: getPlatformOS(),
        operational: getOperationalEnvironment(),
        network,
        appVersion: getTossAppVersion(),
        locale: getLocale(),
        deviceId: getDeviceId(),
        groupId: getGroupId(),
        minVersion: String(isMinVersionSupported({ android: '1.0.0', ios: '1.0.0' })),
        schemeUri: getSchemeUri(),
        safeTop: String(insets.top),
      });
    }
    refreshEnv().catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      setEnv((prev) => ({ ...prev, platform: `error:${msg}` }));
    });
  }, []);

  return (
    <ApiSection id="environment" title="Environment">
      <ApiValue id="env-platform" label="platform" value={env.platform} />
      <ApiValue id="env-operational" label="operational" value={env.operational} />
      <ApiValue id="env-network" label="network" value={env.network} />
      <ApiValue id="env-app-version" label="appVersion" value={env.appVersion} />
      <ApiValue id="env-locale" label="locale" value={env.locale} />
      <ApiValue id="env-device-id" label="deviceId" value={env.deviceId} />
      <ApiValue id="env-group-id" label="groupId" value={env.groupId} />
      <ApiValue id="env-min-version" label="minVersionOk" value={env.minVersion} />
      <ApiValue id="env-scheme-uri" label="schemeUri" value={env.schemeUri} />
      <ApiValue id="env-safe-area-top" label="safeArea.top" value={env.safeTop} />
      {/* A button that re-reads getPlatformOS so Layer C (env OS bridge) can
          observe changes after panel-driven state updates. */}
      <ApiButton
        id="env-platform-refresh"
        run={() => {
          const v = getPlatformOS();
          setEnv((prev) => ({ ...prev, platform: v }));
          return v;
        }}
      />
      <ApiButton id="env-server-time" run={async () => await getServerTime()} />
    </ApiSection>
  );
}

// ---------------------------------------------------------------------------
// Root fixture app component
// ---------------------------------------------------------------------------

function FixtureApp(): React.JSX.Element {
  return (
    <>
      {/* --- Auth --- */}
      <ApiSection id="auth" title="Auth">
        <ApiButton id="auth-login" run={async () => await appLogin()} />
        <ApiButton
          id="auth-toss-integrated"
          run={async () => await getIsTossLoginIntegratedService()}
        />
        <ApiButton id="auth-userkey" run={async () => await getUserKeyForGame()} />
        <ApiButton
          id="auth-cert"
          run={async () => {
            await appsInTossSignTossCert({ txId: 'mock-tx' });
            return undefined;
          }}
        />
      </ApiSection>

      {/* --- Navigation --- */}
      <ApiSection id="navigation" title="Navigation">
        <ApiButton id="nav-sharelink" run={async () => await getTossShareLink('intoss://mock')} />
        <ApiButton
          id="nav-awake"
          run={async () => {
            const r = await setScreenAwakeMode({ enabled: true });
            return r;
          }}
        />
        <ApiButton
          id="nav-secure"
          run={async () => {
            const r = await setSecureScreen({ enabled: true });
            return r;
          }}
        />
        <ApiButton
          id="nav-review"
          run={async () => {
            await requestReview();
            return undefined;
          }}
        />
        <ApiButton
          id="nav-openurl"
          run={async () => {
            await openURL('https://example.com');
            return undefined;
          }}
        />
        <ApiButton
          id="nav-swipe"
          run={async () => {
            await setIosSwipeGestureEnabled({ isEnabled: true });
            return undefined;
          }}
        />
        <ApiButton
          id="nav-orientation"
          run={async () => {
            await setDeviceOrientation({ type: 'portrait' });
            return undefined;
          }}
        />
        <ApiButton
          id="nav-share"
          run={async () => {
            await share({ message: 'hello' });
            return undefined;
          }}
        />
        <ApiButton
          id="nav-close"
          run={async () => {
            await closeView();
            return undefined;
          }}
        />
      </ApiSection>

      {/* --- Environment --- */}
      <EnvironmentSection />

      {/* --- Permissions --- */}
      <ApiSection id="permissions" title="Permissions">
        <ApiButton
          id="perm-get"
          run={async () => await getPermission({ name: 'camera', access: 'access' })}
        />
        <ApiButton
          id="perm-dialog"
          run={async () => await openPermissionDialog({ name: 'camera', access: 'access' })}
        />
        <ApiButton
          id="perm-request"
          run={async () => await requestPermission({ name: 'camera', access: 'access' })}
        />
      </ApiSection>

      {/* --- Storage --- */}
      <ApiSection id="storage" title="Storage">
        <ApiInput id="storage-key" label="key" />
        <ApiInput id="storage-value" label="value" />
        <ApiButton
          id="storage-set"
          run={async ({ 'storage-key': k, 'storage-value': v }) => {
            await Storage.setItem(k, v);
            return undefined;
          }}
          withInputs={['storage-key', 'storage-value']}
        />
        <ApiButton
          id="storage-get"
          run={async ({ 'storage-key': k }) => {
            const v = await Storage.getItem(k);
            return v ?? '(null)';
          }}
          withInputs={['storage-key']}
        />
        <ApiButton
          id="storage-remove"
          run={async ({ 'storage-key': k }) => {
            await Storage.removeItem(k);
            return undefined;
          }}
          withInputs={['storage-key']}
        />
        <ApiButton
          id="storage-clear"
          run={async () => {
            await Storage.clearItems();
            return undefined;
          }}
        />
      </ApiSection>

      {/* --- Location --- */}
      <ApiSection id="location" title="Location">
        <ApiButton
          id="location-current"
          run={async () => {
            const loc = await getCurrentLocation({ accuracy: Accuracy.High });
            return loc;
          }}
        />
      </ApiSection>

      {/* --- Camera & Photos --- */}
      <ApiSection id="camera" title="Camera & Photos">
        <ApiButton id="camera-open" run={async () => await openCamera()} />
        <ApiButton
          id="photos-fetch"
          run={async () => {
            const photos = await fetchAlbumPhotos({ maxCount: 5 });
            return photos.length;
          }}
        />
      </ApiSection>

      {/* --- Contacts --- */}
      <ApiSection id="contacts" title="Contacts">
        <ApiButton
          id="contacts-fetch"
          run={async () => {
            const list = await fetchContacts({ size: 10, offset: 0 });
            return list;
          }}
        />
      </ApiSection>

      {/* --- Clipboard --- */}
      <ApiSection id="clipboard" title="Clipboard">
        <ApiInput id="clipboard" label="text" />
        <ApiButton
          id="clipboard-set"
          run={async ({ clipboard: v }) => {
            await setClipboardText(v);
            return undefined;
          }}
          withInputs={['clipboard']}
        />
        <ApiButton id="clipboard-get" run={async () => (await getClipboardText()) ?? ''} />
      </ApiSection>

      {/* --- Haptic --- */}
      <ApiSection id="haptic" title="Haptic">
        <ApiButton
          id="haptic-tap"
          run={async () => {
            await generateHapticFeedback({ type: 'tap' });
            return undefined;
          }}
        />
        <ApiButton
          id="save-base64"
          run={async () => {
            await saveBase64Data({ data: 'iVBOR', fileName: 'x.png', mimeType: 'image/png' });
            return undefined;
          }}
        />
      </ApiSection>

      {/* --- IAP --- */}
      <ApiSection id="iap" title="IAP">
        <ApiButton
          id="iap-products"
          run={async () => {
            const list = await IAP.getProductItemList();
            return list;
          }}
        />
        <ApiButton
          id="iap-purchase"
          run={async () => {
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
          }}
        />
        <ApiButton
          id="iap-sub"
          run={async () => {
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
          }}
        />
        <ApiButton id="iap-pending" run={async () => await IAP.getPendingOrders()} />
        <ApiButton id="iap-completed" run={async () => await IAP.getCompletedOrRefundedOrders()} />
        <ApiButton
          id="iap-subinfo"
          run={async () => await IAP.getSubscriptionInfo({ params: { orderId: 'mock-sub' } })}
        />
        <ApiButton
          id="iap-checkout"
          run={async () => await checkoutPayment({ params: { payToken: 'mock-token' } })}
        />
      </ApiSection>

      {/* --- Ads --- */}
      <ApiSection id="ads" title="Ads">
        <ApiButton
          id="ads-admob-load"
          run={async () => {
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
          }}
        />
        <ApiButton
          id="ads-admob-show"
          run={async () => {
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
          }}
        />
        <ApiButton
          id="ads-admob-isloaded"
          run={async () =>
            String(await GoogleAdMob.isAppsInTossAdMobLoaded({ adGroupId: 'mock-ad' }))
          }
        />
        <ApiButton
          id="ads-fullscreen-load"
          run={async () => {
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
          }}
        />
        <ApiButton
          id="ads-fullscreen-show"
          run={async () => {
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
          }}
        />
        <ApiButton
          id="ads-tossads-init"
          run={() => {
            TossAds.initialize({ callbacks: {} });
            return undefined;
          }}
        />
        <ApiButton
          id="ads-tossads-destroy"
          run={() => {
            TossAds.destroyAll();
            return undefined;
          }}
        />
      </ApiSection>

      {/* --- Game --- */}
      <ApiSection id="game" title="Game">
        <ApiButton
          id="game-promo"
          run={async () =>
            await grantPromotionReward({ params: { promotionCode: 'mock', amount: 100 } })
          }
        />
        <ApiButton
          id="game-promo-game"
          run={async () =>
            await grantPromotionRewardForGame({ params: { promotionCode: 'mock', amount: 100 } })
          }
        />
        <ApiButton
          id="game-score"
          run={async () => await submitGameCenterLeaderBoardScore({ score: '100' })}
        />
        <ApiButton id="game-profile" run={async () => await getGameCenterGameProfile()} />
        <ApiButton
          id="game-leaderboard"
          run={async () => {
            await openGameCenterLeaderboard();
            return undefined;
          }}
        />
        <ApiButton
          id="game-viral"
          run={async () => {
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
          }}
        />
      </ApiSection>

      {/* --- Analytics --- */}
      <ApiSection id="analytics" title="Analytics">
        <ApiButton
          id="analytics-click"
          run={() => {
            Analytics.click({ log_name: 'e2e-click' });
            return undefined;
          }}
        />
        <ApiButton
          id="analytics-screen"
          run={() => {
            Analytics.screen({ log_name: 'e2e-screen' });
            return undefined;
          }}
        />
        <ApiButton
          id="analytics-impression"
          run={() => {
            Analytics.impression({ log_name: 'e2e-imp' });
            return undefined;
          }}
        />
        <ApiButton
          id="analytics-eventlog"
          run={async () => {
            await eventLog({ log_name: 'e2e-log', log_type: 'event', params: {} });
            return undefined;
          }}
        />
      </ApiSection>

      {/* --- Partner --- */}
      <ApiSection id="partner" title="Partner">
        <ApiButton
          id="partner-add"
          run={async () => {
            await partner.addAccessoryButton({
              id: 'mock',
              title: 'mock',
              icon: { name: 'icon-heart-mono' },
            });
            return undefined;
          }}
        />
        <ApiButton
          id="partner-remove"
          run={async () => {
            await partner.removeAccessoryButton();
            return undefined;
          }}
        />
      </ApiSection>

      {/* --- Notifications --- */}
      <ApiSection id="notification" title="Notification">
        <ApiButton
          id="notification-request"
          run={async () => {
            return await withTimeout(
              new Promise<string>((resolve, reject) => {
                requestNotificationAgreement({
                  options: { templateCode: 'fixture-template' },
                  onEvent: (r) => resolve(r.type),
                  onError: (e) => reject(e instanceof Error ? e : new Error(String(e))),
                });
              }),
            );
          }}
        />
      </ApiSection>

      {/* --- Events --- */}
      <ApiSection id="events" title="Events">
        <ApiSubscriber
          id="events-back"
          subscribe={(onEvent) => {
            graniteEvent.addEventListener('backEvent', { onEvent: () => onEvent(undefined) });
          }}
        />
        <ApiSubscriber
          id="events-home"
          subscribe={(onEvent) => {
            graniteEvent.addEventListener('homeEvent', { onEvent: () => onEvent(undefined) });
          }}
        />
        <ApiSubscriber
          id="events-tds"
          subscribe={(onEvent) => {
            tdsEvent.addEventListener('navigationAccessoryEvent', {
              onEvent: (e) => onEvent(e),
            });
          }}
        />
      </ApiSection>
    </>
  );
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

const container = document.getElementById('app');
if (!container) throw new Error('#app not found');

createRoot(container).render(
  <StrictMode>
    <FixtureApp />
  </StrictMode>,
);
