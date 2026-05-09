/**
 * Mock state preset library.
 *
 * 자주 쓰는 QA 시나리오(권한 거부, 오프라인, 미로그인 등)를 한 클릭으로 적용할 수 있는
 * preset 정의 + apply 유틸. 토글 한 번에 여러 mock 키가 동시에 일정 상태가 되어야 하는
 * 경우 매번 손으로 맞추는 번잡함을 제거한다.
 *
 * Preset state는 `aitState`의 일부만 다룬다 — preset이 어떤 키도 건드리지 않으면 해당
 * 키는 현재 값을 유지한다. forward-compat: schema 외 키가 들어와도 무시된다.
 */

import type { AitDevtoolsState } from './state.js';
import { aitState } from './state.js';

/**
 * Preset이 덮어쓸 수 있는 mock state slice. 모든 키는 optional —
 * 한 preset이 모든 분야를 정의할 필요 없다.
 *
 * 일부러 좁게 잡았다: viewport / brand / mockData / analyticsLog 등 QA 시나리오와
 * 직접 관련 없는 영역은 preset 대상에서 제외한다 (preset 적용으로 unrelated state가
 * 흔들리는 사고 방지). 필요해지면 추가.
 *
 * `iap` slice는 일부러 `nextResult`만 노출한다 — products / pendingOrders /
 * completedOrders는 array/object 비교가 까다롭고 QA 시나리오에서 강제할 일이 거의
 * 없다. `captureCurrentState` / `matchesPreset` 의 iap 처리 범위와 동기화.
 */
export interface MockPresetState {
  networkStatus?: AitDevtoolsState['networkStatus'];
  permissions?: Partial<AitDevtoolsState['permissions']>;
  auth?: Partial<AitDevtoolsState['auth']>;
  iap?: { nextResult?: AitDevtoolsState['iap']['nextResult'] };
  ads?: Partial<AitDevtoolsState['ads']>;
  payment?: Partial<AitDevtoolsState['payment']>;
}

export interface MockPreset {
  id: string;
  label: string;
  description?: string;
  state: MockPresetState;
}

export const builtInPresets: readonly MockPreset[] = [
  {
    id: 'all-allowed',
    label: 'All allowed (default-ish)',
    description: '모든 권한 허용, WIFI, 로그인됨, IAP success',
    state: {
      networkStatus: 'WIFI',
      permissions: {
        camera: 'allowed',
        photos: 'allowed',
        geolocation: 'allowed',
        clipboard: 'allowed',
        contacts: 'allowed',
        microphone: 'allowed',
      },
      auth: { isLoggedIn: true },
      iap: { nextResult: 'success' },
      ads: { forceNoFill: false },
      payment: { nextResult: 'success', failReason: '' },
    },
  },
  {
    id: 'permission-denied',
    label: 'Permissions denied',
    description: 'camera / photos / geolocation / contacts 거부',
    state: {
      permissions: {
        camera: 'denied',
        photos: 'denied',
        geolocation: 'denied',
        contacts: 'denied',
      },
    },
  },
  {
    id: 'offline',
    label: 'Offline',
    description: 'getNetworkStatus → OFFLINE, IAP NETWORK_ERROR',
    state: {
      networkStatus: 'OFFLINE',
      iap: { nextResult: 'NETWORK_ERROR' },
      payment: { nextResult: 'fail', failReason: 'NETWORK_ERROR' },
    },
  },
  {
    id: 'logged-out',
    label: 'Logged out',
    description: 'auth.isLoggedIn=false. login flow 검증용',
    state: {
      auth: { isLoggedIn: false },
    },
  },
  {
    id: 'iap-pending',
    label: 'IAP payment pending',
    description: '결제 진행 중 분기 검증',
    state: {
      iap: { nextResult: 'PAYMENT_PENDING' },
    },
  },
  {
    id: 'ads-no-fill',
    label: 'Ads — no fill',
    description: '광고 fill 실패 분기 검증',
    state: {
      networkStatus: 'WIFI',
      ads: { forceNoFill: true },
    },
  },
];

/**
 * Preset의 nested slice를 검증된 키만 골라서 풀어낸다. Forward-compat 차원에서
 * 알지 못하는 키는 drop, drop된 키 전부를 모아 한 번에 warn한다.
 *
 * Value 단위 검증은 하지 않는다 — `permissions.camera`에 enum 외 값이 들어와도
 * 그대로 통과한다. mock state라 잘못된 값은 mock 함수 분기 결과만 흔든다.
 * 새 enum 값이 추가됐을 때 저장된 preset을 reject하지 않으려는 의도.
 */
function pickKnownKeys<T extends object>(
  input: unknown,
  allowed: readonly (keyof T)[],
): Partial<T> {
  if (typeof input !== 'object' || input === null) return {};
  const out: Partial<T> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(input)) {
    if ((allowed as readonly string[]).includes(key)) {
      (out as Record<string, unknown>)[key] = value;
    } else {
      dropped.push(key);
    }
  }
  if (dropped.length > 0) {
    console.warn(`[@ait-co/devtools] Preset dropped unknown keys: ${dropped.join(', ')}`);
  }
  return out;
}

const PERMISSION_KEYS = [
  'camera',
  'photos',
  'geolocation',
  'clipboard',
  'contacts',
  'microphone',
] as const;
const AUTH_KEYS = ['isLoggedIn', 'isTossLoginIntegrated', 'userKeyHash'] as const;
const IAP_KEYS = ['nextResult'] as const;
const ADS_KEYS = ['isLoaded', 'nextEvent', 'forceNoFill', 'lastEvent'] as const;
const PAYMENT_KEYS = ['nextResult', 'failReason'] as const;

/**
 * Preset state를 현재 `aitState`에 적용한다. 정의된 키만 덮어쓰고, 알지 못하는 키는
 * 조용히 drop한다 (한 번 warn). 여러 슬라이스를 적용해도 listener notify는 한 번이다
 * (`aitState.transaction` 사용 — panel re-render 폭주 방지).
 */
export function applyPreset(state: MockPresetState): void {
  aitState.transaction(() => {
    if (state.networkStatus !== undefined) {
      aitState.update({ networkStatus: state.networkStatus });
    }
    if (state.permissions !== undefined) {
      aitState.patch(
        'permissions',
        pickKnownKeys<AitDevtoolsState['permissions']>(state.permissions, PERMISSION_KEYS),
      );
    }
    if (state.auth !== undefined) {
      aitState.patch('auth', pickKnownKeys<AitDevtoolsState['auth']>(state.auth, AUTH_KEYS));
    }
    if (state.iap !== undefined) {
      const picked = pickKnownKeys<{ nextResult: AitDevtoolsState['iap']['nextResult'] }>(
        state.iap,
        IAP_KEYS,
      );
      aitState.patch('iap', picked);
    }
    if (state.ads !== undefined) {
      aitState.patch('ads', pickKnownKeys<AitDevtoolsState['ads']>(state.ads, ADS_KEYS));
    }
    if (state.payment !== undefined) {
      aitState.patch(
        'payment',
        pickKnownKeys<AitDevtoolsState['payment']>(state.payment, PAYMENT_KEYS),
      );
    }
  });
}

/**
 * Preset의 모든 정의된 슬라이스가 현재 state와 일치하는지 검사. UI에서 dirty
 * indicator를 그릴 때 쓴다.
 *
 * 일치한다 = preset이 정의한 키 전부가 그대로다. preset이 정의하지 않은 키는
 * 비교 대상이 아니다 — preset은 partial이므로 다른 토글이 바뀌어도 dirty가 아니다.
 */
export function matchesPreset(snapshot: AitDevtoolsState, preset: MockPresetState): boolean {
  if (preset.networkStatus !== undefined && snapshot.networkStatus !== preset.networkStatus) {
    return false;
  }
  if (preset.permissions !== undefined) {
    for (const k of PERMISSION_KEYS) {
      const want = preset.permissions[k];
      if (want !== undefined && snapshot.permissions[k] !== want) return false;
    }
  }
  if (preset.auth !== undefined) {
    for (const k of AUTH_KEYS) {
      const want = preset.auth[k];
      if (want !== undefined && snapshot.auth[k] !== want) return false;
    }
  }
  if (preset.iap !== undefined) {
    if (preset.iap.nextResult !== undefined && snapshot.iap.nextResult !== preset.iap.nextResult) {
      return false;
    }
  }
  if (preset.ads !== undefined) {
    if (preset.ads.forceNoFill !== undefined && snapshot.ads.forceNoFill !== preset.ads.forceNoFill)
      return false;
    if (preset.ads.isLoaded !== undefined && snapshot.ads.isLoaded !== preset.ads.isLoaded)
      return false;
    if (preset.ads.nextEvent !== undefined && snapshot.ads.nextEvent !== preset.ads.nextEvent)
      return false;
  }
  if (preset.payment !== undefined) {
    for (const k of PAYMENT_KEYS) {
      const want = preset.payment[k];
      if (want !== undefined && snapshot.payment[k] !== want) return false;
    }
  }
  return true;
}

/**
 * 현재 state에서 preset에 저장할 만한 슬라이스를 추출. "save current as preset"에서 쓴다.
 */
export function captureCurrentState(snapshot: AitDevtoolsState): MockPresetState {
  return {
    networkStatus: snapshot.networkStatus,
    permissions: { ...snapshot.permissions },
    auth: {
      isLoggedIn: snapshot.auth.isLoggedIn,
      isTossLoginIntegrated: snapshot.auth.isTossLoginIntegrated,
      userKeyHash: snapshot.auth.userKeyHash,
    },
    iap: { nextResult: snapshot.iap.nextResult },
    ads: {
      forceNoFill: snapshot.ads.forceNoFill,
      isLoaded: snapshot.ads.isLoaded,
      nextEvent: snapshot.ads.nextEvent,
    },
    payment: { ...snapshot.payment },
  };
}
