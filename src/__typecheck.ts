/**
 * 타입 호환성 검증 파일
 *
 * 빌드에는 포함되지 않는다. tsc --noEmit으로만 실행.
 * @apps-in-toss/web-framework의 export와 mock의 export가 호환되는지 컴파일 타임에 검증한다.
 * SDK가 업데이트되어 시그니처가 바뀌면 여기서 에러가 발생한다.
 */

import type * as Original from '@apps-in-toss/web-framework';
import type * as Mock from './mock/index.js';

// --- 유틸리티 타입 ---

/** Mock 타입이 Original 타입에 할당 가능하면 통과, 아니면 컴파일 에러 */
type Assert<TMock, TOriginal> = TMock extends TOriginal ? true : never;

// --- Storage ---
type _StorageGetItem = Assert<typeof Mock.Storage.getItem, typeof Original.Storage.getItem>;
type _StorageSetItem = Assert<typeof Mock.Storage.setItem, typeof Original.Storage.setItem>;
type _StorageRemoveItem = Assert<typeof Mock.Storage.removeItem, typeof Original.Storage.removeItem>;
type _StorageClearItems = Assert<typeof Mock.Storage.clearItems, typeof Original.Storage.clearItems>;

// --- 인증/로그인 ---
type _AppLogin = Assert<typeof Mock.appLogin, typeof Original.appLogin>;
type _GetIsTossLoginIntegratedService = Assert<typeof Mock.getIsTossLoginIntegratedService, typeof Original.getIsTossLoginIntegratedService>;

// --- 화면/네비게이션 ---
type _CloseView = Assert<typeof Mock.closeView, typeof Original.closeView>;
type _OpenURL = Assert<typeof Mock.openURL, typeof Original.openURL>;
type _Share = Assert<typeof Mock.share, typeof Original.share>;
type _GetTossShareLink = Assert<typeof Mock.getTossShareLink, typeof Original.getTossShareLink>;
type _SetSecureScreen = Assert<typeof Mock.setSecureScreen, typeof Original.setSecureScreen>;
type _SetScreenAwakeMode = Assert<typeof Mock.setScreenAwakeMode, typeof Original.setScreenAwakeMode>;

// --- 환경 정보 ---
type _GetPlatformOS = Assert<typeof Mock.getPlatformOS, typeof Original.getPlatformOS>;
type _GetOperationalEnvironment = Assert<typeof Mock.getOperationalEnvironment, typeof Original.getOperationalEnvironment>;
type _GetTossAppVersion = Assert<typeof Mock.getTossAppVersion, typeof Original.getTossAppVersion>;
type _IsMinVersionSupported = Assert<typeof Mock.isMinVersionSupported, typeof Original.isMinVersionSupported>;
type _GetSchemeUri = Assert<typeof Mock.getSchemeUri, typeof Original.getSchemeUri>;
type _GetLocale = Assert<typeof Mock.getLocale, typeof Original.getLocale>;
type _GetNetworkStatus = Assert<typeof Mock.getNetworkStatus, typeof Original.getNetworkStatus>;
type _GetDeviceId = Assert<typeof Mock.getDeviceId, typeof Original.getDeviceId>;
type _GetServerTime = Assert<typeof Mock.getServerTime, typeof Original.getServerTime>;
type _RequestReview = Assert<typeof Mock.requestReview, typeof Original.requestReview>;

// --- IAP ---
type _IAPCreateOneTime = Assert<typeof Mock.IAP.createOneTimePurchaseOrder, typeof Original.IAP.createOneTimePurchaseOrder>;
type _IAPGetProducts = Assert<typeof Mock.IAP.getProductItemList, typeof Original.IAP.getProductItemList>;
type _IAPGetPending = Assert<typeof Mock.IAP.getPendingOrders, typeof Original.IAP.getPendingOrders>;
type _IAPCompleteGrant = Assert<typeof Mock.IAP.completeProductGrant, typeof Original.IAP.completeProductGrant>;

// --- 결제 ---
type _CheckoutPayment = Assert<typeof Mock.checkoutPayment, typeof Original.checkoutPayment>;

// --- 광고 ---
type _GoogleAdMobLoad = Assert<typeof Mock.GoogleAdMob.loadAppsInTossAdMob, typeof Original.GoogleAdMob.loadAppsInTossAdMob>;
type _GoogleAdMobShow = Assert<typeof Mock.GoogleAdMob.showAppsInTossAdMob, typeof Original.GoogleAdMob.showAppsInTossAdMob>;
type _LoadFullScreenAd = Assert<typeof Mock.loadFullScreenAd, typeof Original.loadFullScreenAd>;
type _ShowFullScreenAd = Assert<typeof Mock.showFullScreenAd, typeof Original.showFullScreenAd>;

// --- 디바이스 ---
type _GenerateHapticFeedback = Assert<typeof Mock.generateHapticFeedback, typeof Original.generateHapticFeedback>;
type _SaveBase64Data = Assert<typeof Mock.saveBase64Data, typeof Original.saveBase64Data>;

// --- 이벤트 ---
type _GraniteEvent = Assert<typeof Mock.graniteEvent, typeof Original.graniteEvent>;

// --- SafeAreaInsets ---
type _SafeAreaInsetsGet = Assert<typeof Mock.SafeAreaInsets.get, typeof Original.SafeAreaInsets.get>;
type _SafeAreaInsetsSubscribe = Assert<typeof Mock.SafeAreaInsets.subscribe, typeof Original.SafeAreaInsets.subscribe>;

// --- env ---
type _EnvGetDeploymentId = Assert<typeof Mock.env.getDeploymentId, typeof Original.env.getDeploymentId>;

// --- Partner ---
type _PartnerAddBtn = Assert<typeof Mock.partner.addAccessoryButton, typeof Original.partner.addAccessoryButton>;
type _PartnerRemoveBtn = Assert<typeof Mock.partner.removeAccessoryButton, typeof Original.partner.removeAccessoryButton>;

// --- 디바이스: 카메라/앨범/연락처 (PermissionFunctionWithDialog) ---
type _FetchAlbumPhotos = Assert<typeof Mock.fetchAlbumPhotos, typeof Original.fetchAlbumPhotos>;
type _FetchContacts = Assert<typeof Mock.fetchContacts, typeof Original.fetchContacts>;
type _OpenCamera = Assert<typeof Mock.openCamera, typeof Original.openCamera>;

// --- 디바이스: 위치 ---
type _GetCurrentLocation = Assert<typeof Mock.getCurrentLocation, typeof Original.getCurrentLocation>;
type _StartUpdateLocation = Assert<typeof Mock.startUpdateLocation, typeof Original.startUpdateLocation>;

// --- 디바이스: 클립보드 ---
type _GetClipboardText = Assert<typeof Mock.getClipboardText, typeof Original.getClipboardText>;
type _SetClipboardText = Assert<typeof Mock.setClipboardText, typeof Original.setClipboardText>;

// --- 디바이스: 화면 제어 ---
type _SetIosSwipeGestureEnabled = Assert<typeof Mock.setIosSwipeGestureEnabled, typeof Original.setIosSwipeGestureEnabled>;
type _SetDeviceOrientation = Assert<typeof Mock.setDeviceOrientation, typeof Original.setDeviceOrientation>;

// --- 인증 ---
type _GetUserKeyForGame = Assert<typeof Mock.getUserKeyForGame, typeof Original.getUserKeyForGame>;
type _AppsInTossSignTossCert = Assert<typeof Mock.appsInTossSignTossCert, typeof Original.appsInTossSignTossCert>;

// --- 게임/프로모션 ---
type _GrantPromotionReward = Assert<typeof Mock.grantPromotionReward, typeof Original.grantPromotionReward>;
type _GrantPromotionRewardForGame = Assert<typeof Mock.grantPromotionRewardForGame, typeof Original.grantPromotionRewardForGame>;
type _SubmitGameCenterLeaderBoardScore = Assert<typeof Mock.submitGameCenterLeaderBoardScore, typeof Original.submitGameCenterLeaderBoardScore>;
type _GetGameCenterGameProfile = Assert<typeof Mock.getGameCenterGameProfile, typeof Original.getGameCenterGameProfile>;
type _OpenGameCenterLeaderboard = Assert<typeof Mock.openGameCenterLeaderboard, typeof Original.openGameCenterLeaderboard>;
type _ContactsViral = Assert<typeof Mock.contactsViral, typeof Original.contactsViral>;

// --- 로깅 ---
type _EventLog = Assert<typeof Mock.eventLog, typeof Original.eventLog>;

// --- 환경 정보 (추가) ---
type _GetGroupId = Assert<typeof Mock.getGroupId, typeof Original.getGroupId>;
type _GetAppsInTossGlobals = Assert<typeof Mock.getAppsInTossGlobals, typeof Original.getAppsInTossGlobals>;

// --- 이벤트 (추가) ---
type _TdsEvent = Assert<typeof Mock.tdsEvent, typeof Original.tdsEvent>;
type _AppsInTossEvent = Assert<typeof Mock.appsInTossEvent, typeof Original.appsInTossEvent>;
type _OnVisibilityChanged = Assert<typeof Mock.onVisibilityChangedByTransparentServiceWeb, typeof Original.onVisibilityChangedByTransparentServiceWeb>;
type _GetSafeAreaInsets = Assert<typeof Mock.getSafeAreaInsets, typeof Original.getSafeAreaInsets>;

// --- 광고: TossAds ---
type _TossAdsInit = Assert<typeof Mock.TossAds.initialize, typeof Original.TossAds.initialize>;
type _TossAdsAttach = Assert<typeof Mock.TossAds.attach, typeof Original.TossAds.attach>;
type _TossAdsAttachBanner = Assert<typeof Mock.TossAds.attachBanner, typeof Original.TossAds.attachBanner>;
type _TossAdsDestroy = Assert<typeof Mock.TossAds.destroy, typeof Original.TossAds.destroy>;
type _TossAdsDestroyAll = Assert<typeof Mock.TossAds.destroyAll, typeof Original.TossAds.destroyAll>;

// --- 광고: GoogleAdMob (추가) ---
type _GoogleAdMobIsLoaded = Assert<typeof Mock.GoogleAdMob.isAppsInTossAdMobLoaded, typeof Original.GoogleAdMob.isAppsInTossAdMobLoaded>;

// --- IAP (추가) ---
type _IAPCreateSubscription = Assert<typeof Mock.IAP.createSubscriptionPurchaseOrder, typeof Original.IAP.createSubscriptionPurchaseOrder>;
type _IAPGetCompletedOrRefunded = Assert<typeof Mock.IAP.getCompletedOrRefundedOrders, typeof Original.IAP.getCompletedOrRefundedOrders>;
type _IAPGetSubscriptionInfo = Assert<typeof Mock.IAP.getSubscriptionInfo, typeof Original.IAP.getSubscriptionInfo>;

// --- Analytics (web-analytics) ---
type _AnalyticsScreen = Assert<typeof Mock.Analytics.screen, typeof Original.Analytics.screen>;
type _AnalyticsImpression = Assert<typeof Mock.Analytics.impression, typeof Original.Analytics.impression>;
type _AnalyticsClick = Assert<typeof Mock.Analytics.click, typeof Original.Analytics.click>;

// --- 권한 ---
type _GetPermission = Assert<typeof Mock.getPermission, typeof Original.getPermission>;
type _OpenPermissionDialog = Assert<typeof Mock.openPermissionDialog, typeof Original.openPermissionDialog>;
type _RequestPermission = Assert<typeof Mock.requestPermission, typeof Original.requestPermission>;

// --- 이 파일은 import되지 않으며, tsc --noEmit으로만 검증된다 ---
export {};
