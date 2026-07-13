import { beforeEach, describe, expect, it } from 'vitest';
import { buildNativeError, type NativeErrorEnvelope } from '../mock/native-error.js';
import { aitState } from '../mock/state.js';

describe('buildNativeError (devtools#770 실패-모드 다이얼)', () => {
  beforeEach(() => {
    aitState.reset();
  });

  it('sdkLine 기본값(2.x)에서 native envelope 필드를 필드 단위로 싣는다', () => {
    const err = buildNativeError('APP_LOGIN') as Error & NativeErrorEnvelope;

    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('Error');
    expect(err.code).toBe('APP_LOGIN');
    expect(typeof err.message).toBe('string');
    expect(err.message.length).toBeGreaterThan(0);
    expect(err.userInfo).toEqual({});
    expect(typeof err.moduleName).toBe('string');
    expect(err.moduleName.length).toBeGreaterThan(0);
    expect(err.__isError).toBe(true);
  });

  it('sdkLine이 3.x면 envelope 필드 없는 맨 Error로 평탄화한다', () => {
    aitState.patch('failureModes', { sdkLine: '3.x' });
    const err = buildNativeError('APP_LOGIN') as Error & Partial<NativeErrorEnvelope>;

    expect(err).toBeInstanceOf(Error);
    expect(typeof err.message).toBe('string');
    expect(err.message.length).toBeGreaterThan(0);
    // 3.x 라인은 envelope 필드가 실리지 않는다 (sdk-example#284 "패턴 ① envelope 평탄화")
    expect(err.code).toBeUndefined();
    expect(err.userInfo).toBeUndefined();
    expect(err.moduleName).toBeUndefined();
    expect(err.__isError).toBeUndefined();
  });

  it('코드별로 다른 message/moduleName을 싣는다', () => {
    const adMob = buildNativeError('PLACEMENT_ID_FETCH_FAILED') as Error & NativeErrorEnvelope;
    const fullScreen = buildNativeError('EXECUTION_ERROR') as Error & NativeErrorEnvelope;

    expect(adMob.code).toBe('PLACEMENT_ID_FETCH_FAILED');
    expect(fullScreen.code).toBe('EXECUTION_ERROR');
    expect(adMob.message).not.toBe(fullScreen.message);
  });

  it('2.x/3.x 무관하게 __isError를 제외한 모든 envelope 필드가 undefined인 3.x에서도 message는 코드별로 다르다', () => {
    aitState.patch('failureModes', { sdkLine: '3.x' });
    const adMob = buildNativeError('PLACEMENT_ID_FETCH_FAILED');
    const fullScreen = buildNativeError('EXECUTION_ERROR');
    expect(adMob.message).not.toBe(fullScreen.message);
  });
});
