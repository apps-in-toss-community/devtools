export type Primitive = string | number | boolean | null | undefined | symbol;

export type PlatformOS = 'ios' | 'android';
export type OperationalEnvironment = 'toss' | 'sandbox';
export type NetworkStatus = 'OFFLINE' | 'WIFI' | '2G' | '3G' | '4G' | '5G' | 'WWAN' | 'UNKNOWN';
export type PermissionStatus = 'notDetermined' | 'denied' | 'allowed';
export type PermissionName =
  | 'clipboard'
  | 'contacts'
  | 'photos'
  | 'geolocation'
  | 'camera'
  | 'microphone';
export type HapticFeedbackType =
  | 'tickWeak'
  | 'tap'
  | 'tickMedium'
  | 'softMedium'
  | 'basicWeak'
  | 'basicMedium'
  | 'success'
  | 'error'
  | 'wiggle'
  | 'confetti';

export type DeviceApiMode = 'mock' | 'web' | 'prompt';

export interface DeviceModes {
  camera: DeviceApiMode;
  photos: DeviceApiMode;
  location: DeviceApiMode;
  network: 'mock' | 'web';
  clipboard: 'mock' | 'web';
}

export interface MockData {
  images: string[];
  clipboardText: string;
}

export interface LocationCoords {
  latitude: number;
  longitude: number;
  altitude: number;
  accuracy: number;
  altitudeAccuracy: number;
  heading: number;
}

export interface MockLocation {
  coords: LocationCoords;
  timestamp: number;
  accessLocation?: 'FINE' | 'COARSE';
}

export interface MockContact {
  name: string;
  phoneNumber: string;
}

export interface MockIapProduct {
  sku: string;
  type: 'CONSUMABLE' | 'NON_CONSUMABLE' | 'SUBSCRIPTION';
  displayName: string;
  displayAmount: string;
  iconUrl: string;
  description: string;
  renewalCycle?: 'WEEKLY' | 'MONTHLY' | 'YEARLY';
}

export type IapNextResult =
  | 'success'
  | 'USER_CANCELED'
  | 'INVALID_PRODUCT_ID'
  | 'PAYMENT_PENDING'
  | 'NETWORK_ERROR'
  | 'ITEM_ALREADY_OWNED'
  | 'INTERNAL_ERROR';

export interface AnalyticsLogEntry {
  timestamp: number;
  type: string;
  params: Record<string, unknown>;
}

export interface SafeAreaInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export type ViewportPresetId =
  | 'none'
  | 'iphone-se-3'
  | 'iphone-16e'
  | 'iphone-17'
  | 'iphone-air'
  | 'iphone-17-pro'
  | 'iphone-17-pro-max'
  | 'galaxy-s26'
  | 'galaxy-s26-plus'
  | 'galaxy-s26-ultra'
  | 'galaxy-z-flip7'
  | 'galaxy-z-fold7-folded'
  | 'galaxy-z-fold7-unfolded'
  | 'custom';

/**
 * Panel의 orientation 선택.
 * - `auto` — Panel이 강제하지 않음. 앱의 SDK `setDeviceOrientation` 호출을 그대로 따름.
 *   호출 값은 별도로 `viewport.appOrientation`에 기록되며, `viewport.orientation`은
 *   계속 `auto`로 유지된다 — 같은 앱이 여러 번 호출해도 매번 정상 반영됨.
 * - `portrait` / `landscape` — Panel이 강제. SDK 호출은 무시됨 (로그만 남김).
 */
export type ViewportOrientation = 'auto' | 'portrait' | 'landscape';

/**
 * `setDeviceOrientation`이 한 번도 호출되지 않은 초기 상태는 `null`.
 * SDK가 받을 수 있는 값과 일치하므로 portrait/landscape만 허용.
 */
export type AppOrientation = 'portrait' | 'landscape' | null;

/** Landscape 시 노치/Dynamic Island가 어느 쪽으로 가는지. iOS 기본은 landscape-left. */
export type LandscapeSide = 'left' | 'right';

export type NotchType = 'none' | 'notch' | 'dynamic-island' | 'punch-hole-center';

/**
 * Apps in Toss host nav bar 변형. SDK `webViewProps.type`과 의미 일치.
 * - `partner` (기본): 흰 배경, 뒤로가기 + 앱 아이콘/이름 + ⋯ + ×.
 * - `game`: 투명 배경, 게임 캔버스를 가리지 않도록 ⋯ + ×만 표시.
 */
export type AitNavBarType = 'partner' | 'game';

export interface ViewportPreset {
  id: ViewportPresetId;
  label: string;
  /** CSS viewport width in portrait (px) */
  width: number;
  /** CSS viewport height in portrait (px) */
  height: number;
  /** devicePixelRatio */
  dpr: number;
  /** Notch / camera cutout style (portrait) */
  notch: NotchType;
  /** OS-level safe area insets in portrait (px). Excludes Apps in Toss nav bar. */
  safeAreaTop: number;
  safeAreaBottom: number;
}

export interface ViewportState {
  preset: ViewportPresetId;
  /** User-controlled orientation. `auto`이면 `appOrientation`을 따른다. */
  orientation: ViewportOrientation;
  /**
   * SDK가 마지막으로 요청한 orientation. `setDeviceOrientation` 호출 시 갱신.
   * `orientation === 'auto'`일 때 실제 화면 방향 결정에 쓰인다. 초기값 `null`.
   */
  appOrientation: AppOrientation;
  /** Landscape 시 노치/Dynamic Island가 어느 쪽으로 갈지. */
  landscapeSide: LandscapeSide;
  customWidth: number;
  customHeight: number;
  frame: boolean;
  /** Render the Apps in Toss host nav bar (back / app name / ··· / close) inside the frame. */
  aitNavBar: boolean;
  /** Nav bar 변형. `partner` = 기본(흰 배경 + 아이콘/이름), `game` = 투명 배경 + ⋯/× 만. */
  aitNavBarType: AitNavBarType;
}
