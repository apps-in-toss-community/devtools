/**
 * Unit tests for call_sdk 인자 시그니처 검증 (devtools#264).
 *
 * 테스트 전략:
 *   - 등록된 메서드: ok 케이스(정상 인자) + bad 케이스(잘못된 인자) 각각 검증
 *   - 미등록 메서드: passthrough (bridge에 도달) + stderr 경고 1회
 *   - bridge는 FakeCdpConnection으로 mocking — 실 기기·relay 없음
 *
 * SECRET-HANDLING: args/name이 에러 메시지에 포함되는 것은 call_sdk 특성상 허용
 * (인자 형태를 에러 메시지에 보여주는 것이 이 기능의 목적). 단, 비밀 값을 담는
 * 메서드(token 등)는 현재 등록 목록에 없으므로 별도 redact 불필요.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CdpCommandMap,
  CdpCommandName,
  CdpConnection,
  CdpEventMap,
  CdpEventName,
  CdpTarget,
} from '../mcp/cdp-connection.js';
import {
  _resetWarnedPassthroughForTest,
  lookupSignature,
  warnPassthrough,
} from '../mcp/sdk-signatures.js';
import { callSdk } from '../mcp/tools.js';

/* -------------------------------------------------------------------------- */
/* Fake CdpConnection (bridge 호출을 mock)                                     */
/* -------------------------------------------------------------------------- */

type CannedResults = Partial<{
  [M in CdpCommandName]: CdpCommandMap[M]['result'];
}>;

function makeFakeConnection(canned: CannedResults = {}): CdpConnection {
  return {
    kind: 'relay' as const,
    enableDomains: () => Promise.resolve(),
    listTargets: (): CdpTarget[] => [],
    getBufferedEvents: <E extends CdpEventName>(_event: E): ReadonlyArray<CdpEventMap[E]> => [],
    on:
      <E extends CdpEventName>(
        _event: E,
        _listener: (payload: CdpEventMap[E]) => void,
      ): (() => void) =>
      () => {},
    send: <M extends CdpCommandName>(
      method: M,
      _params?: CdpCommandMap[M]['params'],
    ): Promise<CdpCommandMap[M]['result']> => {
      if (method in canned) {
        return Promise.resolve(canned[method] as CdpCommandMap[M]['result']);
      }
      return Promise.reject(new Error(`FakeCdpConnection: no canned result for ${method}`));
    },
  };
}

/** 성공 결과를 반환하는 canned connection */
function connWithSuccess(value: unknown): CdpConnection {
  return makeFakeConnection({
    'Runtime.evaluate': {
      result: { type: 'string', value: JSON.stringify({ ok: true, value }) },
    },
  });
}

/** bridge에 도달하면 fail시키는 connection — validation에서 reject되어야 bridge를 안 타야 함 */
function connThatShouldNotBeReached(): CdpConnection {
  return {
    kind: 'relay' as const,
    enableDomains: () => Promise.resolve(),
    listTargets: (): CdpTarget[] => [],
    getBufferedEvents: <E extends CdpEventName>(_event: E): ReadonlyArray<CdpEventMap[E]> => [],
    on:
      <E extends CdpEventName>(
        _event: E,
        _listener: (payload: CdpEventMap[E]) => void,
      ): (() => void) =>
      () => {},
    send: <M extends CdpCommandName>(
      _method: M,
      _params?: CdpCommandMap[M]['params'],
    ): Promise<CdpCommandMap[M]['result']> => {
      throw new Error('bridge가 호출되면 안 됩니다 — 시그니처 검증이 먼저 reject해야 함');
    },
  };
}

/* -------------------------------------------------------------------------- */
/* lookupSignature 단위 테스트                                                  */
/* -------------------------------------------------------------------------- */

describe('lookupSignature', () => {
  it('등록된 메서드는 SdkSignature를 반환', () => {
    const sig = lookupSignature('setDeviceOrientation');
    expect(sig).toBeDefined();
    expect(sig?.name).toBe('setDeviceOrientation');
  });

  it('미등록 메서드는 undefined를 반환', () => {
    expect(lookupSignature('nonExistentMethod_xyz')).toBeUndefined();
  });

  it('12개 메서드가 등록되어 있다', () => {
    const methods = [
      'setDeviceOrientation',
      'setIosSwipeGestureEnabled',
      'setSecureScreen',
      'setScreenAwakeMode',
      'getOperationalEnvironment',
      'getPlatformOS',
      'getDeviceId',
      'getLocale',
      'getNetworkStatus',
      'getSchemeUri',
      'requestReview',
      'closeView',
    ];
    for (const m of methods) {
      expect(lookupSignature(m), `${m} 등록 확인`).toBeDefined();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* setDeviceOrientation — 핵심 케이스 (crash 원인 메서드)                        */
/* -------------------------------------------------------------------------- */

describe('callSdk — setDeviceOrientation', () => {
  it('{ type: "landscape" } → ok', async () => {
    const conn = connWithSuccess(undefined);
    const result = await callSdk(conn, 'setDeviceOrientation', [{ type: 'landscape' }]);
    expect(result.ok).toBe(true);
  });

  it('{ type: "portrait" } → ok', async () => {
    const conn = connWithSuccess(undefined);
    const result = await callSdk(conn, 'setDeviceOrientation', [{ type: 'portrait' }]);
    expect(result.ok).toBe(true);
  });

  it('"landscape" (문자열) → ok:false + 인자 오류 메시지 (bridge 미도달)', async () => {
    const conn = connThatShouldNotBeReached();
    const result = await callSdk(conn, 'setDeviceOrientation', ['landscape']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('인자 시그니처 오류');
      expect(result.error).toContain("'portrait' | 'landscape'");
      expect(result.error).toContain('올바른 예시');
    }
  });

  it('인자 없음 (빈 배열) → ok:false', async () => {
    const conn = connThatShouldNotBeReached();
    const result = await callSdk(conn, 'setDeviceOrientation', []);
    expect(result.ok).toBe(false);
  });

  it('{ type: "auto" } (잘못된 값) → ok:false', async () => {
    const conn = connThatShouldNotBeReached();
    const result = await callSdk(conn, 'setDeviceOrientation', [{ type: 'auto' }]);
    expect(result.ok).toBe(false);
  });

  it('에러 메시지에 올바른 예시가 포함됨', async () => {
    const conn = connThatShouldNotBeReached();
    const result = await callSdk(conn, 'setDeviceOrientation', ['wrong']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("call_sdk('setDeviceOrientation'");
      expect(result.error).toContain('{ type:');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* setIosSwipeGestureEnabled                                                   */
/* -------------------------------------------------------------------------- */

describe('callSdk — setIosSwipeGestureEnabled', () => {
  it('{ isEnabled: true } → ok', async () => {
    const result = await callSdk(connWithSuccess(undefined), 'setIosSwipeGestureEnabled', [
      { isEnabled: true },
    ]);
    expect(result.ok).toBe(true);
  });

  it('{ isEnabled: false } → ok', async () => {
    const result = await callSdk(connWithSuccess(undefined), 'setIosSwipeGestureEnabled', [
      { isEnabled: false },
    ]);
    expect(result.ok).toBe(true);
  });

  it('{ enabled: true } (잘못된 키) → ok:false', async () => {
    const conn = connThatShouldNotBeReached();
    const result = await callSdk(conn, 'setIosSwipeGestureEnabled', [{ enabled: true }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('isEnabled');
    }
  });

  it('true (원시값) → ok:false', async () => {
    const conn = connThatShouldNotBeReached();
    const result = await callSdk(conn, 'setIosSwipeGestureEnabled', [true]);
    expect(result.ok).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* setSecureScreen                                                              */
/* -------------------------------------------------------------------------- */

describe('callSdk — setSecureScreen', () => {
  it('{ enabled: true } → ok', async () => {
    const result = await callSdk(connWithSuccess({ enabled: true }), 'setSecureScreen', [
      { enabled: true },
    ]);
    expect(result.ok).toBe(true);
  });

  it('{ isSecure: true } (잘못된 키) → ok:false', async () => {
    const conn = connThatShouldNotBeReached();
    const result = await callSdk(conn, 'setSecureScreen', [{ isSecure: true }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('enabled');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* setScreenAwakeMode                                                           */
/* -------------------------------------------------------------------------- */

describe('callSdk — setScreenAwakeMode', () => {
  it('{ enabled: true } → ok', async () => {
    const result = await callSdk(connWithSuccess({ enabled: true }), 'setScreenAwakeMode', [
      { enabled: true },
    ]);
    expect(result.ok).toBe(true);
  });

  it("{ mode: 'always' } (잘못된 키) → ok:false", async () => {
    const conn = connThatShouldNotBeReached();
    const result = await callSdk(conn, 'setScreenAwakeMode', [{ mode: 'always' }]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('enabled');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 인자 없는 메서드 (no-args) — ok 케이스                                        */
/* -------------------------------------------------------------------------- */

describe('callSdk — no-args 메서드', () => {
  const noArgsMethods = [
    'getOperationalEnvironment',
    'getPlatformOS',
    'getDeviceId',
    'getLocale',
    'getNetworkStatus',
    'getSchemeUri',
    'requestReview',
    'closeView',
  ] as const;

  for (const method of noArgsMethods) {
    it(`${method}([]) → ok (bridge 통과)`, async () => {
      const conn = connWithSuccess('mock-value');
      const result = await callSdk(conn, method, []);
      expect(result.ok).toBe(true);
    });
  }
});

/* -------------------------------------------------------------------------- */
/* 미등록 메서드 — passthrough + stderr 경고                                     */
/* -------------------------------------------------------------------------- */

describe('callSdk — 미등록 메서드 passthrough', () => {
  beforeEach(() => {
    _resetWarnedPassthroughForTest();
  });

  it('미등록 메서드는 bridge를 통과한다', async () => {
    const conn = connWithSuccess('bridge-result');
    const result = await callSdk(conn, 'someUnknownSdkMethod', [{ anything: true }]);
    expect(result.ok).toBe(true);
  });

  it('미등록 메서드에 대해 stderr에 경고를 1회 출력한다', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    warnPassthrough('unknownMethod');
    warnPassthrough('unknownMethod'); // 두 번 호출
    warnPassthrough('unknownMethod'); // 세 번 호출

    // 1회만 출력되어야 함
    const calls = stderrSpy.mock.calls.filter((c) => String(c[0]).includes('unknownMethod'));
    expect(calls).toHaveLength(1);
    expect(String(stderrSpy.mock.calls[0]?.[0])).toContain('시그니처가 등록되지 않음');

    stderrSpy.mockRestore();
  });

  it('다른 미등록 메서드는 각각 1회씩 경고를 출력한다', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    warnPassthrough('methodA');
    warnPassthrough('methodB');
    warnPassthrough('methodA'); // 중복
    warnPassthrough('methodB'); // 중복

    const callsA = stderrSpy.mock.calls.filter((c) => String(c[0]).includes('methodA'));
    const callsB = stderrSpy.mock.calls.filter((c) => String(c[0]).includes('methodB'));
    expect(callsA).toHaveLength(1);
    expect(callsB).toHaveLength(1);

    stderrSpy.mockRestore();
  });
});

/* -------------------------------------------------------------------------- */
/* 검증 실패 시 bridge에 도달하지 않음 (isError 형태 확인)                         */
/* -------------------------------------------------------------------------- */

describe('callSdk — validation 실패 시 bridge 미도달 확인', () => {
  it('시그니처 오류는 {ok:false, error} 형태로 반환 (throw 아님)', async () => {
    const conn = connThatShouldNotBeReached();
    // callSdk는 throw하지 않고 {ok:false} 결과를 반환해야 한다
    await expect(callSdk(conn, 'setDeviceOrientation', ['wrong-type'])).resolves.toMatchObject({
      ok: false,
    });
  });

  it('에러 메시지에 메서드 이름이 포함된다', async () => {
    const conn = connThatShouldNotBeReached();
    const result = await callSdk(conn, 'setDeviceOrientation', ['wrong']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('setDeviceOrientation');
    }
  });
});
