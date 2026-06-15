# Mock ↔ Real fidelity 카탈로그

`@ait-co/devtools`가 브라우저에서 제공하는 SDK **mock**과, 실제 토스 앱 WebView 안에서 도는 **real** 환경의 동작 차이를 한곳에 모은 표다. 목표는 "브라우저에서 통과한 코드가 실폰에서 다르게 동작"하는 회귀를 mock 단계에서 잡는 것 — gap을 먼저 가시화해야 어디부터 좁힐지 우선순위를 정할 수 있다.

이 문서는 **카탈로그(survey)일 뿐 구현이 아니다.** 각 행의 gap을 실제로 좁히는 작업은 별도 PR로 나뉘며, 그 우선순위 근거가 이 표다. 추적: [devtools#190](https://github.com/apps-in-toss-community/devtools/issues/190).

## 읽는 법

- **분류(category)** — gap의 성격:
  - `🔴 inert` — mock이 호출은 받지만 **상태를 전혀 안 바꿔** 호출 전/후를 구분할 수 없다. real은 환경을 바꾸므로 toss-gated 코드가 브라우저에서 영영 안 돌거나, 부수효과를 대조할 수 없다. **gap이 가장 큼.**
  - `🟡 partial` — 동작은 하지만 real과 형태·타이밍·분기가 다르다. 보통 실용에 충분하나 edge case에서 갈린다.
  - `🟢 faithful` — mock이 real의 계약(반환 shape·상태 전이)을 충실히 재현. 남은 차이는 native 런타임 자체(실제 결제 UI, 실제 카메라)뿐.
- **관측 가능?** — 호출 결과가 `AIT.getMockState`(패널·MCP로 read)에 반영되는가. `AIT.getMockState`는 `aitState.state`를 그대로 반환하므로, **state slice에 쓰는 API만** 에이전트가 호출 후 환경 변화를 관측할 수 있다. `✓ sdkCallLog`는 영역 4 ([#195](https://github.com/apps-in-toss-community/devtools/issues/195)) 구현으로 추가된 `AIT.getSdkCallHistory` 관측을 뜻한다 — state가 안 바뀌는 inert API도 **호출 자체**를 패널 Analytics → Calls 뷰에서 🔴 뱃지로 확인하고, MCP `AIT.getSdkCallHistory`로 에이전트가 읽을 수 있다.
- 코드 위치는 `src/mock/` 기준 상대 경로.

이 표의 출발점은 [devtools#171](https://github.com/apps-in-toss-community/devtools/issues/171) on-device relay 세션(2026-05-25)에서 실폰(`AppsInToss TossApp/5.261.0`)에 attach해 실측한 분기들이다.

---

## 0. 환경 기본값 (전체 gate의 뿌리)

mock의 환경 기본값이 real과 달라서, 환경으로 분기하는 코드 경로 전체가 브라우저에서 다르게 활성화된다. 개별 API 이전에 이 기본값들이 fidelity의 1차 변수다.

| 항목 | mock 기본값 | real (실폰 실측) | 분류 | gap |
|---|---|---|---|---|
| `environment` (`getOperationalEnvironment`) | `'sandbox'` (`state.ts:157`) | `'toss'` (본 앱) | 🔴 inert | `=== 'toss'`로 gate되는 코드(예: sdk-example `useDisableIosSwipeGestureInToss`)가 브라우저에서 **영영 inert**. 패널 Environment row(`panel/tabs/environment.ts`의 `env.row.environment` selectRow)로 `'toss'` 전환은 가능하나 default가 sandbox라 dev가 의식적으로 안 켜면 toss 경로는 한 번도 안 돈다. |
| `platform` (`getPlatformOS`) | `'ios'` | 디바이스에 따름 | 🟢 faithful | 패널에서 ios/android 토글. 상태 기반이라 관측·전환 정상. |
| `appVersion` (`getTossAppVersion`) | `'5.240.0'` | 실 앱 버전(예: `5.261.0`) | 🟡 partial | `isMinVersionSupported`가 이 값으로 계산. default가 임의 고정값이라 실 버전 분기와 어긋날 수 있다. 패널에서 변경 가능. |
| `deploymentId` (`env.getDeploymentId`) | `'mock-deployment-id'` | 실 배포 id(UUID) | 🟡 partial | 형태만 흉내. relay activation gate(B2)는 real host에서만 의미 있음. |
| `host` / UA | 브라우저 origin · 브라우저 UA | `*.private-apps.tossmini.com` · `AppsInToss TossApp/x` | 🔴 inert | host/UA로 gate되는 코드는 브라우저에서 시험 불가. mock에 환경 단서 흉내 옵션 없음 (#190 범위 4). |

---

## 0.5. Safe area insets · 기기 특성 (viewport 모델)

토스 앱 WebView는 실 기기의 노치/Dynamic Island/홈 인디케이터에 따라 `safe-area-inset-*`와 CSS viewport·DPR이 정해진다. devtools는 이걸 **두 갈래**로 모델한다 — 둘이 어긋날 수 있는 게 fidelity gap의 한 축이다:

1. **`safeAreaInsets` state slice** (`SafeAreaInsets.get()` / `.subscribe()`가 읽는 SDK 계약값) — default `{top:54, bottom:34, left:0, right:0}` (`state.ts`). 패널 Environment 탭에서 top/bottom 직접 편집(`panel/tabs/environment.ts:66-73`).
2. **viewport preset** (devtools 전용 화면 시뮬레이션, SDK와 무관) — `VIEWPORT_PRESETS`(`panel/viewport.ts`)가 기기별 `width/height/dpr/notch/safeAreaTop/safeAreaBottom`을 정의. preset이 `none`/`custom`이 **아닐 때만** `syncSafeAreaFromViewport`가 preset 값을 ① slice로 동기화(orientation·landscapeSide 반영). default는 `preset:'none'`이라 **동기화 안 됨** → slice의 `{54,34}` 정적 값(실측 기반)이 그대로 남는다.

### gap

| 항목 | mock | real (연결 기기 = iPhone 15 Pro) | 분류 | gap |
|---|---|---|---|---|
| `safeAreaInsets` default | `{top:54, bottom:34, left:0, right:0}` (devtools#190 실측 기반) | iPhone 15 Pro Dynamic Island: `top=54`(토스 nav bar), `bottom=34`(home indicator) | 🟢 faithful | top=54는 devtools#190 relay 실측과 정합. `env(safe-area-inset-top)`은 0이며 top은 토스 host nav bar 높이 — 실측과 일치. |
| `left`/`right` insets | 항상 0 (portrait) | landscape에서 ≠0 (노치 쪽) | 🟡 partial | preset 선택 + landscape일 때만 `computeSafeAreaInsets`가 채움. slice 단독으론 portrait 0 고정. |
| viewport preset 목록 | SE3 / 15 Pro / 16e / 17 / Air / 17 Pro / 17 Pro Max + Galaxy | iPhone 15 Pro preset 존재 (393×852, DPR 3, Dynamic Island) | 🟢 faithful | iPhone 15 Pro preset이 devtools#190 PR에서 추가됨 — `safeAreaProvenance: measured`. |
| `DPR` (`devicePixelRatio`) | preset의 `dpr` (시각 시뮬용) | 15 Pro = 3 | 🟡 partial | preset이 화면 프레임 스케일에만 쓰이고 `window.devicePixelRatio` 자체를 못 바꾼다 (브라우저 read-only 천장). DPR-분기 코드는 브라우저 실 DPR을 봄 — `measure_safe_area`가 실기기 DPR을 반환하므로 relay 세션에서 확인 가능. |
| slice ↔ preset 일관성 | preset 선택 시 sync (`none`/`custom` 제외) | 실 기기는 단일 ground truth | 🟡 partial | 두 모델이 분리돼 있어, slice를 손으로 바꾸고 preset도 고르면 둘이 불일치 가능. `none`/`custom`에선 sync 자체가 꺼짐. |

iPhone 15 Pro 실 web-relevant 스펙(devtools#190 relay 실측): CSS viewport **393×852**(portrait), DPR **3**, notch = **Dynamic Island**, `env(safe-area-inset-top)` **= 0** (호스트 WebView가 notch 아래에 위치), `SafeAreaInsets.get().top` **= 54** (토스 host nav bar 높이), `bottom` **= 34**.

### 후속(이 카탈로그 범위 밖, #198 구현 대상)

- **Android/landscape safe-area 실측** — Galaxy 계열 `safeArea*`는 relay 세션 미진행(`placeholder`). `measure_safe_area` MCP 툴로 실기기 relay 세션에서 측정 후 `measured`로 승급 필요.
- **DPR 천장** — `window.devicePixelRatio`는 브라우저 read-only라 로컬에서 에뮬레이션 불가. 이건 환경 1의 구조적 천장 — relay 세션(환경 2·3)에서만 실 DPR을 관측할 수 있으며 `measure_safe_area`가 그 값을 반환한다.
- **landscape nav bar 실측** — landscape에서 토스 host nav bar가 어떻게 동작하는지 아직 relay 실측 없음. portrait 모델(`top=54`)만 확정.

---

## 0.6. Safe-area 실측 절차 (`measure_safe_area` MCP 툴)

`measure_safe_area` MCP 툴을 relay 세션(환경 2·3)에서 호출하면 실기기의 `SafeAreaInsets` + `devicePixelRatio`를 읽어 반환한다. 이 절차로 preset의 `safeAreaProvenance`를 `measured`로 승급한다.

### 측정 대상 조합

기기당 아래 4개 조합(orientation × navBarType)을 측정한다. 각 조합에서 `measure_safe_area` 툴을 호출하고 반환값을 표에 기록한다.

| orientation | navBarType | measure 필요 항목 |
|---|---|---|
| portrait | partner | top(nav bar), bottom(home indicator), left, right |
| portrait | game | **SDK deprecated** (web-framework 2.6.1: `type?: 'partner' \| 'external' \| 'game'`, external/game `@deprecated`) → mock은 partner와 동일하게 취급(top=0). deprecated 경로는 신뢰할 ground truth를 얻을 수 없어 실측 미추진 (#577) |
| landscape (notch 왼쪽) | partner | left(notchInset), top(0 예상), right, bottom |
| landscape (notch 오른쪽) | partner | right(notchInset), top(0 예상), left, bottom |

### 측정 흐름

1. relay 세션 진입: `build_attach_url` 툴로 QR/deep-link를 생성하고 실기기 토스 앱에서 스캔.
2. relay attach 확인: `list_pages` 툴로 연결된 페이지 확인.
3. 각 조합마다 `measure_safe_area` 툴 호출. 반환 예시:
   ```json
   { "top": 54, "right": 0, "bottom": 34, "left": 0, "devicePixelRatio": 3 }
   ```
4. 반환값을 아래 표에 채운다. `safeAreaBottom`은 portrait bottom 값, `notchInset`은 landscape left/right 값으로 검증.

### 기록 표 (실측 후 채울 것)

| preset id | 측정일 | orientation | navBarType | top | right | bottom | left | DPR | 비고 |
|---|---|---|---|---|---|---|---|---|---|
| `iphone-15-pro` | 2026-05-25 | portrait | partner | 54 | 0 | 34 | 0 | 3 | devtools#190 실측 — `measured` 승급 완료 |
| `iphone-16e` | — | portrait | partner | — | — | — | — | — | 미실측 (`extrapolated`) |
| `iphone-17` | — | portrait | partner | — | — | — | — | — | 미실측 (`extrapolated`) |
| `iphone-air` | — | portrait | partner | — | — | — | — | — | 미실측 (`extrapolated`) |
| `iphone-17-pro` | — | portrait | partner | — | — | — | — | — | 미실측 (`extrapolated`) |
| `iphone-17-pro-max` | — | portrait | partner | — | — | — | — | — | 미실측 (`extrapolated`) |
| `galaxy-s26` | — | portrait | partner | — | — | — | — | — | 미실측 (`placeholder`) |
| `galaxy-s26-plus` | — | portrait | partner | — | — | — | — | — | 미실측 (`placeholder`) |
| `galaxy-s26-ultra` | — | portrait | partner | — | — | — | — | — | 미실측 (`placeholder`) |
| `galaxy-z-flip7` | — | portrait | partner | — | — | — | — | — | 미실측 (`placeholder`) |
| `galaxy-z-fold7-folded` | — | portrait | partner | — | — | — | — | — | 미실측 (`placeholder`) |
| `galaxy-z-fold7-unfolded` | — | portrait | partner | — | — | — | — | — | 미실측 (`placeholder`) |

### 측정 후 코드 승급 절차

1. `src/panel/viewport.ts`의 해당 preset에서 `safeAreaProvenance`를 수정:
   ```ts
   safeAreaProvenance: { source: 'measured', device: 'iPhone XX', date: 'yyyy-mm-dd' }
   ```
2. `navBarHeight`, `safeAreaBottom`, `notchInset` 값이 측정값과 다르면 같이 수정.
3. 이 표의 해당 행을 채운다.
4. `pnpm typecheck && pnpm test`로 회귀 없음 확인 후 PR.

### DPR 천장

`window.devicePixelRatio`는 브라우저 read-only라 환경 1(로컬 브라우저)에서는 에뮬레이션이 구조적으로 불가하다. `measure_safe_area`가 relay 세션에서 실기기 DPR을 반환하므로, DPR 확인은 환경 2·3에서만 가능하다. 이 천장은 환경 1의 설계 제약으로 향후 해결 대상이 아니다.

---

## 1. Navigation / 환경 / 이벤트 (`navigation/index.ts`)

| API | mock 동작 | real 동작 | 분류 | 관측? | gap |
|---|---|---|---|---|---|
| `setIosSwipeGestureEnabled` | `console.log`만 (`navigation/index.ts:31`) | iOS 엣지 스와이프 뒤로가기 제스처를 실제 토글 | 🔴 inert | ✗ | 호출 후 mock state 변화 없음 → toss-gated 가드가 "걸렸는지"를 관측 불가. **#190 1순위** (pattern: `setDeviceOrientation` mirror). |
| `setDeviceOrientation` | `viewport.appOrientation` 토글 (`auto`일 때만) | 화면 방향 강제 | 🟢 faithful | ✓ | 상태 기록·패널 반영. real과 가장 가까운 no-op→state 패턴의 모범. |
| `setScreenAwakeMode` | log + 입력값 echo → **`sdkCallLog` 🔴 기록** (#195) | 화면 슬립 방지 토글 | 🔴 inert | ✓ sdkCallLog | `{enabled}` 반환만, state 미반영. Analytics 탭 Calls 뷰에서 🔴 뱃지로 관측 가능. |
| `setSecureScreen` | log + 입력값 echo → **`sdkCallLog` 🔴 기록** (#195) | 캡처 방지(보안 화면) | 🔴 inert | ✓ sdkCallLog | 위와 동일. |
| `requestReview` | log (`isSupported:()=>true`) → **`sdkCallLog` 🔴 기록** (#195) | 앱스토어 리뷰 프롬프트 | 🔴 inert | ✓ sdkCallLog | native UI라 브라우저 재현 불가. 호출 여부는 sdkCallLog로 관측 가능. |
| `closeView` | `window.history.back()` | 미니앱 뷰 종료 | 🟡 partial | ✗ | 브라우저에선 히스토리 뒤로. 실제 종료(앱 컨테이너 dismiss)와 의미 다름. |
| `openURL` | `window.open(_, '_blank')` | 외부 브라우저/딥링크 | 🟡 partial | ✗ | 새 탭. 토스 in-app 브라우저 동작과 다름. |
| `share` | `navigator.share` 있으면 위임, 없으면 log | 네이티브 공유 시트 | 🟡 partial | ✗ | 브라우저 Web Share에 의존. |
| `getTossShareLink` | `https://toss.im/share/mock<path>` 고정 | 실제 공유 단축 URL | 🟡 partial | ✗ | 형태만 흉내, 실 링크 아님. |
| `getNetworkStatus` | mode-aware (`mock`/`web`) | 실 네트워크 상태 | 🟡 partial | ✓ | web mode는 `navigator.connection`으로 추정(`device/network.ts`). WIFI/5G/WWAN 감지 불가 — Network Information API 한계. |
| `getServerTime` | `Date.now()` | 토스 서버 시각 | 🟡 partial | ✗ | 로컬 시각. 서버 시각 skew 미반영. |
| `isMinVersionSupported` | `appVersion` state로 계산 | 실 앱 버전 비교 | 🟢 faithful | (state 의존) | 로직 충실. 입력값(`appVersion` default)에만 의존. |
| `getPlatformOS` / `getLocale` / `getDeviceId` / `getGroupId` / `getSchemeUri` | state 반환 | 실 환경값 | 🟢 faithful | ✓ | 상태 기반 read. `deviceId` default는 빈 문자열. |
| `getAppsInTossGlobals` | `brand.*` + `deploymentId` state 반환 | 실 브랜드/배포 메타 | 🟢 faithful | ✓ | 패널 brand slice로 편집 가능. |
| `SafeAreaInsets.get` / `.subscribe` | state 반환 / `aitState.subscribe` 위임 | 실 insets + insets 변경 시 호출 | 🟡 partial | ✓ | `subscribe`가 **모든** state 변경에 콜백 (real은 insets 변경 시만) — 의도된 간소화(`navigation/index.ts` 주석). |
| `graniteEvent.addEventListener` (`backEvent`/`homeEvent`) | `window` 커스텀 이벤트(`__ait:*`) 브리지 | 네이티브 back/home 하드웨어 이벤트 | 🟡 partial | ✗ | 패널/relay로 `__ait:backEvent` dispatch해 트리거. 실 하드웨어 버튼은 아님. |
| `tdsEvent.addEventListener` (`navigationAccessoryEvent`) | `window` 커스텀 이벤트 브리지 | 네비 액세서리 버튼 탭 | 🟡 partial | ✗ | 위와 동일 패턴. |
| `appsInTossEvent.addEventListener` | **빈 cleanup 반환 (완전 no-op)** (`navigation/index.ts`) | 실 앱 라이프사이클/커스텀 이벤트 | 🔴 inert | ✗ | 리스너 등록 자체가 무의미 — 어떤 이벤트도 발화 안 됨. |
| `onVisibilityChangedByTransparentServiceWeb` | `document` visibilitychange 위임 | 투명 서비스웹 가시성 | 🟡 partial | ✗ | 브라우저 탭 가시성으로 근사. |

---

## 2. Auth / 로그인 (`auth/index.ts`)

| API | mock 동작 | real 동작 | 분류 | 관측? | gap |
|---|---|---|---|---|---|
| `appLogin` | `mock-auth-<uuid>` + `environment` 따라 referrer | 실 OAuth authorization code | 🟡 partial | (env 의존) | 토큰은 가짜. referrer는 `'toss'→DEFAULT`/`else→SANDBOX`로 환경 반영. oidc-bridge 연동 시 실 code 필요. |
| `getIsTossLoginIntegratedService` | `auth.isTossLoginIntegrated` state | 실 통합 여부 | 🟢 faithful | ✓ | 패널 토글. |
| `getUserKeyForGame` | `auth.userKeyHash` 있으면 `{hash,HASH}`, 없으면 `undefined` | 실 사용자 키 해시 | 🟢 faithful | ✓ | 상태 기반. |
| `getAnonymousKey` | `auth.anonymousKeyHash` 동일 패턴 | 실 익명 키 | 🟢 faithful | ✓ | 상태 기반. |
| `appsInTossSignTossCert` | `console.log`만 (no-op) | 토스 인증서 서명 | 🔴 inert | ✗ | 호출만, 서명 결과·state 없음. |

---

## 3. IAP / 결제 (`iap/index.ts`)

| API | mock 동작 | real 동작 | 분류 | 관측? | gap |
|---|---|---|---|---|---|
| `IAP.createOneTimePurchaseOrder` | 300ms 후 `iap.nextResult` 분기 → `processProductGrant` → `completedOrders`에 기록 | 실 결제 UI + 결제 | 🟢 faithful | ✓ | 계약 충실. 반환 cancel 함수는 no-op(실 SDK는 결제 UI 닫음). |
| `IAP.createSubscriptionPurchaseOrder` | 위와 동일 흐름(구독) | 실 구독 결제 | 🟢 faithful | ✓ | 동일. |
| `IAP.getProductItemList` | `iap.products` 반환(구독은 `renewalCycle` 보강) | 실 상품 카탈로그 | 🟢 faithful | ✓ | 패널 상품 편집. |
| `IAP.getPendingOrders` | `iap.pendingOrders` 반환 | 실 미완료 주문 | 🟢 faithful | ✓ | 상태 기반. |
| `IAP.getCompletedOrRefundedOrders` | `iap.completedOrders` (`hasNext:false`) | 실 주문 이력(페이지네이션) | 🟡 partial | ✓ | mock은 항상 단일 페이지. |
| `IAP.completeProductGrant` | pending→completed 전이 | 실 grant 확정 | 🟢 faithful | ✓ | 상태 전이 충실. |
| `IAP.getSubscriptionInfo` | 30일 후 만료 고정 ACTIVE | 실 구독 상태 | 🟡 partial | ✗ | 입력 무시, 항상 동일 더미. state 미반영. |
| `checkoutPayment` (TossPay) | 300ms 후 `payment.nextResult` 분기 | 실 결제 토큰 검증 | 🟢 faithful | ✓ | 패널 payment slice로 success/fail 토글. |
| `requestTossPayPaysBilling` | 위와 동일(`isSupported:()=>true`) | 실 빌링 인증 | 🟢 faithful | ✓ | 동일. |

---

## 4. Ads (`ads/index.ts`)

| API | mock 동작 | real 동작 | 분류 | 관측? | gap |
|---|---|---|---|---|---|
| `GoogleAdMob.loadAppsInTossAdMob` | 200ms 후 `forceNoFill`이면 error, 아니면 `isLoaded=true` + `loaded` 이벤트 | 실 AdMob 로드 | 🟢 faithful | ✓ sdkCallLog | 패널 `forceNoFill` 토글로 no-fill 시험. |
| `GoogleAdMob.showAppsInTossAdMob` | `isLoaded` 체크 후 requested→show→impression→reward→dismissed 시퀀스 emit | 실 광고 노출 + 리워드 | 🟢 faithful | ✓ sdkCallLog | 이벤트 타임라인 재현. reward는 `state.ads.rewardUnitType`/`rewardAmount`로 파라미터화 (#196). |
| `GoogleAdMob.isAppsInTossAdMobLoaded` | `ads.isLoaded` 반환 | 실 로드 상태 | 🟢 faithful | ✓ sdkCallLog | 상태 기반. |
| `TossAds.initialize` | `onInitialized` 발화. `forceNoFill=true`이면 `onInitializationFailed` 발화 (#196) | 실 SDK 초기화 | 🟢 faithful | ✓ sdkCallLog | 콜백 발화 완성. 패널 Load 버튼이 initialize를 통해 `isLoaded=true` + `loaded` 이벤트 기록. |
| `TossAds.attach` | DOM에 placeholder div 삽입 | 실 광고 렌더 | 🟡 partial | ✓ sdkCallLog | 시각적 placeholder. 실 광고 콘텐츠 아님. |
| `TossAds.attachBanner` | DOM에 placeholder 삽입 + `BannerSlotCallbacks` 발화(onAdRendered/onAdImpression 기본; forceNoFill이면 onNoFill/onAdFailedToRender). AttachBannerOptions(theme/tone/variant) 스타일 반영. 반환 `{destroy}`가 실제 `el.remove()` (#196) | 실 광고 렌더 + 콜백 | 🟢 faithful | ✓ sdkCallLog | 패널 TossAds 배너 섹션에서 Render/No-fill/Click/Destroy 버튼으로 결정론적 발화. |
| `TossAds.destroy` / `destroyAll` | slot 레지스트리(`Map<string, HTMLElement>`)로 placeholder 추적 → 실제 `el.remove()` 수행 (#196) | 실 광고 해제 | 🟢 faithful | ✓ sdkCallLog | 누수 수정. `destroyAll`은 등록된 모든 슬롯 제거. |
| `loadFullScreenAd` / `showFullScreenAd` | AdMob과 동일 패턴(`isLoaded` 공유) | 실 전면 광고 | 🟢 faithful | ✓ sdkCallLog | `ads.isLoaded` 공유 — load 없이 show하면 error. |

---

## 5. Game / 프로모션 (`game/index.ts`)

| API | mock 동작 | real 동작 | 분류 | 관측? | gap |
|---|---|---|---|---|---|
| `grantPromotionReward` | log + `{key: mock-reward-<ts>}` | 실 리워드 지급 | 🟡 partial | ✗ | 항상 성공, state 미반영. 실제 지급/중복 방지 없음. |
| `grantPromotionRewardForGame` | 위와 동일 | 실 게임 리워드 | 🟡 partial | ✗ | 동일. |
| `submitGameCenterLeaderBoardScore` | `game.leaderboardScores`에 push + `SUCCESS` | 실 리더보드 제출 | 🟢 faithful | ✓ | 상태 기록. |
| `getGameCenterGameProfile` | `game.profile` 있으면 SUCCESS, 없으면 `PROFILE_NOT_FOUND` | 실 게임 프로필 | 🟢 faithful | ✓ | 패널 profile 토글. |
| `openGameCenterLeaderboard` | log (no-op in browser) | 네이티브 리더보드 UI | 🔴 inert | ✗ | native UI라 재현 불가. |
| `contactsViral` | 500ms 후 `close`/`noReward` 이벤트 | 실 연락처 바이럴 시트 | 🟡 partial | ✗ | 항상 noReward로 닫힘. 실 바이럴 흐름 없음. |

---

## 6. Notification (`notification.ts`)

| API | mock 동작 | real 동작 | 분류 | 관측? | gap |
|---|---|---|---|---|---|
| `requestNotificationAgreement` | microtask 후 `notification.nextResult`를 `onEvent`로 | 실 알림 동의 시트 | 🟢 faithful | (state 입력) | 패널에서 결과 토글(`agreementRejected` 포함). 계약 충실. |

---

## 7. Device — Storage (`device/storage.ts`)

| API | mock 동작 | real 동작 | 분류 | 관측? | gap |
|---|---|---|---|---|---|
| `Storage.getItem` / `setItem` / `removeItem` / `clearItems` | `localStorage`에 `__ait_storage:` prefix로 격리 | 네이티브 KV 저장 | 🟢 faithful | ✗ | localStorage라 영속·격리 정상. 단 `AIT.getMockState`엔 안 보임(브라우저 storage). 용량/직렬화 제약은 브라우저 기준. |

---

## 8. Device — Location (`device/location.ts`)

| API | mock 동작 | real 동작 | 분류 | 관측? | gap |
|---|---|---|---|---|---|
| `getCurrentLocation` | mode 분기: `mock`(state 좌표) / `web`(`navigator.geolocation`) / `prompt`(패널 입력) | 실 GPS | 🟢 faithful | ✓ | permission gate 부착(`checkPermission`). 3-mode로 실용성 높음. |
| `startUpdateLocation` | mode 분기: `mock`(지터 추가 interval) / `web`(`watchPosition`) / `prompt` | 실 위치 스트림 | 🟢 faithful | ✓ | mock mode는 ±0.0001 무작위 드리프트. |
| `Accuracy` (enum) | SDK와 동일 enum | 동일 | 🟢 faithful | — | 값 일치. |

---

## 9. Device — Camera / Photos (`device/camera.ts`)

| API | mock 동작 | real 동작 | 분류 | 관측? | gap |
|---|---|---|---|---|---|
| `openCamera` | mode 분기: `mock`(더미 이미지) / `web`(`<input capture>`) / `prompt` | 실 카메라 | 🟡 partial | ✗ | web mode 파일 선택 취소 감지가 focus 휴리스틱이라 모바일/Safari에서 불안정(코드 주석). |
| `fetchAlbumPhotos` | mode 분기: 더미 / `<input multiple>` / prompt | 실 앨범 다중 선택 | 🟡 partial | ✗ | 위와 동일 취소 감지 한계. |
| `fetchAlbumItems` (PHOTO/VIDEO) | mode 분기. mock mode는 PHOTO만 | 실 사진·동영상 복합 선택 | 🟡 partial | ✗ | mock mode에서 VIDEO 더미 없음 — PHOTO만 반환. |

---

## 10. Device — Clipboard / Contacts / Haptic / PDF (`device/*.ts`)

| API | mock 동작 | real 동작 | 분류 | 관측? | gap |
|---|---|---|---|---|---|
| `getClipboardText` / `setClipboardText` | mode 분기: `mock`(state) / `web`(`navigator.clipboard`, default) | 네이티브 클립보드 | 🟢 faithful | ✓ (mock mode) | web mode는 브라우저 권한 프롬프트·HTTPS 필요. permission gate 부착. |
| `fetchContacts` | `contacts` state slice 페이지네이션 + `contains` 필터 | 실 주소록 | 🟢 faithful | ✓ | 패널 contacts 편집. offset/size/query 충실. |
| `generateHapticFeedback` | `analyticsLog` 기록 + 10종 타입→`navigator.vibrate` 패턴 매핑(best-effort) + `sdkCallLog` 🟡 기록(hapticType + vibrated) + 패널 Device 탭 마지막 haptic 행·트리거 버튼 | 실 햅틱 진동 | 🟡 partial | ✓ sdkCallLog | 진동 자체는 native API라 브라우저 표현이 다름. `navigator.vibrate` 지원 여부에 따라 실제 진동 여부(`vibrated: boolean`)가 sdkCallLog에 기록되어 관측 가능. ([#197](https://github.com/apps-in-toss-community/devtools/issues/197)) |
| `saveBase64Data` | `<a download>` 트리거(브라우저 다운로드) | 네이티브 파일 저장 | 🟡 partial | ✗ | 브라우저 다운로드로 근사. 저장 위치 다름. |
| `openPDFViewer` | `await Promise.resolve()` 후 `'CLOSE'` | 네이티브 PDF 뷰어 | 🔴 inert | ✗ | 즉시 CLOSE 반환, 실제 뷰어 없음. 권한·모드 분기 없음. |

---

## 11. Permissions (`permissions.ts`)

| API | mock 동작 | real 동작 | 분류 | 관측? | gap |
|---|---|---|---|---|---|
| `getPermission` | `permissions[name]` state 반환 | 실 권한 상태 | 🟢 faithful | ✓ | 패널 권한 토글. |
| `openPermissionDialog` | `allowed`면 그대로, 아니면 `allowed`로 전환 후 반환 | 네이티브 권한 다이얼로그 | 🟡 partial | ✓ | 항상 allow로 귀결(denied 유지 불가). 실 다이얼로그의 거부 흐름 미재현. |
| `requestPermission` | `openPermissionDialog` 위임 | 동일 | 🟡 partial | ✓ | 위와 동일. |
| `checkPermission` (내부) | `denied`면 throw | — | 🟢 faithful | — | 각 device API가 호출. denied 시 명확한 에러. |

---

## 12. Analytics (`analytics/index.ts`) · Partner (`partner/index.ts`)

| API | mock 동작 | real 동작 | 분류 | 관측? | gap |
|---|---|---|---|---|---|
| `Analytics.screen` / `impression` / `click` | `analyticsLog`에 기록 | 실 텔레메트리 전송 | 🟢 faithful | ✓ | 전송 대신 로컬 로그 — dev에선 더 유용(패널에서 관측). |
| `eventLog` | `analyticsLog`에 `log_type`별 기록 | 실 이벤트 로그 전송 | 🟢 faithful | ✓ | 동일. |
| `partner.addAccessoryButton` / `removeAccessoryButton` | `console.log`만 | 네비 액세서리 버튼 등록/제거 | 🔴 inert | ✗ | 호출만, state·DOM 변화 없음. `tdsEvent.navigationAccessoryEvent`와 짝이지만 mock에선 둘 다 끊겨 있음. |

---

## 요약 — gap 우선순위 (구현 PR 순서 후보)

`🔴 inert`가 가장 시급하다 — 호출 전/후를 구분할 수 없어 회귀를 mock에서 못 잡는다. real에서 환경/관측 신호를 갖는 것부터 좁힌다.

1. **`environment` 기본값 + toss 진입 story** (§0) — gate 전체의 뿌리. #190 acceptance 2번.
2. **`setIosSwipeGestureEnabled` → state 토글** (§1) — `setDeviceOrientation` 패턴 mirror. #190 acceptance 3번, 명시적 1순위.
3. **나머지 navigation no-op** (`setScreenAwakeMode`, `setSecureScreen`, `requestReview`) → "요청됨" state 기록.
4. **safe area · 기기 특성 정합** (§0.5) — iPhone 15 Pro preset 존재(393×852/dpr3/dynamic-island, `safeAreaProvenance: measured`). 남은 gap: Android/Galaxy 계열 및 landscape mode safe-area relay 실측(`placeholder`/`extrapolated` → `measured` 승급). 절차는 §0.6 참조.
5. **`appsInTossEvent` / `partner.*accessoryButton`** — 이벤트 발화 경로 연결(현재 완전 끊김).
6. **UA/host 단서 흉내** (§0) — host-gated 코드 경로를 브라우저에서 시험 (#190 범위 4, 검토 단계).

`🟡 partial`은 대부분 실용에 충분 — native 런타임 의존(카메라 취소 감지, 실 결제 UI)이나 의도된 간소화(SafeAreaInsets 과호출)라 #190 비목표에 가깝다. `🟢 faithful`은 손댈 필요 없음.

새 mock API를 추가하면 이 표에 행을 더한다 — 그게 fidelity 회귀를 막는 규약이다.

---

## 시나리오별 MCP tool 응답 diff snapshot (4겹 fidelity — #281)

M1 acceptance 기준: 4 시나리오에서 `list_pages → measure_safe_area → call_sdk(getOperationalEnvironment)` 3종 호출이 동일 schema 응답.

### `list_pages` — 시나리오별 예상 shape

| 필드 | 환경 1 (로컬) | 환경 2 (PWA relay) | 환경 3 (intoss dev relay) | 환경 4 (live relay) |
|---|---|---|---|---|
| `pages` 길이 | 1 | 1 | 1 | 1 |
| `pages[0].url` | `http://localhost:517x/` | `https://*.trycloudflare.com/` | `intoss-private://…?_deploymentId=<uuid>` | `intoss-private://…?_deploymentId=<uuid>` |
| `tunnel.up` | false | true | true | true |
| `source` (env) | mock | relay | relay-dev | relay-live |
| `lastSeenAt` | 현재 시각 | 현재 시각 | 현재 시각 | 현재 시각 |
| `crashDetectedAt` | null | null | null | null |
| `singleAttachModel` | true | true | true | true |

### `measure_safe_area` — 시나리오별 예상 shape

| 필드 | 환경 1 (로컬) | 환경 2 (PWA) | 환경 3 (relay-dev) | 환경 4 (relay-live) |
|---|---|---|---|---|
| `source` | `"mock"` | `"relay"` (토큰 확정 미정) | `"relay-dev"` | `"relay-live"` |
| `sdkInsetsSource` | `"window.__ait"` | `"window.__ait"` | `"window.__sdk"` | `"window.__sdk"` |
| `sdkInsets.top` | 패널 설정값 (예: 47) | 실기기 측정값 | 실기기 측정값 (예: 44–54) | 실기기 측정값 (예: 44–54) |
| `cssEnv.top` | CSS env var (panel context) | 실기기 측정값 | 0 (Toss host WebView override) | 0 (Toss host WebView override) |
| `userAgent` | desktop Chrome UA | iOS/Android Safari UA | iOS/Android Toss WebView UA | iOS/Android Toss WebView UA |
| `devicePixelRatio` | 1–2 (desktop) | 2–3 (실기기) | 2–3 (실기기) | 2–3 (실기기) |

### `call_sdk("getOperationalEnvironment", [])` — 시나리오별 예상 shape

| 필드 | 환경 1 (mock) | 환경 2 (PWA non-dogfood) | 환경 3 (intoss dev dogfood) | 환경 4 (live dogfood) |
|---|---|---|---|---|
| `ok` | true | false | true | true |
| `error` | — | `"window.__sdkCall is not available"` | — | — |
| `value` | `"sandbox"` (scalar) 또는 패널 설정값 | — | scalar string (`'toss' \| 'sandbox'`) | scalar string (`'toss' \| 'sandbox'`) |

`value`는 scalar string(`'toss' | 'sandbox'`)이다 — `{environment, sdkVersion}` 객체 형태는 `AIT.getOperationalEnvironment`(mock-only)의 응답이며 `call_sdk` envelope과 다르다. 실기기 실측 토큰은 검증 후 확정.

**schema 평행 기준**: `ok` 필드 존재, `value` 또는 `error` 필드 존재 — 즉 동일한 JSON envelope. 환경 2 non-dogfood에서 `ok: false`는 예상 결과(bridge 부재)이며 schema 위반이 아니다.
