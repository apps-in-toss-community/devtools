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

export type NotificationAgreementResult = 'newAgreement' | 'alreadyAgreed' | 'agreementRejected';

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
  | 'iphone-15-pro'
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

/**
 * @deprecated landscapeSide는 잘못된 mental model이었다 — iOS landscape에서 CSS env()와
 * SDK SafeAreaInsets 모두 left=right=notchInset(양쪽 대칭)을 반환한다(2026-05-28 iPhone 15
 * Pro relay 실측 #198/#232). 이 타입은 하위 호환 유지만을 위해 export되며 내부 로직에서
 * 더 이상 사용되지 않는다.
 */
export type LandscapeSide = 'left' | 'right';

export type NotchType = 'none' | 'notch' | 'dynamic-island' | 'punch-hole-center';

/**
 * Apps in Toss host nav bar 변형. SDK `webViewProps.type`과 의미 일치.
 * - `partner` (기본): 흰 배경, 뒤로가기 + 앱 아이콘/이름 + ⋯ + ×.
 * - `game`: 투명 배경, 게임 캔버스를 가리지 않도록 ⋯ + ×만 표시.
 */
export type AitNavBarType = 'partner' | 'game';

/**
 * Provenance of a preset's safe-area values — how trustworthy they are.
 *
 * - `measured`   — confirmed by an on-device relay session via `measure_safe_area`.
 * - `extrapolated` — derived from related device specs / Apple/Samsung docs without
 *   a relay session on that exact model.
 * - `placeholder` — a best-guess stand-in. Do not use for QA ground truth until
 *   upgraded to `measured` via a relay session.
 */
export interface SafeAreaProvenance {
  /** Origin of the safe-area values for this preset. */
  source: 'measured' | 'extrapolated' | 'placeholder';
  /** Device label used during the relay session (meaningful for `measured`). */
  device?: string;
  /** ISO-8601 date of the relay measurement session (meaningful for `measured`). */
  date?: string;
  /**
   * Orientations confirmed by relay measurement. Absent means only portrait was
   * measured (or measurement orientation is unknown for non-`measured` sources).
   */
  orientations?: Array<'portrait' | 'landscape'>;
}

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
  /**
   * OS-level notch / status-bar inset (px), device-specific. This is the
   * physical notch the OS carves out — used for the landscape side-inset and
   * the visual notch overlay. It is NOT what the Toss SDK reports as
   * `SafeAreaInsets.get().top` in portrait: on-device relay measurement of an
   * iPhone 15 Pro showed `env(safe-area-inset-top)` is 0 (the host WebView is
   * positioned below the physical notch), so the OS notch never reaches the
   * miniapp's top inset. See `navBarHeight`.
   */
  notchInset: number;
  /**
   * Apps in Toss host nav bar height (px). This — not `notchInset` — is what
   * the SDK returns as `SafeAreaInsets.get().top` for a `partner` WebView in
   * portrait: the relay measured 54 px, which is the native nav bar drawn at
   * the top of the WebView's own coordinate space. It is device-independent
   * (host chrome, not device hardware). 0 for `none`/`custom`.
   */
  navBarHeight: number;
  /** OS-level home-indicator inset in portrait (px), device-specific. */
  safeAreaBottom: number;
  /**
   * OS-level home-indicator inset in landscape (px). When defined, takes precedence
   * over `safeAreaBottom` in landscape. iPhone 15 Pro relay measured 20 px
   * (vs portrait 34) — the home indicator shrinks in landscape (#198/#232).
   * Absent for presets where landscape has not been measured.
   */
  safeAreaBottomLandscape?: number;
  /**
   * How trustworthy the safe-area values are. See {@link SafeAreaProvenance}.
   * Absent for `none`/`custom` (no safe-area model).
   * Use `measure_safe_area` MCP tool in a relay session to upgrade to `measured`.
   */
  safeAreaProvenance?: SafeAreaProvenance;
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
  customWidth: number;
  customHeight: number;
  frame: boolean;
  /** Render the Apps in Toss host nav bar (back / app name / ··· / close) inside the frame. */
  aitNavBar: boolean;
  /** Nav bar 변형. `partner` = 기본(흰 배경 + 아이콘/이름), `game` = 투명 배경 + ⋯/× 만. */
  aitNavBarType: AitNavBarType;
}
