/**
 * 화면/네비게이션/이벤트 mock
 */

import type { GraniteEvent, TdsEvent } from '@apps-in-toss/web-framework';
import { getNetworkStatusByMode } from '../device/index.js';
import { buildNativeError } from '../native-error.js';
import { observe } from '../observe.js';
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

// RFC 3986 scheme 문법(ALPHA *(ALPHA / DIGIT / "+" / "-" / ".") ":")만 확인한다 — 특정
// scheme 이름(intoss 등)을 하드코딩하지 않아 애매한 케이스는 통과시킨다(보수적 규칙,
// devtools#780). "intoss://my-app" 같은 mini-app 딥링크는 통과, "/some/path" 같은
// scheme 없는 bare path는 거부.
const URI_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

export async function getTossShareLink(path: string, _ogImageUrl?: string): Promise<string> {
  // 실기기(env3)는 scheme 없는 bare path를 reject(code: EXECUTION_ERROR)한다 —
  // mock은 과거 어떤 문자열이든 조용히 resolve했다(devtools#780, env1↔env3 capture
  // diff 실측). string.resolve(path)로 만든 "mock 링크"가 유효한 mini-app 딥링크가
  // 아닌데도 성공한 것처럼 보이면 개발자가 dev에서 통과한 코드를 실기기에서 깨뜨린다.
  // 이 throw는 결정적 입력-계약 위반이라 다이얼 뒤에 두지 않는다 — 던지는 error의
  // *shape*만 buildNativeError로 실기기 2.x envelope(name/code/userInfo/moduleName/
  // __isError)과 맞춘다(devtools#788, 손수 만든 `{errorCode}`가 env1↔env3
  // errorKeys 발산의 원인이었다).
  if (!URI_SCHEME_PATTERN.test(path)) {
    throw buildNativeError('EXECUTION_ERROR');
  }
  return `https://toss.im/share/mock${path}`;
}

export async function setIosSwipeGestureEnabled(options: { isEnabled: boolean }): Promise<void> {
  console.log('[@ait-co/devtools] setIosSwipeGestureEnabled:', options.isEnabled);
  // real(토스 WebView)에선 이 호출이 native bridge로 발화한다(devtools#171 실측). mock은
  // 그 "마지막 호출값"을 관측 가능한 state로 mirror해, toss-gated 가드(예: sdk-example
  // useDisableIosSwipeGestureInToss)가 실제로 돌았는지를 AIT.getMockState로 대조할 수 있게 한다.
  aitState.patch('navigation', { iosSwipeGestureEnabled: options.isEnabled });
}

export async function setDeviceOrientation(options: {
  type: 'portrait' | 'landscape';
}): Promise<void> {
  const current = aitState.state.viewport.orientation;
  if (current === 'auto') {
    console.log('[@ait-co/devtools] setDeviceOrientation:', options.type);
    // appOrientation은 Panel이 'auto'일 때 effective orientation을 결정하는 별도 필드.
    // viewport.orientation은 사용자 의도이므로 SDK가 임의로 덮어쓰지 않는다 — 그래야
    // 앱이 같은 방향으로 여러 번 호출해도 매번 정상 반영된다.
    aitState.patch('viewport', { appOrientation: options.type });
    return;
  }
  console.warn(
    `[@ait-co/devtools] setDeviceOrientation(${options.type}) ignored — Panel is forcing "${current}". Change the Viewport tab's orientation to "auto" to let the app control rotation.`,
  );
}

export const setScreenAwakeMode = observe(
  'setScreenAwakeMode',
  'inert',
  async (options: { enabled: boolean }): Promise<{ enabled: boolean }> => {
    console.log('[@ait-co/devtools] setScreenAwakeMode:', options.enabled);
    return { enabled: options.enabled };
  },
);

export const setSecureScreen = observe(
  'setSecureScreen',
  'inert',
  async (options: { enabled: boolean }): Promise<{ enabled: boolean }> => {
    console.log('[@ait-co/devtools] setSecureScreen:', options.enabled);
    return { enabled: options.enabled };
  },
);

const _requestReviewImpl = observe('requestReview', 'inert', async (): Promise<void> => {
  console.log('[@ait-co/devtools] requestReview called');
});
export const requestReview: typeof _requestReviewImpl & { isSupported: () => boolean } =
  _requestReviewImpl as typeof _requestReviewImpl & { isSupported: () => boolean };
requestReview.isSupported = () => true;

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

const _getServerTimeImpl = async (): Promise<number | undefined> => {
  return Date.now();
};
export const getServerTime: (() => Promise<number | undefined>) & { isSupported: () => boolean } =
  Object.assign(_getServerTimeImpl, { isSupported: () => true });

// --- 이벤트 시스템 ---

/**
 * 현재 backEvent 구독자 수. graniteEvent.addEventListener('backEvent', …)가
 * 증가시키고, 반환된 cleanup이 감소시킨다. 호스트 back 메시지 처리 시 인터셉트
 * 여부를 판단하는 데 쓰인다.
 *
 * @internal 테스트 및 safe-area-bridge에서만 사용.
 */
let _backEventSubscriberCount = 0;

export const graniteEvent = {
  addEventListener<K extends keyof GraniteEvent>(
    event: K,
    {
      onEvent,
      onError,
    }: {
      onEvent: GraniteEvent[K]['onEvent'];
      onError?: GraniteEvent[K]['onError'];
      options?: GraniteEvent[K]['options'];
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

    // backEvent 구독자 카운터 관리
    if (event === 'backEvent') {
      _backEventSubscriberCount++;
    }

    let cleaned = false;
    return () => {
      if (cleaned) return; // 이중 호출 방지
      cleaned = true;
      window.removeEventListener(`__ait:${event}`, handler);
      if (event === 'backEvent') {
        _backEventSubscriberCount--;
      }
    };
  },
};

/**
 * 호스트 back 내비게이션을 처리한다.
 *
 * backEvent 구독자가 1명 이상이면 `window.dispatchEvent(new CustomEvent('__ait:backEvent'))`만
 * 발사한다 — 미니앱이 back을 가로채는(intercept) 채널이고 실제 토스 호스트와 동일한 시맨틱.
 * 구독자가 없으면 `history.back()`을 호출해 기본 브라우저 뒤로가기를 수행한다.
 *
 * env 1 패널의 back 버튼(`src/panel/viewport.ts` `aitState.trigger('backEvent')`)과
 * 동일한 경로를 거쳐 back 시맨틱의 단일 소유처를 navigation 모듈에 유지한다.
 */
export function dispatchHostBackNavigation(): void {
  if (_backEventSubscriberCount > 0) {
    window.dispatchEvent(new CustomEvent('__ait:backEvent'));
  } else {
    history.back();
  }
}

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

export const tdsEvent = {
  addEventListener<K extends keyof TdsEvent>(
    event: K,
    {
      onEvent,
    }: {
      onEvent: TdsEvent[K]['onEvent'];
      onError?: TdsEvent[K]['onError'];
      options?: TdsEvent[K]['options'];
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

/**
 * @deprecated web-framework 3.0 에서 제거됨. 2.x 소비자 back-compat용으로 유지.
 */
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

/**
 * @deprecated `SafeAreaInsets.get()`을 쓸 것.
 *
 * 상류 SDK의 타입 선언은 `getSafeAreaInsets(): number`지만, 실기기(2.x×iOS)
 * capture는 이 함수가 숫자가 아니라 `SafeAreaInsets.get()`과 같은 객체
 * (`{ top, right, bottom, left }`)를 반환함을 보였다(devtools#770 —
 * `returnType: "object"`, `valueKeys: ["top","right","bottom","left"]`).
 * 즉 선언과 런타임이 어긋나 있는 상류 타입 버그다.
 *
 * mock은 타입 선언이 아니라 **런타임 실측**을 재현해야 개발자가 env1에서 겪는
 * 동작이 실기기와 같아진다. 그래서 시그니처는 상류와 동일하게 `number`로 두되
 * (`__typecheck.ts`가 SDK 타입에 대해 계속 컴파일되도록) 반환값만 실측 객체로
 * 캐스트한다 — Analytics·setClipboardText·Storage와 같은 처리(#775).
 */
export function getSafeAreaInsets(): number {
  return { ...aitState.state.safeAreaInsets } as unknown as number;
}
