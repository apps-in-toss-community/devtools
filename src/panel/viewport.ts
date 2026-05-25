/**
 * Viewport 시뮬레이션 유틸
 *
 * Panel에서 선택한 디바이스 프리셋을 `document.body`에 적용한다. 정적 CSS는
 * `panel/styles.ts`에 정의되어 있고 (Panel mount 시 head에 주입), 여기서는 프리셋별
 * 동적 값(width/height, 콘텐츠 push용 body padding-top)만 별도 `<style>` 엘리먼트로
 * 관리한다.
 */

import { closeView } from '../mock/navigation/index.js';
import { aitState } from '../mock/state.js';
import type {
  AitNavBarType,
  AppOrientation,
  LandscapeSide,
  SafeAreaInsets,
  SafeAreaProvenance,
  ViewportOrientation,
  ViewportPreset,
  ViewportPresetId,
  ViewportState,
} from '../mock/types.js';
import { revertDeviceEmulation, syncDeviceEmulation } from './device-emulation.js';
import { h } from './helpers.js';

export const VIEWPORT_STORAGE_KEY = '__ait_viewport';

/** Custom width/height의 안전 상한 (CSS px). 4K + 여유. */
export const VIEWPORT_CUSTOM_MAX = 4096;

/**
 * Apps in Toss host nav bar 높이 (CSS px), `partner` type 기준.
 *
 * iPhone 15 Pro on-device relay 실측값(devtools#190): `SafeAreaInsets.get().top`이
 * **54 px**를 반환했고, 같은 시점 `env(safe-area-inset-top)`은 0이었다. 즉 SDK가 top으로
 * 주는 값은 OS 노치 inset이 아니라 토스 네이티브 nav bar 높이 그 자체다 — nav bar는 호스트
 * chrome이라 기기에 무관하므로 모든 preset이 이 단일 상수를 공유한다(이전 추정치 48은 폐기).
 *
 * type별 동작:
 * - `partner` (기본): nav bar가 콘텐츠를 밀어내므로 SDK top = 이 값.
 * - `game`: nav bar가 투명 오버레이라 콘텐츠를 밀어내지 않음(인게임 full-screen이 출시 요건)
 *   → SDK top = 0. `external` type은 아직 시뮬레이션하지 않는다.
 *
 * landscape에서의 nav bar 거동은 아직 실측하지 못해 portrait 모델만 확정이다(landscape는
 * 노치를 측면 inset으로 돌리고 top=0 유지 — 후속 실측 대상).
 */
export const AIT_NAV_BAR_HEIGHT_PARTNER = 54;

const NONE_PRESET: ViewportPreset = {
  id: 'none',
  label: 'None (full window)',
  width: 0,
  height: 0,
  dpr: 1,
  notch: 'none',
  notchInset: 0,
  navBarHeight: 0,
  safeAreaBottom: 0,
};

const CUSTOM_PRESET: ViewportPreset = {
  id: 'custom',
  label: 'Custom',
  width: 0,
  height: 0,
  dpr: 1,
  notch: 'none',
  notchInset: 0,
  navBarHeight: 0,
  safeAreaBottom: 0,
};

/** Shorthands used when building preset provenance entries. */
const EXTRAPOLATED: SafeAreaProvenance = { source: 'extrapolated' };
const PLACEHOLDER: SafeAreaProvenance = { source: 'placeholder' };

/**
 * Device presets (2026). CSS viewport 크기는 실제 기기의 `window.innerWidth/innerHeight`.
 * iPhone 17 시리즈는 2025-09 출시. iPhone Air는 2026-04 출시.
 * Galaxy S26 시리즈는 2026-03-11 출시 — viewport 값은 phone-simulator.com에서 보고된
 * 측정치를 사용.
 *
 * safe-area 모델 (devtools#190 relay 실측 반영):
 * - `notchInset` = OS 노치/status bar inset. 기기별 물리값(landscape 측면 inset + 시각
 *   노치 오버레이용). iPhone 15 Pro 실측에서 `env(safe-area-inset-top)`은 0이었으므로 이
 *   값은 portrait SDK top에는 들어가지 않는다.
 * - `navBarHeight` = 토스 호스트 nav bar 높이. partner type portrait의 SDK `top`(실측 54).
 *   호스트 chrome이라 기기 무관 — 전 preset이 `AIT_NAV_BAR_HEIGHT_PARTNER` 공유.
 * - `safeAreaBottom` = home-indicator inset. 기기별(노치 iPhone 34, 홈버튼/Android 0).
 *   iPhone 15 Pro 실측 bottom 34와 일치.
 *
 * 단, navBarHeight 54는 iOS partner에서만 실측됐다 — Android nav bar 높이와 game type
 * 미세 차이는 후속 실측 대상(현재는 같은 값을 잠정 적용).
 *
 * iPhone 17과 17 Pro는 CSS viewport / DPR / safe area가 동일 — 이는 의도이며 카피-페이스트
 * 실수가 아니다. Apple의 17 lineup은 base와 Pro의 web-relevant 스펙이 같다.
 *
 * safeAreaProvenance: 각 preset의 safe-area 값 신뢰도 출처.
 * - `measured` — relay 실기기 세션(measure_safe_area)으로 직접 확인한 값.
 *   현재 iPhone 15 Pro portrait iOS partner만 해당 (devtools#190).
 * - `extrapolated` — Apple 스펙/같은 시리즈 기기에서 유추한 값.
 * - `placeholder` — 연결 기기 없이 추정한 값. QA ground truth로 쓰지 말 것.
 *   `measure_safe_area` MCP 툴로 relay 세션에서 `measured`로 승급 필요.
 */
export const VIEWPORT_PRESETS: ViewportPreset[] = [
  NONE_PRESET,
  // Apple
  {
    id: 'iphone-se-3',
    label: 'iPhone SE (3rd gen)',
    width: 375,
    height: 667,
    dpr: 2,
    notch: 'none',
    notchInset: 20,
    navBarHeight: AIT_NAV_BAR_HEIGHT_PARTNER,
    safeAreaBottom: 0,
    // SE 3는 홈버튼 기기 — OS 노치 없고 home indicator도 없음. bottom=0은 확정.
    // navBarHeight는 iOS partner 실측(54)에서 기기 무관 상수. extrapolated.
    safeAreaProvenance: EXTRAPOLATED,
  },
  {
    id: 'iphone-15-pro',
    label: 'iPhone 15 Pro',
    width: 393,
    height: 852,
    dpr: 3,
    notch: 'dynamic-island',
    notchInset: 59,
    navBarHeight: AIT_NAV_BAR_HEIGHT_PARTNER,
    safeAreaBottom: 34,
    // devtools#190 relay 실측: iOS partner portrait에서 navBarHeight=54, bottom=34 확인.
    safeAreaProvenance: { source: 'measured', device: 'iPhone 15 Pro', date: '2026-05-25' },
  },
  {
    id: 'iphone-16e',
    label: 'iPhone 16e',
    width: 390,
    height: 844,
    dpr: 3,
    notch: 'notch',
    notchInset: 47,
    navBarHeight: AIT_NAV_BAR_HEIGHT_PARTNER,
    safeAreaBottom: 34,
    // 16e는 notch 기기. bottom 34는 Apple 스펙에서 유추. 실측 미진행.
    safeAreaProvenance: EXTRAPOLATED,
  },
  {
    id: 'iphone-17',
    label: 'iPhone 17',
    width: 402,
    height: 874,
    dpr: 3,
    notch: 'dynamic-island',
    notchInset: 59,
    navBarHeight: AIT_NAV_BAR_HEIGHT_PARTNER,
    safeAreaBottom: 34,
    // 17 시리즈 Dynamic Island — bottom 34 Apple 스펙 유추. 실측 미진행.
    safeAreaProvenance: EXTRAPOLATED,
  },
  {
    id: 'iphone-air',
    label: 'iPhone Air',
    width: 420,
    height: 912,
    dpr: 3,
    notch: 'dynamic-island',
    notchInset: 59,
    navBarHeight: AIT_NAV_BAR_HEIGHT_PARTNER,
    safeAreaBottom: 34,
    // iPhone Air (2026-04 출시) — Dynamic Island 유추. 실측 미진행.
    safeAreaProvenance: EXTRAPOLATED,
  },
  {
    id: 'iphone-17-pro',
    label: 'iPhone 17 Pro',
    width: 402,
    height: 874,
    dpr: 3,
    notch: 'dynamic-island',
    notchInset: 59,
    navBarHeight: AIT_NAV_BAR_HEIGHT_PARTNER,
    safeAreaBottom: 34,
    // 17 Pro — 17와 web-relevant 스펙 동일. 유추.
    safeAreaProvenance: EXTRAPOLATED,
  },
  {
    id: 'iphone-17-pro-max',
    label: 'iPhone 17 Pro Max',
    width: 440,
    height: 956,
    dpr: 3,
    notch: 'dynamic-island',
    notchInset: 62,
    navBarHeight: AIT_NAV_BAR_HEIGHT_PARTNER,
    safeAreaBottom: 34,
    // Pro Max — notchInset 62는 Apple 스펙 유추. 실측 미진행.
    safeAreaProvenance: EXTRAPOLATED,
  },
  // Samsung
  //
  // Galaxy S26 series shipped 2026-03-11. Viewport widths/heights below come
  // from phone-simulator.com's measured values. safe-area top/bottom remain
  // S25-derived placeholders because we have no toss host live-measure yet —
  // do not treat them as ground truth for QA.
  {
    id: 'galaxy-s26',
    label: 'Galaxy S26',
    width: 360,
    height: 773,
    dpr: 3,
    notch: 'punch-hole-center',
    notchInset: 32,
    navBarHeight: AIT_NAV_BAR_HEIGHT_PARTNER,
    safeAreaBottom: 0,
    // Android safe-area는 relay 실측 없음. placeholder.
    safeAreaProvenance: PLACEHOLDER,
  },
  {
    id: 'galaxy-s26-plus',
    label: 'Galaxy S26+',
    width: 480,
    height: 1040,
    dpr: 3,
    notch: 'punch-hole-center',
    notchInset: 32,
    navBarHeight: AIT_NAV_BAR_HEIGHT_PARTNER,
    safeAreaBottom: 0,
    safeAreaProvenance: PLACEHOLDER,
  },
  {
    id: 'galaxy-s26-ultra',
    label: 'Galaxy S26 Ultra',
    width: 480,
    height: 1040,
    dpr: 3,
    notch: 'punch-hole-center',
    notchInset: 40,
    navBarHeight: AIT_NAV_BAR_HEIGHT_PARTNER,
    safeAreaBottom: 0,
    safeAreaProvenance: PLACEHOLDER,
  },
  {
    id: 'galaxy-z-flip7',
    label: 'Galaxy Z Flip7',
    width: 412,
    height: 990,
    dpr: 3,
    notch: 'punch-hole-center',
    notchInset: 36,
    navBarHeight: AIT_NAV_BAR_HEIGHT_PARTNER,
    safeAreaBottom: 0,
    safeAreaProvenance: PLACEHOLDER,
  },
  {
    id: 'galaxy-z-fold7-folded',
    label: 'Galaxy Z Fold7 (folded)',
    width: 384,
    height: 870,
    dpr: 3,
    notch: 'punch-hole-center',
    notchInset: 32,
    navBarHeight: AIT_NAV_BAR_HEIGHT_PARTNER,
    safeAreaBottom: 0,
    safeAreaProvenance: PLACEHOLDER,
  },
  {
    id: 'galaxy-z-fold7-unfolded',
    label: 'Galaxy Z Fold7 (unfolded)',
    width: 768,
    height: 884,
    dpr: 2.625,
    notch: 'punch-hole-center',
    notchInset: 32,
    navBarHeight: AIT_NAV_BAR_HEIGHT_PARTNER,
    safeAreaBottom: 0,
    safeAreaProvenance: PLACEHOLDER,
  },
  CUSTOM_PRESET,
];

export function getPreset(id: ViewportPresetId): ViewportPreset {
  return VIEWPORT_PRESETS.find((p) => p.id === id) ?? NONE_PRESET;
}

/**
 * 실제로 화면에 표시될 orientation을 결정한다.
 *
 * - Panel `orientation === 'auto'`: 앱이 마지막으로 SDK로 요청한 값
 *   (`appOrientation`)을 따른다. 호출 전이면 portrait.
 * - Panel `orientation === 'portrait' | 'landscape'`: Panel 값이 우선.
 */
export function effectiveOrientation(state: ViewportState): 'portrait' | 'landscape' {
  if (state.orientation === 'auto') {
    return state.appOrientation ?? 'portrait';
  }
  return state.orientation;
}

/**
 * 선택된 뷰포트의 실제 width/height를 계산한다.
 * preset === 'custom'이면 customWidth/customHeight, 그 외에는 preset의 값.
 * effective orientation이 landscape이면 width/height를 swap한다.
 */
export function resolveViewportSize(state: ViewportState): { width: number; height: number } {
  if (state.preset === 'none') return { width: 0, height: 0 };
  const base =
    state.preset === 'custom'
      ? { width: state.customWidth, height: state.customHeight }
      : getPreset(state.preset);
  return effectiveOrientation(state) === 'landscape'
    ? { width: base.height, height: base.width }
    : { width: base.width, height: base.height };
}

/**
 * 프리셋 + orientation + nav bar 상태로부터 SDK `SafeAreaInsets.get()`이 반환할 insets를
 * 계산한다. iPhone 15 Pro on-device relay 실측(devtools#190)에 맞춘 모델:
 *
 * - **Portrait top = 토스 nav bar 높이** (OS 노치가 아니다). 실측에서
 *   `env(safe-area-inset-top)` = 0, `SafeAreaInsets.get().top` = 54 였고, 그 54는 호스트
 *   nav bar다. 따라서 nav bar가 떠 있고 `partner` type일 때만 `navBarHeight`를 top에 준다.
 *   `game`(투명 오버레이, 콘텐츠 안 밀어냄) 또는 nav bar 미표시면 top = 0.
 * - **Bottom = `safeAreaBottom`** (home-indicator). 실측 34와 일치.
 * - **Landscape iPhone(notch/Dynamic Island)**: 노치가 한쪽으로 가므로 `landscapeSide`에
 *   따라 left/right 한쪽에만 `notchInset`을 준다. top은 0(landscape nav bar 거동은
 *   미실측 — portrait 모델만 확정), home-indicator는 bottom에 유지.
 * - **Android punch-hole(status bar)**: landscape에서도 top에 status bar(`notchInset`)가
 *   유지된다.
 */
export function computeSafeAreaInsets(
  preset: ViewportPreset,
  landscape: boolean,
  side: LandscapeSide,
  navBarVisible: boolean,
  navBarType: AitNavBarType,
): SafeAreaInsets {
  if (preset.id === 'none' || preset.id === 'custom') {
    return { top: 0, bottom: 0, left: 0, right: 0 };
  }
  // partner nav bar가 떠 있을 때만 콘텐츠를 밀어낸다 (game은 투명 오버레이).
  const navBarTop = navBarVisible && navBarType === 'partner' ? preset.navBarHeight : 0;
  if (!landscape) {
    return { top: navBarTop, bottom: preset.safeAreaBottom, left: 0, right: 0 };
  }
  if (preset.notch === 'notch' || preset.notch === 'dynamic-island') {
    return {
      top: 0,
      bottom: preset.safeAreaBottom,
      left: side === 'left' ? preset.notchInset : 0,
      right: side === 'right' ? preset.notchInset : 0,
    };
  }
  // Android status bar stays on the top edge even in landscape.
  return {
    top: preset.notchInset,
    bottom: preset.safeAreaBottom,
    left: 0,
    right: 0,
  };
}

/** viewport preset 또는 orientation이 바뀌면 safe-area insets도 자동 갱신한다. */
function syncSafeAreaFromViewport(state: ViewportState): void {
  if (state.preset === 'none' || state.preset === 'custom') return;
  const preset = getPreset(state.preset);
  const next = computeSafeAreaInsets(
    preset,
    effectiveOrientation(state) === 'landscape',
    state.landscapeSide,
    state.aitNavBar,
    state.aitNavBarType,
  );
  const current = aitState.state.safeAreaInsets;
  if (
    current.top === next.top &&
    current.bottom === next.bottom &&
    current.left === next.left &&
    current.right === next.right
  ) {
    return;
  }
  aitState.update({ safeAreaInsets: next });
}

const STYLE_ELEMENT_ID = '__ait-viewport-style';
const NOTCH_ELEMENT_ID = '__ait-viewport-notch';
const HOME_INDICATOR_ID = '__ait-viewport-home-indicator';
const NAV_BAR_ELEMENT_ID = '__ait-viewport-navbar';

let bodyScrollHintEmitted = false;

function ensureStyleElement(): HTMLStyleElement | null {
  if (typeof document === 'undefined') return null;
  let el = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ELEMENT_ID;
    document.head.appendChild(el);
  }
  return el;
}

function removeById(id: string): void {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function removeNotchElement(): void {
  removeById(NOTCH_ELEMENT_ID);
}

function removeHomeIndicator(): void {
  removeById(HOME_INDICATOR_ID);
}

function removeNavBarElement(): void {
  removeById(NAV_BAR_ELEMENT_ID);
}

/**
 * Apps in Toss host nav bar 렌더. OS status bar(notch) 아래에 쌓인다.
 *
 * 변형(SDK `webViewProps.type`과 의미 일치):
 * - `partner` (기본): 흰 배경, 좌측 뒤로가기(‹), 앱 아이콘 + 이름(`brand.displayName`),
 *   우측 `⋯` + 구분선 + `×`.
 * - `game`: 투명 배경, 게임 캔버스를 가리지 않도록 우측 `⋯` + 구분선 + `×`만.
 *
 * nav bar는 WebView(body) 좌표계의 최상단(top 0)에 앉는다 — 실기기에서 OS notch는
 * WebView 밖(status bar)이라 `env(safe-area-inset-top)`이 0이고, WebView 콘텐츠 영역은
 * nav bar 바로 아래(= SDK `SafeAreaInsets.get().top` = `navBarHeight`)에서 시작한다.
 * 콘텐츠를 그만큼 밀어내는 건 `applyViewport`의 body `padding-top`이 담당하므로, nav bar
 * 바닥과 콘텐츠 시작이 정확히 맞물린다. 시각 notch 오버레이는 body 밖 위쪽(status bar
 * 영역)에 따로 그린다(`renderNotchOverlay`) — body 안이 아니다.
 *
 * 뒤로가기 버튼은 `__ait:backEvent`를 트리거하고, X 버튼은 `closeView()`를 호출한다.
 * 실제 SDK 이벤트 플러밍을 한 곳에서 검증할 수 있다.
 */
function renderNavBar(displayName: string, type: AitNavBarType): void {
  removeNavBarElement();
  const el = h('div', {
    id: NAV_BAR_ELEMENT_ID,
    className: `ait-navbar ait-navbar-${type}`,
    'aria-hidden': 'true',
  });

  const moreBtn = h('button', {
    className: 'ait-navbar-btn',
    type: 'button',
    'aria-label': 'More',
  });
  moreBtn.textContent = '⋯';

  const closeBtn = h('button', {
    className: 'ait-navbar-btn',
    type: 'button',
    'aria-label': 'Close',
  });
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => {
    closeView().catch((err) => console.error('[@ait-co/devtools] navbar close failed:', err));
  });

  const actions = h(
    'div',
    { className: 'ait-navbar-actions' },
    moreBtn,
    h('span', { className: 'ait-navbar-divider' }),
    closeBtn,
  );

  if (type === 'game') {
    // Game: 투명 배경, back/title 없음, 우측 actions만 (실제 토스 host 동작과 일치).
    el.append(actions);
  } else {
    const backBtn = h('button', {
      className: 'ait-navbar-btn ait-navbar-back',
      type: 'button',
      'aria-label': 'Back',
    });
    backBtn.textContent = '‹';
    backBtn.addEventListener('click', () => {
      aitState.trigger('backEvent');
    });

    const nameSpan = h('span', { className: 'ait-navbar-name' });
    nameSpan.textContent = displayName;

    el.append(
      backBtn,
      h(
        'div',
        { className: 'ait-navbar-title' },
        h('span', { className: 'ait-navbar-icon' }),
        nameSpan,
      ),
      actions,
    );
  }

  document.body.appendChild(el);
}

/**
 * 현재 preset의 notch/Dynamic Island/punch-hole을 body 상단에 시각적으로 렌더한다.
 * landscape 시에는 노치가 한쪽 변에 있는 것이 실제 기기 동작이지만, 시뮬레이터에서는
 * landscape에서 오버레이를 그리지 않는다 (safeAreaInsets의 left/right로 이미 반영).
 */
function renderNotchOverlay(preset: ViewportPreset): void {
  removeNotchElement();
  if (preset.notch === 'none') return;

  const variant =
    preset.notch === 'dynamic-island'
      ? 'ait-notch-dynamic-island'
      : preset.notch === 'notch'
        ? 'ait-notch-pill'
        : 'ait-notch-punch-hole';

  const notch = h('div', {
    id: NOTCH_ELEMENT_ID,
    className: `ait-notch ${variant}`,
    'aria-hidden': 'true',
  });
  document.body.appendChild(notch);
}

/** brand 이름만 바뀐 경우 nav bar 전체를 다시 만들지 않고 텍스트 노드만 교체한다. */
function refreshNavBarBrand(displayName: string): void {
  const name = document.querySelector(`#${NAV_BAR_ELEMENT_ID} .ait-navbar-name`);
  if (name) name.textContent = displayName;
}

function renderHomeIndicator(): void {
  removeHomeIndicator();
  const el = h('div', {
    id: HOME_INDICATOR_ID,
    className: 'ait-home-indicator',
    'aria-hidden': 'true',
  });
  document.body.appendChild(el);
}

/**
 * 모든 viewport DOM mutation을 원복하고 aitState 구독도 해제한다.
 * 외부 consumer가 패널을 동적으로 제거할 때 호출. 호출 후에는 aitState 변경이
 * DOM에 반영되지 않으므로 안전하게 panel을 떼어낼 수 있다.
 */
export function disposeViewport(): void {
  if (typeof document === 'undefined') return;
  if (viewportUnsubscribe) viewportUnsubscribe();
  const html = document.documentElement;
  html.classList.remove('ait-viewport-active');
  html.classList.remove('ait-viewport-framed');
  removeById(STYLE_ELEMENT_ID);
  removeNotchElement();
  removeHomeIndicator();
  removeNavBarElement();
  revertDeviceEmulation();
  bodyScrollHintEmitted = false;
}

/**
 * DOM에 뷰포트 제약을 적용한다.
 * - `html.ait-viewport-active` 클래스로 정적 CSS(styles.ts) 활성화
 * - body의 width/height는 preset 값으로, navbar top offset은 notchInset으로 인라인 주입
 */
export function applyViewport(state: ViewportState): void {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  const style = ensureStyleElement();
  if (!style) return;

  const size = resolveViewportSize(state);

  if (state.preset === 'none' || size.width === 0 || size.height === 0) {
    html.classList.remove('ait-viewport-active');
    html.classList.remove('ait-viewport-framed');
    style.textContent = '';
    removeNotchElement();
    removeHomeIndicator();
    removeNavBarElement();
    syncDeviceEmulation(null, false);
    return;
  }

  if (!bodyScrollHintEmitted) {
    bodyScrollHintEmitted = true;
    console.info(
      '[@ait-co/devtools] Viewport simulation active — scroll happens on body, not window. ' +
        'See README "Known limitations" for details.',
    );
  }

  html.classList.add('ait-viewport-active');
  html.classList.toggle('ait-viewport-framed', state.frame);

  const preset = state.preset === 'custom' ? null : getPreset(state.preset);
  const landscape = effectiveOrientation(state) === 'landscape';

  // 기기 preset이면 UA/DPR/screen/platform을 그 기기와 정합 (custom은 치수만 강제).
  syncDeviceEmulation(preset, landscape);

  // partner nav bar는 실기기 토스 호스트처럼 콘텐츠를 밀어낸다 — body padding-top으로
  // 재현한다. game은 투명 오버레이라 안 밀고(0), nav bar 미표시·landscape도 0. 미는 양은
  // SDK `SafeAreaInsets.get().top`과 같은 값이라 computeSafeAreaInsets의 top을 단일 진실로
  // 쓴다 (오버레이로만 얹으면 nav bar가 콘텐츠 첫 픽셀을 덮어 실기기와 어긋난다).
  const contentTop = preset
    ? computeSafeAreaInsets(
        preset,
        landscape,
        state.landscapeSide,
        state.aitNavBar,
        state.aitNavBarType,
      ).top
    : 0;

  // Dynamic per-preset values only — static rules live in styles.ts.
  style.textContent = /* css */ `
    html.ait-viewport-active body {
      width: ${size.width}px;
      max-width: ${size.width}px;
      min-height: ${size.height}px;
      max-height: ${size.height}px;
      padding-top: ${contentTop}px;
    }
  `;

  // Notch / home indicator / nav bar are gated in JS so document.getElementById
  // becomes a reliable "is overlay present" predicate.
  if (preset && state.frame && !landscape) renderNotchOverlay(preset);
  else removeNotchElement();

  if (preset && state.frame && !landscape && preset.safeAreaBottom > 0) renderHomeIndicator();
  else removeHomeIndicator();

  if (preset && state.aitNavBar && !landscape) {
    renderNavBar(aitState.state.brand.displayName, state.aitNavBarType);
  } else {
    removeNavBarElement();
  }
}

function isViewportPresetId(v: unknown): v is ViewportPresetId {
  return typeof v === 'string' && VIEWPORT_PRESETS.some((p) => p.id === v);
}

function isViewportOrientation(v: unknown): v is ViewportOrientation {
  return v === 'auto' || v === 'portrait' || v === 'landscape';
}

function isAppOrientation(v: unknown): v is AppOrientation {
  return v === null || v === 'portrait' || v === 'landscape';
}

function isLandscapeSide(v: unknown): v is LandscapeSide {
  return v === 'left' || v === 'right';
}

/** 1 이상의 정수 + VIEWPORT_CUSTOM_MAX 이하인지 검사. sessionStorage 보호용. */
function isValidCustomDimension(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= VIEWPORT_CUSTOM_MAX;
}

/** Custom 입력에서 사용. 잘린 정수 + 클램프된 안전한 값 또는 null 반환. */
export function clampCustomDimension(raw: number): number | null {
  if (!Number.isFinite(raw)) return null;
  const n = Math.floor(raw);
  if (n < 1) return null;
  return Math.min(n, VIEWPORT_CUSTOM_MAX);
}

/**
 * sessionStorage에 저장된 뷰포트 상태를 읽어서 현재 state에 merge한다.
 * 값이 없거나 파싱 실패 시 no-op.
 */
export function loadViewportFromStorage(): Partial<ViewportState> | null {
  if (typeof sessionStorage === 'undefined') return null;
  const raw = sessionStorage.getItem(VIEWPORT_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    const next: Partial<ViewportState> = {};
    if (isViewportPresetId(obj.preset)) next.preset = obj.preset;
    if (isViewportOrientation(obj.orientation)) next.orientation = obj.orientation;
    if (isAppOrientation(obj.appOrientation)) next.appOrientation = obj.appOrientation;
    if (isLandscapeSide(obj.landscapeSide)) next.landscapeSide = obj.landscapeSide;
    if (isValidCustomDimension(obj.customWidth)) next.customWidth = obj.customWidth;
    if (isValidCustomDimension(obj.customHeight)) next.customHeight = obj.customHeight;
    if (typeof obj.frame === 'boolean') next.frame = obj.frame;
    if (typeof obj.aitNavBar === 'boolean') next.aitNavBar = obj.aitNavBar;
    if (obj.aitNavBarType === 'partner' || obj.aitNavBarType === 'game') {
      next.aitNavBarType = obj.aitNavBarType;
    }
    return next;
  } catch {
    return null;
  }
}

export function saveViewportToStorage(state: ViewportState): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(VIEWPORT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota errors */
  }
}

let viewportInitialized = false;
let viewportUnsubscribe: (() => void) | null = null;

/**
 * Panel mount 시 호출. sessionStorage 복원 → aitState에 반영 → DOM 적용.
 * aitState 변경을 구독해서 DOM / storage / safe-area insets를 자동 동기화한다.
 *
 * Idempotent: 두 번째 호출은 기존 unsubscribe를 그대로 반환한다 (HMR / 재mount 안전).
 * 테스트는 반환된 unsubscribe를 afterEach에서 호출해 cleanup해야 한다.
 */
export function initViewport(): () => void {
  if (typeof window === 'undefined') return () => {};
  if (viewportInitialized && viewportUnsubscribe) return viewportUnsubscribe;

  const restored = loadViewportFromStorage();
  if (restored) {
    aitState.patch('viewport', restored);
  }
  applyViewport(aitState.state.viewport);
  syncSafeAreaFromViewport(aitState.state.viewport);

  let lastViewportJson = JSON.stringify(aitState.state.viewport);
  let lastBrandName = aitState.state.brand.displayName;

  const unsubscribeFn = aitState.subscribe(() => {
    const vp = aitState.state.viewport;
    const brandName = aitState.state.brand.displayName;
    const json = JSON.stringify(vp);

    const viewportChanged = json !== lastViewportJson;
    const brandChanged = brandName !== lastBrandName;

    if (!viewportChanged && !brandChanged) return;
    lastViewportJson = json;
    lastBrandName = brandName;

    if (viewportChanged) {
      applyViewport(vp);
      saveViewportToStorage(vp);
      syncSafeAreaFromViewport(vp);
    } else {
      // Brand-only change: refresh just the nav bar text instead of rebuilding all overlays.
      refreshNavBarBrand(brandName);
    }
  });

  viewportInitialized = true;
  viewportUnsubscribe = () => {
    unsubscribeFn();
    viewportInitialized = false;
    viewportUnsubscribe = null;
  };
  return viewportUnsubscribe;
}

/**
 * @internal Test helper. Production code never touches this — use `disposeViewport()`.
 */
export function _resetViewportInit(): void {
  if (viewportUnsubscribe) viewportUnsubscribe();
  viewportInitialized = false;
  viewportUnsubscribe = null;
}
