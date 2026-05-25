import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { aitState } from '../mock/state.js';
import {
  applyDeviceEmulation,
  buildDeviceProfile,
  type DeviceProfile,
  platformForPreset,
  revertDeviceEmulation,
  syncDeviceEmulation,
} from '../panel/device-emulation.js';
import { getPreset } from '../panel/viewport.js';

describe('platformForPreset', () => {
  it('iphone/ipad 계열은 ios', () => {
    expect(platformForPreset('iphone-15-pro')).toBe('ios');
    expect(platformForPreset('iphone-se-3')).toBe('ios');
    expect(platformForPreset('ipad-pro-11')).toBe('ios');
  });

  it('그 외(Galaxy 등)는 android', () => {
    expect(platformForPreset('galaxy-s26')).toBe('android');
    expect(platformForPreset('galaxy-z-fold7-folded')).toBe('android');
  });
});

describe('buildDeviceProfile', () => {
  it('iPhone 15 Pro: ios 플랫폼 + iPhone UA + 토스 토큰 suffix', () => {
    const profile = buildDeviceProfile(getPreset('iphone-15-pro'), '5.261.0', false);
    expect(profile.platform).toBe('ios');
    expect(profile.navigatorPlatform).toBe('iPhone');
    expect(profile.userAgent).toContain('iPhone');
    // #171 실측 형태: 표준 UA 뒤에 토스 WebView 토큰.
    expect(profile.userAgent).toContain('AppsInToss TossApp/5.261.0');
    expect(profile.userAgent).toMatch(/AppsInToss TossApp\/5\.261\.0$/);
  });

  it('Galaxy: android 플랫폼 + Android UA + Linux navigator.platform', () => {
    const profile = buildDeviceProfile(getPreset('galaxy-s26'), '5.261.0', false);
    expect(profile.platform).toBe('android');
    expect(profile.navigatorPlatform).toBe('Linux armv8l');
    expect(profile.userAgent).toContain('Android');
    expect(profile.userAgent).toContain('AppsInToss TossApp/5.261.0');
  });

  it('appVersion이 UA suffix 버전 토큰에 반영된다', () => {
    const profile = buildDeviceProfile(getPreset('iphone-15-pro'), '5.240.0', false);
    expect(profile.userAgent).toContain('AppsInToss TossApp/5.240.0');
  });

  it('devicePixelRatio는 preset의 dpr', () => {
    expect(buildDeviceProfile(getPreset('iphone-15-pro'), '5.0.0', false).devicePixelRatio).toBe(3);
  });

  it('portrait: screen은 CSS px × dpr (물리 해상도)', () => {
    // iPhone 15 Pro: 393×852 CSS, dpr 3 → 1179×2556 물리.
    const profile = buildDeviceProfile(getPreset('iphone-15-pro'), '5.0.0', false);
    expect(profile.screenWidth).toBe(1179);
    expect(profile.screenHeight).toBe(2556);
  });

  it('landscape: screen width/height를 swap한다', () => {
    const profile = buildDeviceProfile(getPreset('iphone-15-pro'), '5.0.0', true);
    expect(profile.screenWidth).toBe(2556);
    expect(profile.screenHeight).toBe(1179);
  });
});

describe('applyDeviceEmulation / revertDeviceEmulation', () => {
  const profile: DeviceProfile = {
    platform: 'ios',
    userAgent: 'Mozilla/5.0 (iPhone) AppsInToss TossApp/5.261.0',
    navigatorPlatform: 'iPhone',
    devicePixelRatio: 3,
    screenWidth: 1179,
    screenHeight: 2556,
  };

  // jsdom 기본값을 테스트 전후로 비교하기 위해 보존.
  const origUa = navigator.userAgent;
  const origPlatform = navigator.platform;
  const origDpr = window.devicePixelRatio;

  afterEach(() => {
    // 어떤 테스트가 override를 남겨도 다음 테스트에 누수되지 않게 강제 원복.
    revertDeviceEmulation();
  });

  it('navigator.userAgent / platform / devicePixelRatio를 프로필 값으로 덮어쓴다', () => {
    applyDeviceEmulation(profile);
    expect(navigator.userAgent).toBe(profile.userAgent);
    expect(navigator.platform).toBe(profile.navigatorPlatform);
    expect(window.devicePixelRatio).toBe(profile.devicePixelRatio);
    expect(screen.width).toBe(profile.screenWidth);
    expect(screen.height).toBe(profile.screenHeight);
  });

  it('revert 후 원래 호스트 값으로 돌아온다', () => {
    applyDeviceEmulation(profile);
    revertDeviceEmulation();
    expect(navigator.userAgent).toBe(origUa);
    expect(navigator.platform).toBe(origPlatform);
    expect(window.devicePixelRatio).toBe(origDpr);
  });

  it('revert는 idempotent — 두 번 호출해도 안전하고 호스트 값 유지', () => {
    applyDeviceEmulation(profile);
    revertDeviceEmulation();
    revertDeviceEmulation();
    expect(navigator.userAgent).toBe(origUa);
  });

  it('apply 연속 호출(preset 전환) 후 revert하면 누적 없이 호스트 값 복원', () => {
    applyDeviceEmulation(profile);
    applyDeviceEmulation({ ...profile, userAgent: 'second-ua', devicePixelRatio: 2 });
    expect(navigator.userAgent).toBe('second-ua');
    expect(window.devicePixelRatio).toBe(2);
    revertDeviceEmulation();
    expect(navigator.userAgent).toBe(origUa);
    expect(window.devicePixelRatio).toBe(origDpr);
  });
});

describe('syncDeviceEmulation', () => {
  const origUa = navigator.userAgent;
  const origPlatform = navigator.platform;

  beforeEach(() => {
    aitState.reset();
  });

  afterEach(() => {
    revertDeviceEmulation();
    aitState.reset();
  });

  it('none preset: override를 걸지 않는다 (호스트 UA 유지)', () => {
    syncDeviceEmulation(getPreset('none'), false);
    expect(navigator.userAgent).toBe(origUa);
  });

  it('null preset(custom 매핑): override를 걸지 않는다', () => {
    syncDeviceEmulation(null, false);
    expect(navigator.userAgent).toBe(origUa);
  });

  it('active preset: UA override + platform을 그 기기와 정합', () => {
    // jsdom 기본 state.platform은 'ios'. Galaxy로 가면 android로 끌려가는지 확인.
    expect(aitState.state.platform).toBe('ios');
    syncDeviceEmulation(getPreset('galaxy-s26'), false);
    expect(navigator.userAgent).toContain('Android');
    expect(navigator.platform).toBe('Linux armv8l');
    expect(aitState.state.platform).toBe('android');
  });

  it('iphone preset: platform이 ios로 정합', () => {
    aitState.update({ platform: 'android' });
    syncDeviceEmulation(getPreset('iphone-15-pro'), false);
    expect(navigator.userAgent).toContain('iPhone');
    expect(aitState.state.platform).toBe('ios');
  });

  it('platform이 이미 일치하면 aitState.update를 호출하지 않는다 (재진입 가드)', () => {
    // platform 이미 ios → iphone preset sync 시 update 불필요해야 한다.
    expect(aitState.state.platform).toBe('ios');
    let updates = 0;
    const unsub = aitState.subscribe(() => {
      updates += 1;
    });
    syncDeviceEmulation(getPreset('iphone-15-pro'), false);
    unsub();
    expect(updates).toBe(0);
    expect(aitState.state.platform).toBe('ios');
  });

  it('preset → none 전환 시 override가 원복된다', () => {
    syncDeviceEmulation(getPreset('galaxy-s26'), false);
    expect(navigator.userAgent).toContain('Android');
    syncDeviceEmulation(getPreset('none'), false);
    expect(navigator.userAgent).toBe(origUa);
    expect(navigator.platform).toBe(origPlatform);
  });
});
