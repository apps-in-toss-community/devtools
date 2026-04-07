import { describe, it, expect, beforeEach, vi } from 'vitest';
import { aitState } from '../mock/state.js';
import {
  getPlatformOS,
  getOperationalEnvironment,
  isMinVersionSupported,
  getNetworkStatus,
  getServerTime,
  graniteEvent,
  getTossAppVersion,
  getSchemeUri,
  getLocale,
  getDeviceId,
  getGroupId,
  SafeAreaInsets,
  env,
  getAppsInTossGlobals,
  closeView,
  openURL,
  getTossShareLink,
  setScreenAwakeMode,
  requestReview,
  tdsEvent,
  share,
  setIosSwipeGestureEnabled,
  setDeviceOrientation,
  setSecureScreen,
  getSafeAreaInsets,
} from '../mock/navigation/index.js';

describe('Navigation mock', () => {
  beforeEach(() => {
    aitState.reset();
  });

  it('getPlatformOS: 상태의 platform을 반환한다', () => {
    expect(getPlatformOS()).toBe('ios');
    aitState.update({ platform: 'android' });
    expect(getPlatformOS()).toBe('android');
  });

  it('getOperationalEnvironment: 상태의 environment를 반환한다', () => {
    expect(getOperationalEnvironment()).toBe('sandbox');
    aitState.update({ environment: 'toss' });
    expect(getOperationalEnvironment()).toBe('toss');
  });

  describe('isMinVersionSupported', () => {
    it('현재 버전이 최소 버전 이상이면 true', () => {
      expect(isMinVersionSupported({ ios: '5.240.0', android: '5.240.0' })).toBe(true);
      expect(isMinVersionSupported({ ios: '5.200.0', android: '5.200.0' })).toBe(true);
    });

    it('현재 버전이 최소 버전 미만이면 false', () => {
      expect(isMinVersionSupported({ ios: '6.0.0', android: '6.0.0' })).toBe(false);
    });

    it('always는 항상 true, never는 항상 false', () => {
      expect(isMinVersionSupported({ ios: 'always', android: 'always' })).toBe(true);
      expect(isMinVersionSupported({ ios: 'never', android: 'never' })).toBe(false);
    });

    it('android 플랫폼일 때 android 버전을 비교한다', () => {
      aitState.update({ platform: 'android' });
      expect(isMinVersionSupported({ ios: '999.0.0', android: '1.0.0' })).toBe(true);
    });
  });

  it('getNetworkStatus: 상태의 networkStatus를 반환한다', async () => {
    expect(await getNetworkStatus()).toBe('WIFI');
    aitState.update({ networkStatus: 'OFFLINE' });
    expect(await getNetworkStatus()).toBe('OFFLINE');
  });

  // Note: requires real timers (no vi.useFakeTimers)
  it('getServerTime: 현재 시간을 반환한다', async () => {
    const before = Date.now();
    const time = await getServerTime();
    const after = Date.now();
    expect(time).toBeGreaterThanOrEqual(before);
    expect(time).toBeLessThanOrEqual(after);
  });

  it('getTossAppVersion: 상태의 appVersion을 반환한다', () => {
    expect(getTossAppVersion()).toBe('5.240.0');
  });

  it('getSchemeUri: 상태의 schemeUri를 반환한다', () => {
    expect(getSchemeUri()).toBe('/');
    aitState.update({ schemeUri: '/test' });
    expect(getSchemeUri()).toBe('/test');
  });

  it('getLocale: 상태의 locale을 반환한다', () => {
    expect(getLocale()).toBe('ko-KR');
  });

  it('getDeviceId: 상태의 deviceId를 반환한다', () => {
    expect(getDeviceId()).toBe(aitState.state.deviceId);
  });

  it('getGroupId: 상태의 groupId를 반환한다', () => {
    expect(getGroupId()).toBe('mock-group-id');
  });

  it('env.getDeploymentId: 상태의 deploymentId를 반환한다', () => {
    expect(env.getDeploymentId()).toBe('mock-deployment-id');
  });

  it('getAppsInTossGlobals: brand 정보를 포함한 globals를 반환한다', () => {
    const globals = getAppsInTossGlobals();
    expect(globals.deploymentId).toBe('mock-deployment-id');
    expect(globals.brandDisplayName).toBe('Mock App');
    expect(globals.brandPrimaryColor).toBe('#3182F6');
  });

  it('closeView: history.back()을 호출한다', async () => {
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    await closeView();
    expect(backSpy).toHaveBeenCalled();
  });

  it('openURL: window.open()을 호출한다', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    await openURL('https://example.com');
    expect(openSpy).toHaveBeenCalledWith('https://example.com', '_blank');
  });

  it('getTossShareLink: mock share link를 반환한다', async () => {
    const link = await getTossShareLink('/path');
    expect(link).toBe('https://toss.im/share/mock/path');
  });

  it('setScreenAwakeMode: 설정한 값을 반환한다', async () => {
    const result = await setScreenAwakeMode({ enabled: true });
    expect(result).toEqual({ enabled: true });
  });

  it('requestReview: isSupported()가 true를 반환한다', () => {
    // requestReview는 런타임에 isSupported가 부착되지만 타입 정의에는 없다
    const fn = requestReview as unknown as { isSupported: () => boolean };
    expect(fn.isSupported()).toBe(true);
  });

  it('share: 에러 없이 실행된다', async () => {
    await expect(share({ message: 'hello' })).resolves.toBeUndefined();
  });

  it('setIosSwipeGestureEnabled: 에러 없이 실행된다', async () => {
    await expect(setIosSwipeGestureEnabled({ isEnabled: true })).resolves.toBeUndefined();
  });

  it('setDeviceOrientation: 에러 없이 실행된다', async () => {
    await expect(setDeviceOrientation({ type: 'landscape' })).resolves.toBeUndefined();
  });

  it('setSecureScreen: 설정한 값을 반환한다', async () => {
    const result = await setSecureScreen({ enabled: true });
    expect(result).toEqual({ enabled: true });
  });

  it('getSafeAreaInsets (deprecated): top 값을 반환한다', () => {
    expect(getSafeAreaInsets()).toBe(47);
  });

  describe('SafeAreaInsets', () => {
    it('get: 현재 safe area insets를 반환한다', () => {
      const insets = SafeAreaInsets.get();
      expect(insets).toEqual({ top: 47, bottom: 34, left: 0, right: 0 });
    });

    it('subscribe: 상태 변경 시 콜백이 호출되고 unsubscribe 후 호출되지 않는다', () => {
      const handler = vi.fn();
      const unsub = SafeAreaInsets.subscribe({ onEvent: handler });

      aitState.patch('safeAreaInsets', { top: 50 });
      expect(handler).toHaveBeenCalledWith({ top: 50, bottom: 34, left: 0, right: 0 });
      expect(handler).toHaveBeenCalledTimes(1);

      unsub();
      aitState.patch('safeAreaInsets', { top: 60 });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    // TODO: SafeAreaInsets.subscribe는 현재 aitState.subscribe에 위임하므로
    // safeAreaInsets 외 상태 변경에도 콜백이 호출된다. 향후 insets 변경 시에만 호출되도록 개선 필요.
    it.todo('subscribe: safeAreaInsets 변경 시에만 콜백이 호출되어야 한다');
  });

  describe('graniteEvent', () => {
    it('backEvent 리스너를 등록하고 trigger로 호출할 수 있다', () => {
      const handler = vi.fn();
      const unsub = graniteEvent.addEventListener('backEvent', { onEvent: handler });

      aitState.trigger('backEvent');
      expect(handler).toHaveBeenCalledTimes(1);

      unsub();
      aitState.trigger('backEvent');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('homeEvent 리스너를 등록하고 trigger로 호출할 수 있다', () => {
      const handler = vi.fn();
      const unsub = graniteEvent.addEventListener('homeEvent', { onEvent: handler });

      aitState.trigger('homeEvent');
      expect(handler).toHaveBeenCalledTimes(1);

      unsub();
    });
  });

  describe('tdsEvent', () => {
    it('navigationAccessoryEvent를 수신할 수 있다', () => {
      const handler = vi.fn();
      const unsub = tdsEvent.addEventListener('navigationAccessoryEvent', { onEvent: handler });

      window.dispatchEvent(new CustomEvent('__ait:navigationAccessoryEvent', { detail: { id: 'btn1' } }));
      expect(handler).toHaveBeenCalledWith({ id: 'btn1' });

      unsub();
    });
  });
});
