/**
 * 타입 호환성 검증 파일 — 2.x stable 라인 (web-framework-2x alias)
 *
 * `__typecheck.ts`(3.0-beta 라인)와 같은 본체를, devDep alias
 * `@apps-in-toss/web-framework-2x`(= `npm:@apps-in-toss/web-framework@2.8.0`)
 * 대상으로 한 번 더 컴파일한다 — mock이 2.x stable·3.0-beta 두 라인 모두와
 * 호환됨을 CI에서 증명한다(`tsconfig.2x.json`이 이 파일만 include).
 *
 * 두 라인의 유일한 표면 차이는 base `PermissionError`다(2.x public surface 부재,
 * 서브클래스 7개는 존재) → 그 한 심볼만 `AssertIfPresent`로 capability-gate하고
 * 나머지 70개는 평면 `Assert`로 엄격 검증한다. 새 mock API를 추가할 때는 이 파일과
 * `__typecheck.ts`를 함께 갱신한다(현재 skip 대상은 PermissionError base 1개뿐).
 */

import type * as Original from '@apps-in-toss/web-framework-2x';
import type { Assert, AssertIfPresent } from './__typecheck-shared.js';
import type * as Mock from './mock/index.js';

// 제네릭 인자에 `typeof Mock`/`typeof Original`을 직접 쓰면 TS2709가 나므로
// 먼저 명명형 타입으로 고정한다.
type MockNS = typeof Mock;
type OrigNS = typeof Original;

// --- Storage ---
type _StorageGetItem = Assert<typeof Mock.Storage.getItem, typeof Original.Storage.getItem>;
type _StorageSetItem = Assert<typeof Mock.Storage.setItem, typeof Original.Storage.setItem>;
type _StorageRemoveItem = Assert<
  typeof Mock.Storage.removeItem,
  typeof Original.Storage.removeItem
>;
type _StorageClearItems = Assert<
  typeof Mock.Storage.clearItems,
  typeof Original.Storage.clearItems
>;

// --- 인증/로그인 ---
type _AppLogin = Assert<typeof Mock.appLogin, typeof Original.appLogin>;
type _GetIsTossLoginIntegratedService = Assert<
  typeof Mock.getIsTossLoginIntegratedService,
  typeof Original.getIsTossLoginIntegratedService
>;
type _GetUserKeyForGame = Assert<typeof Mock.getUserKeyForGame, typeof Original.getUserKeyForGame>;
type _AppsInTossSignTossCert = Assert<
  typeof Mock.appsInTossSignTossCert,
  typeof Original.appsInTossSignTossCert
>;

// --- 화면/네비게이션 ---
type _CloseView = Assert<typeof Mock.closeView, typeof Original.closeView>;
type _OpenURL = Assert<typeof Mock.openURL, typeof Original.openURL>;
type _Share = Assert<typeof Mock.share, typeof Original.share>;
type _GetTossShareLink = Assert<typeof Mock.getTossShareLink, typeof Original.getTossShareLink>;
type _SetSecureScreen = Assert<typeof Mock.setSecureScreen, typeof Original.setSecureScreen>;
type _SetScreenAwakeMode = Assert<
  typeof Mock.setScreenAwakeMode,
  typeof Original.setScreenAwakeMode
>;
type _SetIosSwipeGestureEnabled = Assert<
  typeof Mock.setIosSwipeGestureEnabled,
  typeof Original.setIosSwipeGestureEnabled
>;
type _SetDeviceOrientation = Assert<
  typeof Mock.setDeviceOrientation,
  typeof Original.setDeviceOrientation
>;

// --- 환경 정보 ---
type _GetPlatformOS = Assert<typeof Mock.getPlatformOS, typeof Original.getPlatformOS>;
type _GetOperationalEnvironment = Assert<
  typeof Mock.getOperationalEnvironment,
  typeof Original.getOperationalEnvironment
>;
type _GetTossAppVersion = Assert<typeof Mock.getTossAppVersion, typeof Original.getTossAppVersion>;
type _IsMinVersionSupported = Assert<
  typeof Mock.isMinVersionSupported,
  typeof Original.isMinVersionSupported
>;
type _GetSchemeUri = Assert<typeof Mock.getSchemeUri, typeof Original.getSchemeUri>;
type _GetLocale = Assert<typeof Mock.getLocale, typeof Original.getLocale>;
type _GetNetworkStatus = Assert<typeof Mock.getNetworkStatus, typeof Original.getNetworkStatus>;
type _GetDeviceId = Assert<typeof Mock.getDeviceId, typeof Original.getDeviceId>;
type _GetServerTime = Assert<typeof Mock.getServerTime, typeof Original.getServerTime>;
type _RequestReview = Assert<typeof Mock.requestReview, typeof Original.requestReview>;
type _GetGroupId = Assert<typeof Mock.getGroupId, typeof Original.getGroupId>;
type _GetAppsInTossGlobals = Assert<
  typeof Mock.getAppsInTossGlobals,
  typeof Original.getAppsInTossGlobals
>;

// --- 디바이스: 카메라/앨범/연락처 ---
type _FetchAlbumItems = Assert<typeof Mock.fetchAlbumItems, typeof Original.fetchAlbumItems>;
type _FetchAlbumPhotos = Assert<typeof Mock.fetchAlbumPhotos, typeof Original.fetchAlbumPhotos>;
type _FetchContacts = Assert<typeof Mock.fetchContacts, typeof Original.fetchContacts>;
type _OpenCamera = Assert<typeof Mock.openCamera, typeof Original.openCamera>;

// --- 디바이스: PDF ---
type _OpenPDFViewer = Assert<typeof Mock.openPDFViewer, typeof Original.openPDFViewer>;

// --- 디바이스: 위치 ---
type _Accuracy = Assert<typeof Mock.Accuracy, typeof Original.Accuracy>;
type _GetCurrentLocation = Assert<
  typeof Mock.getCurrentLocation,
  typeof Original.getCurrentLocation
>;
type _StartUpdateLocation = Assert<
  typeof Mock.startUpdateLocation,
  typeof Original.startUpdateLocation
>;

// --- 디바이스: 클립보드 ---
type _GetClipboardText = Assert<typeof Mock.getClipboardText, typeof Original.getClipboardText>;
type _SetClipboardText = Assert<typeof Mock.setClipboardText, typeof Original.setClipboardText>;

// --- 디바이스: 기타 ---
type _GenerateHapticFeedback = Assert<
  typeof Mock.generateHapticFeedback,
  typeof Original.generateHapticFeedback
>;
type _SaveBase64Data = Assert<typeof Mock.saveBase64Data, typeof Original.saveBase64Data>;

// --- IAP ---
type _IAPCreateOneTime = Assert<
  typeof Mock.IAP.createOneTimePurchaseOrder,
  typeof Original.IAP.createOneTimePurchaseOrder
>;
type _IAPCreateSubscription = Assert<
  typeof Mock.IAP.createSubscriptionPurchaseOrder,
  typeof Original.IAP.createSubscriptionPurchaseOrder
>;
type _IAPGetProducts = Assert<
  typeof Mock.IAP.getProductItemList,
  typeof Original.IAP.getProductItemList
>;
type _IAPGetPending = Assert<
  typeof Mock.IAP.getPendingOrders,
  typeof Original.IAP.getPendingOrders
>;
type _IAPGetCompletedOrRefunded = Assert<
  typeof Mock.IAP.getCompletedOrRefundedOrders,
  typeof Original.IAP.getCompletedOrRefundedOrders
>;
type _IAPCompleteGrant = Assert<
  typeof Mock.IAP.completeProductGrant,
  typeof Original.IAP.completeProductGrant
>;
type _IAPGetSubscriptionInfo = Assert<
  typeof Mock.IAP.getSubscriptionInfo,
  typeof Original.IAP.getSubscriptionInfo
>;

// --- 결제 ---
type _CheckoutPayment = Assert<typeof Mock.checkoutPayment, typeof Original.checkoutPayment>;

// --- 광고: GoogleAdMob ---
type _GoogleAdMobLoad = Assert<
  typeof Mock.GoogleAdMob.loadAppsInTossAdMob,
  typeof Original.GoogleAdMob.loadAppsInTossAdMob
>;
type _GoogleAdMobShow = Assert<
  typeof Mock.GoogleAdMob.showAppsInTossAdMob,
  typeof Original.GoogleAdMob.showAppsInTossAdMob
>;
type _GoogleAdMobIsLoaded = Assert<
  typeof Mock.GoogleAdMob.isAppsInTossAdMobLoaded,
  typeof Original.GoogleAdMob.isAppsInTossAdMobLoaded
>;

// --- 광고: TossAds ---
type _TossAdsInit = Assert<typeof Mock.TossAds.initialize, typeof Original.TossAds.initialize>;
type _TossAdsAttach = Assert<typeof Mock.TossAds.attach, typeof Original.TossAds.attach>;
type _TossAdsAttachBanner = Assert<
  typeof Mock.TossAds.attachBanner,
  typeof Original.TossAds.attachBanner
>;
type _TossAdsDestroy = Assert<typeof Mock.TossAds.destroy, typeof Original.TossAds.destroy>;
type _TossAdsDestroyAll = Assert<
  typeof Mock.TossAds.destroyAll,
  typeof Original.TossAds.destroyAll
>;

// --- 광고: FullScreenAd ---
type _LoadFullScreenAd = Assert<typeof Mock.loadFullScreenAd, typeof Original.loadFullScreenAd>;
type _ShowFullScreenAd = Assert<typeof Mock.showFullScreenAd, typeof Original.showFullScreenAd>;

// --- 이벤트 ---
type _GraniteEvent = Assert<typeof Mock.graniteEvent, typeof Original.graniteEvent>;
type _TdsEvent = Assert<typeof Mock.tdsEvent, typeof Original.tdsEvent>;
type _AppsInTossEvent = Assert<typeof Mock.appsInTossEvent, typeof Original.appsInTossEvent>;

// --- 게임/프로모션 ---
type _GrantPromotionReward = Assert<
  typeof Mock.grantPromotionReward,
  typeof Original.grantPromotionReward
>;
type _GrantPromotionRewardForGame = Assert<
  typeof Mock.grantPromotionRewardForGame,
  typeof Original.grantPromotionRewardForGame
>;
type _SubmitGameCenterLeaderBoardScore = Assert<
  typeof Mock.submitGameCenterLeaderBoardScore,
  typeof Original.submitGameCenterLeaderBoardScore
>;
type _GetGameCenterGameProfile = Assert<
  typeof Mock.getGameCenterGameProfile,
  typeof Original.getGameCenterGameProfile
>;
type _OpenGameCenterLeaderboard = Assert<
  typeof Mock.openGameCenterLeaderboard,
  typeof Original.openGameCenterLeaderboard
>;
type _ContactsViral = Assert<typeof Mock.contactsViral, typeof Original.contactsViral>;

// --- 로깅 ---
type _EventLog = Assert<typeof Mock.eventLog, typeof Original.eventLog>;

// --- Analytics (web-analytics) ---
type _AnalyticsScreen = Assert<typeof Mock.Analytics.screen, typeof Original.Analytics.screen>;
type _AnalyticsImpression = Assert<
  typeof Mock.Analytics.impression,
  typeof Original.Analytics.impression
>;
type _AnalyticsClick = Assert<typeof Mock.Analytics.click, typeof Original.Analytics.click>;

// --- SafeAreaInsets ---
type _SafeAreaInsetsGet = Assert<
  typeof Mock.SafeAreaInsets.get,
  typeof Original.SafeAreaInsets.get
>;
type _SafeAreaInsetsSubscribe = Assert<
  typeof Mock.SafeAreaInsets.subscribe,
  typeof Original.SafeAreaInsets.subscribe
>;
type _GetSafeAreaInsets = Assert<typeof Mock.getSafeAreaInsets, typeof Original.getSafeAreaInsets>;

// --- env ---
type _EnvGetDeploymentId = Assert<
  typeof Mock.env.getDeploymentId,
  typeof Original.env.getDeploymentId
>;

// --- Partner ---
type _PartnerAddBtn = Assert<
  typeof Mock.partner.addAccessoryButton,
  typeof Original.partner.addAccessoryButton
>;
type _PartnerRemoveBtn = Assert<
  typeof Mock.partner.removeAccessoryButton,
  typeof Original.partner.removeAccessoryButton
>;

// --- 권한 ---
type _GetPermission = Assert<typeof Mock.getPermission, typeof Original.getPermission>;
type _OpenPermissionDialog = Assert<
  typeof Mock.openPermissionDialog,
  typeof Original.openPermissionDialog
>;
type _RequestPermission = Assert<typeof Mock.requestPermission, typeof Original.requestPermission>;

// --- PermissionError 계층 (web-framework 3.0+ 신규, runtime class) ---
// base PermissionError는 2.x stable 라인 public surface에 부재 → AssertIfPresent로
// skip(true). 서브클래스 7개는 2.x에도 존재하므로 평면 Assert로 엄격 검증한다.
type _PermissionError = AssertIfPresent<MockNS, OrigNS, 'PermissionError'>;
type _FetchAlbumPhotosPermissionError = Assert<
  typeof Mock.FetchAlbumPhotosPermissionError,
  typeof Original.FetchAlbumPhotosPermissionError
>;
type _FetchContactsPermissionError = Assert<
  typeof Mock.FetchContactsPermissionError,
  typeof Original.FetchContactsPermissionError
>;
type _GetClipboardTextPermissionError = Assert<
  typeof Mock.GetClipboardTextPermissionError,
  typeof Original.GetClipboardTextPermissionError
>;
type _GetCurrentLocationPermissionError = Assert<
  typeof Mock.GetCurrentLocationPermissionError,
  typeof Original.GetCurrentLocationPermissionError
>;
type _OpenCameraPermissionError = Assert<
  typeof Mock.OpenCameraPermissionError,
  typeof Original.OpenCameraPermissionError
>;
type _SetClipboardTextPermissionError = Assert<
  typeof Mock.SetClipboardTextPermissionError,
  typeof Original.SetClipboardTextPermissionError
>;
type _StartUpdateLocationPermissionError = Assert<
  typeof Mock.StartUpdateLocationPermissionError,
  typeof Original.StartUpdateLocationPermissionError
>;

// --- 알림 ---
type _RequestNotificationAgreement = Assert<
  typeof Mock.requestNotificationAgreement,
  typeof Original.requestNotificationAgreement
>;
