/**
 * Haptic Feedback & saveBase64Data mock
 *
 * generateHapticFeedback — 영역 3 (하드웨어 API 관측):
 *   - 10종 HapticFeedbackType을 navigator.vibrate 패턴으로 매핑(근사, best-effort).
 *   - `typeof navigator.vibrate === 'function'` 가드 — API 없는 환경에서 throw 없이 skip.
 *   - sdkCallLog에 🟡(partial)로 기록. params: { hapticType, vibrated: boolean }.
 *   - 시그니처 불변 — __typecheck.ts의 Assert<Mock, Original> 통과.
 */

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

export async function generateHapticFeedback(options: { type: HapticFeedbackType }): Promise<void> {
  const timestamp = Date.now();
  aitState.logAnalytics({ type: 'haptic', params: { hapticType: options.type } });

  const pattern = HAPTIC_VIBRATE_PATTERN[options.type] ?? 30;
  const vibrated = typeof navigator.vibrate === 'function' ? navigator.vibrate(pattern) : false;

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
  const a = document.createElement('a');
  a.href = `data:${params.mimeType};base64,${params.data}`;
  a.download = params.fileName;
  a.click();
}
