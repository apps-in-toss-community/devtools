/**
 * 화면/네비게이션/이벤트 mock
 */

import { aitState } from '../state.js';
import { getNetworkStatusByMode } from '../device/index.js';

export function closeView(): Promise<void> {
  console.log('[ait-devtools] closeView called');
  window.history.back();
  return Promise.resolve();
}

export function openURL(url: string): Promise<void> {
  console.log('[ait-devtools] openURL:', url);
  window.open(url, '_blank');
  return Promise.resolve();
}

export function share(message: { message: string }): Promise<void> {
  if (navigator.share) {
    return navigator.share({ text: message.message }).then(() => {});
  }
  console.log('[ait-devtools] share:', message.message);
  return Promise.resolve();
}

export function getTossShareLink(path: string, _ogImageUrl?: string): Promise<string> {
  return Promise.resolve(`https://toss.im/share/mock${path}`);
}

export function setIosSwipeGestureEnabled(_options: { isEnabled: boolean }): Promise<void> {
  console.log('[ait-devtools] setIosSwipeGestureEnabled:', _options.isEnabled);
  return Promise.resolve();
}

export function setDeviceOrientation(_options: { type: 'portrait' | 'landscape' }): Promise<void> {
  console.log('[ait-devtools] setDeviceOrientation:', _options.type);
  return Promise.resolve();
}

export function setScreenAwakeMode(options: { enabled: boolean }): Promise<{ enabled: boolean }> {
  console.log('[ait-devtools] setScreenAwakeMode:', options.enabled);
  return Promise.resolve({ enabled: options.enabled });
}

export function setSecureScreen(options: { enabled: boolean }): Promise<{ enabled: boolean }> {
  console.log('[ait-devtools] setSecureScreen:', options.enabled);
  return Promise.resolve({ enabled: options.enabled });
}

export function requestReview(): Promise<void> {
  console.log('[ait-devtools] requestReview called');
  return Promise.resolve();
}
(requestReview as unknown as { isSupported: () => boolean }).isSupported = () => true;

// --- 환경 정보 ---

export function getPlatformOS(): 'ios' | 'android' {
  return aitState.state.platform;
}

export function getOperationalEnvironment(): 'toss' | 'sandbox' {
  return aitState.state.environment;
}

export function getTossAppVersion(): string {
  return aitState.state.appVersion;
}

export function isMinVersionSupported(minVersions: {
  android: string;
  ios: string;
}): boolean {
  const platform = aitState.state.platform;
  const required = platform === 'ios' ? minVersions.ios : minVersions.android;
  if (required === 'always') return true;
  if (required === 'never') return false;

  const current = aitState.state.appVersion.split('.').map(Number);
  const min = required.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((current[i] ?? 0) > (min[i] ?? 0)) return true;
    if ((current[i] ?? 0) < (min[i] ?? 0)) return false;
  }
  return true; // equal
}

export function getSchemeUri(): string {
  return aitState.state.schemeUri || window.location.pathname;
}

export function getLocale(): string {
  return aitState.state.locale;
}

export function getDeviceId(): string {
  return aitState.state.deviceId;
}

export function getGroupId(): string {
  return aitState.state.groupId;
}

export function getNetworkStatus(): Promise<NetworkStatus> {
  const modeResult = getNetworkStatusByMode();
  if (modeResult) return Promise.resolve(modeResult);
  return Promise.resolve(aitState.state.networkStatus);
}

type NetworkStatus = 'OFFLINE' | 'WIFI' | '2G' | '3G' | '4G' | '5G' | 'WWAN' | 'UNKNOWN';

export function getServerTime(): Promise<number | undefined> {
  return Promise.resolve(Date.now());
}
(getServerTime as unknown as { isSupported: () => boolean }).isSupported = () => true;

// --- 이벤트 시스템 ---

interface GraniteEventMap {
  backEvent: { onEvent: () => void; onError?: (error: Error) => void; options?: void };
  homeEvent: { onEvent: () => void; onError?: (error: Error) => void; options?: void };
}

export const graniteEvent = {
  addEventListener<K extends keyof GraniteEventMap>(
    event: K,
    { onEvent, onError }: {
      onEvent: GraniteEventMap[K]['onEvent'];
      onError?: GraniteEventMap[K]['onError'];
      options?: GraniteEventMap[K]['options'];
    },
  ): () => void {
    const handler = () => {
      try { onEvent(); }
      catch (e) { onError?.(e instanceof Error ? e : new Error(String(e))); }
    };
    window.addEventListener(`__ait:${event}`, handler);
    return () => window.removeEventListener(`__ait:${event}`, handler);
  },
};

export const appsInTossEvent = {
  addEventListener<K extends string>(
    _event: K,
    _handlers: { onEvent: (...args: unknown[]) => void; onError?: (error: Error) => void; options?: unknown },
  ): () => void {
    return () => {};
  },
};

interface TdsEventMap {
  navigationAccessoryEvent: { onEvent: (data: { id: string }) => void; onError?: (error: Error) => void; options: undefined };
}

export const tdsEvent = {
  addEventListener<K extends keyof TdsEventMap>(
    event: K,
    { onEvent }: {
      onEvent: TdsEventMap[K]['onEvent'];
      onError?: TdsEventMap[K]['onError'];
      options?: TdsEventMap[K]['options'];
    },
  ): () => void {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      onEvent(detail);
    };
    window.addEventListener(`__ait:${event}`, handler);
    return () => window.removeEventListener(`__ait:${event}`, handler);
  },
};

export function onVisibilityChangedByTransparentServiceWeb(eventParams: {
  options: { callbackId: string };
  onEvent: (isVisible: boolean) => void;
  onError: (error: unknown) => void;
}): () => void {
  const handler = () => eventParams.onEvent(!document.hidden);
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}

// --- env / globals ---

export const env = {
  getDeploymentId: () => aitState.state.deploymentId,
};

export function getAppsInTossGlobals() {
  return {
    deploymentId: aitState.state.deploymentId,
    brandDisplayName: aitState.state.brand.displayName,
    brandIcon: aitState.state.brand.icon,
    brandPrimaryColor: aitState.state.brand.primaryColor,
  };
}

// --- SafeAreaInsets ---

type SafeAreaInsetsValue = { top: number; bottom: number; left: number; right: number };
type SafeAreaInsetsSubscribeHandler = { onEvent: (data: SafeAreaInsetsValue) => void };

export const SafeAreaInsets = {
  get: (): SafeAreaInsetsValue => ({ ...aitState.state.safeAreaInsets }),
  // NOTE: aitState.subscribe에 위임하므로 safeAreaInsets 외 상태 변경에도 콜백이 호출된다.
  // 실제 SDK는 insets 변경 시에만 호출되지만, mock에서는 간소화를 위해 필터링하지 않는다.
  subscribe: ({ onEvent }: SafeAreaInsetsSubscribeHandler): (() => void) => {
    return aitState.subscribe(() => onEvent({ ...aitState.state.safeAreaInsets }));
  },
};

/** @deprecated */
export function getSafeAreaInsets(): number {
  return aitState.state.safeAreaInsets.top;
}
