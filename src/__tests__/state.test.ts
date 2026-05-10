import { beforeEach, describe, expect, it, vi } from 'vitest';
import { aitState } from '../mock/state.js';

describe('AitStateManager', () => {
  beforeEach(() => {
    aitState.reset();
  });

  it('update: 상태를 부분 업데이트한다', () => {
    aitState.update({ platform: 'android' });
    expect(aitState.state.platform).toBe('android');
    // 다른 필드는 유지
    expect(aitState.state.locale).toBe('ko-KR');
  });

  it('update: 중첩 객체를 전달하면 통째로 교체하며 이전 참조는 변경되지 않는다', () => {
    const oldAuth = aitState.state.auth;
    aitState.update({
      auth: {
        isLoggedIn: false,
        isTossLoginIntegrated: false,
        userKeyHash: '',
        anonymousKeyHash: '',
      },
    });
    expect(aitState.state.auth.isLoggedIn).toBe(false);
    expect(aitState.state.auth.isTossLoginIntegrated).toBe(false);
    // update는 shallow merge이므로 중첩 객체를 완전히 대체한다
    // 이전 참조는 변경되지 않는다 (불변성 보장)
    expect(oldAuth.isLoggedIn).toBe(true);
    expect(aitState.state.auth).not.toBe(oldAuth);
  });

  it('patch: 중첩 객체를 부분 업데이트한다', () => {
    aitState.patch('auth', { isLoggedIn: false });
    expect(aitState.state.auth.isLoggedIn).toBe(false);
    // 기존 값은 유지
    expect(aitState.state.auth.isTossLoginIntegrated).toBe(true);
  });

  it('subscribe: 상태 변경 시 리스너가 호출된다', () => {
    const listener = vi.fn();
    const unsub = aitState.subscribe(listener);

    aitState.update({ locale: 'en-US' });
    expect(listener).toHaveBeenCalledTimes(1);

    aitState.patch('brand', { displayName: 'Test' });
    expect(listener).toHaveBeenCalledTimes(2);

    unsub();
    aitState.update({ locale: 'ja-JP' });
    expect(listener).toHaveBeenCalledTimes(2); // 구독 해제 후 호출 안 됨
  });

  it('subscribe: 리스너 콜백 내에서 새 상태를 읽을 수 있다', () => {
    let capturedLocale = '';
    const unsub = aitState.subscribe(() => {
      capturedLocale = aitState.state.locale;
    });

    aitState.update({ locale: 'en-US' });
    expect(capturedLocale).toBe('en-US');

    aitState.patch('brand', { displayName: 'Changed' });
    expect(aitState.state.brand.displayName).toBe('Changed');

    unsub();
  });

  it('trigger: CustomEvent를 dispatch한다', () => {
    const handler = vi.fn();
    window.addEventListener('__ait:backEvent', handler);

    aitState.trigger('backEvent');
    expect(handler).toHaveBeenCalledTimes(1);

    window.removeEventListener('__ait:backEvent', handler);
  });

  it('logAnalytics: 분석 로그에 타임스탬프와 함께 추가된다', () => {
    aitState.logAnalytics({ type: 'screen', params: { page: 'home' } });
    const logs = aitState.state.analyticsLog;
    expect(logs).toHaveLength(1);
    expect(logs[0].type).toBe('screen');
    expect(logs[0].params).toEqual({ page: 'home' });
    expect(typeof logs[0].timestamp).toBe('number');
  });

  it('reset: 상태를 초기값으로 되돌린다 (deviceId는 유지)', () => {
    const deviceId = aitState.state.deviceId;
    aitState.update({ platform: 'android', locale: 'en-US' });
    aitState.logAnalytics({ type: 'click', params: {} });

    aitState.reset();
    expect(aitState.state.platform).toBe('ios');
    expect(aitState.state.locale).toBe('ko-KR');
    expect(aitState.state.analyticsLog).toHaveLength(0);
    expect(aitState.state.deviceId).toBe(deviceId);
  });

  it('reset: 중첩 객체가 deep-clone되어 이전 상태와 독립적이다', () => {
    aitState.patch('iap', {
      completedOrders: [{ orderId: 'x', sku: 'x', status: 'COMPLETED', date: '' }],
    });
    aitState.patch('auth', { isLoggedIn: false });

    aitState.reset();
    expect(aitState.state.iap.completedOrders).toHaveLength(0);
    expect(aitState.state.auth.isLoggedIn).toBe(true);
  });

  it('panelEditable: 기본값은 true이다', () => {
    expect(aitState.state.panelEditable).toBe(true);
  });

  it('panelEditable: update로 토글할 수 있다', () => {
    aitState.update({ panelEditable: false });
    expect(aitState.state.panelEditable).toBe(false);
  });

  it('panelEditable: reset 시 기본값으로 복원된다', () => {
    aitState.update({ panelEditable: false });
    aitState.reset();
    expect(aitState.state.panelEditable).toBe(true);
  });

  describe('transaction', () => {
    it('내부의 여러 update/patch를 묶어 listener notify 1회로 만든다', () => {
      const listener = vi.fn();
      const unsub = aitState.subscribe(listener);

      aitState.transaction(() => {
        aitState.update({ locale: 'en-US' });
        aitState.patch('auth', { isLoggedIn: false });
        aitState.patch('brand', { displayName: 'Test' });
      });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(aitState.state.locale).toBe('en-US');
      expect(aitState.state.auth.isLoggedIn).toBe(false);
      expect(aitState.state.brand.displayName).toBe('Test');
      unsub();
    });

    it('중첩 transaction은 outermost 종료 시 한 번만 notify한다', () => {
      const listener = vi.fn();
      const unsub = aitState.subscribe(listener);

      aitState.transaction(() => {
        aitState.update({ locale: 'en-US' });
        aitState.transaction(() => {
          aitState.patch('auth', { isLoggedIn: false });
        });
        aitState.patch('brand', { displayName: 'Test' });
      });

      expect(listener).toHaveBeenCalledTimes(1);
      unsub();
    });

    it('내부에서 throw해도 partial state를 1회 notify하고 flag가 복구된다', () => {
      const listener = vi.fn();
      const unsub = aitState.subscribe(listener);

      expect(() => {
        aitState.transaction(() => {
          aitState.update({ locale: 'en-US' });
          throw new Error('boom');
        });
      }).toThrow('boom');

      // throw 직전까지의 partial state(locale=en-US)가 1회 notify된다
      expect(listener).toHaveBeenCalledTimes(1);
      expect(aitState.state.locale).toBe('en-US');

      // 이후 update가 정상적으로 notify된다 (transaction flag가 stuck되지 않음)
      aitState.update({ locale: 'ja-JP' });
      expect(listener).toHaveBeenCalledTimes(2);
      unsub();
    });
  });
});
