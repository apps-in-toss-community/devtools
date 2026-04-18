/**
 * 화면/네비게이션/이벤트 mock
 */

import { getNetworkStatusByMode } from '../device/index.js';
import { aitState } from '../state.js';
import type { NetworkStatus } from '../types.js';

export async function closeView(): Promise<void> {
  console.log('[@ait-co/devtools] closeView called');
  window.history.back();
}

export async function openURL(url: string): Promise<void> {
  console.log('[@ait-co/devtools] openURL:', url);
  window.open(url, '_blank');
}

export async function share(message: { message: string }): Promise<void> {
  if (navigator.share) {
    await navigator.share({ text: message.message });
    return;
  }
  console.log('[@ait-co/devtools] share:', message.message);
}

export async function getTossShareLink(path: string, _ogImageUrl?: string): Promise<string> {
  return `https://toss.im/share/mock${path}`;
}

export async function setIosSwipeGestureEnabled(_options: { isEnabled: boolean }): Promise<void> {
  console.log('[@ait-co/devtools] setIosSwipeGestureEnabled:', _options.isEnabled);
}

export async function setDeviceOrientation(_options: {
  type: 'portrait' | 'landscape';
}): Promise<void> {
  console.log('[@ait-co/devtools] setDeviceOrientation:', _options.type);
}

export async function setScreenAwakeMode(options: {
  enabled: boolean;
}): Promise<{ enabled: boolean }> {
  console.log('[@ait-co/devtools] setScreenAwakeMode:', options.enabled);
  return { enabled: options.enabled };
}

export async function setSecureScreen(options: {
  enabled: boolean;
}): Promise<{ enabled: boolean }> {
  console.log('[@ait-co/devtools] setSecureScreen:', options.enabled);
  return { enabled: options.enabled };
}

export async function requestReview(): Promise<void> {
  console.log('[@ait-co/devtools] requestReview called');
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

export function isMinVersionSupported(minVersions: { android: string; ios: string }): boolean {
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

export async function getNetworkStatus(): Promise<NetworkStatus> {
  const modeResult = getNetworkStatusByMode();
  if (modeResult) return modeResult;
  return aitState.state.networkStatus;
}

export async function getServerTime(): Promise<number | undefined> {
  return Date.now();
}
(getServerTime as unknown as { isSupported: () => boolean }).isSupported = () => true;

// --- 이벤트 시스템 ---

interface GraniteEventMap {
  backEvent: { onEvent: () => void; onError?: (error: Error) => void; options?: undefined };
  homeEvent: { onEvent: () => void; onError?: (error: Error) => void; options?: undefined };
}

export const graniteEvent = {
  addEventListener<K extends keyof GraniteEventMap>(
    event: K,
    {
      onEvent,
      onError,
    }: {
      onEvent: GraniteEventMap[K]['onEvent'];
      onError?: GraniteEventMap[K]['onError'];
      options?: GraniteEventMap[K]['options'];
    },
  ): () => void {
    const handler = () => {
      try {
        onEvent();
      } catch (e) {
        onError?.(e instanceof Error ? e : new Error(String(e)));
      }
    };
    window.addEventListener(`__ait:${event}`, handler);
    return () => window.removeEventListener(`__ait:${event}`, handler);
  },
};

export const appsInTossEvent = {
  addEventListener<K extends string>(
    _event: K,
    _handlers: {
      onEvent: (...args: unknown[]) => void;
      onError?: (error: Error) => void;
      options?: unknown;
    },
  ): () => void {
    return () => {};
  },
};

interface TdsEventMap {
  navigationAccessoryEvent: {
    onEvent: (data: { id: string }) => void;
    onError?: (error: Error) => void;
    options: undefined;
  };
}

export const tdsEvent = {
  addEventListener<K extends keyof TdsEventMap>(
    event: K,
    {
      onEvent,
    }: {
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
