/**
 * Viewport 시뮬레이션 유틸
 *
 * Panel에서 선택한 디바이스 프리셋을 `document.body`에 적용한다. 정적 CSS는
 * `panel/styles.ts`에 정의되어 있고 (Panel mount 시 head에 주입), 여기서는 프리셋별
 * 동적 값(width/height, navbar top offset)만 별도 `<style>` 엘리먼트로 관리한다.
 */

import { closeView } from '../mock/navigation/index.js';
import { aitState } from '../mock/state.js';
import type {
  AppOrientation,
  LandscapeSide,
  SafeAreaInsets,
  ViewportOrientation,
  ViewportPreset,
  ViewportPresetId,
  ViewportState,
} from '../mock/types.js';
import { h } from './helpers.js';

export const VIEWPORT_STORAGE_KEY = '__ait_viewport';

/** Custom width/height의 안전 상한 (CSS px). 4K + 여유. */
export const VIEWPORT_CUSTOM_MAX = 4096;

/**
 * Apps in Toss의 host nav bar 높이 (CSS px). 공식 docs에는 명시되어 있지 않지만
 * Toss 공식 예제(`with-contacts-viral`, `random-balls`)가 safeArea.top에 `+ 48`을
 * 추가하는 패턴을 쓴다. SafeAreaInsets에는 포함되지 않으므로 별도 상수로 관리.
 */
export const AIT_NAV_BAR_HEIGHT = 48;

const NONE_PRESET: ViewportPreset = {
  id: 'none',
  label: 'None (full window)',
  width: 0,
  height: 0,
  dpr: 1,
  notch: 'none',
  safeAreaTop: 0,
  safeAreaBottom: 0,
};

const CUSTOM_PRESET: ViewportPreset = {
  id: 'custom',
  label: 'Custom',
  width: 0,
  height: 0,
  dpr: 1,
  notch: 'none',
  safeAreaTop: 0,
  safeAreaBottom: 0,
};

/**
 * Device presets (2026). CSS viewport 크기는 실제 기기의 `window.innerWidth/innerHeight`.
 * iPhone 17 시리즈는 2025-09 출시. iPhone Air와 Galaxy S26 시리즈는 2026-04 기준 미출시라
 * 추정 값(`(est)` 라벨 표기). 실제 출시 후 값을 갱신한다.
 *
 * iPhone 17과 17 Pro는 CSS viewport / DPR / safe area가 동일 — 이는 의도이며 카피-페이스트
 * 실수가 아니다. Apple의 17 lineup은 base와 Pro의 web-relevant 스펙이 같다.
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
    safeAreaTop: 20,
    safeAreaBottom: 0,
  },
  {
    id: 'iphone-16e',
    label: 'iPhone 16e',
    width: 390,
    height: 844,
    dpr: 3,
    notch: 'notch',
    safeAreaTop: 47,
    safeAreaBottom: 34,
  },
  {
    id: 'iphone-17',
    label: 'iPhone 17',
    width: 402,
    height: 874,
    dpr: 3,
    notch: 'dynamic-island',
    safeAreaTop: 59,
    safeAreaBottom: 34,
  },
  {
    id: 'iphone-air',
    label: 'iPhone Air (est)',
    width: 420,
    height: 912,
    dpr: 3,
    notch: 'dynamic-island',
    safeAreaTop: 59,
    safeAreaBottom: 34,
  },
  {
    id: 'iphone-17-pro',
    label: 'iPhone 17 Pro',
    width: 402,
    height: 874,
    dpr: 3,
    notch: 'dynamic-island',
    safeAreaTop: 59,
    safeAreaBottom: 34,
  },
  {
    id: 'iphone-17-pro-max',
    label: 'iPhone 17 Pro Max',
    width: 440,
    height: 956,
    dpr: 3,
    notch: 'dynamic-island',
    safeAreaTop: 62,
    safeAreaBottom: 34,
  },
  // Samsung — S26 series specs are estimated from S25 until release.
  {
    id: 'galaxy-s26',
    label: 'Galaxy S26 (est)',
    width: 384,
    height: 832,
    dpr: 3,
    notch: 'punch-hole-center',
    safeAreaTop: 32,
    safeAreaBottom: 0,
  },
  {
    id: 'galaxy-s26-plus',
    label: 'Galaxy S26+ (est)',
    width: 412,
    height: 915,
    dpr: 3,
    notch: 'punch-hole-center',
    safeAreaTop: 32,
    safeAreaBottom: 0,
  },
  {
    id: 'galaxy-s26-ultra',
    label: 'Galaxy S26 Ultra (est)',
    width: 412,
    height: 915,
    dpr: 3.5,
    notch: 'punch-hole-center',
    safeAreaTop: 40,
    safeAreaBottom: 0,
  },
  {
    id: 'galaxy-z-flip7',
    label: 'Galaxy Z Flip7',
    width: 412,
    height: 990,
    dpr: 3,
    notch: 'punch-hole-center',
    safeAreaTop: 36,
    safeAreaBottom: 0,
  },
  {
    id: 'galaxy-z-fold7-folded',
    label: 'Galaxy Z Fold7 (folded)',
    width: 384,
    height: 870,
    dpr: 3,
    notch: 'punch-hole-center',
    safeAreaTop: 32,
    safeAreaBottom: 0,
  },
  {
    id: 'galaxy-z-fold7-unfolded',
    label: 'Galaxy Z Fold7 (unfolded)',
    width: 768,
    height: 884,
    dpr: 2.625,
    notch: 'punch-hole-center',
    safeAreaTop: 32,
    safeAreaBottom: 0,
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
 * 프리셋 + landscape 여부 + landscape side로부터 OS-level safe-area insets를 계산한다.
 *
 * - Portrait: preset의 `safeAreaTop`, `safeAreaBottom`을 그대로 사용.
 * - Landscape iPhone(notch/Dynamic Island): 노치가 한쪽으로 가므로 `landscapeSide`에
 *   따라 left 또는 right에만 인셋을 준다 (실 기기 동작과 일치). top은 0,
 *   home-indicator는 bottom에 유지.
 * - Android punch-hole(status bar): landscape 시에도 top에 status bar가 유지된다.
 */
export function computeSafeAreaInsets(
  preset: ViewportPreset,
  landscape: boolean,
  side: LandscapeSide,
): SafeAreaInsets {
  if (preset.id === 'none' || preset.id === 'custom') {
    return { top: 0, bottom: 0, left: 0, right: 0 };
  }
  if (!landscape) {
    return { top: preset.safeAreaTop, bottom: preset.safeAreaBottom, left: 0, right: 0 };
  }
  if (preset.notch === 'notch' || preset.notch === 'dynamic-island') {
    return {
      top: 0,
      bottom: preset.safeAreaBottom,
      left: side === 'left' ? preset.safeAreaTop : 0,
      right: side === 'right' ? preset.safeAreaTop : 0,
    };
  }
  // Android status bar stays on the top edge even in landscape.
  return {
    top: preset.safeAreaTop,
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
 * Apps in Toss host nav bar 렌더. OS status bar 아래에 48px 높이로 쌓인다.
 * 구성: 좌측 뒤로가기(‹), 앱 아이콘 + 이름(`brand.displayName`), 우측 `⋯` + 구분선 + `×`.
 *
 * `env(safe-area-inset-top)`에는 이 높이가 포함되지 않으므로 (공식 SDK 확인),
 * 오버레이는 preset.safeAreaTop만큼 아래로 내려서 그린다.
 *
 * 뒤로가기 버튼은 `__ait:backEvent`를 트리거하고, X 버튼은 `closeView()`를 호출한다.
 * 실제 SDK 이벤트 플러밍을 한 곳에서 검증할 수 있다.
 */
function renderNavBar(preset: ViewportPreset, displayName: string): void {
  removeNavBarElement();
  const el = h('div', {
    id: NAV_BAR_ELEMENT_ID,
    className: 'ait-navbar',
    'aria-hidden': 'true',
  });
  el.style.top = `${preset.safeAreaTop}px`;

  const backBtn = h('button', {
    className: 'ait-navbar-btn ait-navbar-back',
    type: 'button',
    'aria-label': 'Back',
  });
  backBtn.textContent = '‹';
  backBtn.addEventListener('click', () => {
    aitState.trigger('backEvent');
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
    h(
      'div',
      { className: 'ait-navbar-actions' },
      moreBtn,
      h('span', { className: 'ait-navbar-divider' }),
      closeBtn,
    ),
  );

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
 * 모든 viewport DOM mutation을 원복한다. 외부 consumer가 패널을 동적으로 제거할 때 호출.
 */
export function disposeViewport(): void {
  if (typeof document === 'undefined') return;
  const html = document.documentElement;
  html.classList.remove('ait-viewport-active');
  html.classList.remove('ait-viewport-framed');
  removeById(STYLE_ELEMENT_ID);
  removeNotchElement();
  removeHomeIndicator();
  removeNavBarElement();
}

/**
 * DOM에 뷰포트 제약을 적용한다.
 * - `html.ait-viewport-active` 클래스로 정적 CSS(styles.ts) 활성화
 * - body의 width/height는 preset 값으로, navbar top offset은 safeAreaTop으로 인라인 주입
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
    return;
  }

  html.classList.add('ait-viewport-active');
  html.classList.toggle('ait-viewport-framed', state.frame);

  const preset = state.preset === 'custom' ? null : getPreset(state.preset);
  const landscape = effectiveOrientation(state) === 'landscape';

  // Dynamic per-preset values only — static rules live in styles.ts.
  style.textContent = /* css */ `
    html.ait-viewport-active body {
      width: ${size.width}px;
      max-width: ${size.width}px;
      min-height: ${size.height}px;
      max-height: ${size.height}px;
    }
  `;

  // Notch / home indicator / nav bar are gated in JS so document.getElementById
  // becomes a reliable "is overlay present" predicate.
  if (preset && state.frame && !landscape) renderNotchOverlay(preset);
  else removeNotchElement();

  if (preset && state.frame && !landscape && preset.safeAreaBottom > 0) renderHomeIndicator();
  else removeHomeIndicator();

  if (preset && state.aitNavBar && !landscape) {
    renderNavBar(preset, aitState.state.brand.displayName);
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

    applyViewport(vp);
    if (viewportChanged) {
      saveViewportToStorage(vp);
      syncSafeAreaFromViewport(vp);
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

/** Test helper. Production code never touches this — use disposeViewport(). */
export function _resetViewportInit(): void {
  if (viewportUnsubscribe) viewportUnsubscribe();
  viewportInitialized = false;
  viewportUnsubscribe = null;
}
