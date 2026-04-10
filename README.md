# @ait-co/devtools

> **데모: https://apps-in-toss-community.github.io/devtools/**

`@apps-in-toss/web-framework` SDK의 mock 라이브러리입니다. `@apps-in-toss/web-bridge`, `@apps-in-toss/web-analytics` import도 함께 mock됩니다.

앱인토스(Apps in Toss) 미니앱을 **일반 브라우저**에서 개발하고 테스트할 수 있게 해줍니다. 토스 앱 없이도 SDK의 모든 기능을 시뮬레이션하여 빠른 개발 사이클을 지원합니다.

- **60+ SDK API mock** — 인증, 결제, IAP, 위치, 카메라, 스토리지 등
- **Device API 모드 시스템** — mock / web / prompt 세 가지 모드로 디바이스 API 동작 전환
- **Floating DevTools Panel** — 브라우저에서 SDK 상태를 실시간으로 제어 (8개 탭)
- **모든 번들러 지원** — [unplugin](https://github.com/unjs/unplugin) 기반 Vite, Webpack, Rspack, esbuild, Rollup 통합

## 설치

```bash
npm install -D @ait-co/devtools
# 또는
pnpm add -D @ait-co/devtools
```

> `@apps-in-toss/web-framework ^2.0.0`이 peerDependency로 설정되어 있습니다 (optional).

## 번들러 설정

### Vite

```ts
// vite.config.ts
import aitDevtools from '@ait-co/devtools/unplugin';

export default {
  plugins: [aitDevtools.vite()],
};
```

### Webpack / Rspack

```js
// webpack.config.js (ESM)
import aitDevtools from '@ait-co/devtools/unplugin';
config.plugins.push(aitDevtools.webpack());

// webpack.config.js (CommonJS)
const aitDevtools = require('@ait-co/devtools/unplugin');
config.plugins.push(aitDevtools.webpack());
```

### Next.js (Turbopack)

Turbopack은 플러그인 시스템을 지원하지 않으므로 `resolveAlias`를 사용합니다:

```js
// next.config.js (Next.js 15+)
module.exports = {
  turbo: {
    resolveAlias: {
      '@apps-in-toss/web-framework': '@ait-co/devtools/mock',
    },
  },
};

// Next.js 14 이하
module.exports = {
  experimental: {
    turbo: {
      resolveAlias: {
        '@apps-in-toss/web-framework': '@ait-co/devtools/mock',
      },
    },
  },
};
```

### 수동 Alias 설정

번들러의 `resolve.alias` 설정으로 직접 지정할 수도 있습니다:

```js
// vite.config.ts 또는 webpack.config.js
{
  resolve: {
    alias: {
      '@apps-in-toss/web-framework': '@ait-co/devtools/mock',
      '@apps-in-toss/web-bridge': '@ait-co/devtools/mock',
      '@apps-in-toss/web-analytics': '@ait-co/devtools/mock',
    },
  },
}
```

### 플러그인 옵션

| 옵션 | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `panel` | `boolean` | `true` | DevTools Panel 자동 주입 여부 |

```ts
aitDevtools.vite({ panel: false }); // Panel 없이 mock만 사용
```

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

### 8개 탭

| 탭 | 설명 |
|---|---|
| **Environment** | 플랫폼 OS (ios/android), 앱 버전, 환경 (toss/sandbox), 로케일, 네트워크 상태, Safe Area Insets |
| **Permissions** | camera, photos, geolocation, clipboard, contacts, microphone 권한 상태 제어 (allowed/denied/notDetermined) |
| **Location** | 위도, 경도, 정확도 설정 |
| **Device** | API 모드 전환 (mock/web/prompt), 더미 이미지 관리 (추가/제거/기본값/초기화) |
| **IAP** | 다음 구매 결과 선택 (success/취소/에러 등), TossPay 결제 결과, 완료된 주문 내역 (최근 5건) |
| **Events** | Back/Home 네비게이션 이벤트 트리거, 로그인 상태 토글 |
| **Analytics** | 기록된 분석 이벤트 실시간 로그 뷰어 (최근 30건, 타임스탬프/타입/파라미터) |
| **Storage** | `Storage` API로 저장된 항목 조회 및 초기화 |

> **prompt 모드 자동 열림**: prompt 모드로 설정된 API가 호출되면, Panel이 자동으로 Device 탭을 열고 사용자 입력 UI를 표시합니다.

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

세 가지 메커니즘으로 SDK 변경에 안전하게 대응합니다:

### 1. 컴파일 타임 타입 검증 (`__typecheck.ts`)

`src/__typecheck.ts`에서 mock의 주요 export가 원본 SDK와 타입 호환되는지 검증합니다. SDK 시그니처가 변경되면 `pnpm typecheck`에서 즉시 에러가 발생합니다.

```ts
type Assert<TMock, TOriginal> = TMock extends TOriginal ? true : never;
type _AppLogin = Assert<typeof Mock.appLogin, typeof Original.appLogin>;
// 40+ 타입 호환성 assertion
```

### 2. Proxy Fallback (런타임 안전망)

`createMockProxy()`가 미구현 API 접근 시 에러 대신 경고 로그 + no-op 함수를 반환합니다. 새 SDK API가 추가되어도 앱이 크래시하지 않습니다.

```
[@ait-co/devtools] IAP.newMethod is not mocked yet. Returning no-op.
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

## Troubleshooting

### `[@ait-co/devtools] XXX.method is not mocked yet` 경고가 뜰 때

사용 중인 SDK API가 아직 mock으로 구현되지 않았습니다. Proxy fallback이 no-op을 반환하므로 앱은 정상 동작하지만, 해당 API의 실제 동작은 시뮬레이션되지 않습니다. [이슈를 등록](https://github.com/apps-in-toss-community/devtools/issues)하거나 직접 mock을 추가해 주세요.

### DevTools Panel이 안 보일 때

- 플러그인 옵션에서 `panel: false`로 설정하지 않았는지 확인
- 수동 alias 설정을 사용 중이라면, 진입점 파일에 직접 import를 추가하세요:
  ```ts
  import '@ait-co/devtools/panel';
  ```
- 플러그인은 `/main|index|entry/` 패턴의 진입점 파일만 자동 주입합니다

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
