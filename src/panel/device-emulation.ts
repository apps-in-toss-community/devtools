/**
 * 기기 preset ↔ 브라우저 특성 정합
 *
 * Viewport preset이 active일 때(`none`/`custom` 아님), 그 preset이 주장하는 기기와
 * `navigator.userAgent`·`navigator.platform`·`window.devicePixelRatio`·`screen.*`를
 * 일치시킨다. 특정 기기 frame 가상환경을 제공하는 이상 UA/DPR만 호스트 데스크톱 값으로
 * 남으면 비일관적이기 때문이다 (#190).
 *
 * 한계 — page-JS override는 **JS 읽기값만** 바꾼다. 실 CSS media query(`@media`),
 * 실제 터치 이벤트, 엔진 레벨 레이아웃은 호스트 브라우저 값이 그대로다. 픽셀/입력 단위
 * 완전 emulation이 필요하면 Chrome DevTools device-mode(또는 CDP)를 쓴다. preset이
 * `none`/`custom`이면 override를 걸지 않아 일반 dev의 호스트 환경을 건드리지 않는다.
 *
 * 구현 — 대상 속성은 setter가 없어도 `configurable: true`이므로 `Object.defineProperty`로
 * getter를 덮어쓸 수 있다. 원복을 위해 최초 override 직전의 디스크립터를 저장한다.
 */

import { aitState } from '../mock/state.js';
import type { PlatformOS, ViewportPreset } from '../mock/types.js';

/** preset id → 플랫폼. Apple 계열은 ios, 그 외(Galaxy)는 android. */
export function platformForPreset(presetId: string): PlatformOS {
  return presetId.startsWith('iphone') || presetId.startsWith('ipad') ? 'ios' : 'android';
}

export interface DeviceProfile {
  platform: PlatformOS;
  userAgent: string;
  navigatorPlatform: string;
  devicePixelRatio: number;
  /** 세로 기준 물리 해상도 (CSS px × dpr). landscape면 swap해서 적용. */
  screenWidth: number;
  screenHeight: number;
}

/**
 * preset + 토스 앱 버전으로 기기 프로필을 합성한다.
 *
 * UA는 표준 모바일 UA 뒤에 `AppsInToss TossApp/<appVersion>` 토큰을 붙인다 — #171
 * 실측(`AppsInToss TossApp/5.261.0`)에서 확인된 토스 WebView UA 형태.
 *
 * @param preset      portrait 기준 width/height/dpr를 가진 device preset
 * @param appVersion  `aitState.state.appVersion` (UA suffix의 버전 토큰)
 * @param landscape   true면 screen width/height를 swap
 */
export function buildDeviceProfile(
  preset: ViewportPreset,
  appVersion: string,
  landscape: boolean,
): DeviceProfile {
  const platform = platformForPreset(preset.id);
  const tossToken = `AppsInToss TossApp/${appVersion}`;

  const baseUa =
    platform === 'ios'
      ? // iOS Safari WebView 형태 (iOS 17 계열 — 토스 WebView가 보고하는 라인과 정합).
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) ' +
        'AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
      : // Android Chrome WebView 형태.
        'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/120.0.0.0 Mobile Safari/537.36';

  const physWidth = Math.round(preset.width * preset.dpr);
  const physHeight = Math.round(preset.height * preset.dpr);

  return {
    platform,
    userAgent: `${baseUa} ${tossToken}`,
    navigatorPlatform: platform === 'ios' ? 'iPhone' : 'Linux armv8l',
    devicePixelRatio: preset.dpr,
    screenWidth: landscape ? physHeight : physWidth,
    screenHeight: landscape ? physWidth : physHeight,
  };
}

// --- override apply / revert ---------------------------------------------

interface SavedDescriptor {
  target: object;
  prop: string;
  descriptor: PropertyDescriptor | undefined;
}

let savedDescriptors: SavedDescriptor[] | null = null;

function override(target: object, prop: string, value: unknown, saved: SavedDescriptor[]): void {
  // 같은 override 세션에서 이미 저장했으면 다시 저장하지 않는다 (원본 보존).
  if (!saved.some((s) => s.target === target && s.prop === prop)) {
    saved.push({ target, prop, descriptor: Object.getOwnPropertyDescriptor(target, prop) });
  }
  try {
    Object.defineProperty(target, prop, {
      configurable: true,
      get: () => value,
    });
  } catch {
    // 일부 환경(엄격한 jsdom 등)에서 redefine이 막히면 조용히 건너뛴다.
  }
}

/**
 * 기기 프로필을 현재 페이지의 `navigator`/`window`/`screen`에 적용한다.
 * 호출 시 직전 디스크립터를 저장하므로 `revertDeviceEmulation()`으로 원복 가능.
 */
export function applyDeviceEmulation(profile: DeviceProfile): void {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return;
  // 이전 override가 남아 있으면 먼저 원복하고 새로 적용 (preset 전환 시 누적 방지).
  revertDeviceEmulation();

  const saved: SavedDescriptor[] = [];
  override(navigator, 'userAgent', profile.userAgent, saved);
  override(navigator, 'platform', profile.navigatorPlatform, saved);
  override(window, 'devicePixelRatio', profile.devicePixelRatio, saved);
  if (typeof screen !== 'undefined') {
    override(screen, 'width', profile.screenWidth, saved);
    override(screen, 'height', profile.screenHeight, saved);
  }
  savedDescriptors = saved;
}

/** `applyDeviceEmulation`이 덮어쓴 속성을 원래 디스크립터로 되돌린다. */
export function revertDeviceEmulation(): void {
  if (!savedDescriptors) return;
  for (const { target, prop, descriptor } of savedDescriptors) {
    try {
      if (descriptor) {
        Object.defineProperty(target, prop, descriptor);
      } else {
        // 원래 own descriptor가 없었으면 (프로토타입 상속 getter) own override만 제거.
        delete (target as Record<string, unknown>)[prop];
      }
    } catch {
      // redefine/delete 실패는 조용히 무시 — best-effort 원복.
    }
  }
  savedDescriptors = null;
}

/**
 * Viewport state를 받아 preset이 active면 emulation 적용, 아니면 원복.
 * `applyViewport`가 매 viewport 변경마다 호출한다.
 */
export function syncDeviceEmulation(preset: ViewportPreset | null, landscape: boolean): void {
  if (!preset || preset.id === 'none' || preset.id === 'custom') {
    revertDeviceEmulation();
    return;
  }
  const profile = buildDeviceProfile(preset, aitState.state.appVersion, landscape);
  applyDeviceEmulation(profile);
  // SDK 계약값 정합: getPlatformOS()는 aitState.platform을 읽으므로 함께 끌고 간다.
  // 값이 실제로 바뀔 때만 update — applyViewport는 viewport subscriber 안에서 호출되므로
  // 무조건 update하면 재진입 루프가 된다 (syncSafeAreaFromViewport와 같은 idempotent 규약).
  if (aitState.state.platform !== profile.platform) {
    aitState.update({ platform: profile.platform });
  }
}
