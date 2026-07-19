/**
 * Haptic Feedback & saveBase64Data mock
 *
 * generateHapticFeedback — 영역 3 (하드웨어 API 관측):
 *   - 10종 HapticFeedbackType을 navigator.vibrate 패턴으로 매핑(근사, best-effort).
 *   - `typeof navigator.vibrate === 'function'` 가드 — API 없는 환경에서 throw 없이 skip.
 *   - @ait-co/polyfill 동시 사용 시 재귀 방지: polyfill이 navigator.vibrate를 override하고
 *     내부에서 mock의 generateHapticFeedback을 호출하므로 무한 재귀가 발생한다. polyfill이
 *     원본 vibrate를 BACKUP_KEY(Symbol.for('@ait-co/polyfill/vibrate.original'))에 저장하면
 *     그 원본을 직접 호출해 재귀를 끊는다.
 *   - sdkCallLog에 🟡(partial)로 기록. params: { hapticType, vibrated: boolean }.
 *   - 시그니처 불변 — __typecheck.ts의 Assert<Mock, Original> 통과.
 */

import { buildNativeError } from '../native-error.js';
import { aitState } from '../state.js';
import type { HapticFeedbackType } from '../types.js';

/**
 * HapticFeedbackType 10종 → navigator.vibrate 패턴 매핑.
 * 숫자: 진동 ms. 배열: [진동, 정지, 진동, …] 교대 패턴.
 */
export const HAPTIC_VIBRATE_PATTERN: Record<HapticFeedbackType, VibratePattern> = {
  tickWeak: 10,
  tap: 20,
  tickMedium: 30,
  softMedium: 40,
  basicWeak: 15,
  basicMedium: 50,
  success: [10, 40, 10],
  error: [40, 30, 40],
  wiggle: [20, 20, 20, 20, 20],
  confetti: [10, 20, 10, 20, 10, 20, 10],
};

/**
 * navigator.vibrate를 안전하게 호출한다.
 *
 * @ait-co/polyfill/auto가 설치된 환경에서는 navigator.vibrate가 polyfill shim으로
 * override되어 있고, 그 shim은 내부적으로 mock의 generateHapticFeedback을 호출한다.
 * mock이 다시 navigator.vibrate(현재 = shim)를 호출하면 무한 재귀가 발생한다.
 * polyfill은 원본 vibrate를 BACKUP_KEY에 저장하므로 그쪽을 직접 호출한다.
 */
const POLYFILL_VIBRATE_BACKUP = Symbol.for('@ait-co/polyfill/vibrate.original');

function callVibrate(pattern: VibratePattern): boolean {
  if (typeof navigator === 'undefined') return false;
  // polyfill이 설치되어 있으면 원본 vibrate를 직접 호출해 재귀를 방지한다.
  const nav = navigator as Navigator & Record<symbol, ((p: VibratePattern) => boolean) | undefined>;
  const original = POLYFILL_VIBRATE_BACKUP in nav ? nav[POLYFILL_VIBRATE_BACKUP] : null;
  if (typeof original === 'function') return original(pattern);
  // polyfill 없음 — 그냥 navigator.vibrate 호출.
  return typeof navigator.vibrate === 'function' ? navigator.vibrate(pattern) : false;
}

export async function generateHapticFeedback(options: { type: HapticFeedbackType }): Promise<void> {
  // 실기기(env3)는 알 수 없는 haptic type을 reject(errorCode: EXECUTION_ERROR)한다 —
  // mock은 과거 알 수 없는 type도 30ms fallback 패턴으로 조용히 resolve했다
  // (devtools#780, env1↔env3 capture diff 실측). 유효 판정은 SDK 타입 선언
  // (HapticFeedbackType, 10종 union)을 그대로 쓴다 — 이 mock의 HAPTIC_VIBRATE_PATTERN
  // 키 집합이 그 union과 정확히 일치하므로 별도 허용 목록을 새로 만들지 않는다.
  if (!(options.type in HAPTIC_VIBRATE_PATTERN)) {
    const err = new Error(
      `[@ait-co/devtools] generateHapticFeedback: unknown haptic type "${options.type}"`,
    );
    (err as Error & { errorCode?: string }).errorCode = 'EXECUTION_ERROR';
    throw err;
  }

  const timestamp = Date.now();
  aitState.logAnalytics({ type: 'haptic', params: { hapticType: options.type } });

  const pattern = HAPTIC_VIBRATE_PATTERN[options.type] ?? 30;
  const vibrated = callVibrate(pattern);

  aitState.logSdkCall({
    method: 'generateHapticFeedback',
    args: [{ type: options.type }],
    timestamp,
    status: 'resolved',
    result: { hapticType: options.type, vibrated },
    fidelity: 'partial',
  });
}

export async function saveBase64Data(params: {
  data: string;
  fileName: string;
  mimeType: string;
}): Promise<void> {
  // 빈 `data`는 native가 거부한다 — 실측(env3 run11, 2.x/iOS):
  //   { data: '', fileName: '', mimeType: '' }
  //     → rejected / Error / INVALID_DATA / moduleName 'RNFileSystem'
  // mock은 anchor를 만들어 click하기만 해서 무조건 resolve했고, 그 발산은
  // 시나리오 이름이 자동/manual 슈트에서 갈려 있어 커버리지 갭 뒤에 가려져
  // 있었다(sdk-example#313에서 키를 통일하며 드러남).
  //
  // 게이트를 `data`에만 거는 건 관측이 거기까지만 뒷받침하기 때문이다 —
  // 코드가 `INVALID_DATA`이고, 빈 fileName/mimeType 단독으로 무엇이 나오는지는
  // 관측이 없다. 근거 없이 조건을 넓히면 env1이 실기기에 없는 실패를 만든다.
  if (params.data === '') {
    throw buildNativeError('INVALID_DATA');
  }

  const a = document.createElement('a');
  a.href = `data:${params.mimeType};base64,${params.data}`;
  a.download = params.fileName;
  a.click();
}
