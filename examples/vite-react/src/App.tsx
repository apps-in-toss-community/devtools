import { useState, useEffect, useCallback, useRef } from 'react';
import {
  // Auth
  appLogin,
  getIsTossLoginIntegratedService,
  getUserKeyForGame,
  appsInTossSignTossCert,
  // Navigation
  closeView,
  openURL,
  share,
  getTossShareLink,
  setIosSwipeGestureEnabled,
  setDeviceOrientation,
  setScreenAwakeMode,
  setSecureScreen,
  requestReview,
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
  graniteEvent,
  appsInTossEvent,
  tdsEvent,
  onVisibilityChangedByTransparentServiceWeb,
  env,
  getAppsInTossGlobals,
  SafeAreaInsets,
  getSafeAreaInsets,
  // Device
  Storage,
  getCurrentLocation,
  openCamera,
  fetchAlbumPhotos,
  fetchContacts,
  getClipboardText,
  setClipboardText,
  generateHapticFeedback,
  saveBase64Data,
  // IAP
  IAP,
  checkoutPayment,
  // Ads
  GoogleAdMob,
  TossAds,
  loadFullScreenAd,
  showFullScreenAd,
  // Game
  grantPromotionReward,
  grantPromotionRewardForGame,
  submitGameCenterLeaderBoardScore,
  getGameCenterGameProfile,
  openGameCenterLeaderboard,
  contactsViral,
  // Analytics
  Analytics,
  eventLog,
  // Partner
  partner,
  // Permissions
  getPermission,
  openPermissionDialog,
  requestPermission,
  // Types
  type NetworkStatus,
} from '@apps-in-toss/web-framework';

// --- Styles ---
const colors = {
  bg: '#f4f5f7',
  card: '#ffffff',
  primary: '#3182f6',
  text: '#191f28',
  subtext: '#8b95a1',
  border: '#e5e8eb',
  success: '#00c471',
  error: '#ff4d4f',
  tag: '#f2f4f6',
};

const cardStyle: React.CSSProperties = {
  background: colors.card,
  borderRadius: 16,
  padding: 20,
  marginBottom: 16,
  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
};

const buttonStyle: React.CSSProperties = {
  background: colors.primary,
  color: '#fff',
  border: 'none',
  borderRadius: 10,
  padding: '10px 20px',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

const smallButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  fontSize: 12,
  padding: '6px 14px',
};

const inputStyle: React.CSSProperties = {
  border: `1px solid ${colors.border}`,
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 14,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const tagStyle: React.CSSProperties = {
  display: 'inline-block',
  background: colors.tag,
  borderRadius: 6,
  padding: '4px 10px',
  fontSize: 13,
  color: colors.text,
  marginRight: 8,
  marginBottom: 4,
};

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h3 style={{ margin: '0 0 12px', fontSize: 16, color: colors.text }}>{children}</h3>
);

const SubTitle = ({ children }: { children: React.ReactNode }) => (
  <h4 style={{ margin: '12px 0 8px', fontSize: 14, color: colors.subtext, fontWeight: 600 }}>{children}</h4>
);

const Result = ({ label, value, testId }: { label: string; value: string; testId?: string }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
    <span style={{ color: colors.subtext, fontSize: 13 }}>{label}</span>
    <span style={tagStyle} data-testid={testId}>{value}</span>
  </div>
);

const ButtonRow = ({ children }: { children: React.ReactNode }) => (
  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>{children}</div>
);

// =======================================================================
// AUTH
// =======================================================================

function AuthSection() {
  const [loginCode, setLoginCode] = useState<string | null>(null);
  const [isTossIntegrated, setIsTossIntegrated] = useState<string | null>(null);
  const [userKey, setUserKey] = useState<string | null>(null);
  const [certResult, setCertResult] = useState<string | null>(null);

  return (
    <div style={cardStyle} data-testid="auth-section">
      <SectionTitle>Auth</SectionTitle>

      <ButtonRow>
        <button style={smallButtonStyle} data-testid="auth-login-btn" onClick={async () => {
          const r = await appLogin();
          setLoginCode(r.authorizationCode);
        }}>appLogin()</button>
        <button style={smallButtonStyle} data-testid="auth-toss-integrated-btn" onClick={async () => {
          const r = await getIsTossLoginIntegratedService();
          setIsTossIntegrated(String(r));
        }}>isTossLoginIntegrated</button>
        <button style={smallButtonStyle} data-testid="auth-userkey-btn" onClick={async () => {
          const r = await getUserKeyForGame();
          setUserKey(JSON.stringify(r));
        }}>getUserKeyForGame</button>
        <button style={smallButtonStyle} data-testid="auth-cert-btn" onClick={async () => {
          await appsInTossSignTossCert({ txId: 'test-tx-123' });
          setCertResult('done');
        }}>signTossCert</button>
      </ButtonRow>

      {loginCode && <Result label="authorizationCode" value={loginCode} testId="auth-login-code" />}
      {isTossIntegrated !== null && <Result label="isTossLoginIntegrated" value={isTossIntegrated} testId="auth-toss-integrated-result" />}
      {userKey !== null && <Result label="userKeyForGame" value={userKey} testId="auth-userkey-result" />}
      {certResult && <Result label="signTossCert" value={certResult} testId="auth-cert-result" />}
    </div>
  );
}

// =======================================================================
// NAVIGATION
// =======================================================================

function NavigationSection() {
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [screenAwake, setScreenAwake] = useState<string | null>(null);
  const [secureScreenResult, setSecureScreenResult] = useState<string | null>(null);
  const [reviewDone, setReviewDone] = useState(false);

  return (
    <div style={cardStyle} data-testid="navigation-section">
      <SectionTitle>Navigation</SectionTitle>

      <ButtonRow>
        <button style={smallButtonStyle} data-testid="nav-close-btn" onClick={() => closeView()}>closeView</button>
        <button style={smallButtonStyle} data-testid="nav-openurl-btn" onClick={() => openURL('https://example.com')}>openURL</button>
        <button style={smallButtonStyle} data-testid="nav-share-btn" onClick={() => share({ message: 'Hello from AIT!' })}>share</button>
        <button style={smallButtonStyle} data-testid="nav-sharelink-btn" onClick={async () => {
          const link = await getTossShareLink('/test');
          setShareLink(link);
        }}>getTossShareLink</button>
      </ButtonRow>

      <ButtonRow>
        <button style={smallButtonStyle} data-testid="nav-swipe-btn" onClick={() => setIosSwipeGestureEnabled({ isEnabled: true })}>swipeGesture</button>
        <button style={smallButtonStyle} data-testid="nav-orientation-btn" onClick={() => setDeviceOrientation({ type: 'landscape' })}>orientation</button>
        <button style={smallButtonStyle} data-testid="nav-awake-btn" onClick={async () => {
          const r = await setScreenAwakeMode({ enabled: true });
          setScreenAwake(JSON.stringify(r));
        }}>screenAwake</button>
        <button style={smallButtonStyle} data-testid="nav-secure-btn" onClick={async () => {
          const r = await setSecureScreen({ enabled: true });
          setSecureScreenResult(JSON.stringify(r));
        }}>secureScreen</button>
        <button style={smallButtonStyle} data-testid="nav-review-btn" onClick={async () => {
          await requestReview();
          setReviewDone(true);
        }}>requestReview</button>
      </ButtonRow>

      {shareLink && <Result label="shareLink" value={shareLink} testId="nav-sharelink-result" />}
      {screenAwake && <Result label="screenAwake" value={screenAwake} testId="nav-awake-result" />}
      {secureScreenResult && <Result label="secureScreen" value={secureScreenResult} testId="nav-secure-result" />}
      {reviewDone && <Result label="requestReview" value="done" testId="nav-review-result" />}
    </div>
  );
}

// =======================================================================
// ENVIRONMENT
// =======================================================================

function EnvironmentSection() {
  const [platform, setPlatform] = useState(getPlatformOS());
  const [envVal, setEnvVal] = useState(getOperationalEnvironment());
  const [network, setNetwork] = useState<NetworkStatus | ''>('');
  const [appVersion] = useState(getTossAppVersion());
  const [minVersion] = useState(isMinVersionSupported({ android: '5.0.0', ios: '5.0.0' }));
  const [schemeUri] = useState(getSchemeUri());
  const [locale] = useState(getLocale());
  const [deviceId] = useState(getDeviceId());
  const [groupId] = useState(getGroupId());
  const [serverTime, setServerTime] = useState<string | null>(null);
  const [deploymentId] = useState(env.getDeploymentId());
  const [globals] = useState(getAppsInTossGlobals());
  const [safeArea] = useState(SafeAreaInsets.get());
  const [safeAreaLegacy] = useState(getSafeAreaInsets());

  useEffect(() => {
    const refresh = () => {
      setPlatform(getPlatformOS());
      setEnvVal(getOperationalEnvironment());
      getNetworkStatus().then(setNetwork);
    };
    refresh();
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    getServerTime().then(t => setServerTime(t !== undefined ? String(t) : 'undefined'));
  }, []);

  return (
    <div style={cardStyle} data-testid="environment-section">
      <SectionTitle>Environment</SectionTitle>
      <Result label="getPlatformOS()" value={platform} testId="env-platform" />
      <Result label="getOperationalEnvironment()" value={envVal} testId="env-operational" />
      <Result label="getNetworkStatus()" value={network || 'loading...'} testId="env-network" />
      <Result label="getTossAppVersion()" value={appVersion} testId="env-app-version" />
      <Result label="isMinVersionSupported()" value={String(minVersion)} testId="env-min-version" />
      <Result label="getSchemeUri()" value={schemeUri} testId="env-scheme-uri" />
      <Result label="getLocale()" value={locale} testId="env-locale" />
      <Result label="getDeviceId()" value={deviceId} testId="env-device-id" />
      <Result label="getGroupId()" value={groupId} testId="env-group-id" />
      <Result label="getServerTime()" value={serverTime ?? 'loading...'} testId="env-server-time" />
      <Result label="env.getDeploymentId()" value={deploymentId} testId="env-deployment-id" />
      <Result label="globals.brandDisplayName" value={globals.brandDisplayName} testId="env-brand-name" />
      <Result label="SafeAreaInsets.top" value={String(safeArea.top)} testId="env-safe-area-top" />
      <Result label="getSafeAreaInsets()" value={String(safeAreaLegacy)} testId="env-safe-area-legacy" />
    </div>
  );
}

// =======================================================================
// DEVICE - Storage
// =======================================================================

function StorageSection() {
  const [key, setKey] = useState('demo-key');
  const [value, setValue] = useState('hello world');
  const [stored, setStored] = useState<string | null>(null);
  const [hasQueried, setHasQueried] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [cleared, setCleared] = useState(false);

  return (
    <div style={cardStyle} data-testid="storage-section">
      <SectionTitle>Storage</SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input style={inputStyle} placeholder="Key" value={key} onChange={e => setKey(e.target.value)} data-testid="storage-key-input" />
        <input style={inputStyle} placeholder="Value" value={value} onChange={e => setValue(e.target.value)} data-testid="storage-value-input" />
        <ButtonRow>
          <button style={buttonStyle} onClick={async () => { await Storage.setItem(key, value); setStored(null); setHasQueried(false); setRemoved(false); setCleared(false); }} data-testid="storage-set-button">setItem</button>
          <button style={{ ...buttonStyle, background: colors.success }} onClick={async () => { const r = await Storage.getItem(key); setStored(r); setHasQueried(true); }} data-testid="storage-get-button">getItem</button>
          <button style={{ ...smallButtonStyle, background: colors.error }} onClick={async () => { await Storage.removeItem(key); setRemoved(true); }} data-testid="storage-remove-button">removeItem</button>
          <button style={{ ...smallButtonStyle, background: '#666' }} onClick={async () => { await Storage.clearItems(); setCleared(true); }} data-testid="storage-clear-button">clearItems</button>
        </ButtonRow>
        {hasQueried && <Result label="저장된 값" value={stored ?? '(null)'} testId="storage-result" />}
        {removed && <Result label="removeItem" value="done" testId="storage-remove-result" />}
        {cleared && <Result label="clearItems" value="done" testId="storage-clear-result" />}
      </div>
    </div>
  );
}

// =======================================================================
// DEVICE - Location
// =======================================================================

function LocationSection() {
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <div style={cardStyle} data-testid="location-section">
      <SectionTitle>Location</SectionTitle>
      <button style={buttonStyle} onClick={async () => {
        try { setError(null); const loc = await getCurrentLocation(); setCoords(loc.coords); }
        catch (e) { setError(String(e)); }
      }} data-testid="location-button">getCurrentLocation()</button>
      {coords && (
        <div style={{ marginTop: 8 }}>
          <Result label="latitude" value={String(coords.latitude)} testId="location-lat" />
          <Result label="longitude" value={String(coords.longitude)} testId="location-lng" />
        </div>
      )}
      {error && <p style={{ color: 'red', fontSize: 13, margin: '8px 0 0' }} data-testid="location-error">{error}</p>}
    </div>
  );
}

// =======================================================================
// DEVICE - Camera & Photos
// =======================================================================

function CameraPhotosSection() {
  const [cameraResult, setCameraResult] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [photosResult, setPhotosResult] = useState<string | null>(null);
  const [photosError, setPhotosError] = useState<string | null>(null);

  return (
    <div style={cardStyle} data-testid="camera-section">
      <SectionTitle>Camera & Photos</SectionTitle>
      <ButtonRow>
        <button style={buttonStyle} data-testid="camera-button" onClick={async () => {
          try { setCameraError(null); const r = await openCamera(); setCameraResult(r.id); }
          catch (e) { setCameraError(String(e)); }
        }}>openCamera()</button>
        <button style={{ ...buttonStyle, background: colors.success }} data-testid="photos-button" onClick={async () => {
          try { setPhotosError(null); const r = await fetchAlbumPhotos({ maxCount: 3 }); setPhotosResult(String(r.length)); }
          catch (e) { setPhotosError(String(e)); }
        }}>fetchAlbumPhotos()</button>
      </ButtonRow>
      {cameraResult && <Result label="Camera Photo ID" value={cameraResult} testId="camera-result" />}
      {cameraError && <p style={{ color: colors.error, fontSize: 13, margin: '8px 0 0' }} data-testid="camera-error">{cameraError}</p>}
      {photosResult && <Result label="Photos count" value={photosResult} testId="photos-result" />}
      {photosError && <p style={{ color: colors.error, fontSize: 13, margin: '8px 0 0' }} data-testid="photos-error">{photosError}</p>}
    </div>
  );
}

// =======================================================================
// DEVICE - Contacts
// =======================================================================

function ContactsSection() {
  const [contacts, setContacts] = useState<string | null>(null);
  const [contactsError, setContactsError] = useState<string | null>(null);

  return (
    <div style={cardStyle} data-testid="contacts-section">
      <SectionTitle>Contacts</SectionTitle>
      <button style={buttonStyle} data-testid="contacts-button" onClick={async () => {
        try { setContactsError(null); const r = await fetchContacts({ size: 10, offset: 0 }); setContacts(JSON.stringify(r.result)); }
        catch (e) { setContactsError(String(e)); }
      }}>fetchContacts()</button>
      {contacts && (
        <pre style={{ marginTop: 8, padding: 12, background: colors.tag, borderRadius: 8, fontSize: 12, overflow: 'auto' }} data-testid="contacts-result">{contacts}</pre>
      )}
      {contactsError && <p style={{ color: colors.error, fontSize: 13, margin: '8px 0 0' }} data-testid="contacts-error">{contactsError}</p>}
    </div>
  );
}

// =======================================================================
// DEVICE - Clipboard
// =======================================================================

function ClipboardSection() {
  const [text, setText] = useState('clipboard test');
  const [readResult, setReadResult] = useState<string | null>(null);
  const [writeResult, setWriteResult] = useState(false);

  return (
    <div style={cardStyle} data-testid="clipboard-section">
      <SectionTitle>Clipboard</SectionTitle>
      <input style={{ ...inputStyle, marginBottom: 8 }} value={text} onChange={e => setText(e.target.value)} data-testid="clipboard-input" />
      <ButtonRow>
        <button style={buttonStyle} data-testid="clipboard-set-btn" onClick={async () => {
          await setClipboardText(text);
          setWriteResult(true);
        }}>setClipboardText</button>
        <button style={{ ...buttonStyle, background: colors.success }} data-testid="clipboard-get-btn" onClick={async () => {
          const r = await getClipboardText();
          setReadResult(r);
        }}>getClipboardText</button>
      </ButtonRow>
      {writeResult && <Result label="setClipboardText" value="done" testId="clipboard-set-result" />}
      {readResult !== null && <Result label="clipboardText" value={readResult} testId="clipboard-get-result" />}
    </div>
  );
}

// =======================================================================
// DEVICE - Haptic & SaveBase64
// =======================================================================

function HapticSection() {
  const types = ['tickWeak', 'tap', 'success', 'error', 'confetti'] as const;
  const [saveDone, setSaveDone] = useState(false);

  return (
    <div style={cardStyle} data-testid="haptic-section">
      <SectionTitle>Haptic & File</SectionTitle>
      <ButtonRow>
        {types.map(type => (
          <button key={type} style={smallButtonStyle} onClick={() => generateHapticFeedback({ type })} data-testid={`haptic-${type}`}>{type}</button>
        ))}
      </ButtonRow>
      <SubTitle>saveBase64Data</SubTitle>
      <button style={smallButtonStyle} data-testid="save-base64-btn" onClick={async () => {
        await saveBase64Data({ data: btoa('hello'), fileName: 'test.txt', mimeType: 'text/plain' });
        setSaveDone(true);
      }}>saveBase64Data</button>
      {saveDone && <Result label="saveBase64Data" value="done" testId="save-base64-result" />}
    </div>
  );
}

// =======================================================================
// PERMISSIONS
// =======================================================================

function PermissionsSection() {
  const [permResult, setPermResult] = useState<string | null>(null);
  const [dialogResult, setDialogResult] = useState<string | null>(null);
  const [reqResult, setReqResult] = useState<string | null>(null);

  return (
    <div style={cardStyle} data-testid="permissions-section">
      <SectionTitle>Permissions</SectionTitle>
      <ButtonRow>
        <button style={smallButtonStyle} data-testid="perm-get-btn" onClick={async () => {
          const r = await getPermission('camera');
          setPermResult(r);
        }}>getPermission(camera)</button>
        <button style={smallButtonStyle} data-testid="perm-dialog-btn" onClick={async () => {
          const r = await openPermissionDialog('camera');
          setDialogResult(r);
        }}>openPermissionDialog</button>
        <button style={smallButtonStyle} data-testid="perm-request-btn" onClick={async () => {
          const r = await requestPermission({ name: 'camera', access: 'full' });
          setReqResult(r);
        }}>requestPermission</button>
      </ButtonRow>
      {permResult && <Result label="getPermission" value={permResult} testId="perm-get-result" />}
      {dialogResult && <Result label="openPermissionDialog" value={dialogResult} testId="perm-dialog-result" />}
      {reqResult && <Result label="requestPermission" value={reqResult} testId="perm-request-result" />}
    </div>
  );
}

// =======================================================================
// IAP
// =======================================================================

function IAPSection() {
  const [products, setProducts] = useState<unknown[]>([]);
  const [purchaseResult, setPurchaseResult] = useState<string | null>(null);
  const [subResult, setSubResult] = useState<string | null>(null);
  const [pendingOrders, setPendingOrders] = useState<string | null>(null);
  const [completedOrders, setCompletedOrders] = useState<string | null>(null);
  const [subInfo, setSubInfo] = useState<string | null>(null);
  const [payResult, setPayResult] = useState<string | null>(null);

  return (
    <div style={cardStyle} data-testid="iap-section">
      <SectionTitle>In-App Purchase & Payment</SectionTitle>

      <SubTitle>Products</SubTitle>
      <ButtonRow>
        <button style={smallButtonStyle} data-testid="iap-fetch-button" onClick={async () => {
          const r = await IAP.getProductItemList();
          setProducts(r.products);
        }}>getProductItemList</button>
      </ButtonRow>
      {products.length > 0 && (
        <pre style={{ padding: 12, background: colors.tag, borderRadius: 8, fontSize: 12, overflow: 'auto' }} data-testid="iap-products">{JSON.stringify(products, null, 2)}</pre>
      )}

      <SubTitle>Purchase</SubTitle>
      <ButtonRow>
        <button style={smallButtonStyle} data-testid="iap-purchase-button" onClick={() => {
          setPurchaseResult(null);
          IAP.createOneTimePurchaseOrder({
            options: { sku: 'mock-gem-100', processProductGrant: async () => true },
            onEvent: (event) => setPurchaseResult(`success:${event.data.orderId}`),
            onError: (error) => { const e = error as { code?: string }; setPurchaseResult(`error:${e.code ?? 'UNKNOWN'}`); },
          });
        }}>OneTime Purchase</button>
        <button style={smallButtonStyle} data-testid="iap-sub-button" onClick={() => {
          setSubResult(null);
          IAP.createSubscriptionPurchaseOrder({
            options: { sku: 'mock-gem-100', processProductGrant: async () => true },
            onEvent: (event) => setSubResult(`success:${event.data.orderId}`),
            onError: (error) => { const e = error as { code?: string }; setSubResult(`error:${e.code ?? 'UNKNOWN'}`); },
          });
        }}>Subscription</button>
      </ButtonRow>
      {purchaseResult && <Result label="Purchase" value={purchaseResult} testId="iap-purchase-result" />}
      {subResult && <Result label="Subscription" value={subResult} testId="iap-sub-result" />}

      <SubTitle>Orders</SubTitle>
      <ButtonRow>
        <button style={smallButtonStyle} data-testid="iap-pending-btn" onClick={async () => {
          const r = await IAP.getPendingOrders();
          setPendingOrders(JSON.stringify(r.orders));
        }}>getPendingOrders</button>
        <button style={smallButtonStyle} data-testid="iap-completed-btn" onClick={async () => {
          const r = await IAP.getCompletedOrRefundedOrders();
          setCompletedOrders(JSON.stringify(r.orders));
        }}>getCompletedOrders</button>
        <button style={smallButtonStyle} data-testid="iap-subinfo-btn" onClick={async () => {
          const r = await IAP.getSubscriptionInfo({ params: { orderId: 'mock-order-1' } });
          setSubInfo(JSON.stringify(r.subscription));
        }}>getSubscriptionInfo</button>
      </ButtonRow>
      {pendingOrders !== null && <Result label="pendingOrders" value={pendingOrders} testId="iap-pending-result" />}
      {completedOrders !== null && <Result label="completedOrders" value={completedOrders} testId="iap-completed-result" />}
      {subInfo !== null && <Result label="subscriptionInfo" value={subInfo} testId="iap-subinfo-result" />}

      <SubTitle>TossPay</SubTitle>
      <button style={smallButtonStyle} data-testid="iap-checkout-btn" onClick={async () => {
        const r = await checkoutPayment({ params: { payToken: 'test-token-123' } });
        setPayResult(r.success ? 'success' : `fail:${r.reason}`);
      }}>checkoutPayment</button>
      {payResult && <Result label="checkoutPayment" value={payResult} testId="iap-checkout-result" />}
    </div>
  );
}

// =======================================================================
// ADS
// =======================================================================

function AdsSection() {
  const [adMobLoaded, setAdMobLoaded] = useState<string | null>(null);
  const [adMobShown, setAdMobShown] = useState<string | null>(null);
  const [adMobIsLoaded, setAdMobIsLoaded] = useState<string | null>(null);
  const [fullScreenLoaded, setFullScreenLoaded] = useState<string | null>(null);
  const [fullScreenShown, setFullScreenShown] = useState<string | null>(null);
  const [tossAdsInit, setTossAdsInit] = useState(false);

  return (
    <div style={cardStyle} data-testid="ads-section">
      <SectionTitle>Ads</SectionTitle>

      <SubTitle>GoogleAdMob</SubTitle>
      <ButtonRow>
        <button style={smallButtonStyle} data-testid="ads-admob-load-btn" onClick={() => {
          GoogleAdMob.loadAppsInTossAdMob({
            onEvent: (e) => setAdMobLoaded(e.type),
            onError: (e) => setAdMobLoaded(`error:${String(e)}`),
          });
        }}>loadAdMob</button>
        <button style={smallButtonStyle} data-testid="ads-admob-show-btn" onClick={() => {
          GoogleAdMob.showAppsInTossAdMob({
            onEvent: (e) => setAdMobShown(e.type),
            onError: (e) => setAdMobShown(`error:${String(e)}`),
          });
        }}>showAdMob</button>
        <button style={smallButtonStyle} data-testid="ads-admob-isloaded-btn" onClick={async () => {
          const r = await GoogleAdMob.isAppsInTossAdMobLoaded({});
          setAdMobIsLoaded(String(r));
        }}>isAdMobLoaded</button>
      </ButtonRow>
      {adMobLoaded && <Result label="loadAdMob" value={adMobLoaded} testId="ads-admob-load-result" />}
      {adMobShown && <Result label="showAdMob" value={adMobShown} testId="ads-admob-show-result" />}
      {adMobIsLoaded !== null && <Result label="isAdMobLoaded" value={adMobIsLoaded} testId="ads-admob-isloaded-result" />}

      <SubTitle>FullScreenAd</SubTitle>
      <ButtonRow>
        <button style={smallButtonStyle} data-testid="ads-fullscreen-load-btn" onClick={() => {
          loadFullScreenAd({
            onEvent: (e) => setFullScreenLoaded(e.type),
            onError: (e) => setFullScreenLoaded(`error:${String(e)}`),
          });
        }}>loadFullScreenAd</button>
        <button style={smallButtonStyle} data-testid="ads-fullscreen-show-btn" onClick={() => {
          showFullScreenAd({
            onEvent: (e) => setFullScreenShown(e.type),
            onError: (e) => setFullScreenShown(`error:${String(e)}`),
          });
        }}>showFullScreenAd</button>
      </ButtonRow>
      {fullScreenLoaded && <Result label="loadFullScreenAd" value={fullScreenLoaded} testId="ads-fullscreen-load-result" />}
      {fullScreenShown && <Result label="showFullScreenAd" value={fullScreenShown} testId="ads-fullscreen-show-result" />}

      <SubTitle>TossAds</SubTitle>
      <ButtonRow>
        <button style={smallButtonStyle} data-testid="ads-tossads-init-btn" onClick={() => {
          TossAds.initialize({});
          setTossAdsInit(true);
        }}>initialize</button>
        <button style={smallButtonStyle} data-testid="ads-tossads-destroy-btn" onClick={() => {
          TossAds.destroyAll();
        }}>destroyAll</button>
      </ButtonRow>
      {tossAdsInit && <Result label="TossAds.initialize" value="done" testId="ads-tossads-init-result" />}
    </div>
  );
}

// =======================================================================
// GAME
// =======================================================================

function GameSection() {
  const [promoResult, setPromoResult] = useState<string | null>(null);
  const [promoGameResult, setPromoGameResult] = useState<string | null>(null);
  const [scoreResult, setScoreResult] = useState<string | null>(null);
  const [profile, setProfile] = useState<string | null>(null);
  const [leaderboardOpened, setLeaderboardOpened] = useState(false);
  const [viralResult, setViralResult] = useState<string | null>(null);

  return (
    <div style={cardStyle} data-testid="game-section">
      <SectionTitle>Game</SectionTitle>

      <SubTitle>Promotion</SubTitle>
      <ButtonRow>
        <button style={smallButtonStyle} data-testid="game-promo-btn" onClick={async () => {
          const r = await grantPromotionReward({ params: { promotionCode: 'PROMO1', amount: 100 } });
          setPromoResult(JSON.stringify(r));
        }}>grantPromotionReward</button>
        <button style={smallButtonStyle} data-testid="game-promo-game-btn" onClick={async () => {
          const r = await grantPromotionRewardForGame({ params: { promotionCode: 'GAME1', amount: 50 } });
          setPromoGameResult(JSON.stringify(r));
        }}>grantPromoForGame</button>
      </ButtonRow>
      {promoResult && <Result label="promoReward" value={promoResult} testId="game-promo-result" />}
      {promoGameResult && <Result label="promoRewardForGame" value={promoGameResult} testId="game-promo-game-result" />}

      <SubTitle>Game Center</SubTitle>
      <ButtonRow>
        <button style={smallButtonStyle} data-testid="game-score-btn" onClick={async () => {
          const r = await submitGameCenterLeaderBoardScore({ score: '1234' });
          setScoreResult(JSON.stringify(r));
        }}>submitScore</button>
        <button style={smallButtonStyle} data-testid="game-profile-btn" onClick={async () => {
          const r = await getGameCenterGameProfile();
          setProfile(JSON.stringify(r));
        }}>getProfile</button>
        <button style={smallButtonStyle} data-testid="game-leaderboard-btn" onClick={async () => {
          await openGameCenterLeaderboard();
          setLeaderboardOpened(true);
        }}>openLeaderboard</button>
      </ButtonRow>
      {scoreResult && <Result label="submitScore" value={scoreResult} testId="game-score-result" />}
      {profile && <Result label="gameProfile" value={profile} testId="game-profile-result" />}
      {leaderboardOpened && <Result label="openLeaderboard" value="done" testId="game-leaderboard-result" />}

      <SubTitle>Contacts Viral</SubTitle>
      <button style={smallButtonStyle} data-testid="game-viral-btn" onClick={() => {
        contactsViral({
          options: { moduleId: 'test-module' },
          onEvent: (event) => setViralResult(JSON.stringify(event)),
          onError: (error) => setViralResult(`error:${String(error)}`),
        });
      }}>contactsViral</button>
      {viralResult && <Result label="contactsViral" value={viralResult} testId="game-viral-result" />}
    </div>
  );
}

// =======================================================================
// ANALYTICS
// =======================================================================

function AnalyticsSection() {
  const [clickDone, setClickDone] = useState(false);
  const [screenDone, setScreenDone] = useState(false);
  const [impressionDone, setImpressionDone] = useState(false);
  const [eventLogDone, setEventLogDone] = useState(false);

  return (
    <div style={cardStyle} data-testid="analytics-section">
      <SectionTitle>Analytics</SectionTitle>
      <ButtonRow>
        <button style={smallButtonStyle} data-testid="analytics-click-btn" onClick={async () => {
          await Analytics.click({ component: 'demo_button', page: 'main' });
          setClickDone(true);
        }}>Analytics.click()</button>
        <button style={smallButtonStyle} data-testid="analytics-screen-btn" onClick={async () => {
          await Analytics.screen({ page: 'main' });
          setScreenDone(true);
        }}>Analytics.screen()</button>
        <button style={smallButtonStyle} data-testid="analytics-impression-btn" onClick={async () => {
          await Analytics.impression({ component: 'banner', page: 'main' });
          setImpressionDone(true);
        }}>Analytics.impression()</button>
        <button style={smallButtonStyle} data-testid="analytics-eventlog-btn" onClick={async () => {
          await eventLog({ log_name: 'test_event', log_type: 'event', params: { key: 'value' } });
          setEventLogDone(true);
        }}>eventLog()</button>
      </ButtonRow>
      {clickDone && <span style={{ ...tagStyle, color: colors.success }} data-testid="analytics-click-result">Click Logged!</span>}
      {screenDone && <span style={{ ...tagStyle, color: colors.success }} data-testid="analytics-screen-result">Screen Logged!</span>}
      {impressionDone && <span style={{ ...tagStyle, color: colors.success }} data-testid="analytics-impression-result">Impression Logged!</span>}
      {eventLogDone && <span style={{ ...tagStyle, color: colors.success }} data-testid="analytics-eventlog-result">EventLog Logged!</span>}
    </div>
  );
}

// =======================================================================
// PARTNER
// =======================================================================

function PartnerSection() {
  const [addResult, setAddResult] = useState(false);
  const [removeResult, setRemoveResult] = useState(false);

  return (
    <div style={cardStyle} data-testid="partner-section">
      <SectionTitle>Partner</SectionTitle>
      <ButtonRow>
        <button style={smallButtonStyle} data-testid="partner-add-btn" onClick={async () => {
          await partner.addAccessoryButton({ id: 'test-btn', title: 'Test', icon: { name: 'test-icon' } });
          setAddResult(true);
        }}>addAccessoryButton</button>
        <button style={smallButtonStyle} data-testid="partner-remove-btn" onClick={async () => {
          await partner.removeAccessoryButton();
          setRemoveResult(true);
        }}>removeAccessoryButton</button>
      </ButtonRow>
      {addResult && <Result label="addAccessoryButton" value="done" testId="partner-add-result" />}
      {removeResult && <Result label="removeAccessoryButton" value="done" testId="partner-remove-result" />}
    </div>
  );
}

// =======================================================================
// EVENTS
// =======================================================================

function EventSection() {
  const [events, setEvents] = useState<{ id: number; text: string }[]>([]);
  const [tdsEventResult, setTdsEventResult] = useState<string | null>(null);
  const [visibilityResult, setVisibilityResult] = useState<string | null>(null);
  const eventCounterRef = useRef(0);

  const addEvent = useCallback((name: string) => {
    const id = ++eventCounterRef.current;
    setEvents(prev => [{ id, text: `[${new Date().toLocaleTimeString()}] ${name}` }, ...prev].slice(0, 10));
  }, []);

  useEffect(() => {
    const unsubBack = graniteEvent.addEventListener('backEvent', { onEvent: () => addEvent('backEvent') });
    const unsubHome = graniteEvent.addEventListener('homeEvent', { onEvent: () => addEvent('homeEvent') });
    return () => { unsubBack(); unsubHome(); };
  }, [addEvent]);

  useEffect(() => {
    // appsInTossEvent listener
    const unsub = appsInTossEvent.addEventListener('customEvent', { onEvent: () => addEvent('appsInTossEvent:customEvent') });
    return () => unsub();
  }, [addEvent]);

  return (
    <div style={cardStyle} data-testid="events-section">
      <SectionTitle>Events</SectionTitle>
      <p style={{ fontSize: 13, color: colors.subtext, margin: '0 0 8px' }}>
        DevTools 패널에서 backEvent / homeEvent를 트리거해 보세요.
      </p>

      <SubTitle>tdsEvent</SubTitle>
      <button style={smallButtonStyle} data-testid="events-tds-btn" onClick={() => {
        const unsub = tdsEvent.addEventListener('navigationAccessoryEvent', {
          onEvent: () => setTdsEventResult('received'),
        });
        setTdsEventResult('listening');
        setTimeout(() => unsub(), 5000);
      }}>Listen tdsEvent</button>
      {tdsEventResult && <Result label="tdsEvent" value={tdsEventResult} testId="events-tds-result" />}

      <SubTitle>Visibility</SubTitle>
      <button style={smallButtonStyle} data-testid="events-visibility-btn" onClick={() => {
        const unsub = onVisibilityChangedByTransparentServiceWeb({
          options: { callbackId: 'test-vis' },
          onEvent: (isVisible) => setVisibilityResult(String(isVisible)),
          onError: () => setVisibilityResult('error'),
        });
        setVisibilityResult('listening');
        setTimeout(() => unsub(), 10000);
      }}>onVisibilityChanged</button>
      {visibilityResult && <Result label="visibility" value={visibilityResult} testId="events-visibility-result" />}

      <SubTitle>Granite Events Log</SubTitle>
      {events.length > 0 ? (
        <div style={{ fontFamily: 'monospace', fontSize: 12 }} data-testid="events-log">
          {events.map(e => (
            <div key={e.id} style={{ padding: '4px 0', borderBottom: `1px solid ${colors.border}` }}>{e.text}</div>
          ))}
        </div>
      ) : (
        <span style={{ fontSize: 13, color: colors.subtext }} data-testid="events-empty">수신된 이벤트 없음</span>
      )}
    </div>
  );
}

// =======================================================================
// APP
// =======================================================================

export default function App() {
  return (
    <div style={{ background: colors.bg, minHeight: '100vh', padding: '24px 16px', maxWidth: 540, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: colors.text, margin: '0 0 4px' }}>
        앱인토스 미니앱 데모
      </h1>
      <p style={{ fontSize: 14, color: colors.subtext, margin: '0 0 24px' }}>
        @ait-co/devtools Mock SDK 전체 기능을 테스트합니다.
      </p>

      <AuthSection />
      <NavigationSection />
      <EnvironmentSection />
      <PermissionsSection />
      <StorageSection />
      <LocationSection />
      <CameraPhotosSection />
      <ContactsSection />
      <ClipboardSection />
      <HapticSection />
      <IAPSection />
      <AdsSection />
      <GameSection />
      <AnalyticsSection />
      <PartnerSection />
      <EventSection />
    </div>
  );
}
