# @ait-co/devtools

`@apps-in-toss/web-framework` SDK의 mock 라이브러리입니다. `@apps-in-toss/web-bridge`, `@apps-in-toss/web-analytics` import도 함께 mock됩니다.

앱인토스(Apps in Toss) 미니앱을 **일반 브라우저**에서 개발하고 테스트할 수 있게 해줍니다. 토스 앱 없이도 SDK의 모든 기능을 시뮬레이션하여 빠른 개발 사이클을 지원합니다.

- **60+ SDK API mock** — 인증, 결제, IAP, 위치, 카메라, 스토리지 등
- **Device API 모드 시스템** — mock / web / prompt 세 가지 모드로 디바이스 API 동작 전환
- **Device simulation** — iPhone/Galaxy 프리셋 + orientation 토글로 데스크탑 브라우저에서 모바일 뷰포트 시뮬레이션
- **Floating DevTools Panel** — 브라우저에서 SDK 상태를 실시간으로 제어 (9개 탭)
- **모든 번들러 지원** — [unplugin](https://github.com/unjs/unplugin) 기반 Vite, Webpack, Rspack, esbuild, Rollup 통합

## Reference consumer

[`sdk-example`](https://github.com/apps-in-toss-community/sdk-example)이 devtools의 reference consumer다. 모든 SDK API를 인터랙티브하게 실행해볼 수 있는 카탈로그 앱으로, 웹 데모는 <https://sdk-example.aitc.dev/>에서 바로 확인할 수 있다. 새 mock을 추가하면 sdk-example의 카드에서 그대로 동작하는 게 1차 sanity check. 단, 이 repo의 E2E suite는 sdk-example을 clone하지 않고 **내부 자기완결 fixture(`e2e/fixture/`)** 로 운영한다 — sdk-example이 깨져도 devtools CI는 영향받지 않는다.

## 설치

```bash
npm install -D @ait-co/devtools
# 또는
pnpm add -D @ait-co/devtools
```

> **지원 SDK 버전**: `@apps-in-toss/web-framework >=2.4.0 <2.4.8` (peer, required).
>
> devtools는 위 범위의 SDK 버전에서만 동작이 검증됩니다. 범위 밖 SDK를 설치하면
> 패키지 매니저가 install-time에 peer 경고를 표시합니다. 또한 devtools가 아직 mock하지
> 않은 API를 호출하면 런타임에 에러가 발생합니다 — "devtools에서는 잘 되는데 실제 SDK에서는
> 안 되는" 상황을 방지하기 위한 의도적 동작입니다. 누락된 API는
> [이슈](https://github.com/apps-in-toss-community/devtools/issues)로 알려주세요.

## 번들러 설정

### Vite

```ts
// vite.config.ts (개발 전용)
import aitDevtools from '@ait-co/devtools/unplugin';

export default {
  plugins: [aitDevtools.vite()],
};
```

> 개발 전용 설정입니다. Production 빌드에서 제외하려면 아래 [Production 빌드](#production-빌드) 섹션을 참고하세요.

### Webpack / Rspack

```js
// webpack.config.js (ESM, 개발 환경에서만 사용 권장)
import aitDevtools from '@ait-co/devtools/unplugin';
config.plugins.push(aitDevtools.webpack());

// webpack.config.js (CommonJS)
const aitDevtools = require('@ait-co/devtools/unplugin');
config.plugins.push(aitDevtools.webpack());
```

### Next.js (Turbopack)

Turbopack은 플러그인 시스템을 지원하지 않으므로 `resolveAlias`를 사용합니다.

- `@apps-in-toss/web-bridge`, `@apps-in-toss/web-analytics`도 함께 alias해야 합니다.
- Turbopack은 일반적으로 `next dev`에서만 사용되므로 별도의 production 가드가 필요하지 않습니다.

```js
// next.config.js (Next.js 15+)
module.exports = {
  turbo: {
    resolveAlias: {
      '@apps-in-toss/web-framework': '@ait-co/devtools/mock',
      '@apps-in-toss/web-bridge': '@ait-co/devtools/mock',
      '@apps-in-toss/web-analytics': '@ait-co/devtools/mock',
    },
  },
};
```

Next.js 14 이하에서는 `experimental.turbo`를 사용합니다:

```js
// next.config.js (Next.js 14 이하)
module.exports = {
  experimental: {
    turbo: {
      resolveAlias: {
        '@apps-in-toss/web-framework': '@ait-co/devtools/mock',
        '@apps-in-toss/web-bridge': '@ait-co/devtools/mock',
        '@apps-in-toss/web-analytics': '@ait-co/devtools/mock',
      },
    },
  },
};
```

> **Panel 주입**: Turbopack은 unplugin을 지원하지 않으므로 Panel이 자동 주입되지 않습니다. 진입점에서 직접 import하세요:
> ```ts
> // app/layout.tsx 또는 pages/_app.tsx
> import '@ait-co/devtools/panel';
> ```

### Next.js (Webpack)

Next.js에서 Webpack 모드(`next dev` without `--turbo`, 또는 `next build`)를 사용하는 경우:

```js
// next.config.js (Webpack 모드)
const aitDevtools = require('@ait-co/devtools/unplugin'); // CJS entrypoint 제공

module.exports = {
  webpack: (config, { dev }) => {
    if (dev) {
      config.plugins.push(aitDevtools.webpack());
    }
    return config;
  },
};
```

### 수동 Alias 설정

번들러의 `resolve.alias` 설정으로 직접 지정할 수도 있습니다:

```ts
// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  resolve: {
    alias: {
      '@apps-in-toss/web-framework': '@ait-co/devtools/mock',
      '@apps-in-toss/web-bridge': '@ait-co/devtools/mock',
      '@apps-in-toss/web-analytics': '@ait-co/devtools/mock',
    },
  },
});
```

```js
// webpack.config.js (Webpack은 절대 경로 필요)
module.exports = {
  resolve: {
    alias: {
      '@apps-in-toss/web-framework': require.resolve('@ait-co/devtools/mock'),
      '@apps-in-toss/web-bridge': require.resolve('@ait-co/devtools/mock'),
      '@apps-in-toss/web-analytics': require.resolve('@ait-co/devtools/mock'),
    },
  },
};
```

> **주의**: 수동 alias만 사용하면 DevTools Panel이 자동 주입되지 않습니다. 진입점 파일에 직접 import를 추가하세요:
> ```ts
> import '@ait-co/devtools/panel'; // 진입점에 추가
> ```

### 플러그인 옵션

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `panel` | `boolean` | `true` | DevTools Panel 자동 주입 여부 |
| `forceEnable` | `boolean` | `false` | production에서도 devtools 활성화 |
| `mock` | `boolean` | `true` (dev) / `false` (prod+forceEnable) | mock alias 활성화 여부 |

```ts
aitDevtools.vite({ panel: false }); // Panel 없이 mock만 사용
aitDevtools.vite({ forceEnable: true }); // production에서도 활성화 (mock 기본 OFF, panel ON)
aitDevtools.vite({ forceEnable: true, mock: true }); // production에서 mock도 활성화
```

## Production 빌드

기본적으로 devtools 플러그인은 **production 빌드에서 자동 비활성화**됩니다 (`NODE_ENV === 'production'`이면 alias 변환과 Panel 주입이 모두 스킵). 별도의 조건부 설정 없이도 안전합니다.

스테이징 환경 등에서 production 빌드에서도 devtools를 사용하려면 `forceEnable` 옵션을 사용하세요:

```ts
aitDevtools.vite({ forceEnable: true }); // panel ON, mock OFF (모니터링 전용)
aitDevtools.vite({ forceEnable: true, mock: true }); // panel + mock 모두 ON
```

번들러 설정에서 플러그인 자체를 조건부로 제외할 수도 있습니다:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import aitDevtools from '@ait-co/devtools/unplugin';

export default defineConfig(({ command }) => ({
  plugins: [
    ...(command === 'serve' ? [aitDevtools.vite()] : []),
  ],
}));
```

```js
// webpack.config.js (Rspack도 동일)
const aitDevtools = require('@ait-co/devtools/unplugin');
const plugins = [];
if (process.env.NODE_ENV !== 'production') {
  plugins.push(aitDevtools.webpack());
}
```

> Next.js 설정은 위의 [Next.js (Webpack)](#nextjs-webpack) 및 [Next.js (Turbopack)](#nextjs-turbopack) 섹션을 참고하세요.

## Device API 모드 시스템

디바이스 관련 API(카메라, 위치, 클립보드 등)는 세 가지 모드로 동작합니다:

| 모드 | 동작 | 사용 사례 |
|---|---|---|
| **mock** | `aitState`에 저장된 더미 데이터 반환 | 자동화 테스트, 고정된 시나리오 |
| **web** | 브라우저 네이티브 API 사용 (Geolocation, File API 등) | 실제 디바이스 기능 테스트 |
| **prompt** | DevTools Panel이 자동으로 열리고 사용자 입력 대기 (30초 타임아웃) | 수동 QA, 특정 값 입력 |

### 모드별 지원 API

| API | mock | web | prompt |
|---|---|---|---|
| `openCamera` | ✅ | ✅ | ✅ |
| `fetchAlbumPhotos` | ✅ | ✅ | ✅ |
| `getCurrentLocation` | ✅ | ✅ | ✅ |
| `startUpdateLocation` | ✅ | ✅ | ✅ |
| `getNetworkStatus` | ✅ | ✅ | — |
| `getClipboardText` / `setClipboardText` | ✅ | ✅ | — |

### 모드 설정 방법

```js
// 콘솔에서 개별 API 모드 변경
__ait.patch('deviceModes', { camera: 'web', location: 'prompt' });

// 또는 DevTools Panel의 Device 탭에서 드롭다운으로 전환
```

### 더미 이미지 관리

mock 모드에서 카메라/앨범 API는 더미 이미지를 반환합니다.

- **기본 플레이스홀더**: 파란색/녹색/주황색 320×240 이미지 3장 자동 생성
- **커스텀 이미지**: DevTools Panel의 Device 탭에서 파일 추가/제거 가능
- **콘솔에서 설정**: `__ait.patch('mockData', { images: ['data:image/png;base64,...'] })`

## Floating DevTools Panel

플러그인 사용 시 진입점 파일에 패널이 자동 주입됩니다. 화면 우하단의 **'AIT' 버튼**을 클릭하면 토글됩니다.

### 9개 탭

| 탭 | 설명 |
|---|---|
| **Environment** | 플랫폼 OS (ios/android), 앱 버전, 환경 (toss/sandbox), 로케일, 네트워크 상태, Safe Area Insets |
| **Viewport** | 디바이스 프리셋(iPhone/Galaxy) + orientation 토글로 모바일 뷰포트 시뮬레이션 |
| **Permissions** | camera, photos, geolocation, clipboard, contacts, microphone 권한 상태 제어 (allowed/denied/notDetermined) |
| **Location** | 위도, 경도, 정확도 설정 |
| **Device** | API 모드 전환 (mock/web/prompt), 더미 이미지 관리 (추가/제거/기본값/초기화) |
| **IAP** | 다음 구매 결과 선택 (success/취소/에러 등), TossPay 결제 결과, 완료된 주문 내역 (최근 5건) |
| **Events** | Back/Home 네비게이션 이벤트 트리거, 로그인 상태 토글 |
| **Analytics** | 기록된 분석 이벤트 실시간 로그 뷰어 (최근 30건, 타임스탬프/타입/파라미터) |
| **Storage** | `Storage` API로 저장된 항목 조회 및 초기화 |

> **prompt 모드 자동 열림**: prompt 모드로 설정된 API가 호출되면, Panel이 자동으로 Device 탭을 열고 사용자 입력 UI를 표시합니다.

## Device simulation (Viewport 탭)

데스크탑 브라우저에서 모바일 미니앱을 개발할 때, 실제 디바이스 해상도/safe area/노치/홈 인디케이터/앱인토스 nav bar를 반영해 레이아웃을 검증할 수 있습니다.

### 프리셋 (2026)

| 카테고리 | 기기 |
|---|---|
| Apple | iPhone SE (3rd gen), iPhone 16e, iPhone 17, iPhone Air, iPhone 17 Pro, iPhone 17 Pro Max |
| Samsung | Galaxy S26, S26+, S26 Ultra, Z Flip7, Z Fold7 (folded / unfolded) |
| 기타 | Custom (width/height 직접 입력), None (기본) |

> iPhone 17 시리즈는 2025-09에 출시되었습니다. Samsung Galaxy S26 시리즈는 2026-04 기준 미출시이므로 현재 S25 기반 값을 담고 있으며, 실제 출시 후 갱신 예정입니다.

각 프리셋은 다음 정보를 포함합니다:
- **CSS viewport** (portrait `width × height`)
- **DPR** (devicePixelRatio: 2, 3, 3.5 등)
- **Notch** 종류 (`none` / `notch` / `dynamic-island` / `punch-hole-center`)
- **OS-level safe area insets** (status bar / 홈 인디케이터 / 노치 회전에 따른 좌우 인셋)

### Orientation

- **auto** (기본) — Panel이 강제하지 않음. 앱의 `setDeviceOrientation` 호출이 별도 필드(`appOrientation`)에 기록되어 effective orientation 결정에 쓰입니다. 같은 앱이 여러 번 호출해도 매번 정상 반영됩니다.
- **portrait / landscape** — Panel이 override. 앱의 `setDeviceOrientation` 호출은 무시되고 `console.warn`으로 알림.

Landscape로 전환하면:
- CSS viewport width/height가 swap됩니다.
- iPhone(notch/Dynamic Island) 프리셋은 safe area의 top이 0이 되고, **Notch side** 토글(left/right, default left)에 따라 한쪽 변에만 인셋이 생깁니다 (실 기기 동작과 일치).
- Android(punch-hole) 프리셋은 status bar가 top에 유지됩니다.

### Frame + 노치 + 홈 인디케이터 + 앱인토스 nav bar

**Show frame** 토글을 켜면:
- 디바이스 베젤을 모사하는 border-radius + box-shadow
- Notch / Dynamic Island / punch-hole 오버레이 (body 상단에 절대 배치)
- 홈 인디케이터 pill (iPhone 등 `safeAreaBottom > 0` 디바이스에 한정, body 하단에 배치)
- 앱 이름은 `aitState.brand.displayName`을 사용 (Environment 탭에서 변경 가능, 자동 갱신)
- 뒤로가기 버튼은 `__ait:backEvent`를 트리거하고, X 버튼은 `closeView()`를 호출 — 실제 SDK 이벤트 플러밍을 패널에서 직접 검증할 수 있습니다.

**Show Apps in Toss nav bar** 토글(기본 on)을 켜면:
- 토스 호스트의 상단 nav bar(뒤로가기 / 앱 아이콘·이름 / ⋯ / ×)를 48px 높이로 오버레이
- status bar 바로 아래, safe area top 이후에 배치
- **중요**: 이 48px는 `env(safe-area-inset-top)` 및 `SafeAreaInsets.get().top`에 **포함되지 않습니다** (공식 SDK 동작). 토스 공식 예제들도 `insets.top + 48` 패턴으로 보정합니다.

### 콘솔에서 직접 조작

```js
// iPhone 17 Pro 세로 + 프레임 켜기
__ait.patch('viewport', { preset: 'iphone-17-pro', orientation: 'auto', frame: true });

// Landscape 강제 (앱의 setDeviceOrientation 호출은 무시됨)
__ait.patch('viewport', { orientation: 'landscape' });

// Landscape 시 노치 위치 (iOS 기본 'left')
__ait.patch('viewport', { landscapeSide: 'right' });

// Custom 크기 (1 ≤ value ≤ 4096으로 자동 클램프)
__ait.patch('viewport', { preset: 'custom', customWidth: 360, customHeight: 740 });

// 앱인토스 nav bar 숨기기 (순수 뷰포트만 보고 싶을 때)
__ait.patch('viewport', { aitNavBar: false });

// Nav bar 변형 토글 ('partner' = 흰 배경 + 아이콘/이름, 'game' = 투명 배경 + ⋯/× 만)
__ait.patch('viewport', { aitNavBarType: 'game' });

// 해제
__ait.patch('viewport', { preset: 'none' });
```

### Status 패널

Viewport 탭 하단에 현재 적용된 값을 실시간으로 보여줍니다:
- **CSS / physical**: `402×874@3x | 1206×2622 portrait (auto)`
- **Safe area**: `T59 R0 B34 L0`
- **AIT nav bar**: `48px (excl. SafeArea)`

### 영속성 + 기술 세부

- 상태는 sessionStorage(`__ait_viewport`)에 저장되어 페이지 reload 시 복원됩니다.
- 프리셋 선택 시 `aitState.safeAreaInsets`도 자동 업데이트 → SDK의 `SafeAreaInsets.get()` / `.subscribe()`가 따라갑니다.
- 뷰포트는 `document.body`에 `max-width`/`max-height` + `margin:auto`로 적용됩니다. iframe을 쓰지 않으므로 앱 JS/CSS가 그대로 실행되고, 콘솔·DevTools도 정상 접근 가능합니다.
- body에 `isolation: isolate`를 적용해 노치/nav bar/홈 인디케이터의 z-index가 stacking context 밖으로 새지 않습니다 (DevTools 패널이 그 위에 떠 있음).
- 패널을 동적으로 제거하고 싶다면 `disposeViewport()`를 export로 제공합니다.
- User-Agent spoofing / touch event emulation / network throttling은 하지 않습니다 (Chrome DevTools가 이미 제공).

### Known limitations

- **Body가 스크롤 컨테이너가 됩니다** — 뷰포트 활성화 중에는 스크롤이 `window`가 아닌 `document.body`에서 발생합니다. `window.addEventListener('scroll', ...)`나 root에 붙은 `IntersectionObserver`는 실 디바이스와 다른 동작을 보일 수 있습니다. 미니앱 코드에서 스크롤을 다룬다면 `body`도 함께 검증하세요.
- **추정 프리셋(`(est)` 라벨)** — iPhone Air, Galaxy S26 시리즈는 미출시 또는 공식 스펙 미공개. 출시 후 갱신 예정. QA 시 절대값으로 신뢰하지 마세요.

## `window.__ait` 콘솔 API

브라우저 콘솔에서 `window.__ait`(또는 `__ait`)로 mock 상태를 직접 제어할 수 있습니다:

```js
// 현재 상태 조회
__ait.state                    // 전체 상태 객체
__ait.state.platform           // 'ios' 또는 'android'
__ait.state.auth.isLoggedIn    // 로그인 상태
__ait.state.deviceModes        // 각 API의 현재 모드

// 상태 업데이트 (얕은 병합)
__ait.update({ platform: 'android', locale: 'en-US' });
__ait.update({ networkStatus: 'OFFLINE' });

// 중첩 상태 업데이트
__ait.patch('permissions', { camera: 'denied' });
__ait.patch('deviceModes', { location: 'web' });
__ait.patch('iap', { nextResult: 'USER_CANCELED' });

// 이벤트 트리거
__ait.trigger('backEvent');
__ait.trigger('homeEvent');

// 분석 이벤트 수동 기록
__ait.logAnalytics({ type: 'click', params: { button: 'purchase' } });

// 상태 초기화 (deviceId는 유지됨)
__ait.reset();

// 상태 변경 구독
const unsubscribe = __ait.subscribe(() => {
  console.log('상태 변경됨:', __ait.state);
});
unsubscribe(); // 구독 해제
```

## Mock API 목록

### 인증/로그인

| API | Mock 동작 |
|---|---|
| `appLogin` | `{ authorizationCode, referrer }` 반환 |
| `getIsTossLoginIntegratedService` | state의 `isTossLoginIntegrated` 반환 |
| `getUserKeyForGame` | `{ hash, type: 'HASH' }` 반환 (비로그인 시 `undefined`) |
| `appsInTossSignTossCert` | 콘솔 로그만 출력 (no-op) |

### 화면/네비게이션

| API | Mock 동작 |
|---|---|
| `closeView` | `window.history.back()` 호출 |
| `openURL` | `window.open()`으로 새 탭 |
| `share` | `navigator.share()` 사용 (미지원 시 콘솔 출력) |
| `getTossShareLink` | `https://toss.im/share/mock{path}` 반환 |
| `setIosSwipeGestureEnabled` | 콘솔 로그 (no-op) |
| `setDeviceOrientation` | 콘솔 로그 (no-op) |
| `setScreenAwakeMode` | `{ enabled }` 반환 |
| `setSecureScreen` | `{ enabled }` 반환 |
| `requestReview` | no-op (`.isSupported()` 메서드 포함) |

### 환경 정보

| API | Mock 동작 |
|---|---|
| `getPlatformOS` | state의 platform 반환 (기본: `'ios'`) |
| `getOperationalEnvironment` | state의 environment 반환 (기본: `'sandbox'`) |
| `getTossAppVersion` | state의 appVersion 반환 (기본: `'5.240.0'`) |
| `isMinVersionSupported` | 시맨틱 버전 비교 수행 |
| `getSchemeUri` | state의 schemeUri 또는 `window.location.pathname` |
| `getLocale` | state의 locale 반환 (기본: `'ko-KR'`) |
| `getDeviceId` | localStorage에 저장된 고유 UUID 반환 |
| `getGroupId` | state의 groupId 반환 |
| `getNetworkStatus` | 모드에 따라 state 또는 브라우저 API 사용 |
| `getServerTime` | `Date.now()` 반환 |
| `env.getDeploymentId` | state의 deploymentId 반환 |
| `getAppsInTossGlobals` | `{ deploymentId, brandDisplayName, brandIcon, brandPrimaryColor }` |

### Safe Area

| API | Mock 동작 |
|---|---|
| `SafeAreaInsets.get` | `{ top, bottom, left: 0, right: 0 }` 반환 |
| `SafeAreaInsets.subscribe` | 상태 변경 시 콜백 호출, unsubscribe 함수 반환 |
| `getSafeAreaInsets` | top inset 값 반환 (deprecated) |

### 디바이스 기능

| API | Mock 동작 |
|---|---|
| `Storage.getItem/setItem/removeItem/clearItems` | localStorage에 `__ait_storage:` prefix로 저장 |
| `getCurrentLocation` | 모드별: mock(state 좌표), web(Geolocation API), prompt(Panel 입력) |
| `startUpdateLocation` | mock(랜덤 좌표 변동), web(watchPosition), prompt(반복 입력) |
| `openCamera` | mock(더미 이미지), web(파일 선택기), prompt(Panel 파일 입력) |
| `fetchAlbumPhotos` | mock(더미 이미지 배열), web(파일 다중 선택), prompt(Panel 파일 입력) |
| `fetchContacts` | 페이지네이션 지원 mock 연락처 반환, `query.contains` 검색 |
| `getClipboardText` / `setClipboardText` | mock(state 저장) 또는 web(Clipboard API) |
| `generateHapticFeedback` | 콘솔 로그 + analytics 기록 |
| `saveBase64Data` | anchor 엘리먼트로 파일 다운로드 |

### IAP/결제

| API | Mock 동작 |
|---|---|
| `IAP.createOneTimePurchaseOrder` | 300ms 딜레이 후 state의 `nextResult`에 따라 성공/실패 시뮬레이션 |
| `IAP.createSubscriptionPurchaseOrder` | 위와 동일한 흐름 |
| `IAP.getProductItemList` | state의 상품 목록 반환 |
| `IAP.getPendingOrders` | 대기 중 주문 목록 |
| `IAP.getCompletedOrRefundedOrders` | 완료/환불 주문 목록 |
| `IAP.completeProductGrant` | 대기 → 완료 주문 이동 |
| `IAP.getSubscriptionInfo` | 활성 구독 mock (30일 만료, 자동 갱신) |
| `checkoutPayment` | 300ms 딜레이 후 state의 결제 결과 반환 (TossPay) |

**IAP 구매 시뮬레이션 흐름:**

1. `IAP.createOneTimePurchaseOrder()` 호출
2. 300ms 딜레이 (결제 UI 시뮬레이션)
3. `state.iap.nextResult` 확인 → `'success'`가 아니면 `onError` 호출
4. 성공 시 `processProductGrant` 콜백 실행 → 실패하면 `'PRODUCT_NOT_GRANTED_BY_PARTNER'` 에러
5. 모두 성공하면 `completedOrders`에 기록, `onEvent`로 주문 결과 전달

### 광고

| API | Mock 동작 |
|---|---|
| `GoogleAdMob.loadAppsInTossAdMob` | 200ms 후 `loaded` 이벤트 |
| `GoogleAdMob.showAppsInTossAdMob` | 50ms~1.5s에 걸쳐 requested→show→impression→reward→dismissed 이벤트 순차 발행 |
| `GoogleAdMob.isAppsInTossAdMobLoaded` | 로드 여부 boolean 반환 |
| `TossAds.initialize/attach/attachBanner` | 회색 플레이스홀더 div 렌더링 |
| `TossAds.destroy/destroyAll` | no-op |
| `loadFullScreenAd` / `showFullScreenAd` | GoogleAdMob과 유사한 흐름 |

### 이벤트

| API | Mock 동작 |
|---|---|
| `graniteEvent.addEventListener` | `__ait:backEvent`, `__ait:homeEvent` 커스텀 이벤트 수신 |
| `appsInTossEvent.addEventListener` | no-op |
| `tdsEvent.addEventListener` | `__ait:navigationAccessoryEvent` 수신 |
| `onVisibilityChangedByTransparentServiceWeb` | `document.visibilitychange` 이벤트 위임 |

### 분석

| API | Mock 동작 |
|---|---|
| `Analytics.screen/impression/click` | analyticsLog에 타입별 기록, Panel에서 실시간 확인 |
| `eventLog` | `log_name`, `log_type`, `params`로 커스텀 이벤트 기록 |

### 게임/프로모션

| API | Mock 동작 |
|---|---|
| `grantPromotionReward` | 타임스탬프 기반 mock key 반환 |
| `grantPromotionRewardForGame` | 위와 동일 |
| `submitGameCenterLeaderBoardScore` | state에 점수 추가, `{ statusCode: 'SUCCESS' }` |
| `getGameCenterGameProfile` | mock 프로필 반환 (없으면 `PROFILE_NOT_FOUND`) |
| `openGameCenterLeaderboard` | 콘솔 로그 (no-op) |
| `contactsViral` | 500ms 후 close 이벤트 발행 |

### 권한

| API | Mock 동작 |
|---|---|
| `getPermission` | state의 권한 상태 반환 (allowed/denied/notDetermined) |
| `openPermissionDialog` | 상태를 `allowed`로 변경 |
| `requestPermission` | `openPermissionDialog`에 위임 |

> 권한이 필요한 함수(openCamera, getCurrentLocation 등)는 `withPermission()`으로 래핑되어 `.getPermission()`, `.openPermissionDialog()` 메서드가 자동 부착됩니다.

### 파트너

| API | Mock 동작 |
|---|---|
| `partner.addAccessoryButton` | 콘솔 로그 (no-op) |
| `partner.removeAccessoryButton` | 콘솔 로그 (no-op) |

## 테스트에서의 활용

vitest/jest에서 mock 라이브러리를 직접 import하여 테스트할 수 있습니다.

> mock 함수들이 `window`, `document`, `localStorage` 등 브라우저 API를 사용하므로 **jsdom 환경**이 필요합니다.
>
> ```ts
> // vitest.config.ts
> import { defineConfig } from 'vitest/config';
> export default defineConfig({ test: { environment: 'jsdom' } });
> ```

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { appLogin, Storage, getCurrentLocation, getNetworkStatus, openCamera, IAP } from '@ait-co/devtools/mock';
import { aitState } from '@ait-co/devtools/mock';

beforeEach(() => {
  aitState.reset(); // 매 테스트 전 상태 초기화
});

// 인증 테스트
it('appLogin은 authorizationCode를 반환한다', async () => {
  const result = await appLogin();
  expect(result.authorizationCode).toBeDefined();
});

// 상태를 세팅하고 함수 호출
it('오프라인 상태에서 네트워크 조회', async () => {
  aitState.update({ networkStatus: 'OFFLINE' });
  const status = await getNetworkStatus();
  expect(status).toBe('OFFLINE');
});

// 권한 denied 시나리오
it('카메라 권한이 denied면 에러를 던진다', async () => {
  aitState.patch('permissions', { camera: 'denied' });
  await expect(openCamera()).rejects.toThrow();
});

// IAP 실패 시나리오 (fake timers 필요)
it('구매 취소 시 onError가 호출된다', async () => {
  vi.useFakeTimers();
  aitState.patch('iap', { nextResult: 'USER_CANCELED' });
  const onError = vi.fn();
  IAP.createOneTimePurchaseOrder({
    options: { sku: 'item_01', processProductGrant: async () => true },
    onEvent: vi.fn(),
    onError,
  });
  await vi.advanceTimersByTimeAsync(500);
  expect(onError).toHaveBeenCalledWith({ code: 'USER_CANCELED' });
  vi.useRealTimers();
});

// Storage 테스트
it('Storage에 값을 저장하고 읽을 수 있다', async () => {
  await Storage.setItem('key1', 'value1');
  const result = await Storage.getItem('key1');
  expect(result).toBe('value1');
});
```

## SDK 업데이트 대응

devtools는 [`@apps-in-toss/web-framework`](https://www.npmjs.com/package/@apps-in-toss/web-framework)를 추적하고, [`sdk-example`](https://github.com/apps-in-toss-community/sdk-example)은 원본 SDK와 devtools를 모두 추적한다. 즉 새 SDK 버전이 나오면 (1) devtools가 mock/타입 시그니처를 따라잡고 → (2) sdk-example이 양쪽 새 버전을 동시에 반영하는 흐름. devtools 단독 PR이 sdk-example을 깨뜨리면 양쪽을 함께 본다.

세 가지 메커니즘으로 SDK 변경에 안전하게 대응합니다:

### 1. 컴파일 타임 타입 검증 (`__typecheck.ts`)

`src/__typecheck.ts`에서 mock의 주요 export가 원본 SDK와 타입 호환되는지 검증합니다. SDK 시그니처가 변경되면 `pnpm typecheck`에서 즉시 에러가 발생합니다.

```ts
type Assert<TMock, TOriginal> = TMock extends TOriginal ? true : never;
type _AppLogin = Assert<typeof Mock.appLogin, typeof Original.appLogin>;
// 40+ 타입 호환성 assertion
```

### 2. Proxy 트립와이어 (런타임 차단)

`createMockProxy()`는 미구현 API 접근 시 즉시 `Error`를 throw합니다. mock에 없는 API가 실 SDK에는 있을 수 있어 "devtools에서는 잘 되는데 실제 SDK에서는 안 되는" 배포 사고를 원천 차단하기 위한 의도적 동작입니다. 누락된 API는 [이슈](https://github.com/apps-in-toss-community/devtools/issues)로 제보하거나 직접 mock을 추가해 주세요.

```
[@ait-co/devtools] IAP.newMethod is not mocked. This API may exist in
@apps-in-toss/web-framework, but devtools' mock does not cover it yet.
Please file an issue: https://github.com/apps-in-toss-community/devtools/issues
```

### 3. GitHub Actions 주간 CI

`.github/workflows/check-sdk-update.yml`이 **매주 월요일** 자동으로:

1. `@apps-in-toss/web-framework`의 새 버전 확인
2. 최신 버전으로 업데이트 후 타입 체크 실행
3. 새 버전 감지 시 자동으로 GitHub Issue 생성 (타입 에러 여부 포함)

## Contributing

### 새 API mock 추가 절차

1. 해당 카테고리 디렉토리에 함수 구현 (예: `src/mock/device/`)
2. `src/mock/index.ts`에 export 추가
3. `src/__typecheck.ts`에 타입 호환성 assertion 추가
4. `pnpm typecheck`로 원본과 호환되는지 검증
5. `src/__tests/`에 테스트 작성

```bash
pnpm build       # tsup으로 빌드
pnpm typecheck   # 타입 호환성 검증
pnpm test        # 전체 테스트 실행
```

### Pre-commit hook (선택)

Optional이지만 권장합니다. clone 후 아래 명령으로 표준 pre-commit hook을 활성화하면 staged 파일에 대해 `biome check`가 자동 실행됩니다.

```sh
git config core.hooksPath .githooks
```

이 hook은 push 전에 빠르게 lint 이슈를 잡기 위한 개발자 편의 장치입니다. 실제 강제 계층은 CI의 `pnpm lint` job이므로, hook을 활성화하지 않은 contributor도 PR 단계에서 lint 실패를 보게 됩니다.

## Troubleshooting

### `[@ait-co/devtools] XXX.method is not mocked` 에러가 날 때

사용 중인 SDK API가 아직 mock으로 구현되지 않았습니다. devtools는 "잘 되는 척" 배포를 막기 위해 미구현 API 접근 시 throw합니다. [이슈를 등록](https://github.com/apps-in-toss-community/devtools/issues)하거나 직접 mock을 추가한 뒤 다시 실행하세요.

### DevTools Panel이 안 보일 때

- 플러그인 옵션에서 `panel: false`로 설정하지 않았는지 확인
- 수동 alias 설정을 사용 중이라면, 진입점 파일에 직접 import를 추가하세요:
  ```ts
  import '@ait-co/devtools/panel';
  ```
- 플러그인은 파일명이 `main`, `index`, `entry`, `app` 중 하나인 진입점에만 자동 주입합니다 (대소문자 무시). 파일명이 이 패턴에 맞지 않으면 수동으로 `import '@ait-co/devtools/panel'`을 추가하세요.

### 서브패스 import는 mock되지 않음

`@apps-in-toss/web-framework/some-subpath` 형태의 서브패스 import는 alias가 적용되지 않습니다. SDK의 메인 엔트리(`@apps-in-toss/web-framework`)만 mock됩니다. 특정 서브패스도 mock이 필요하다면 번들러의 `resolve.alias`에 해당 서브패스를 수동으로 추가하세요.

### Next.js Turbopack에서 설정하는 법

Turbopack은 unplugin을 지원하지 않으므로, `next.config.js`에서 `resolveAlias`를 사용하세요 (위의 [Next.js (Turbopack)](#nextjs-turbopack) 섹션 참고). Panel은 진입점에서 직접 import해야 합니다:

```ts
// app/layout.tsx 또는 pages/_app.tsx
import '@ait-co/devtools/panel';
```

## 패키지 Export 구조

| Import path | 용도 |
|---|---|
| `@ait-co/devtools` 또는 `@ait-co/devtools/mock` | 모든 mock export (번들러 alias 대상) |
| `@ait-co/devtools/panel` | Floating DevTools Panel (import 시 자동 마운트) |
| `@ait-co/devtools/unplugin` | 번들러 플러그인 (.vite, .webpack, .rspack, .esbuild, .rollup) |

## 라이센스

BSD 3-Clause
