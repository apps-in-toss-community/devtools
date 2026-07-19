/**
 * haptic mock 단위 테스트
 *
 * 검증 범위:
 *   1. HAPTIC_VIBRATE_PATTERN — 10종 타입 매핑 테이블 정확성
 *   2. navigator.vibrate 가드 — API 없으면 호출 안 함, 있으면 호출
 *   3. sdkCallLog 🟡(partial) 기록 — hapticType + vibrated 포함
 *   4. analyticsLog 기록 유지
 *
 * jsdom에는 navigator.vibrate가 없으므로 vi.spyOn으로 주입해 검증한다.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateHapticFeedback, HAPTIC_VIBRATE_PATTERN } from '../mock/device/index.js';
import { aitState } from '../mock/state.js';

describe('HAPTIC_VIBRATE_PATTERN', () => {
  it('10종 타입이 모두 정의되어 있다', () => {
    const expectedTypes = [
      'tickWeak',
      'tap',
      'tickMedium',
      'softMedium',
      'basicWeak',
      'basicMedium',
      'success',
      'error',
      'wiggle',
      'confetti',
    ] as const;

    for (const type of expectedTypes) {
      expect(HAPTIC_VIBRATE_PATTERN).toHaveProperty(type);
    }
    expect(Object.keys(HAPTIC_VIBRATE_PATTERN)).toHaveLength(10);
  });

  it('각 패턴이 유효한 VibratePattern 형식이다 (number 또는 number[])', () => {
    for (const [type, pattern] of Object.entries(HAPTIC_VIBRATE_PATTERN)) {
      if (typeof pattern === 'number') {
        expect(pattern, `${type}: 숫자여야 함`).toBeGreaterThan(0);
      } else {
        expect(Array.isArray(pattern), `${type}: 배열이어야 함`).toBe(true);
        for (const n of pattern as number[]) {
          expect(typeof n, `${type}[]: 요소가 숫자여야 함`).toBe('number');
        }
      }
    }
  });
});

describe('generateHapticFeedback', () => {
  beforeEach(() => {
    aitState.reset();
  });

  describe('navigator.vibrate 가드', () => {
    it('navigator.vibrate가 없으면 호출하지 않는다 (throw 없이 통과)', async () => {
      // jsdom에는 navigator.vibrate가 없다 — 가드가 없으면 throw됨
      const original = navigator.vibrate;
      Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true });

      await expect(generateHapticFeedback({ type: 'success' })).resolves.toBeUndefined();

      Object.defineProperty(navigator, 'vibrate', { value: original, configurable: true });
    });

    it('navigator.vibrate가 있으면 패턴으로 호출된다', async () => {
      const vibrateSpy = vi.fn().mockReturnValue(true);
      Object.defineProperty(navigator, 'vibrate', { value: vibrateSpy, configurable: true });

      await generateHapticFeedback({ type: 'success' });

      expect(vibrateSpy).toHaveBeenCalledOnce();
      expect(vibrateSpy).toHaveBeenCalledWith(HAPTIC_VIBRATE_PATTERN.success);
    });

    it('vibrate의 반환값(boolean)이 sdkCallLog result.vibrated에 반영된다', async () => {
      const vibrateSpy = vi.fn().mockReturnValue(true);
      Object.defineProperty(navigator, 'vibrate', { value: vibrateSpy, configurable: true });

      await generateHapticFeedback({ type: 'tickWeak' });

      const log = aitState.state.sdkCallLog;
      const entry = log.find((e) => e.method === 'generateHapticFeedback');
      expect(entry).toBeDefined();
      expect((entry?.result as { vibrated: boolean }).vibrated).toBe(true);
    });

    it('navigator.vibrate가 false를 반환하면 vibrated: false가 기록된다', async () => {
      const vibrateSpy = vi.fn().mockReturnValue(false);
      Object.defineProperty(navigator, 'vibrate', { value: vibrateSpy, configurable: true });

      await generateHapticFeedback({ type: 'error' });

      const log = aitState.state.sdkCallLog;
      const entry = log.find((e) => e.method === 'generateHapticFeedback');
      expect((entry?.result as { vibrated: boolean }).vibrated).toBe(false);
    });
  });

  describe('sdkCallLog 기록', () => {
    it('🟡 partial fidelity로 기록된다', async () => {
      await generateHapticFeedback({ type: 'tap' });

      const log = aitState.state.sdkCallLog;
      const entry = log.find((e) => e.method === 'generateHapticFeedback');
      expect(entry).toBeDefined();
      expect(entry?.fidelity).toBe('partial');
    });

    it('args에 { type } 이 기록된다', async () => {
      await generateHapticFeedback({ type: 'confetti' });

      const log = aitState.state.sdkCallLog;
      const entry = log.find((e) => e.method === 'generateHapticFeedback');
      expect(entry?.args).toEqual([{ type: 'confetti' }]);
    });

    it('result에 hapticType이 포함된다', async () => {
      await generateHapticFeedback({ type: 'wiggle' });

      const log = aitState.state.sdkCallLog;
      const entry = log.find((e) => e.method === 'generateHapticFeedback');
      expect((entry?.result as { hapticType: string }).hapticType).toBe('wiggle');
    });

    it('status가 resolved이다', async () => {
      await generateHapticFeedback({ type: 'basicMedium' });

      const log = aitState.state.sdkCallLog;
      const entry = log.find((e) => e.method === 'generateHapticFeedback');
      expect(entry?.status).toBe('resolved');
    });
  });

  describe('analyticsLog 기록 유지', () => {
    it('analyticsLog에도 haptic 항목이 기록된다', async () => {
      await generateHapticFeedback({ type: 'success' });

      const logs = aitState.state.analyticsLog;
      expect(logs).toHaveLength(1);
      expect(logs[0]?.type).toBe('haptic');
      expect(logs[0]?.params).toEqual({ hapticType: 'success' });
    });
  });

  describe('모든 10종 타입 호출 가능', () => {
    it('10종 타입을 순서대로 호출해도 throw하지 않는다', async () => {
      const types = Object.keys(HAPTIC_VIBRATE_PATTERN);
      for (const type of types) {
        await expect(
          generateHapticFeedback({
            type: type as Parameters<typeof generateHapticFeedback>[0]['type'],
          }),
        ).resolves.toBeUndefined();
      }
    });
  });

  // devtools#780: 실기기(env3)는 알 수 없는 haptic type을 reject한다. mock은 과거
  // 30ms fallback 패턴으로 조용히 resolve했다 — env1↔env3 capture diff 실측에 맞춰
  // reject로 갱신.
  describe('알 수 없는 type — devtools#780', () => {
    it('SDK 타입 union 밖의 type 문자열은 EXECUTION_ERROR로 reject된다', async () => {
      const bogusType = 'not-a-real-haptic-type' as Parameters<
        typeof generateHapticFeedback
      >[0]['type'];

      await expect(generateHapticFeedback({ type: bogusType })).rejects.toThrow();

      try {
        await generateHapticFeedback({ type: bogusType });
        expect.unreachable('reject되어야 한다');
      } catch (err) {
        // 캡처 하네스(aitCapture.extractErrorShape)는 errorName을 err.constructor.name,
        // errorCode를 err.code ?? err.errorCode에서 뽑는다. 실기기 실측이
        // errorName: "Error"이므로 서브클래스가 아닌 평범한 Error여야 한다.
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).constructor.name).toBe('Error');
        expect((err as Error & { errorCode?: string }).errorCode).toBe('EXECUTION_ERROR');
      }
    });

    it('알 수 없는 type이 거부되어도 유효한 type 호출은 계속 통과한다', async () => {
      await expect(generateHapticFeedback({ type: 'success' })).resolves.toBeUndefined();
    });

    it.each([
      'constructor',
      'toString',
      '__proto__',
      'hasOwnProperty',
      'valueOf',
    ])('Object.prototype 예약 이름 "%s"도 거부된다', async (reserved) => {
      // 판정을 `in`으로 하면 프로토타입 체인까지 보므로 이 이름들이 유효한
      // haptic type으로 통과한다 — 이 함수가 막으려는 바로 그 부류(실기기가
      // 거부할 입력을 mock이 조용히 수락)가 재발한다. `Object.hasOwn`이라야
      // 자기 키만 본다. 타입 시그니처는 이걸 못 막는다: MCP `call_sdk`가
      // 타입 없는 인자를 그대로 런타임까지 실어 보내기 때문이다.
      const type = reserved as Parameters<typeof generateHapticFeedback>[0]['type'];
      await expect(generateHapticFeedback({ type })).rejects.toThrow();
    });
  });
});
