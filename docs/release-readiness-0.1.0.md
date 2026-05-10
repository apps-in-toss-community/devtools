# devtools 0.1 라인 release readiness

`@ait-co/devtools` 0.1 라인의 누적 상태를 회고하고, 다음 단계(추가 0.1.x patch / 1.0.0 진입)를 결정하기 위한 reference document.

## 평가 범위 (먼저 읽을 것)

원래 TODO 항목은 "0.1.0 cut"이었으나 0.1.0은 2026-04-20에 이미 publish되었고, 그 이후 9개 patch가 누적돼 origin/main은 현재 **0.1.10**이다. 따라서 본 문서는:

- **회고**: 0.1.1~0.1.10 동안 어떤 변화가 일어났고 어디가 안정되었는가
- **전망**: 더 patch를 누적하며 0.1 라인을 유지할지, umbrella 정책상 다음 minor인 **1.0.0** 진입을 검토할지

를 다룬다. **버전 자체는 변경하지 않는다** — 1.0.0 minor bump는 Dave 명시 결정 사항.

## 현재 상태 (2026-05-10 기준)

| 항목 | 값 |
|---|---|
| 마지막 publish | **0.1.10** (origin/main, 2026-05-10) |
| 첫 0.1.x publish | 0.1.1 (2026-04-20) |
| 0.1 라인 누적 기간 | 약 3주 |
| publish된 0.1.x 개수 | 10개 (0.1.1 ~ 0.1.10) |
| SDK peer range | `>=2.4.0 <2.4.8` (변동 없음) |
| 누적 commit | 39개 (v0.1.0 가상 시작점 → HEAD) |
| Quality gates 상태 | typecheck ✅ / lint ✅ / test ✅ (301 pass + 1 todo) / build ✅ |

> **0.1.0 태그가 없는 이유**: `release-please` → `Changesets` 전환 직후 첫 publish는 0.1.1이었고 (`#67` `fix(unplugin): resolve @ait-co/devtools/mock to an absolute path`), 그 이전 0.0.3까지의 `release-please`-style entry는 CHANGELOG.md 하단에 그대로 보존되어 있다.

### 누적 변경 요약 (publish 단위)

| Version | 핵심 변경 | 영역 | 성격 |
|---|---|---|---|
| 0.1.10 | `e2e/fixture/`를 `devtools.aitc.dev` Pages 배포 + npm OG 이미지 | infra/marketing | additive, 패키지 surface 무관 |
| 0.1.9 | Mock state preset library (`applyPreset`, `builtInPresets`, `saveUserPreset`) + Presets 탭 | mock + panel | 새 export, additive |
| 0.1.8 | Panel Ads 탭 추가 | panel | additive |
| 0.1.7 | Panel IAP pending/completed orders viewer | panel | additive |
| 0.1.6 | Viewport 탭 `aitNavBarType: 'game'` 변형 | panel | additive (default 보존) |
| 0.1.5 | Release workflow를 `pnpm exec changeset publish`로 전환해 GitHub Releases 생성 | infra | infra fix, 런타임 무관 |
| 0.1.4 | Device simulation 강화 (2026 프리셋, safe area, notch, AIT nav bar, orientation sync) + 코드 리뷰 반영 (`landscapeSide`, `disposeViewport`, custom 입력 클램프 등) | panel | major UX 추가 + 작은 export 추가 |
| 0.1.3 | Panel fullscreen breakpoint 480 → 720px | panel | bugfix |
| 0.1.2 | mock clipboard 기본 모드 `'web'` → `'mock'` (polyfill 무한루프 방지) | mock | **behavior change** (소비자에게 영향, README에 문서화) |
| 0.1.1 | unplugin `resolveId`가 absolute path 반환 | unplugin | bugfix (Vite 8+ 호환) |

### 인프라 진화 (CHANGELOG 외)

| 항목 | PR | 변화 |
|---|---|---|
| 빌드 도구 | #83 | tsup → tsdown |
| Lint/format | #62 #81 | Biome 단일화 (ESLint/Prettier 제거), pre-commit hook source-controlled |
| Release 도구 | #61 #66 #77 | release-please → Changesets, App token, `changeset publish` |
| CI E2E gate | #85 | `e2e` job required, Playwright 캐시 키 안정 |
| publish guard | #80 | `prepublishOnly`로 수동 publish 가드 |
| SDK peer lock | #59 | peer range 좁히고 미구현 API throw |
| Demo 호스팅 | #107 | `e2e/fixture/`를 `devtools.aitc.dev`에 publish |

## Public API surface 카테고리

`src/mock/index.ts`(약 60개 export) + `src/unplugin/index.ts`(default + `AitDevtoolsOptions`) + `@ait-co/devtools/panel` side-effect import.

### 안정 ✅ (touch frequency 0, `__typecheck.ts`로 컴파일 게이트)

전 0.1.x 동안 **각 mock 도메인 함수의 외부 시그니처가 한 번도 변경되지 않은** 영역. `src/__typecheck.ts`가 60+ assertion으로 SDK 시그니처와 호환을 강제하므로, peer range가 같은 한 (현재 `>=2.4.0 <2.4.8`) drift 위험은 컴파일 타임에 차단된다.

> 본체 코드 touch 자체는 두 곳에서 발생했지만 외부 시그니처는 보존되었다: `src/mock/ads/index.ts`는 #101에서 `forceNoFill` 분기 추가 (panel Ads 탭이 활용), `src/mock/state.ts`는 새 슬라이스(`viewport`/`ads`/`presets`) 추가로 7개 PR에서 수정. 두 케이스 모두 기존 caller에 비호환 변경 없음.

- **인증/로그인**: `appLogin`, `appsInTossSignTossCert`, `getIsTossLoginIntegratedService`, `getUserKeyForGame`
- **화면/네비게이션/환경 정보**: `closeView`, `openURL`, `share`, `getTossShareLink`, `setIosSwipeGestureEnabled`, `setDeviceOrientation`, `setScreenAwakeMode`, `setSecureScreen`, `requestReview`, `getPlatformOS`, `getOperationalEnvironment`, `getTossAppVersion`, `isMinVersionSupported`, `getSchemeUri`, `getLocale`, `getDeviceId`, `getGroupId`, `getNetworkStatus`, `getServerTime`, `env`, `getAppsInTossGlobals`, `SafeAreaInsets`, `getSafeAreaInsets`
- **디바이스 기능**: `Storage`, `getCurrentLocation`, `startUpdateLocation`, `Accuracy`, `openCamera`, `fetchAlbumPhotos`, `fetchContacts`, `getDefaultPlaceholderImages`, `generateHapticFeedback`, `saveBase64Data` (도메인 디렉토리 `src/mock/device/`는 0.1.x 전 구간 touch 0회). `getClipboardText` / `setClipboardText`는 함수 자체는 touch 0회지만 0.1.2에서 default 모드가 `'web'` → `'mock'`으로 flip되었으니 ⚠️ 참고
- **이벤트**: `graniteEvent`, `appsInTossEvent`, `tdsEvent`, `onVisibilityChangedByTransparentServiceWeb`
- **분석**: `Analytics`, `eventLog`
- **광고**: `GoogleAdMob`, `TossAds`, `loadFullScreenAd`, `showFullScreenAd`
- **IAP / 결제**: `IAP`, `checkoutPayment`
- **게임/프로모션**: `contactsViral`, `getGameCenterGameProfile`, `grantPromotionReward`, `grantPromotionRewardForGame`, `openGameCenterLeaderboard`, `submitGameCenterLeaderBoardScore`
- **파트너**: `partner`
- **권한**: `getPermission`, `openPermissionDialog`, `requestPermission`
- **타입 re-export**: `AnalyticsLogEntry`, `DeviceApiMode`, `DeviceModes`, `HapticFeedbackType`, `IapNextResult`, `LocationCoords`, `MockContact`, `MockData`, `MockIapProduct`, `MockLocation`, `NetworkStatus`, `OperationalEnvironment`, `PermissionName`, `PermissionStatus`, `PlatformOS`, `Primitive`, `SafeAreaInsetsType`
- **unplugin 표면**: `default` factory + `AitDevtoolsOptions` (`panel`, `forceEnable`, `mock`) — 0.1.1 fix 이후 touch 0회

근거: `git log v0.1.1..HEAD -- src/mock/<auth|iap|navigation|device|game|partner|analytics|permissions>/` 모두 비어있음. 본체 변경은 위 callout의 `ads/index.ts`와 `state.ts`(시그니처 호환) 두 곳뿐이고, 새 코드는 panel/viewport/presets로 들어갔다.

### 변경 가능성 있음 ⚠️ (active development)

- **Panel UI / 탭 구성**: 0.1.6~0.1.9에서 4개 PR(viewport game variant, IAP viewer, Ads tab, Presets tab) 추가. 다음 patch에서 추가 탭/리팩토링 가능. 단 **import surface는 side-effect (`@ait-co/devtools/panel`)** 라 사용자 코드에는 영향 적음.
- **`@ait-co/devtools` mock state preset API** (`applyPreset`, `builtInPresets`, `captureCurrentState`, `matchesPreset`, `saveUserPreset`, `listUserPresets`, `deleteUserPreset`, `MockPreset`, `MockPresetState`): 0.1.9에 도입된 신규 export. 사용 패턴이 충분히 누적되지 않아 1.0.0 약속에 포함하기 전에 한두 cycle 더 관찰이 필요. README의 "코드에서도 export됩니다" 섹션이 reference이지만 외부 consumer 사례는 아직 없다.
- **Viewport 프리셋 데이터** (iPhone Air, Galaxy S26 시리즈 `(est)` 라벨): 출시 전 추정값. 출시 후 갱신 예정 — 데이터 변경이지 API 변경은 아니다.
- **mock clipboard 기본 모드**: 0.1.2에서 이미 한 번 flip (`'web'` → `'mock'`). 비슷한 "polyfill과의 상호작용" 분기가 다른 device API (camera/location)에서 발견될 가능성 있음.
- **`aitState` (export) / `AitDevtoolsState` (export type)**: panel/unplugin 진화에 따라 새 슬라이스가 들어올 가능성 (`viewport`, `ads`, `presets` 등이 0.1.x 동안 추가됨). 주요 슬라이스 키는 안정 — 1.0.0에서 동결할 키 집합을 별도 정의하면 외부에서 `aitState.patch('frozenKey', ...)`만 안전 보장 가능.

### 미정 ❓ (1.0.0 commit 전 결정 필요)

- **panel side-effect import 자동 마운트의 contract**: README는 "import 시 자동 마운트"를 약속한다. 1.0.0에서는 idempotent + dispose API 일관성을 명시할 가치. `disposeViewport()`는 있지만 panel root에 대한 `disposePanel()`은 미공개.
- **Turbopack support 범위**: README는 manual alias + `import '@ait-co/devtools/panel'` 패턴을 안내하지만 자동 주입 unplugin 등가물은 아직 없음. 1.0.0에서 "Turbopack은 alias-only"를 공식 stance로 박을지.
- **`forceEnable` + `mock: true` production 사용**: 옵션은 있으나 README에 운영 가이드가 얕다. 1.0.0에서 "어떤 케이스에 권장/비권장인지" 문서화.
- **SDK peer 확장**: 현재 `>=2.4.0 <2.4.8` 한 줄. SDK 2.4.8/2.5.x이 publish됐을 때의 정책은 CLAUDE.md에 한 시나리오만 명시되어 있다 (한 라인 동시 지원, breaking 시 함께 bump). 다음 SDK minor가 떴을 때 devtools가 같이 minor bump → 1.1.0으로 갈지, peer만 확장한 patch로 갈지 처음 한 번 결정해두면 좋다.
- **Mock preset API 형태**: 위 ⚠️ 항목과 동일. 1.0.0에 포함시키려면 minor 한 번 더 회전시키며 외부 사용을 보고 결정.

## 머지 / 1.0.0 진입 가능 여부

### "1.0.0 cut을 막는 것은 없는가" 체크리스트

- [x] CI green (typecheck/lint/test/build/E2E gate 모두 정상)
- [x] Release workflow 검증됨 (0.1.5 fix 이후 GitHub Releases 자동 생성, 0.1.5~0.1.10이 실제 그렇게 publish됨)
- [x] SDK peer lock + `__typecheck.ts` + Proxy throw — drift 안전망 3중
- [x] README에 모든 export 카테고리, Production 가이드, Troubleshooting 정리 완료
- [x] E2E fixture가 self-contained (sdk-example 의존 없음) + Pages 데모 운영 중
- [ ] **Mock preset API의 외부 사용 사례 1+ 확인** — 0.1.9 신규, 아직 사용 사례 없음
- [ ] **`disposePanel()` 또는 panel mount idempotency 명시** — 현재 viewport만 dispose 가능
- [ ] **Turbopack stance 공식화** (alias-only인지 unplugin도 추가 예정인지)
- [ ] **다음 SDK minor 대응 정책 한 번 더 적용** — 2.4.8/2.5.x이 publish되면 처음으로 "한 라인 동시 지원" rule이 실측됨
- [ ] **Changeset 한 번 더 회전** (preset API에 한 cycle 더 사용 case 노출)

> "안정 ✅" 카테고리만 놓고 보면 1.0.0 직행이 가능하다. 그러나 0.1.9 신규 export(preset API)가 들어온 지 1주가 안 됐고, README/문서 측 마무리(panel dispose, Turbopack)가 남아 있어 **1.0.0은 한 cycle 더 밀고 가는 것을 권장**한다.

### 권장 결론

- **즉시 1.0.0 cut**: 비권장 (preset API 검증 부족 + 미정 ❓ 5건 + 미체크 항목 5건)
- **0.1.x를 1~2 patch 더 회전 후 1.0.0** (Recommended): 위 미정 5건 정리 + preset API 사용 사례 1+ 확인 후 cut. 예상 시점은 SDK 새 버전이 한 번 떨어지는 타이밍과 합쳐서 자연스럽게.
- **0.1.x를 더 길게 유지**: preset/panel 영역에 큰 변경이 더 들어올 예정이라면 합리적. 단 surface는 이미 충분히 넓고 안정해서 무리하게 patch만 누적할 필요는 없음.

## 0.1 라인 release notes (highlights, draft)

CHANGELOG.md가 publish 단위 entry는 가지고 있으므로 여기서는 **라인 전체 highlights**만 정리한다 — 1.0.0 release notes 또는 npm landing 카피로 재활용 가능.

### Added

- **Device simulation** (`Viewport` 탭): iPhone 17 시리즈 / iPhone Air / iPhone 16e / SE 3rd / Galaxy S26 시리즈 / Z Flip7 / Z Fold7 프리셋. Safe area, notch (notch / Dynamic Island / punch-hole), 홈 인디케이터, AIT host nav bar (`partner` / `game`) 오버레이. Orientation override + landscape side 토글 + custom width/height (1~4096 클램프). `disposeViewport()` export. (0.1.4, 0.1.6)
- **Panel IAP viewer**: pending / completed orders 실시간 표시. (0.1.7)
- **Panel Ads tab**: GoogleAdMob / TossAds / FullScreenAd load → show → dismiss 흐름 trigger. (0.1.8)
- **Mock state preset library**: `applyPreset` / `builtInPresets` / `saveUserPreset` / `listUserPresets` / `deleteUserPreset` / `captureCurrentState` / `matchesPreset` 코드 export + Panel Presets 탭. 내장 시나리오 6종 (`all-allowed`, `permission-denied`, `offline`, `logged-out`, `iap-pending`, `ads-no-fill`). (0.1.9)
- **타입 export**: `MockPreset`, `MockPresetState`. (0.1.9)

### Changed

- mock clipboard 기본 모드 `'web'` → `'mock'`. `@ait-co/polyfill`과 함께 쓸 때의 무한 재귀 방지. 사용자가 명시적으로 `'web'`로 전환 가능. (0.1.2)
- Panel fullscreen breakpoint 480 → 720px. mobile-container 앱과 floating panel 겹침 해결. (0.1.3)
- AIT nav bar 변형 추가 (`partner` 기본 + `game` 옵션, 게임 캔버스 가림 방지). (0.1.6)

### Fixed

- unplugin `resolveId`가 bare specifier 대신 absolute path를 반환하도록 변경 (Vite 8+ 호환). (0.1.1)
- Viewport 코드 리뷰 1차/2차 피드백: `setDeviceOrientation` auto 모드 다회 호출, `landscapeSide` (좌우 inset 분리), nav bar XSS-safe textContent, `initViewport` HMR-safe, custom 입력 strict 검증. (0.1.4)
- Release workflow가 `pnpm exec changeset publish`를 거치도록 변경 — `changesets/action`이 0.1.0~0.1.4에 대해 GitHub Releases를 생성하지 않던 silent skip 해결. (0.1.5)

### Breaking

- (0.1 라인 내 없음) 모든 변경이 patch로 분류 가능. 0.0 → 0.1 전환 시점의 SDK peer 좁힘과 미구현 API throw(#59)는 0.1 직전에 이미 적용됨.

### Infrastructure (라이브러리 사용자에게는 보이지 않음)

- 빌드 도구 tsup → tsdown
- Lint Biome 단일화 + pre-commit hook standardize
- Release tooling release-please → Changesets, App token으로 downstream workflow 트리거 활성화
- CI E2E job을 required gate로 승격
- `prepublishOnly` 가드 추가
- `e2e/fixture/`를 `devtools.aitc.dev`에 GitHub Pages 자동 배포 + npm OG 이미지 (1200×630)

## Open questions (Dave 결정 대기)

1. **1.0.0 진입 시점 확정**: 위 "미정 ❓" 5건을 1.0.0 전 정리 vs 1.0.0 후 1.0.x patch로 정리. 권장은 한 cycle 더 0.1.x 회전 후.
2. **Preset API의 1.0.0 commit 여부**: 0.1.9 신규 export를 1.0.0에 그대로 동결할지, 한두 cycle 사용 후 형태 조정할지.
3. **Panel dispose API**: `disposeViewport()`가 있는데 panel root level에는 없다. 1.0.0 전에 `disposePanel()` 또는 동등한 idempotent unmount 경로를 추가할지.
4. **Turbopack stance**: "alias-only로 공식 지원, unplugin은 미지원" 스탠스를 README 상단에 박을지, 또는 Turbopack 플러그인 시스템 안정화를 기다릴지.
5. **다음 SDK minor와의 동조**: SDK 2.5.x가 publish됐을 때 devtools를 함께 minor bump (1.0.0 → 2.0.0?) 하는 정책을 1.0.0 cut 전에 한 번 시뮬레이션해볼지. CLAUDE.md "SDK breaking change 대응" 절차의 첫 실측이 됨.

## Appendix: 검증 메모

- `pnpm install --frozen-lockfile && pnpm build && pnpm typecheck && pnpm lint && pnpm test`: 모두 green.
- `git tag --list | sort -V`로 0.1.1~0.1.10이 실제 push되어 있음 확인.
- `gh pr list --state merged`로 #67~#107의 머지 흐름이 CHANGELOG 순서와 일치함 확인.
- `git log v0.1.1..HEAD -- src/mock/<auth|navigation|iap|...>/`이 비어있음 → "안정 ✅" 분류 근거.
- 본 문서는 코드/version/changeset 변경을 동반하지 않는 read-only 리포트.
