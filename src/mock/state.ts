/**
 * ait-devtools 중앙 상태 관리
 * DevTools Panel과 mock 구현체가 이 상태를 공유한다.
 */

export type PlatformOS = 'ios' | 'android';
export type OperationalEnvironment = 'toss' | 'sandbox';
export type NetworkStatus = 'OFFLINE' | 'WIFI' | '2G' | '3G' | '4G' | '5G' | 'WWAN' | 'UNKNOWN';
export type PermissionStatus = 'notDetermined' | 'denied' | 'allowed';
export type PermissionName = 'clipboard' | 'contacts' | 'photos' | 'geolocation' | 'camera' | 'microphone';
export type HapticFeedbackType = 'tickWeak' | 'tap' | 'tickMedium' | 'softMedium' | 'basicWeak' | 'basicMedium' | 'success' | 'error' | 'wiggle' | 'confetti';

export type DeviceApiMode = 'mock' | 'web' | 'prompt';

export interface DeviceModes {
  camera: DeviceApiMode;
  photos: DeviceApiMode;
  location: DeviceApiMode;
  network: DeviceApiMode;
  clipboard: DeviceApiMode;
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

export type IapNextResult = 'success' | 'USER_CANCELED' | 'INVALID_PRODUCT_ID' | 'PAYMENT_PENDING' | 'NETWORK_ERROR' | 'ITEM_ALREADY_OWNED' | 'INTERNAL_ERROR';

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

type Listener = () => void;

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
    completedOrders: Array<{ orderId: string; sku: string; status: 'COMPLETED' | 'REFUNDED'; date: string }>;
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
  };

  // 광고
  ads: {
    isLoaded: boolean;
    nextEvent: 'loaded' | 'clicked' | 'dismissed' | 'failedToShow' | 'impression' | 'userEarnedReward';
  };

  // 게임
  game: {
    profile: { nickname: string; profileImageUri: string } | null;
    leaderboardScores: Array<{ score: string; timestamp: number }>;
  };

  // 분석 로그
  analyticsLog: AnalyticsLogEntry[];

  // 디바이스 API 모드
  deviceModes: DeviceModes;

  // mock 모드용 더미 데이터
  mockData: MockData;
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

  safeAreaInsets: { top: 47, bottom: 34, left: 0, right: 0 },

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
  },

  ads: {
    isLoaded: false,
    nextEvent: 'loaded',
  },

  game: {
    profile: { nickname: 'MockPlayer', profileImageUri: '' },
    leaderboardScores: [],
  },

  analyticsLog: [],

  deviceModes: {
    camera: 'mock',
    photos: 'mock',
    location: 'mock',
    network: 'mock',
    clipboard: 'web',
  },

  mockData: {
    images: [],
    clipboardText: '',
  },
};

function generateDeviceId(): string {
  const stored = localStorage.getItem('__ait_device_id');
  if (stored) return stored;
  const id = crypto.randomUUID();
  localStorage.setItem('__ait_device_id', id);
  return id;
}

class AitStateManager {
  private _state: AitDevtoolsState;
  private _listeners = new Set<Listener>();

  constructor() {
    this._state = structuredClone(DEFAULT_STATE);
    try {
      this._state.deviceId = generateDeviceId();
    } catch {
      this._state.deviceId = 'mock-device-' + Math.random().toString(36).slice(2);
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
  patch<K extends keyof AitDevtoolsState>(
    key: K,
    partial: Partial<AitDevtoolsState[K]>,
  ) {
    const current = this._state[key];
    if (typeof current === 'object' && current !== null && !Array.isArray(current)) {
      this._state = { ...this._state, [key]: { ...(current as Record<string, unknown>), ...(partial as Record<string, unknown>) } };
    } else {
      this._state = { ...this._state, [key]: partial as AitDevtoolsState[K] };
    }
    this._notify();
  }

  subscribe(listener: Listener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  /** 분석 로그 추가 */
  logAnalytics(entry: Omit<AnalyticsLogEntry, 'timestamp'>) {
    this._state = {
      ...this._state,
      analyticsLog: [...this._state.analyticsLog, { ...entry, timestamp: Date.now() }],
    };
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
    for (const listener of this._listeners) {
      listener();
    }
  }
}

export const aitState = new AitStateManager();

// 브라우저 콘솔에서 접근 가능하도록
if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__ait = aitState;
}
