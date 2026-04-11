# sdk-example 설계 스펙

## 개요

`@apps-in-toss/web-framework` SDK의 모든 API를 인터랙티브하게 테스트할 수 있는 API 레퍼런스 앱.
앱인토스에 실제 배포하여 SDK API의 작동 방식을 직접 확인할 수 있으며, 코드 자체가 유저에게 유효한 사용 예제가 된다.

## 레포지토리 구조

- **위치**: `apps-in-toss-community/sdk-example` (독립 레포)
- **devtools 레포 변경**: 기존 `examples/vite-react/` 삭제, GitHub Pages 워크플로우 제거, E2E 테스트는 sdk-example을 git clone하여 실행

## 기술 스택

- React + Vite + TypeScript (ESM)
- Tailwind CSS
- React Router (페이지 라우팅)

## 의존성

```
dependencies:
  @apps-in-toss/web-framework   # 원본 SDK (런타임, 실제 배포 시 사용)
  @ait-co/devtools              # Mock 라이브러리 (개발 시 unplugin이 SDK를 mock으로 alias)
```

개발 시 `@ait-co/devtools/unplugin`의 Vite 플러그인이 `@apps-in-toss/web-framework` import를 mock으로 대체한다.
실제 앱인토스 배포 시에는 원본 SDK가 그대로 사용된다.

## 레이아웃

- **모바일 퍼스트**: max-width 제한(430px) + 중앙 정렬, 데스크톱에서는 좌우 여백
- **미니멀/뉴트럴 디자인**: 회색 톤 기반, 특정 브랜드에 묶이지 않는 중립적 스타일
- **홈 화면**: 도메인 리스트 + 검색/필터
- **도메인 페이지**: 상단 뒤로가기 + 제목 → API 목록

## 페이지 구조 (15개 도메인 + 홈)

| 페이지 | 주요 API | UI 패턴 |
|---|---|---|
| Home | — | 도메인 리스트 + 검색/필터 |
| Auth | appLogin, getUserKeyForGame, getIsTossLoginIntegratedService, appsInTossSignTossCert | 인터랙티브 폼 |
| Navigation | closeView, openURL, share, getTossShareLink, setIosSwipeGestureEnabled, setDeviceOrientation, setScreenAwakeMode, setSecureScreen, requestReview | 인터랙티브 폼 |
| Environment | getPlatformOS, getOperationalEnvironment, getNetworkStatus, getTossAppVersion, isMinVersionSupported, getSchemeUri, getLocale, getDeviceId, getGroupId, getServerTime, env.getDeploymentId, getAppsInTossGlobals, SafeAreaInsets, getSafeAreaInsets | 인터랙티브 폼 |
| Permissions | getPermission, openPermissionDialog, requestPermission | 인터랙티브 폼 |
| Storage | Storage.setItem, getItem, removeItem, clearItems | 인터랙티브 폼 |
| Location | getCurrentLocation, startUpdateLocation | 인터랙티브 폼 |
| Camera & Photos | openCamera, fetchAlbumPhotos | 인터랙티브 폼 |
| Contacts | fetchContacts | 인터랙티브 폼 |
| Clipboard | getClipboardText, setClipboardText | 인터랙티브 폼 |
| Haptic | generateHapticFeedback, saveBase64Data | 인터랙티브 폼 |
| IAP | getProductItemList, createOneTimePurchaseOrder, createSubscriptionPurchaseOrder, getPendingOrders, getCompletedOrRefundedOrders, getSubscriptionInfo, checkoutPayment | **워크플로우** |
| Ads | GoogleAdMob (load/show/isLoaded), TossAds (initialize/attach/attachBanner/destroy/destroyAll), loadFullScreenAd, showFullScreenAd | **워크플로우** |
| Game | grantPromotionReward, grantPromotionRewardForGame, submitGameCenterLeaderBoardScore, getGameCenterGameProfile, openGameCenterLeaderboard, contactsViral | 인터랙티브 폼 |
| Analytics | Analytics.screen, impression, click, eventLog | 인터랙티브 폼 + 로그 히스토리 |
| Partner | partner.addAccessoryButton, removeAccessoryButton | 인터랙티브 폼 |

## API 테스트 UI 패턴

### 인터랙티브 폼 (기본)

각 API 함수마다:

1. **파라미터 입력**: 타입에 맞는 UI
   - `string` → 텍스트 입력
   - `number` → 숫자 입력
   - `boolean` → 토글
   - `enum` → 드롭다운
   - `object` → 중첩 필드 또는 JSON 입력
2. **실행 버튼**: API 호출
3. **결과 표시**: 구조화된 JSON + 성공/에러 상태 뱃지
4. **실행 히스토리**: 최근 호출 기록 (타임스탬프 + 결과)

### 워크플로우 (IAP, Ads)

여러 API를 순서대로 호출하는 스텝 바이 스텝 가이드.

**IAP 워크플로우 (Unity 예제 참고):**

1. **Step 1 — 상품 조회**: `getProductItemList()` 호출 → 상품 목록 표시 → 상품 선택
2. **Step 2 — 구매**: 선택한 상품으로 `createOneTimePurchaseOrder()` 또는 `createSubscriptionPurchaseOrder()` 호출 → 콜백(ProcessProductGrant) 처리 → 결과 표시
3. **Step 3 — 주문 관리**: `getPendingOrders()` → 미완료 주문 조회/복구, `getCompletedOrRefundedOrders()` → 완료/환불 내역, `getSubscriptionInfo()` → 구독 상세

**Ads 워크플로우:**

1. **Step 1 — 초기화/로드**: `GoogleAdMob.loadAppsInTossAdMob()` 또는 `TossAds.initialize()`
2. **Step 2 — 표시**: `GoogleAdMob.showAppsInTossAdMob()` 또는 `TossAds.attach()` → 이벤트 로그 (loaded → impression → reward → dismissed)

## 네비게이션

- **홈 화면**: 15개 도메인 카드 리스트 + 상단 검색바 (이름/API명으로 필터)
- **도메인 페이지**: 상단 헤더(뒤로가기 + 도메인 이름) → 스크롤 가능한 API 목록
- React Router 사용, 브라우저 뒤로가기 지원

## SDK 업데이트 대응

### 빌드 타임 검증

sdk-example에 `__typecheck.ts`를 두어, `@apps-in-toss/web-framework`의 모든 public export가 example에서 커버되는지 컴파일 타임에 검증한다. 새 API가 추가되었는데 example에서 사용하지 않으면 타입 에러 발생.

### CI 감지

`@apps-in-toss/web-framework`의 새 버전이 출시되면 CI 워크플로우가 자동 감지하여 이슈를 생성한다. devtools의 기존 `check-sdk-update.yml`과 동일한 전략.

`@ait-co/devtools`의 새 버전도 동일하게 감지한다.

## devtools 레포 변경사항

### 삭제

- `examples/vite-react/` 디렉토리 전체
- `.github/workflows/deploy-pages.yml`

### 수정

- `playwright.config.ts`: sdk-example을 git clone하여 빌드/서빙 후 E2E 실행
- `package.json`: `example` 스크립트 제거 또는 안내 메시지로 변경
- `CLAUDE.md`: example 관련 안내를 sdk-example 레포 참조로 변경

## 프로젝트 구조 (sdk-example)

```
sdk-example/
├── src/
│   ├── main.tsx                 # 엔트리포인트, devtools panel import
│   ├── App.tsx                  # React Router 설정
│   ├── pages/
│   │   ├── HomePage.tsx         # 도메인 리스트 + 검색
│   │   ├── AuthPage.tsx
│   │   ├── NavigationPage.tsx
│   │   ├── EnvironmentPage.tsx
│   │   ├── PermissionsPage.tsx
│   │   ├── StoragePage.tsx
│   │   ├── LocationPage.tsx
│   │   ├── CameraPage.tsx
│   │   ├── ContactsPage.tsx
│   │   ├── ClipboardPage.tsx
│   │   ├── HapticPage.tsx
│   │   ├── IAPPage.tsx
│   │   ├── AdsPage.tsx
│   │   ├── GamePage.tsx
│   │   ├── AnalyticsPage.tsx
│   │   └── PartnerPage.tsx
│   ├── components/
│   │   ├── Layout.tsx           # 모바일 퍼스트 레이아웃 쉘
│   │   ├── PageHeader.tsx       # 뒤로가기 + 제목
│   │   ├── ApiCard.tsx          # 단일 API 테스트 카드 (폼 + 실행 + 결과)
│   │   ├── ParamInput.tsx       # 타입별 파라미터 입력 컴포넌트
│   │   ├── ResultView.tsx       # 결과 표시 (JSON + 상태 뱃지)
│   │   ├── HistoryLog.tsx       # 실행 히스토리
│   │   └── WorkflowStepper.tsx  # 워크플로우 스텝 UI
│   ├── __typecheck.ts           # SDK export 커버리지 검증
│   └── index.css                # Tailwind 설정
├── index.html
├── vite.config.ts               # @ait-co/devtools/unplugin 사용
├── tailwind.config.js
├── tsconfig.json
├── package.json
└── .github/
    └── workflows/
        └── check-sdk-update.yml # SDK 새 버전 감지
```
