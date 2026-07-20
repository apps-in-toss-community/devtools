/**
 * @ait-co/devtools 중앙 상태 관리
 * DevTools Panel과 mock 구현체가 이 상태를 공유한다.
 */

import type { AitSdkCall } from '../mcp/ait-source.js';
import type { NativeErrorCode } from './native-error.js';
import type {
  AnalyticsLogEntry,
  DeviceModes,
  IapNextResult,
  MockContact,
  MockData,
  MockIapProduct,
  MockLocation,
  NetworkStatus,
  NotificationAgreementResult,
  OperationalEnvironment,
  PermissionName,
  PermissionStatus,
  PlatformOS,
  SafeAreaInsets,
  ViewportState,
} from './types.js';

export type { AitSdkCall, AitSdkCallFidelity } from '../mcp/ait-source.js';
export type { NativeErrorCode, NativeErrorEnvelope } from './native-error.js';
export type {
  AitNavBarType,
  AnalyticsLogEntry,
  AppOrientation,
  DeviceApiMode,
  DeviceModes,
  HapticFeedbackType,
  IapNextResult,
  LandscapeSide,
  LocationCoords,
  MockContact,
  MockData,
  MockIapProduct,
  MockLocation,
  NetworkStatus,
  NotchType,
  NotificationAgreementResult,
  OperationalEnvironment,
  PermissionName,
  PermissionStatus,
  PlatformOS,
  SafeAreaInsets,
  SafeAreaProvenance,
  ViewportOrientation,
  ViewportPreset,
  ViewportPresetId,
  ViewportState,
} from './types.js';

type Listener = () => void;

/** SDK 호출 로그 ring buffer 상한 */
const SDK_CALL_LOG_MAX = 200;

export interface AitDevtoolsState {
  // 환경
  platform: PlatformOS;
  environment: OperationalEnvironment;
  appVersion: string;
  locale: string;
  schemeUri: string;
  groupId: string;
  deploymentId: string;
  deviceId: string;

  // 브랜드
  brand: {
    displayName: string;
    icon: string;
    primaryColor: string;
  };

  // 네트워크
  networkStatus: NetworkStatus;

  // 네비게이션 동작 — real은 native bridge로 발화하는 no-op API들의 마지막 호출값을
  // 관측 가능한 state로 mirror (real ground-truth: devtools#171 on-device relay).
  // null = 앱이 아직 호출 안 함(real 기본 동작 = iOS 엣지 스와이프 뒤로가기 enabled).
  navigation: {
    iosSwipeGestureEnabled: boolean | null;
  };

  // 권한
  permissions: Record<PermissionName, PermissionStatus>;

  // 위치
  location: MockLocation;

  // Safe Area
  safeAreaInsets: SafeAreaInsets;

  // 연락처
  contacts: MockContact[];

  // IAP
  iap: {
    products: MockIapProduct[];
    nextResult: IapNextResult;
    pendingOrders: Array<{ orderId: string; sku: string; paymentCompletedDate: string }>;
    completedOrders: Array<{
      orderId: string;
      sku: string;
      status: 'COMPLETED' | 'REFUNDED';
      date: string;
    }>;
  };

  // 결제 (TossPay)
  payment: {
    nextResult: 'success' | 'fail';
    failReason: string;
  };

  // 로그인
  auth: {
    isLoggedIn: boolean;
    isTossLoginIntegrated: boolean;
    userKeyHash: string;
    anonymousKeyHash: string;
  };

  // 알림
  notification: {
    nextResult: NotificationAgreementResult;
  };

  // 광고
  ads: {
    isLoaded: boolean;
    nextEvent:
      | 'loaded'
      | 'clicked'
      | 'dismissed'
      | 'failedToShow'
      | 'impression'
      | 'userEarnedReward';
    forceNoFill: boolean;
    lastEvent: { type: string; timestamp: number } | null;
    /** AdMob reward 단위 타입 (기본: 'coins') */
    rewardUnitType: string;
    /** AdMob reward 단위 수량 (기본: 10) */
    rewardAmount: number;
  };

  // 게임
  game: {
    profile: { nickname: string; profileImageUri: string } | null;
    leaderboardScores: Array<{ score: string; timestamp: number }>;
  };

  // 분석 로그
  analyticsLog: AnalyticsLogEntry[];

  // SDK 호출 로그 (ring buffer, 상한 SDK_CALL_LOG_MAX)
  sdkCallLog: AitSdkCall[];

  // 디바이스 API 모드
  deviceModes: DeviceModes;

  // mock 모드용 더미 데이터
  mockData: MockData;

  // mock 활성화 상태
  panelEditable: boolean;

  // 뷰포트 시뮬레이션 (devtools 전용, SDK와 무관)
  viewport: ViewportState;

  // 실패-모드 다이얼 (devtools#770) — env1이 env3의 프로비저닝-의존 reject를
  // 재현하도록 per-API 실패 코드를 프로그래매틱하게 설정한다. 패널 UI 노출은
  // 범위 밖(1차는 aitState.patch 표면만). 값이 없는 API는 기존처럼 낙관적으로
  // resolve — 다이얼 미사용 시 zero behavior change.
  failureModes: FailureModes;
}

/**
 * per-API 실패 코드 다이얼. 값이 설정된 API만 mock이 reject하고, 나머지는
 * 기존 낙관적 resolve를 유지한다. `sdkLine`은 envelope shape 분기 축 —
 * `'2.x'`(기본)는 native envelope(`{name,code,userInfo,moduleName,__isError}`),
 * `'3.x'`는 맨 Error로 평탄화(sdk-example#284 매트릭스 "패턴 ① envelope 평탄화").
 */
export interface FailureModes {
  /** 네이티브 실패 envelope의 라인 축. 기본 '2.x'. */
  sdkLine: '2.x' | '3.x';
  /** appLogin 실패 코드 (예: 'APP_LOGIN'). 미설정 시 기존처럼 항상 resolve. */
  appLogin?: NativeErrorCode;
  /** GoogleAdMob.loadAppsInTossAdMob 실패 코드 (예: 'PLACEMENT_ID_FETCH_FAILED'). */
  loadAdMob?: NativeErrorCode;
  /** loadFullScreenAd 실패 코드 (예: 'EXECUTION_ERROR'). */
  loadFullScreenAd?: NativeErrorCode;
  /**
   * getIsTossLoginIntegratedService 실패 코드 (devtools#783 실측: env3 run11,
   * 2.x/iOS `A1-awaited-is-boolean` 시나리오 — rejected/`Error`/`EXECUTION_ERROR`).
   */
  getIsTossLoginIntegratedService?: NativeErrorCode;
  /**
   * requestNotificationAgreement 실패 코드 (devtools#783 실측: env3 run11,
   * 2.x/iOS `happy-force-*`/`A1-empty-templateCode` 시나리오 전부 —
   * rejected/`Error`/`4000`).
   */
  requestNotificationAgreement?: NativeErrorCode;
  /**
   * 권한 이름별 실패 코드 (devtools#783 실측: env3 run11, 2.x/iOS
   * `permissions.ait.test.ts` PERMISSION_NAMES 순회 — `geolocation`/`camera`/
   * `microphone`만 rejected/`Error`/`NO_PERMISSION`, `clipboard`/`contacts`/
   * `photos`는 resolved. 31146의 `granite.config.ts`가 `permissions: []`라
   * 선언 안 된 권한만 거부되는 그림과 정합 — 전역 on/off가 아니라 이름 단위 맵.
   * 설정된 이름만 reject, 나머지는 기존대로 resolve.
   */
  getPermission?: Partial<Record<PermissionName, NativeErrorCode>>;

  /**
   * soft-resolve 다이얼 (#789) — reject가 아니라 "다른 shape로 resolve"하는 env3
   * 프로비저닝-의존 실패를 재현한다. 켠 API만 실측 대체 shape로 resolve하고, 미설정
   * API는 선언 타입대로 성공 shape를 유지한다(다이얼 미사용 시 zero behavior change).
   * shape는 API별 고정(env3 run11 2.x/iOS 실측 — valueKeys만 실측, 문자열 내용은 예시):
   *   grantPromotionReward/grantPromotionRewardForGame → { errorCode, message }
   *   getSubscriptionInfo → {}
   *   checkoutPayment/requestTossPayPaysBilling → { false, reason } (valueKeys=['false','reason'])
   * payment shape의 리터럴 `false` 키가 하네스 artifact가 아니라 실기기 WebView 관측값임은
   * 코드로 확정됐다(sdk-example#303: capture는 relay 개입 전 WebView 안에서 계산 — 아래
   * checkoutPayment 항목 주석). #303/#789.
   */
  softResolve?: {
    grantPromotionReward?: boolean;
    grantPromotionRewardForGame?: boolean;
    getSubscriptionInfo?: boolean;
    /**
     * checkoutPayment/requestTossPayPaysBilling → `{ false: …, reason: … }`
     * (valueKeys=['false','reason'], booleanValues=null). env3 run11 실측 shape로,
     * 리터럴 `false` 키는 실기기 WebView가 실제로 관측한 형태다 — capture는 WebView
     * 안에서 `Object.keys(value)`로 계산돼 console 문자열로 나오므로(devtools#696
     * capture.ts) 우리 CDP relay가 개입하기 전이다. 즉 relay 역직렬화 artifact가 아니라
     * 모든 WebView 소비자가 보는 shape다(sdk-example#303 진단 결론). 성공 분기 기본값
     * ({ success: true })은 그대로 두고, 미프로비저닝 실패 재현만 다이얼에 붙인다.
     */
    checkoutPayment?: boolean;
    requestTossPayPaysBilling?: boolean;
  };
}

const DEFAULT_STATE: AitDevtoolsState = {
  platform: 'ios',
  environment: 'sandbox',
  appVersion: '5.240.0',
  locale: 'ko-KR',
  schemeUri: '/',
  groupId: 'mock-group-id',
  deploymentId: 'mock-deployment-id',
  deviceId: '',

  brand: {
    displayName: 'Mock App',
    icon: '',
    primaryColor: '#3182F6',
  },

  networkStatus: 'WIFI',

  // null = 앱이 setIosSwipeGestureEnabled를 아직 호출 안 함.
  navigation: {
    iosSwipeGestureEnabled: null,
  },

  permissions: {
    clipboard: 'allowed',
    contacts: 'allowed',
    photos: 'allowed',
    geolocation: 'allowed',
    camera: 'allowed',
    microphone: 'notDetermined',
  },

  location: {
    coords: {
      latitude: 37.5665,
      longitude: 126.978,
      altitude: 0,
      accuracy: 10,
      altitudeAccuracy: 0,
      heading: 0,
    },
    timestamp: Date.now(),
    accessLocation: 'FINE',
  },

  // iPhone 15 Pro relay 실측값(devtools#190)과 정합: partner WebView portrait에서
  // SafeAreaInsets.get()이 반환한 top=54(토스 nav bar 높이), bottom=34(home indicator).
  // env(safe-area-inset-top)는 0이었으므로 OS 노치는 이 top에 들어가지 않는다.
  // preset이 'none'/'custom'이면 syncSafeAreaFromViewport가 건드리지 않으므로 이 값이
  // SafeAreaInsets.get()의 out-of-box 계약값으로 남는다. preset을 고르면 그 값으로 sync됨.
  safeAreaInsets: { top: 54, bottom: 34, left: 0, right: 0 },

  contacts: [
    { name: '홍길동', phoneNumber: '010-1234-5678' },
    { name: '김토스', phoneNumber: '010-9876-5432' },
  ],

  iap: {
    products: [
      {
        sku: 'mock-gem-100',
        type: 'CONSUMABLE',
        displayName: '보석 100개',
        displayAmount: '1,000원',
        iconUrl: '',
        description: '게임에서 사용할 수 있는 보석 100개',
      },
    ],
    nextResult: 'success',
    pendingOrders: [],
    completedOrders: [],
  },

  payment: {
    nextResult: 'success',
    failReason: '',
  },

  auth: {
    isLoggedIn: true,
    isTossLoginIntegrated: true,
    userKeyHash: 'mock-user-hash-abc123',
    anonymousKeyHash: 'mock-anon-hash-xyz789',
  },

  notification: {
    nextResult: 'newAgreement',
  },

  ads: {
    isLoaded: false,
    nextEvent: 'loaded',
    forceNoFill: false,
    lastEvent: null,
    rewardUnitType: 'coins',
    rewardAmount: 10,
  },

  game: {
    profile: { nickname: 'MockPlayer', profileImageUri: '' },
    leaderboardScores: [],
  },

  analyticsLog: [],

  sdkCallLog: [],

  deviceModes: {
    camera: 'mock',
    photos: 'mock',
    location: 'mock',
    network: 'mock',
    // 'mock' so the clipboard mock is self-contained. With 'web' the mock
    // calls `navigator.clipboard.readText()` directly, which — when paired
    // with `@ait-co/polyfill` — recurses: polyfill routes `navigator.clipboard`
    // back to the SDK's `getClipboardText`, which is this mock, which calls
    // `navigator.clipboard.readText`, … Users who want true browser
    // clipboard integration can flip this to 'web' from the panel.
    clipboard: 'mock',
  },

  mockData: {
    images: [],
    clipboardText: '',
  },

  panelEditable: true,

  viewport: {
    preset: 'none',
    orientation: 'auto',
    appOrientation: null,
    customWidth: 402,
    customHeight: 874,
    frame: false,
    aitNavBar: true,
    aitNavBarType: 'partner',
  },

  // 다이얼 전부 미설정 = 기존 낙관적 resolve 그대로 (zero behavior change).
  failureModes: {
    sdkLine: '2.x',
  },
};

function generateDeviceId(): string {
  const stored = localStorage.getItem('__ait_device_id');
  if (stored) return stored;
  const id = crypto.randomUUID();
  localStorage.setItem('__ait_device_id', id);
  return id;
}

export class AitStateManager {
  private _state: AitDevtoolsState;
  private _listeners = new Set<Listener>();
  private _inTransaction = false;

  constructor() {
    this._state = structuredClone(DEFAULT_STATE);
    try {
      this._state.deviceId = generateDeviceId();
    } catch {
      this._state.deviceId = `mock-device-${Math.random().toString(36).slice(2)}`;
    }
  }

  get state(): AitDevtoolsState {
    return this._state;
  }

  update(partial: Partial<AitDevtoolsState>) {
    this._state = { ...this._state, ...partial };
    this._notify();
  }

  /** 중첩 객체 업데이트용 */
  patch<K extends keyof AitDevtoolsState>(key: K, partial: Partial<AitDevtoolsState[K]>) {
    const current = this._state[key];
    if (typeof current === 'object' && current !== null && !Array.isArray(current)) {
      this._state = {
        ...this._state,
        [key]: { ...(current as Record<string, unknown>), ...(partial as Record<string, unknown>) },
      };
    } else {
      this._state = { ...this._state, [key]: partial as AitDevtoolsState[K] };
    }
    this._notify();
  }

  subscribe(listener: Listener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /**
   * 한 묶음의 update/patch 호출을 묶어 listener notify 1회로 만든다.
   * preset 적용처럼 여러 슬라이스를 동시에 바꿀 때 panel re-render 폭주를
   * 방지한다. 중첩 호출은 outermost transaction이 끝날 때 한 번만 notify
   * (inner도 throw해도 outer finally가 flag를 복구한다).
   *
   * Rollback은 없다 — `fn`이 throw해도 그때까지의 state 변경은 유지된다.
   * 구독자가 partial state를 영원히 못 보는 사고를 막기 위해, throw 여부와
   * 무관하게 항상 한 번 notify한 뒤 throw를 propagate한다. DB transaction이
   * 아니라 "여러 mutation을 한 notify로 묶는 batch"라고 생각하면 된다.
   *
   * Listener는 throw해선 안 된다 — finally 안의 `_notify()`가 throw하면 원래
   * `fn`의 throw를 덮어버린다. 우리 구독자는 panel re-render뿐이라 실제
   * 발생 사례는 없지만, 외부에서 listener를 등록할 때 주의.
   */
  transaction(fn: () => void): void {
    if (this._inTransaction) {
      fn();
      return;
    }
    this._inTransaction = true;
    try {
      fn();
    } finally {
      this._inTransaction = false;
      this._notify();
    }
  }

  /** 분석 로그 추가 */
  logAnalytics(entry: Omit<AnalyticsLogEntry, 'timestamp'>) {
    this._state = {
      ...this._state,
      analyticsLog: [...this._state.analyticsLog, { ...entry, timestamp: Date.now() }],
    };
    this._notify();
  }

  /**
   * SDK 호출 로그 추가 (ring buffer, 상한 SDK_CALL_LOG_MAX).
   * `observe()`가 호출하고, proxy의 KNOWN_UNIMPLEMENTED 경로도 직접 호출한다.
   */
  logSdkCall(entry: AitSdkCall) {
    const log = this._state.sdkCallLog;
    const next = log.length >= SDK_CALL_LOG_MAX ? log.slice(1 - SDK_CALL_LOG_MAX) : log;
    this._state = { ...this._state, sdkCallLog: [...next, entry] };
    this._notify();
  }

  /** 이벤트 트리거 (backEvent, homeEvent 등) */
  trigger(event: string) {
    window.dispatchEvent(new CustomEvent(`__ait:${event}`));
  }

  reset() {
    const deviceId = this._state.deviceId;
    this._state = { ...structuredClone(DEFAULT_STATE), deviceId };
    this._notify();
  }

  private _notify() {
    if (this._inTransaction) return;
    for (const listener of this._listeners) {
      listener();
    }
  }
}

// `tsdown.config.ts`는 mock/panel/unplugin entry를 별도 config object로 빌드한다
// ("every entry is self-contained"). 그 결과 소비자가 두 entry(예: `@ait-co/devtools` +
// `@ait-co/devtools/panel`)를 동시에 import하면 `state.ts`가 entry별로 따로 번들되어
// `AitStateManager` 인스턴스가 entry당 1개씩 만들어진다. panel이 toggle한 state는
// mock SDK가 보는 state와 다른 인스턴스가 되어 모든 토글이 비기능이 된다.
//
// build pipeline을 건드리지 않고 runtime guard로 해결한다: globalThis에 인스턴스를
// 캐시해 같은 페이지의 모든 entry가 동일 인스턴스를 공유하도록 한다.
const SINGLETON_KEY = '__aitDevtoolsStateSingleton__';
type GlobalWithSingleton = typeof globalThis & { [SINGLETON_KEY]?: AitStateManager };
const globalRef = globalThis as GlobalWithSingleton;
if (!globalRef[SINGLETON_KEY]) {
  globalRef[SINGLETON_KEY] = new AitStateManager();
}
export const aitState: AitStateManager = globalRef[SINGLETON_KEY]!;

// 브라우저 콘솔에서 접근 가능하도록
if (typeof window !== 'undefined') {
  window.__ait = aitState;
}
