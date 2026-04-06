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

// --- 이 파일은 import되지 않으며, tsc --noEmit으로만 검증된다 ---
export {};
