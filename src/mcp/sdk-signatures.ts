/**
 * call_sdk 인자 시그니처 레지스트리
 *
 * 잘 알려진 SDK 메서드의 인자 schema를 수동으로 등록한다.
 * 목적: 잘못된 인자가 native bridge에 도달하기 전에 MCP 레이어에서 reject하여
 * 토스 앱 crash(Swift/Kotlin 측에서 `.type` 등을 undefined로 읽는 경우)를 예방.
 *
 * 등록되지 않은 메서드는 passthrough — 알 수 없는 메서드에 대해 stderr 경고 1회.
 *
 * 시그니처 출처:
 *   - `src/__typecheck.ts` — Original SDK 타입 호환성 검증
 *   - `src/mock/navigation/index.ts` — mock 구현의 함수 시그니처
 *   - `src/mock/device/` — device mock 시그니처
 *
 * 새 메서드 추가 방법:
 *   1. `src/__typecheck.ts` 또는 mock 구현에서 시그니처 확인
 *   2. 아래 SIGNATURES 배열에 `SdkSignature` 항목 추가
 *   3. `src/__tests__/call-sdk-validation.test.ts`에 ok + bad 케이스 추가
 */

/** 단일 메서드에 대한 인자 검증 결과 */
export type ValidationResult = { ok: true } | { ok: false; expected: string; received: string };

/** 등록된 SDK 메서드 시그니처 */
export interface SdkSignature {
  /** SDK 메서드 이름 (예: "setDeviceOrientation") */
  name: string;
  /**
   * 인자 배열을 검증하는 함수.
   * `args[0]` 등 필요한 인자를 `unknown` 타입으로 받아 type guard로 검증.
   */
  validateArgs(args: unknown[]): ValidationResult;
  /**
   * 에러 메시지에 포함할 올바른 호출 예시.
   * 예: `call_sdk('setDeviceOrientation', [{ type: 'landscape' }])`
   */
  example: string;
}

/* -------------------------------------------------------------------------- */
/* 헬퍼 — 공통 type guard                                                      */
/* -------------------------------------------------------------------------- */

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function describeArgs(args: unknown[]): string {
  try {
    return JSON.stringify(args);
  } catch {
    return String(args);
  }
}

/* -------------------------------------------------------------------------- */
/* 시그니처 레지스트리                                                           */
/* -------------------------------------------------------------------------- */

/**
 * 등록된 메서드 목록.
 *
 * 시그니처 출처 확인:
 *   - 함수가 인자를 받지 않으면 args[0] 없음 → `args.length === 0`을 체크하지 않고
 *     그냥 통과시킨다(args 무시하는 stub가 많아서 noArgs 체크가 noise).
 *   - 실 SDK 시그니처는 `src/__typecheck.ts`의 `Assert<Mock, Original>` 줄로 보장.
 */
const SIGNATURES: SdkSignature[] = [
  // --- setDeviceOrientation ---
  // 실 시그니처: setDeviceOrientation(options: { type: 'portrait' | 'landscape' }): Promise<void>
  // 출처: src/mock/navigation/index.ts:40 / src/__typecheck.ts:55
  {
    name: 'setDeviceOrientation',
    validateArgs(args) {
      const arg = args[0];
      if (!isObject(arg)) {
        return {
          ok: false,
          expected: "{ type: 'portrait' | 'landscape' }",
          received: describeArgs(args),
        };
      }
      const type = arg.type;
      if (type !== 'portrait' && type !== 'landscape') {
        return {
          ok: false,
          expected: "{ type: 'portrait' | 'landscape' }",
          received: describeArgs(args),
        };
      }
      return { ok: true };
    },
    example: "call_sdk('setDeviceOrientation', [{ type: 'landscape' }])",
  },

  // --- setIosSwipeGestureEnabled ---
  // 실 시그니처: setIosSwipeGestureEnabled(options: { isEnabled: boolean }): Promise<void>
  // 출처: src/mock/navigation/index.ts:32 / src/__typecheck.ts:51
  {
    name: 'setIosSwipeGestureEnabled',
    validateArgs(args) {
      const arg = args[0];
      if (!isObject(arg) || typeof arg.isEnabled !== 'boolean') {
        return {
          ok: false,
          expected: '{ isEnabled: boolean }',
          received: describeArgs(args),
        };
      }
      return { ok: true };
    },
    example: "call_sdk('setIosSwipeGestureEnabled', [{ isEnabled: false }])",
  },

  // --- setSecureScreen ---
  // 실 시그니처: setSecureScreen(options: { enabled: boolean }): Promise<{ enabled: boolean }>
  // 출처: src/mock/navigation/index.ts:66 / src/__typecheck.ts:46
  {
    name: 'setSecureScreen',
    validateArgs(args) {
      const arg = args[0];
      if (!isObject(arg) || typeof arg.enabled !== 'boolean') {
        return {
          ok: false,
          expected: '{ enabled: boolean }',
          received: describeArgs(args),
        };
      }
      return { ok: true };
    },
    example: "call_sdk('setSecureScreen', [{ enabled: true }])",
  },

  // --- setScreenAwakeMode ---
  // 실 시그니처: setScreenAwakeMode(options: { enabled: boolean }): Promise<{ enabled: boolean }>
  // 출처: src/mock/navigation/index.ts:57 / src/__typecheck.ts:47
  {
    name: 'setScreenAwakeMode',
    validateArgs(args) {
      const arg = args[0];
      if (!isObject(arg) || typeof arg.enabled !== 'boolean') {
        return {
          ok: false,
          expected: '{ enabled: boolean }',
          received: describeArgs(args),
        };
      }
      return { ok: true };
    },
    example: "call_sdk('setScreenAwakeMode', [{ enabled: true }])",
  },

  // --- getOperationalEnvironment ---
  // 실 시그니처: getOperationalEnvironment(): 'toss' | 'sandbox'
  // 인자 없음 — args는 무시 (SDK 자체가 인자를 무시함)
  // 출처: src/mock/navigation/index.ts:88 / src/__typecheck.ts:62
  {
    name: 'getOperationalEnvironment',
    validateArgs(_args) {
      return { ok: true };
    },
    example: "call_sdk('getOperationalEnvironment', [])",
  },

  // --- getPlatformOS ---
  // 실 시그니처: getPlatformOS(): 'ios' | 'android'
  // 출처: src/mock/navigation/index.ts:84 / src/__typecheck.ts:61
  {
    name: 'getPlatformOS',
    validateArgs(_args) {
      return { ok: true };
    },
    example: "call_sdk('getPlatformOS', [])",
  },

  // --- getDeviceId ---
  // 실 시그니처: getDeviceId(): string
  // 출처: src/mock/navigation/index.ts:119 / src/__typecheck.ts:74
  {
    name: 'getDeviceId',
    validateArgs(_args) {
      return { ok: true };
    },
    example: "call_sdk('getDeviceId', [])",
  },

  // --- getLocale ---
  // 실 시그니처: getLocale(): string
  // 출처: src/mock/navigation/index.ts:115 / src/__typecheck.ts:72
  {
    name: 'getLocale',
    validateArgs(_args) {
      return { ok: true };
    },
    example: "call_sdk('getLocale', [])",
  },

  // --- getNetworkStatus ---
  // 실 시그니처: getNetworkStatus(): Promise<NetworkStatus>
  // 출처: src/mock/navigation/index.ts:127 / src/__typecheck.ts:73
  {
    name: 'getNetworkStatus',
    validateArgs(_args) {
      return { ok: true };
    },
    example: "call_sdk('getNetworkStatus', [])",
  },

  // --- getSchemeUri ---
  // 실 시그니처: getSchemeUri(): string
  // 출처: src/mock/navigation/index.ts:111 / src/__typecheck.ts:71
  {
    name: 'getSchemeUri',
    validateArgs(_args) {
      return { ok: true };
    },
    example: "call_sdk('getSchemeUri', [])",
  },

  // --- requestReview ---
  // 실 시그니처: requestReview(): Promise<void>
  // 출처: src/mock/navigation/index.ts:75 / src/__typecheck.ts:76
  {
    name: 'requestReview',
    validateArgs(_args) {
      return { ok: true };
    },
    example: "call_sdk('requestReview', [])",
  },

  // --- closeView ---
  // 실 시그니처: closeView(): Promise<void>
  // 출처: src/mock/navigation/index.ts:10 / src/__typecheck.ts:42
  {
    name: 'closeView',
    validateArgs(_args) {
      return { ok: true };
    },
    example: "call_sdk('closeView', [])",
  },
];

/* -------------------------------------------------------------------------- */
/* 레지스트리 공개 API                                                           */
/* -------------------------------------------------------------------------- */

const SIGNATURE_MAP = new Map<string, SdkSignature>(SIGNATURES.map((s) => [s.name, s]));

/** 세션 내 passthrough 경고를 한 번만 emit하기 위한 Set */
const _warnedPassthrough = new Set<string>();

/**
 * 메서드 이름으로 시그니처를 조회한다.
 * 등록된 메서드이면 `SdkSignature`를 반환하고, 미등록이면 `undefined`.
 */
export function lookupSignature(name: string): SdkSignature | undefined {
  return SIGNATURE_MAP.get(name);
}

/**
 * 미등록 메서드에 대해 stderr에 passthrough 경고를 1회 출력한다.
 * 세션 내 동일 메서드 이름은 최초 1회만 출력.
 */
export function warnPassthrough(name: string): void {
  if (_warnedPassthrough.has(name)) return;
  _warnedPassthrough.add(name);
  process.stderr.write(`[ait-debug] call_sdk: "${name}" 시그니처가 등록되지 않음 — passthrough\n`);
}

/**
 * 테스트에서 passthrough 경고 Set을 초기화하기 위한 헬퍼.
 * 프로덕션 코드에서는 호출하지 않는다.
 */
export function _resetWarnedPassthroughForTest(): void {
  _warnedPassthrough.clear();
}

/**
 * 등록된 메서드 이름 목록 — tool description 생성 등에서 사용.
 */
export const REGISTERED_METHOD_NAMES: ReadonlyArray<string> = SIGNATURES.map((s) => s.name);
