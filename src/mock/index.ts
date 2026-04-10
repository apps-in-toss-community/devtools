/**
 * @ait-co/devtools/mock
 *
 * @apps-in-toss/web-framework의 모든 export를 mock으로 대체한다.
 * 번들러 alias로 원본 대신 이 모듈이 resolve된다.
 */

// --- 상태 관리 (내부 + 외부 접근용) ---
export { aitState } from './state.js';
export type { AitDevtoolsState } from './state.js';
export type {
  PlatformOS,
  OperationalEnvironment,
  NetworkStatus,
  PermissionStatus,
  PermissionName,
  HapticFeedbackType,
  LocationCoords,
  MockLocation,
  MockContact,
  MockIapProduct,
  IapNextResult,
  AnalyticsLogEntry,
  SafeAreaInsets as SafeAreaInsetsType,
  DeviceApiMode,
  DeviceModes,
  MockData,
} from './types.js';

// --- 인증/로그인 ---
export { appLogin, getIsTossLoginIntegratedService, getUserKeyForGame, appsInTossSignTossCert } from './auth/index.js';

// --- 화면/네비게이션/환경정보/이벤트 ---
export {
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
} from './navigation/index.js';

// --- 디바이스 기능 ---
export {
  Storage,
  Accuracy,
  getCurrentLocation,
  startUpdateLocation,
  openCamera,
  fetchAlbumPhotos,
  fetchContacts,
  getClipboardText,
  setClipboardText,
  generateHapticFeedback,
  saveBase64Data,
  getDefaultPlaceholderImages,
} from './device/index.js';

// --- IAP / 결제 ---
export { IAP, checkoutPayment } from './iap/index.js';

// --- 광고 ---
export { GoogleAdMob, TossAds, loadFullScreenAd, showFullScreenAd } from './ads/index.js';

// --- 게임/프로모션 ---
export {
  grantPromotionReward,
  grantPromotionRewardForGame,
  submitGameCenterLeaderBoardScore,
  getGameCenterGameProfile,
  openGameCenterLeaderboard,
  contactsViral,
} from './game/index.js';

// --- 분석 ---
export { Analytics, eventLog } from './analytics/index.js';

// --- 파트너 ---
export { partner } from './partner/index.js';

// --- 권한 (bridge-core 호환) ---
export { getPermission, openPermissionDialog, requestPermission } from './permissions.js';

// --- @apps-in-toss/types re-export 호환 ---
export type { Primitive } from './types.js';
