/**
 * @ait-co/devtools/mock
 *
 * @apps-in-toss/web-framework의 모든 export를 mock으로 대체한다.
 * 번들러 alias로 원본 대신 이 모듈이 resolve된다.
 */

import { installSafeAreaInsetsBridge } from './safe-area-bridge.js';

// env-2 safe-area inset bridge (#484): wire the launcher→framed-page postMessage
// receiver at import time so any consumer that aliases the SDK to this mock gets
// the real device insets forwarded automatically. No-op outside a browser.
installSafeAreaInsetsBridge();

// --- 광고 ---
export { GoogleAdMob, loadFullScreenAd, showFullScreenAd, TossAds } from './ads/index.js';
// --- 분석 ---
export { Analytics, eventLog } from './analytics/index.js';
// --- 인증/로그인 ---
export {
  appLogin,
  appsInTossSignTossCert,
  getAnonymousKey,
  getIsTossLoginIntegratedService,
  getUserKeyForGame,
} from './auth/index.js';
// --- 디바이스 기능 ---
export {
  Accuracy,
  fetchAlbumItems,
  fetchAlbumPhotos,
  fetchContacts,
  generateHapticFeedback,
  getClipboardText,
  getCurrentLocation,
  getDefaultPlaceholderImages,
  openCamera,
  openPDFViewer,
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
export { checkoutPayment, IAP, requestTossPayPaysBilling } from './iap/index.js';
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
// --- 알림 ---
export { requestNotificationAgreement } from './notification.js';
// --- 파트너 ---
export { partner } from './partner/index.js';
// --- 권한 (bridge-core 호환) ---
export {
  FetchAlbumPhotosPermissionError,
  FetchContactsPermissionError,
  GetClipboardTextPermissionError,
  GetCurrentLocationPermissionError,
  getPermission,
  OpenCameraPermissionError,
  openPermissionDialog,
  PermissionError,
  requestPermission,
  SetClipboardTextPermissionError,
  StartUpdateLocationPermissionError,
} from './permissions.js';
export {
  deleteUserPreset,
  listUserPresets,
  saveUserPreset,
} from './preset-store.js';
// --- Mock state preset library ---
export {
  applyPreset,
  builtInPresets,
  captureCurrentState,
  type MockPreset,
  type MockPresetState,
  matchesPreset,
} from './presets.js';
// --- env-2 safe-area inset bridge (#484) ---
export {
  applyForwardedSafeAreaInsets,
  installSafeAreaInsetsBridge,
  parseSafeAreaInsetsMessage,
  SAFE_AREA_INSETS_MESSAGE_TYPE,
} from './safe-area-bridge.js';
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
