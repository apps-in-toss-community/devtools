import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aitState } from '../mock/state.js';
import type { ViewportState } from '../mock/types.js';
import {
  _resetViewportInit,
  applyViewport,
  clampCustomDimension,
  computeSafeAreaInsets,
  disposeViewport,
  effectiveOrientation,
  getPreset,
  initViewport,
  loadViewportFromStorage,
  resolveViewportSize,
  saveViewportToStorage,
  VIEWPORT_CUSTOM_MAX,
  VIEWPORT_PRESETS,
  VIEWPORT_STORAGE_KEY,
} from '../panel/viewport.js';

/** 테스트에서 부분 필드만 바꾼 ViewportState를 만들기 위한 기본값 */
function makeState(overrides: Partial<ViewportState> = {}): ViewportState {
  return {
    preset: 'none',
    orientation: 'auto',
    appOrientation: null,
    landscapeSide: 'left',
    customWidth: 402,
    customHeight: 874,
    frame: false,
    aitNavBar: true,
    aitNavBarType: 'partner',
    ...overrides,
  };
}

describe('viewport presets', () => {
  it('알려진 프리셋 id는 라벨, 크기, DPR, notch, safeArea를 함께 반환한다', () => {
    const iphone17Pro = getPreset('iphone-17-pro');
    expect(iphone17Pro.label).toBe('iPhone 17 Pro');
    expect(iphone17Pro.width).toBe(402);
    expect(iphone17Pro.height).toBe(874);
    expect(iphone17Pro.dpr).toBe(3);
    expect(iphone17Pro.notch).toBe('dynamic-island');
    expect(iphone17Pro.safeAreaTop).toBeGreaterThan(0);
    expect(iphone17Pro.safeAreaBottom).toBeGreaterThan(0);

    expect(getPreset('galaxy-s26').width).toBe(384);
    expect(getPreset('iphone-se-3').notch).toBe('none');
    expect(getPreset('iphone-se-3').safeAreaBottom).toBe(0);
  });

  it('VIEWPORT_PRESETS에는 none과 custom 엔트리가 항상 포함된다', () => {
    const ids = VIEWPORT_PRESETS.map((p) => p.id);
    expect(ids).toContain('none');
    expect(ids).toContain('custom');
  });

  it('Z Fold7은 접힘/펼침 두 프리셋이 모두 있다', () => {
    const ids = VIEWPORT_PRESETS.map((p) => p.id);
    expect(ids).toContain('galaxy-z-fold7-folded');
    expect(ids).toContain('galaxy-z-fold7-unfolded');
    expect(getPreset('galaxy-z-fold7-unfolded').width).toBeGreaterThan(
      getPreset('galaxy-z-fold7-folded').width,
    );
  });

  it('미출시 / 추정 프리셋은 라벨에 (est)를 포함한다', () => {
    const iphoneAir = VIEWPORT_PRESETS.find((p) => p.id === 'iphone-air');
    expect(iphoneAir?.label).toContain('(est)');
    const s26 = VIEWPORT_PRESETS.find((p) => p.id === 'galaxy-s26');
    expect(s26?.label).toContain('(est)');
  });
});

describe('effectiveOrientation', () => {
  it('orientation=portrait/landscape는 그 값을 그대로 반환', () => {
    expect(effectiveOrientation(makeState({ orientation: 'portrait' }))).toBe('portrait');
    expect(effectiveOrientation(makeState({ orientation: 'landscape' }))).toBe('landscape');
  });

  it('orientation=auto이면 appOrientation을 따른다', () => {
    expect(
      effectiveOrientation(makeState({ orientation: 'auto', appOrientation: 'landscape' })),
    ).toBe('landscape');
    expect(
      effectiveOrientation(makeState({ orientation: 'auto', appOrientation: 'portrait' })),
    ).toBe('portrait');
  });

  it('orientation=auto이고 appOrientation이 null이면 portrait 기본', () => {
    expect(effectiveOrientation(makeState({ orientation: 'auto', appOrientation: null }))).toBe(
      'portrait',
    );
  });

  it('orientation=portrait이면 appOrientation을 무시한다', () => {
    expect(
      effectiveOrientation(makeState({ orientation: 'portrait', appOrientation: 'landscape' })),
    ).toBe('portrait');
  });
});

describe('resolveViewportSize', () => {
  it('preset=none이면 0×0을 반환한다', () => {
    expect(resolveViewportSize(makeState({ preset: 'none' }))).toEqual({ width: 0, height: 0 });
  });

  it('portrait는 프리셋 값 그대로 반환한다', () => {
    expect(
      resolveViewportSize(makeState({ preset: 'iphone-17', orientation: 'portrait' })),
    ).toEqual({ width: 402, height: 874 });
  });

  it('auto + appOrientation null은 portrait', () => {
    expect(resolveViewportSize(makeState({ preset: 'iphone-17', orientation: 'auto' }))).toEqual({
      width: 402,
      height: 874,
    });
  });

  it('auto + appOrientation=landscape는 landscape로 처리', () => {
    expect(
      resolveViewportSize(
        makeState({ preset: 'iphone-17', orientation: 'auto', appOrientation: 'landscape' }),
      ),
    ).toEqual({ width: 874, height: 402 });
  });

  it('orientation=landscape는 width/height를 swap한다', () => {
    expect(
      resolveViewportSize(makeState({ preset: 'iphone-17', orientation: 'landscape' })),
    ).toEqual({ width: 874, height: 402 });
  });

  it('custom 프리셋은 customWidth/customHeight를 사용한다', () => {
    expect(
      resolveViewportSize(
        makeState({
          preset: 'custom',
          orientation: 'portrait',
          customWidth: 500,
          customHeight: 900,
        }),
      ),
    ).toEqual({ width: 500, height: 900 });
  });

  it('custom + landscape도 swap된다', () => {
    expect(
      resolveViewportSize(
        makeState({
          preset: 'custom',
          orientation: 'landscape',
          customWidth: 500,
          customHeight: 900,
        }),
      ),
    ).toEqual({ width: 900, height: 500 });
  });
});

describe('applyViewport (DOM)', () => {
  beforeEach(() => {
    aitState.reset();
    disposeViewport();
  });

  afterEach(() => {
    disposeViewport();
  });

  it('preset=none이면 html에 active 클래스가 붙지 않는다', () => {
    applyViewport(makeState({ preset: 'none' }));
    expect(document.documentElement.classList.contains('ait-viewport-active')).toBe(false);
  });

  it('프리셋 선택 시 html에 active 클래스가 붙고 style이 주입된다', () => {
    applyViewport(makeState({ preset: 'iphone-17', orientation: 'portrait' }));
    expect(document.documentElement.classList.contains('ait-viewport-active')).toBe(true);
    const style = document.getElementById('__ait-viewport-style');
    expect(style?.textContent).toContain('402px');
    expect(style?.textContent).toContain('874px');
  });

  it('frame=true이면 framed 클래스가 추가된다', () => {
    applyViewport(makeState({ preset: 'iphone-17', frame: true }));
    expect(document.documentElement.classList.contains('ait-viewport-framed')).toBe(true);
  });

  it('preset을 none으로 되돌리면 active/framed 클래스가 제거된다', () => {
    applyViewport(makeState({ preset: 'iphone-17', frame: true }));
    applyViewport(makeState({ preset: 'none' }));
    expect(document.documentElement.classList.contains('ait-viewport-active')).toBe(false);
    expect(document.documentElement.classList.contains('ait-viewport-framed')).toBe(false);
  });

  it('Dynamic Island 프리셋 + frame=true는 notch 오버레이를 추가한다', () => {
    applyViewport(makeState({ preset: 'iphone-17', frame: true }));
    const notch = document.getElementById('__ait-viewport-notch');
    expect(notch).not.toBeNull();
    expect(notch?.classList.contains('ait-notch-dynamic-island')).toBe(true);
  });

  it('frame=false이면 notch 오버레이를 그리지 않는다', () => {
    applyViewport(makeState({ preset: 'iphone-17', frame: false }));
    expect(document.getElementById('__ait-viewport-notch')).toBeNull();
  });

  it('홈버튼 iPhone(SE)은 notch 오버레이를 그리지 않는다', () => {
    applyViewport(makeState({ preset: 'iphone-se-3', frame: true }));
    expect(document.getElementById('__ait-viewport-notch')).toBeNull();
  });

  it('Galaxy 계열은 punch-hole 오버레이를 그린다', () => {
    applyViewport(makeState({ preset: 'galaxy-s26', frame: true }));
    const notch = document.getElementById('__ait-viewport-notch');
    expect(notch?.classList.contains('ait-notch-punch-hole')).toBe(true);
  });

  it('landscape 시 notch 오버레이를 제거한다', () => {
    applyViewport(makeState({ preset: 'iphone-17', frame: true }));
    expect(document.getElementById('__ait-viewport-notch')).not.toBeNull();
    applyViewport(makeState({ preset: 'iphone-17', orientation: 'landscape', frame: true }));
    expect(document.getElementById('__ait-viewport-notch')).toBeNull();
  });

  it('aitNavBar=true이면 nav bar 오버레이 엘리먼트를 추가한다', () => {
    applyViewport(makeState({ preset: 'iphone-17', aitNavBar: true }));
    const navBar = document.getElementById('__ait-viewport-navbar');
    expect(navBar).not.toBeNull();
    expect(navBar?.classList.contains('ait-navbar')).toBe(true);
    expect(navBar?.querySelector('.ait-navbar-back')).not.toBeNull();
    expect(navBar?.querySelector('.ait-navbar-actions')).not.toBeNull();
  });

  it('aitNavBar=false이면 nav bar 오버레이가 없다', () => {
    applyViewport(makeState({ preset: 'iphone-17', aitNavBar: false }));
    expect(document.getElementById('__ait-viewport-navbar')).toBeNull();
  });

  it('landscape에서는 nav bar 오버레이를 숨긴다', () => {
    applyViewport(makeState({ preset: 'iphone-17', aitNavBar: true, orientation: 'landscape' }));
    expect(document.getElementById('__ait-viewport-navbar')).toBeNull();
  });

  it('aitNavBarType=partner는 ait-navbar-partner 클래스 + back/title/actions 모두 렌더', () => {
    applyViewport(makeState({ preset: 'iphone-17', aitNavBar: true, aitNavBarType: 'partner' }));
    const navBar = document.getElementById('__ait-viewport-navbar');
    expect(navBar?.classList.contains('ait-navbar-partner')).toBe(true);
    expect(navBar?.querySelector('.ait-navbar-back')).not.toBeNull();
    expect(navBar?.querySelector('.ait-navbar-title')).not.toBeNull();
    expect(navBar?.querySelector('.ait-navbar-actions')).not.toBeNull();
  });

  it('aitNavBarType=game은 back/title을 생략하고 actions만 렌더', () => {
    applyViewport(makeState({ preset: 'iphone-17', aitNavBar: true, aitNavBarType: 'game' }));
    const navBar = document.getElementById('__ait-viewport-navbar');
    expect(navBar).not.toBeNull();
    expect(navBar?.classList.contains('ait-navbar-game')).toBe(true);
    expect(navBar?.querySelector('.ait-navbar-back')).toBeNull();
    expect(navBar?.querySelector('.ait-navbar-title')).toBeNull();
    expect(navBar?.querySelector('.ait-navbar-name')).toBeNull();
    expect(navBar?.querySelector('.ait-navbar-actions')).not.toBeNull();
  });

  it('aitNavBarType을 patch하면 nav bar가 다시 렌더된다 (partner→game)', () => {
    applyViewport(makeState({ preset: 'iphone-17', aitNavBar: true, aitNavBarType: 'partner' }));
    expect(document.querySelector('.ait-navbar.ait-navbar-partner')).not.toBeNull();
    applyViewport(makeState({ preset: 'iphone-17', aitNavBar: true, aitNavBarType: 'game' }));
    expect(document.querySelector('.ait-navbar.ait-navbar-partner')).toBeNull();
    expect(document.querySelector('.ait-navbar.ait-navbar-game')).not.toBeNull();
  });

  it('nav bar는 preset.safeAreaTop만큼 아래로 이동한다 (status bar 아래)', () => {
    applyViewport(makeState({ preset: 'iphone-17', aitNavBar: true }));
    const navBar = document.getElementById('__ait-viewport-navbar') as HTMLElement | null;
    expect(navBar?.style.top).toBe('59px');
  });

  it('nav bar는 brand.displayName을 사용한다 (textContent로 안전하게, XSS 방지)', () => {
    aitState.patch('brand', { displayName: '<script>x</script>도끼 게임' });
    applyViewport(makeState({ preset: 'iphone-17', aitNavBar: true }));
    const name = document.querySelector('.ait-navbar-name');
    // textContent로 raw 문자열 그대로 표시
    expect(name?.textContent).toBe('<script>x</script>도끼 게임');
    // innerHTML에서는 &lt;...&gt; 엔티티로 escape됨 — markup으로 해석되지 않음을 직접 검증
    expect(name?.innerHTML).toBe('&lt;script&gt;x&lt;/script&gt;도끼 게임');
    // 실제 script 엘리먼트도 없음 (방어적)
    expect(document.querySelector('.ait-navbar-name script')).toBeNull();
  });

  it('home indicator는 frame=true + safeAreaBottom>0 일 때만 그려진다', () => {
    // iPhone 17 (safeAreaBottom=34)
    applyViewport(makeState({ preset: 'iphone-17', frame: true }));
    expect(document.getElementById('__ait-viewport-home-indicator')).not.toBeNull();

    // iPhone SE 3 (safeAreaBottom=0) → no indicator
    disposeViewport();
    applyViewport(makeState({ preset: 'iphone-se-3', frame: true }));
    expect(document.getElementById('__ait-viewport-home-indicator')).toBeNull();
  });

  it('disposeViewport는 모든 viewport DOM mutation을 원복한다', () => {
    applyViewport(makeState({ preset: 'iphone-17', frame: true, aitNavBar: true }));
    expect(document.documentElement.classList.contains('ait-viewport-active')).toBe(true);
    expect(document.getElementById('__ait-viewport-style')).not.toBeNull();
    expect(document.getElementById('__ait-viewport-notch')).not.toBeNull();
    expect(document.getElementById('__ait-viewport-home-indicator')).not.toBeNull();
    expect(document.getElementById('__ait-viewport-navbar')).not.toBeNull();

    disposeViewport();

    expect(document.documentElement.classList.contains('ait-viewport-active')).toBe(false);
    expect(document.documentElement.classList.contains('ait-viewport-framed')).toBe(false);
    expect(document.getElementById('__ait-viewport-style')).toBeNull();
    expect(document.getElementById('__ait-viewport-notch')).toBeNull();
    expect(document.getElementById('__ait-viewport-home-indicator')).toBeNull();
    expect(document.getElementById('__ait-viewport-navbar')).toBeNull();
  });
});

describe('computeSafeAreaInsets', () => {
  it('preset=none이면 모두 0을 반환한다', () => {
    const none = VIEWPORT_PRESETS.find((p) => p.id === 'none');
    if (!none) throw new Error('none preset missing');
    expect(computeSafeAreaInsets(none, false, 'left')).toEqual({
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
    });
  });

  it('portrait iPhone Dynamic Island: top/bottom만 채움', () => {
    expect(computeSafeAreaInsets(getPreset('iphone-17-pro'), false, 'left')).toEqual({
      top: 59,
      bottom: 34,
      left: 0,
      right: 0,
    });
  });

  it('landscape-left iPhone: left에만 노치 인셋, right는 0', () => {
    expect(computeSafeAreaInsets(getPreset('iphone-17-pro'), true, 'left')).toEqual({
      top: 0,
      bottom: 34,
      left: 59,
      right: 0,
    });
  });

  it('landscape-right iPhone: right에만 노치 인셋, left는 0', () => {
    expect(computeSafeAreaInsets(getPreset('iphone-17-pro'), true, 'right')).toEqual({
      top: 0,
      bottom: 34,
      left: 0,
      right: 59,
    });
  });

  it('iPhone SE(홈버튼)는 notch가 없으므로 landscape에서도 top에 status bar만 남는다', () => {
    expect(computeSafeAreaInsets(getPreset('iphone-se-3'), true, 'left')).toEqual({
      top: 20,
      bottom: 0,
      left: 0,
      right: 0,
    });
  });

  it('Android punch-hole은 landscape에서도 status bar가 top에 남는다', () => {
    expect(computeSafeAreaInsets(getPreset('galaxy-s26'), true, 'left')).toEqual({
      top: 32,
      bottom: 0,
      left: 0,
      right: 0,
    });
  });
});

describe('viewport → safeAreaInsets auto-sync', () => {
  beforeEach(() => {
    aitState.reset();
    sessionStorage.clear();
    _resetViewportInit();
  });

  afterEach(() => {
    _resetViewportInit();
    disposeViewport();
  });

  it('initViewport 이후 프리셋을 선택하면 aitState.safeAreaInsets가 갱신된다', () => {
    initViewport();
    aitState.patch('viewport', { preset: 'iphone-17-pro' });
    expect(aitState.state.safeAreaInsets).toEqual({ top: 59, bottom: 34, left: 0, right: 0 });
  });

  it('landscape로 전환하면 iPhone 인셋이 한쪽으로 이동한다 (landscape-left default)', () => {
    initViewport();
    aitState.patch('viewport', { preset: 'iphone-17-pro', orientation: 'landscape' });
    expect(aitState.state.safeAreaInsets).toEqual({ top: 0, bottom: 34, left: 59, right: 0 });
  });

  it('preset=custom이면 safeAreaInsets를 덮어쓰지 않는다', () => {
    initViewport();
    aitState.update({ safeAreaInsets: { top: 10, bottom: 20, left: 0, right: 0 } });
    aitState.patch('viewport', { preset: 'custom' });
    expect(aitState.state.safeAreaInsets).toEqual({ top: 10, bottom: 20, left: 0, right: 0 });
  });

  it('SDK setDeviceOrientation(landscape)이 호출되면 (auto 모드) safe area도 회전한다', async () => {
    const { setDeviceOrientation } = await import('../mock/navigation/index.js');
    initViewport();
    aitState.patch('viewport', { preset: 'iphone-17-pro' });
    expect(aitState.state.safeAreaInsets.top).toBe(59);

    await setDeviceOrientation({ type: 'landscape' });
    // appOrientation이 landscape가 되어 effective orientation이 landscape
    expect(aitState.state.viewport.appOrientation).toBe('landscape');
    expect(aitState.state.safeAreaInsets).toEqual({ top: 0, bottom: 34, left: 59, right: 0 });
  });
});

describe('disposeViewport', () => {
  beforeEach(() => {
    aitState.reset();
    sessionStorage.clear();
    _resetViewportInit();
    disposeViewport();
  });

  afterEach(() => {
    _resetViewportInit();
    disposeViewport();
  });

  it('dispose 후 aitState 변경은 viewport DOM에 반영되지 않는다', () => {
    initViewport();
    aitState.patch('viewport', { preset: 'iphone-17' });
    expect(document.getElementById('__ait-viewport-style')).not.toBeNull();

    disposeViewport();
    expect(document.getElementById('__ait-viewport-style')).toBeNull();

    // 후속 patch는 무시되어야 한다 — listener가 해제되었으므로 style이 다시 생기지 않는다.
    aitState.patch('viewport', { preset: 'iphone-17-pro' });
    expect(document.getElementById('__ait-viewport-style')).toBeNull();
    expect(document.getElementById('__ait-viewport-notch')).toBeNull();
    expect(document.getElementById('__ait-viewport-navbar')).toBeNull();
  });
});

describe('initViewport idempotency', () => {
  beforeEach(() => {
    aitState.reset();
    sessionStorage.clear();
    _resetViewportInit();
  });

  afterEach(() => {
    _resetViewportInit();
    disposeViewport();
  });

  it('두 번째 initViewport 호출은 같은 unsubscribe를 반환한다', () => {
    const u1 = initViewport();
    const u2 = initViewport();
    expect(u1).toBe(u2);
  });

  it('unsubscribe 후 다시 init하면 새 unsubscribe가 반환된다', () => {
    const u1 = initViewport();
    u1();
    const u2 = initViewport();
    expect(u1).not.toBe(u2);
  });
});

describe('clampCustomDimension', () => {
  it('정상 양수 정수는 그대로', () => {
    expect(clampCustomDimension(390)).toBe(390);
  });

  it('소수는 floor', () => {
    expect(clampCustomDimension(390.7)).toBe(390);
  });

  it('1 미만은 null', () => {
    expect(clampCustomDimension(0)).toBeNull();
    expect(clampCustomDimension(-5)).toBeNull();
    expect(clampCustomDimension(0.5)).toBeNull();
  });

  it('상한 이상은 클램프', () => {
    expect(clampCustomDimension(1e15)).toBe(VIEWPORT_CUSTOM_MAX);
  });

  it('NaN/Infinity는 null', () => {
    expect(clampCustomDimension(Number.NaN)).toBeNull();
    expect(clampCustomDimension(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('sessionStorage persistence', () => {
  beforeEach(() => {
    aitState.reset();
    sessionStorage.clear();
    _resetViewportInit();
  });

  afterEach(() => {
    _resetViewportInit();
    disposeViewport();
  });

  it('saveViewportToStorage는 직렬화해 저장한다', () => {
    saveViewportToStorage(
      makeState({
        preset: 'iphone-17-pro',
        orientation: 'landscape',
        customWidth: 400,
        customHeight: 900,
        frame: true,
      }),
    );
    const raw = sessionStorage.getItem(VIEWPORT_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw ?? '{}');
    expect(parsed.preset).toBe('iphone-17-pro');
    expect(parsed.orientation).toBe('landscape');
    expect(parsed.frame).toBe(true);
  });

  it('loadViewportFromStorage는 저장된 값만 반환한다 (유효성 검증)', () => {
    sessionStorage.setItem(
      VIEWPORT_STORAGE_KEY,
      JSON.stringify({
        preset: 'galaxy-s26',
        orientation: 'landscape',
        appOrientation: 'landscape',
        landscapeSide: 'right',
        customWidth: 500,
        customHeight: 900,
        frame: false,
        aitNavBar: false,
        aitNavBarType: 'game',
      }),
    );
    const restored = loadViewportFromStorage();
    expect(restored).toEqual({
      preset: 'galaxy-s26',
      orientation: 'landscape',
      appOrientation: 'landscape',
      landscapeSide: 'right',
      customWidth: 500,
      customHeight: 900,
      frame: false,
      aitNavBar: false,
      aitNavBarType: 'game',
    });
  });

  it('잘못된 aitNavBarType은 무시한다', () => {
    sessionStorage.setItem(
      VIEWPORT_STORAGE_KEY,
      JSON.stringify({ aitNavBarType: 'not-a-real-type' }),
    );
    expect(loadViewportFromStorage()?.aitNavBarType).toBeUndefined();
  });

  it('잘못된 preset id는 무시한다', () => {
    sessionStorage.setItem(
      VIEWPORT_STORAGE_KEY,
      JSON.stringify({ preset: 'not-a-real-device', orientation: 'portrait' }),
    );
    const restored = loadViewportFromStorage();
    expect(restored?.preset).toBeUndefined();
    expect(restored?.orientation).toBe('portrait');
  });

  it('customWidth가 정수가 아니면 무시한다', () => {
    sessionStorage.setItem(
      VIEWPORT_STORAGE_KEY,
      JSON.stringify({ customWidth: 1.5, customHeight: 'not a number' }),
    );
    const restored = loadViewportFromStorage();
    expect(restored?.customWidth).toBeUndefined();
    expect(restored?.customHeight).toBeUndefined();
  });

  it('customWidth가 상한을 초과하면 무시한다', () => {
    sessionStorage.setItem(VIEWPORT_STORAGE_KEY, JSON.stringify({ customWidth: 1e15 }));
    expect(loadViewportFromStorage()?.customWidth).toBeUndefined();
  });

  it('저장된 값이 없으면 null을 반환한다', () => {
    expect(loadViewportFromStorage()).toBeNull();
  });

  it('손상된 JSON은 null을 반환한다', () => {
    sessionStorage.setItem(VIEWPORT_STORAGE_KEY, '{not json');
    expect(loadViewportFromStorage()).toBeNull();
  });

  it('initViewport는 sessionStorage 값을 aitState에 반영한다', () => {
    sessionStorage.setItem(
      VIEWPORT_STORAGE_KEY,
      JSON.stringify({
        preset: 'iphone-17-pro',
        orientation: 'portrait',
        customWidth: 400,
        customHeight: 900,
        frame: true,
      }),
    );
    initViewport();
    expect(aitState.state.viewport.preset).toBe('iphone-17-pro');
    expect(aitState.state.viewport.frame).toBe(true);
  });

  it('initViewport 이후 aitState 변경은 자동으로 sessionStorage에 저장된다', () => {
    initViewport();
    aitState.patch('viewport', { preset: 'galaxy-s26-ultra', orientation: 'landscape' });
    const raw = sessionStorage.getItem(VIEWPORT_STORAGE_KEY);
    const parsed = JSON.parse(raw ?? '{}');
    expect(parsed.preset).toBe('galaxy-s26-ultra');
    expect(parsed.orientation).toBe('landscape');
  });
});

describe('brand displayName subscription', () => {
  beforeEach(() => {
    aitState.reset();
    sessionStorage.clear();
    _resetViewportInit();
    disposeViewport();
  });

  afterEach(() => {
    _resetViewportInit();
    disposeViewport();
  });

  it('brand.displayName 변경 시 nav bar 텍스트만 갱신되고 element 자체는 재생성되지 않는다', () => {
    initViewport();
    aitState.patch('viewport', { preset: 'iphone-17', aitNavBar: true });
    const initialNavBar = document.getElementById('__ait-viewport-navbar');
    expect(initialNavBar).not.toBeNull();
    const initialName = initialNavBar?.querySelector('.ait-navbar-name');
    expect(initialName?.textContent).toBe('Mock App');

    aitState.patch('brand', { displayName: '도끼 게임' });

    // 같은 nav bar element 인스턴스에서 텍스트만 바뀐다 (M-3: brand-only refresh).
    expect(document.getElementById('__ait-viewport-navbar')).toBe(initialNavBar);
    expect(initialName?.textContent).toBe('도끼 게임');
  });
});

describe('body-scroll hint (console.info)', () => {
  beforeEach(() => {
    aitState.reset();
    _resetViewportInit();
    disposeViewport();
  });

  afterEach(() => {
    _resetViewportInit();
    disposeViewport();
  });

  it('viewport 활성화 시 console.info를 한 번만 발행하고, 후속 호출은 침묵한다', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});

    applyViewport({
      preset: 'iphone-17',
      orientation: 'auto',
      appOrientation: null,
      landscapeSide: 'left',
      customWidth: 0,
      customHeight: 0,
      frame: false,
      aitNavBar: false,
      aitNavBarType: 'partner',
    });
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0][0]).toContain('Viewport simulation active');

    applyViewport({
      preset: 'iphone-17-pro',
      orientation: 'auto',
      appOrientation: null,
      landscapeSide: 'left',
      customWidth: 0,
      customHeight: 0,
      frame: false,
      aitNavBar: false,
      aitNavBarType: 'partner',
    });
    expect(info).toHaveBeenCalledTimes(1); // not re-emitted

    info.mockRestore();
  });
});

describe('aitState.viewport integration', () => {
  beforeEach(() => {
    aitState.reset();
    _resetViewportInit();
  });

  afterEach(() => {
    _resetViewportInit();
    disposeViewport();
  });

  it('기본값은 preset=none, orientation=auto, appOrientation=null, landscapeSide=left, aitNavBar=true, aitNavBarType=partner', () => {
    expect(aitState.state.viewport.preset).toBe('none');
    expect(aitState.state.viewport.orientation).toBe('auto');
    expect(aitState.state.viewport.appOrientation).toBeNull();
    expect(aitState.state.viewport.landscapeSide).toBe('left');
    expect(aitState.state.viewport.frame).toBe(false);
    expect(aitState.state.viewport.aitNavBar).toBe(true);
    expect(aitState.state.viewport.aitNavBarType).toBe('partner');
  });

  it('patch로 프리셋을 변경할 수 있다', () => {
    aitState.patch('viewport', { preset: 'iphone-17' });
    expect(aitState.state.viewport.preset).toBe('iphone-17');
  });

  it('reset 후 viewport도 기본값으로 돌아간다', () => {
    aitState.patch('viewport', {
      preset: 'galaxy-s26-ultra',
      orientation: 'landscape',
      frame: true,
      appOrientation: 'landscape',
    });
    aitState.reset();
    expect(aitState.state.viewport.preset).toBe('none');
    expect(aitState.state.viewport.orientation).toBe('auto');
    expect(aitState.state.viewport.appOrientation).toBeNull();
    expect(aitState.state.viewport.frame).toBe(false);
  });
});
