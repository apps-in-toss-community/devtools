# ait-devtools

`@apps-in-toss/web-framework` SDK의 mock 라이브러리입니다. `@apps-in-toss/web-bridge`, `@apps-in-toss/web-analytics` import도 함께 mock됩니다.

앱인토스(Apps in Toss) 미니앱을 **일반 브라우저**에서 개발하고 테스트할 수 있게 해줍니다. 토스 앱 없이도 SDK의 모든 기능을 시뮬레이션하여 빠른 개발 사이클을 지원합니다.

- **60+ SDK API mock** — 인증, 결제, IAP, 위치, 카메라, 스토리지 등
- **Floating DevTools Panel** — 브라우저에서 SDK 상태를 실시간으로 제어
- **모든 번들러 지원** — [unplugin](https://github.com/unjs/unplugin) 기반 Vite, Webpack, Rspack, esbuild, Rollup 통합

## 설치

```bash
npm install -D ait-devtools
```

> `@apps-in-toss/web-framework ^2.0.0`이 peerDependency로 설정되어 있습니다 (optional).

## 사용법

### 1. Vite 플러그인

```ts
// vite.config.ts
import aitDevtools from 'ait-devtools/unplugin';

export default {
  plugins: [aitDevtools.vite()],
};
```

### 2. Webpack

```js
// webpack.config.js (ESM)
import aitDevtools from 'ait-devtools/unplugin';
config.plugins.push(aitDevtools.webpack());

// webpack.config.js (CommonJS)
const aitDevtools = require('ait-devtools/unplugin');
config.plugins.push(aitDevtools.webpack());
```

### 3. Next.js (Turbopack)

Turbopack은 플러그인 시스템을 지원하지 않으므로 `resolveAlias`를 사용합니다:

```js
// next.config.js (Next.js 15+)
module.exports = {
  turbo: {
    resolveAlias: {
      '@apps-in-toss/web-framework': 'ait-devtools/mock',
    },
  },
};

// Next.js 14 이하
module.exports = {
  experimental: {
    turbo: {
      resolveAlias: {
        '@apps-in-toss/web-framework': 'ait-devtools/mock',
      },
    },
  },
};
```

### 4. 수동 Alias 설정

번들러의 `resolve.alias` 설정으로 직접 지정할 수도 있습니다:

```js
// vite.config.ts 또는 webpack.config.js
{
  resolve: {
    alias: {
      '@apps-in-toss/web-framework': 'ait-devtools/mock',
      '@apps-in-toss/web-bridge': 'ait-devtools/mock',
      '@apps-in-toss/web-analytics': 'ait-devtools/mock',
    },
  },
}
```

## Floating DevTools Panel

플러그인 사용 시 진입점 파일에 패널이 자동 주입됩니다 (`aitDevtools.vite({ panel: false })`로 비활성화 가능).

화면 우하단의 **'AIT' 버튼**을 클릭하면 DevTools 패널이 토글됩니다.

### 7개 탭

| 탭 | 설명 |
|---|---|
| **Environment** | 플랫폼 OS (ios/android), 앱 버전, 환경 (toss/sandbox), 로케일, 네트워크 상태, Safe Area Insets (top/bottom) 설정 |
| **Permissions** | camera, photos, geolocation, clipboard, contacts, microphone 권한 상태 제어 (allowed/denied/notDetermined) |
| **Location** | 위도, 경도, 정확도 등 GPS 좌표 설정 |
| **IAP** | 인앱 구매 시뮬레이션 — 다음 구매 결과(success/취소/에러 등), TossPay 결제 결과, 완료된 주문 내역 |
| **Events** | Back/Home 네비게이션 이벤트 트리거, 로그인 상태 토글 |
| **Analytics** | 기록된 분석 이벤트 실시간 로그 뷰어 (타임스탬프, 타입, 파라미터) |
| **Storage** | `Storage` API로 저장된 항목 조회 및 초기화 |

## 브라우저 콘솔 사용법

`window.__ait`를 통해 mock 상태를 직접 제어할 수 있습니다:

```js
// 네트워크 상태 변경
__ait.update({ networkStatus: 'OFFLINE' });

// 여러 상태 한번에 업데이트
__ait.update({ platform: 'android', locale: 'en-US' });

// 이벤트 트리거
__ait.trigger('backEvent');

// 중첩 상태 업데이트 (permissions, iap 등)
__ait.patch('permissions', { camera: 'denied' });

// 현재 상태 조회
console.log(__ait.state.platform);
```

## Mock API 목록

### 인증/로그인

| API | 설명 |
|---|---|
| `appLogin` | 앱 로그인 |
| `getIsTossLoginIntegratedService` | 토스 로그인 통합 서비스 여부 |
| `getUserKeyForGame` | 게임용 유저 키 조회 |
| `appsInTossSignTossCert` | 토스 인증서 서명 |

### 화면/네비게이션

| API | 설명 |
|---|---|
| `closeView` | 현재 뷰 닫기 |
| `openURL` | URL 열기 |
| `share` | 공유하기 |
| `getTossShareLink` | 토스 공유 링크 조회 |
| `setIosSwipeGestureEnabled` | iOS 스와이프 제스처 활성화 설정 |
| `setDeviceOrientation` | 디바이스 방향 설정 |
| `setScreenAwakeMode` | 화면 꺼짐 방지 설정 |
| `setSecureScreen` | 보안 화면 설정 (캡처 방지) |
| `requestReview` | 앱 리뷰 요청 |

### 환경 정보

| API | 설명 |
|---|---|
| `getPlatformOS` | 플랫폼 OS 조회 (ios/android) |
| `getOperationalEnvironment` | 운영 환경 조회 (toss/sandbox) |
| `getTossAppVersion` | 토스 앱 버전 조회 |
| `isMinVersionSupported` | 최소 버전 지원 여부 |
| `getSchemeUri` | 스킴 URI 조회 |
| `getLocale` | 로케일 조회 |
| `getDeviceId` | 디바이스 ID 조회 |
| `getGroupId` | 그룹 ID 조회 |
| `getNetworkStatus` | 네트워크 상태 조회 |
| `getServerTime` | 서버 시간 조회 |
| `env.getDeploymentId` | 배포 ID 조회 |
| `getAppsInTossGlobals` | 글로벌 설정 조회 |

### Safe Area

| API | 설명 |
|---|---|
| `SafeAreaInsets.get` | Safe Area Insets 조회 |
| `SafeAreaInsets.subscribe` | Safe Area Insets 변경 구독 |
| `getSafeAreaInsets` | Safe Area Insets 조회 (함수형) |

### 이벤트/분석

| API | 설명 |
|---|---|
| `graniteEvent` | Granite 이벤트 발행 |
| `appsInTossEvent` | 앱인토스 이벤트 발행 |
| `tdsEvent` | TDS 이벤트 발행 |
| `onVisibilityChangedByTransparentServiceWeb` | 투명 서비스웹 가시성 변경 핸들러 |
| `Analytics` | 분석 네임스페이스 |
| `eventLog` | 이벤트 로그 기록 |

### 디바이스 기능

| API | 설명 |
|---|---|
| `Storage` | 로컬 스토리지 (getItem, setItem, removeItem, clearItems) |
| `getCurrentLocation` | 현재 위치 조회 |
| `startUpdateLocation` | 위치 업데이트 시작 |
| `Accuracy` | 위치 정확도 enum |
| `openCamera` | 카메라 열기 |
| `fetchAlbumPhotos` | 앨범 사진 가져오기 |
| `fetchContacts` | 연락처 가져오기 |
| `getClipboardText` | 클립보드 텍스트 읽기 |
| `setClipboardText` | 클립보드 텍스트 쓰기 |
| `generateHapticFeedback` | 햅틱 피드백 생성 |
| `saveBase64Data` | Base64 데이터 저장 |

### IAP/결제

| API | 설명 |
|---|---|
| `IAP.createOneTimePurchaseOrder` | 일회성 구매 주문 생성 |
| `IAP.createSubscriptionPurchaseOrder` | 구독 구매 주문 생성 |
| `IAP.getProductItemList` | 상품 목록 조회 |
| `IAP.getPendingOrders` | 대기 중 주문 조회 |
| `IAP.getCompletedOrRefundedOrders` | 완료/환불 주문 조회 |
| `IAP.completeProductGrant` | 상품 지급 완료 |
| `IAP.getSubscriptionInfo` | 구독 정보 조회 |
| `checkoutPayment` | TossPay 결제 |

### 광고

| API | 설명 |
|---|---|
| `GoogleAdMob.loadAppsInTossAdMob` | AdMob 광고 로드 |
| `GoogleAdMob.showAppsInTossAdMob` | AdMob 광고 표시 |
| `GoogleAdMob.isAppsInTossAdMobLoaded` | AdMob 광고 로드 여부 확인 |
| `TossAds.initialize` | 토스 광고 초기화 |
| `TossAds.attach` | 광고 슬롯 부착 |
| `TossAds.attachBanner` | 배너 광고 부착 |
| `TossAds.destroy` | 광고 슬롯 제거 |
| `TossAds.destroyAll` | 모든 광고 슬롯 제거 |
| `loadFullScreenAd` | 전면 광고 로드 |
| `showFullScreenAd` | 전면 광고 표시 |

### 게임/프로모션

| API | 설명 |
|---|---|
| `grantPromotionReward` | 프로모션 보상 지급 |
| `grantPromotionRewardForGame` | 게임 프로모션 보상 지급 |
| `submitGameCenterLeaderBoardScore` | 리더보드 점수 등록 |
| `getGameCenterGameProfile` | 게임센터 프로필 조회 |
| `openGameCenterLeaderboard` | 리더보드 열기 |
| `contactsViral` | 연락처 바이럴 |

### 권한

| API | 설명 |
|---|---|
| `getPermission` | 권한 상태 조회 |
| `openPermissionDialog` | 권한 설정 다이얼로그 열기 |
| `requestPermission` | 권한 요청 |

### 파트너

| API | 설명 |
|---|---|
| `partner.addAccessoryButton` | 액세서리 버튼 추가 |
| `partner.removeAccessoryButton` | 액세서리 버튼 제거 |

## SDK 업데이트 대응

ait-devtools는 세 가지 메커니즘으로 SDK 변경에 대응합니다:

### 1. peerDependencies + typeof 타입 강제

`src/__typecheck.ts`에서 mock의 주요 export가 원본 SDK와 타입 호환되는지 컴파일 타임에 검증합니다. SDK 시그니처가 변경되면 `tsc --noEmit`에서 즉시 에러가 발생합니다.

```ts
type Assert<TMock, TOriginal> = TMock extends TOriginal ? true : never;
type _AppLogin = Assert<typeof Mock.appLogin, typeof Original.appLogin>;
```

### 2. Proxy Fallback

미구현 API에 접근하면 에러 대신 경고 로그와 함께 no-op 함수를 반환하는 Proxy fallback으로 graceful하게 처리합니다. 새로운 SDK API가 추가되어도 앱이 크래시하지 않습니다.

### 3. GitHub Actions 주간 CI

`.github/workflows/check-sdk-update.yml`이 **매주 월요일** 자동으로 실행되어:

1. `@apps-in-toss/web-framework`의 새 버전 확인
2. 최신 버전으로 업데이트 후 타입 체크 실행
3. 새 버전 감지 시 자동으로 GitHub Issue 생성 (타입 에러 여부 포함)

## 라이센스

MIT
