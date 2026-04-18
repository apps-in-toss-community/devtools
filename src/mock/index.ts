/**
 * @ait-co/devtools/mock
 *
 * @apps-in-toss/web-framework의 모든 export를 mock으로 대체한다.
 * 번들러 alias로 원본 대신 이 모듈이 resolve된다.
 */

// --- 광고 ---
export { GoogleAdMob, loadFullScreenAd, showFullScreenAd, TossAds } from './ads/index.js';
// --- 분석 ---
export { Analytics, eventLog } from './analytics/index.js';
// --- 인증/로그인 ---
export {
  appLogin,
  appsInTossSignTossCert,
  getIsTossLoginIntegratedService,
  getUserKeyForGame,
} from './auth/index.js';
// --- 디바이스 기능 ---
export {
  Accuracy,
  fetchAlbumPhotos,
  fetchContacts,
  generateHapticFeedback,
  getClipboardText,
  getCurrentLocation,
  getDefaultPlaceholderImages,
  openCamera,
  Storage,
  saveBase64Data,
  setClipboardText,
  startUpdateLocation,
} from './device/index.js';
// --- 게임/프로모션 ---
export {
  contactsViral,
  getGameCenterGameProfile,
  grantPromotionReward,
  grantPromotionRewardForGame,
  openGameCenterLeaderboard,
  submitGameCenterLeaderBoardScore,
} from './game/index.js';
// --- IAP / 결제 ---
export { checkoutPayment, IAP } from './iap/index.js';
// --- 화면/네비게이션/환경정보/이벤트 ---
export {
  appsInTossEvent,
  closeView,
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
  graniteEvent,
  isMinVersionSupported,
  onVisibilityChangedByTransparentServiceWeb,
  openURL,
  requestReview,
  SafeAreaInsets,
  setDeviceOrientation,
  setIosSwipeGestureEnabled,
  setScreenAwakeMode,
  setSecureScreen,
  share,
  tdsEvent,
} from './navigation/index.js';
// --- 파트너 ---
export { partner } from './partner/index.js';
// --- 권한 (bridge-core 호환) ---
export { getPermission, openPermissionDialog, requestPermission } from './permissions.js';
export type { AitDevtoolsState } from './state.js';
// --- 상태 관리 (내부 + 외부 접근용) ---
export { aitState } from './state.js';
// --- @apps-in-toss/types re-export 호환 ---
export type {
  AnalyticsLogEntry,
  DeviceApiMode,
  DeviceModes,
  HapticFeedbackType,
  IapNextResult,
  LocationCoords,
  MockContact,
  MockData,
  MockIapProduct,
  MockLocation,
  NetworkStatus,
  OperationalEnvironment,
  PermissionName,
  PermissionStatus,
  PlatformOS,
  Primitive,
  SafeAreaInsets as SafeAreaInsetsType,
} from './types.js';
