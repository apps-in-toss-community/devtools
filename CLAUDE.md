# CLAUDE.md

## 프로젝트 개요

**@ait-co/devtools** — `@apps-in-toss/web-framework` SDK의 mock 라이브러리.
앱인토스 미니앱을 토스 앱 없이 일반 크롬 브라우저에서 개발/테스트할 수 있게 해준다.

## 기술 스택

- **TypeScript** (ESM only, `"type": "module"`)
- **tsup** — 빌드 (ESM + CJS for unplugin)
- **vitest** — 테스트 (jsdom 환경)
- **unplugin** — 모든 번들러 지원 (유일한 runtime dependency)
- **pnpm** — 패키지 매니저

## 명령어

```bash
pnpm build          # tsup으로 dist/ 빌드
pnpm dev            # watch 모드
pnpm typecheck      # tsc --noEmit (원본 SDK 대비 타입 호환성 검증 포함)
pnpm test           # vitest 실행
pnpm check-sdk-update  # SDK 새 버전 감지
```

## 프로젝트 구조

```
src/
├── mock/              # @apps-in-toss/web-framework의 모든 export를 mock으로 대체
│   ├── state.ts       # 중앙 상태 관리 (AitStateManager), window.__ait 노출
│   ├── proxy.ts       # 미구현 API용 Proxy fallback
│   ├── permissions.ts # 권한 시스템 (withPermission, checkPermission)
│   ├── types.ts       # 공유 타입 (PermissionName, PermissionStatus, DeviceMode 등)
│   ├── auth/          # appLogin, getUserKeyForGame 등
│   ├── navigation/    # closeView, openURL, graniteEvent, 환경정보, SafeAreaInsets
│   ├── device/        # 도메인별 파일로 분리 (mock/web/prompt 모드 지원)
│   │   ├── index.ts       # re-export
│   │   ├── storage.ts     # Storage (localStorage 기반)
│   │   ├── location.ts    # Location (getCurrentLocation, startUpdateLocation)
│   │   ├── camera.ts      # Camera, Photos (openCamera, fetchAlbumPhotos)
│   │   ├── clipboard.ts   # Clipboard (get/setClipboardText)
│   │   ├── contacts.ts    # Contacts (fetchContacts)
│   │   ├── haptic.ts      # Haptic, saveBase64Data
│   │   ├── network.ts     # Network status
│   │   └── _helpers.ts    # 공유 유틸 (placeholder 이미지, prompt 헬퍼)
│   ├── iap/           # IAP, checkoutPayment (TossPay)
│   ├── ads/           # GoogleAdMob, TossAds, FullScreenAd
│   ├── game/          # 게임센터, 프로모션, contactsViral
│   ├── analytics/     # Analytics, eventLog
│   ├── partner/       # partner, tdsEvent
│   └── index.ts       # 통합 re-export (이 파일이 번들러 alias 대상)
├── panel/             # Floating DevTools Panel (vanilla DOM, 프레임워크 없음)
│   ├── index.ts       # 마운트 로직, 드래그, 패널 셸
│   ├── helpers.ts     # DOM 헬퍼 (h, selectRow, inputRow 등)
│   ├── styles.ts      # CSS 문자열
│   └── tabs/          # 탭별 렌더러
│       ├── index.ts       # 탭 registry
│       ├── environment.ts
│       ├── permissions.ts
│       ├── location.ts
│       ├── device.ts
│       ├── iap.ts
│       ├── events.ts
│       ├── analytics.ts
│       └── storage.ts
├── unplugin/          # unplugin 기반 번들러 플러그인
│   └── index.ts       # Vite/Webpack/Rspack/esbuild/Rollup export
├── __tests__/         # vitest 테스트 파일
│   ├── ads.test.ts
│   ├── analytics.test.ts
│   ├── auth.test.ts
│   ├── camera.test.ts
│   ├── contacts.test.ts
│   ├── device.test.ts
│   ├── game.test.ts
│   ├── iap.test.ts
│   ├── navigation.test.ts
│   ├── panel.test.ts
│   ├── partner.test.ts
│   ├── permissions.test.ts
│   ├── proxy.test.ts
│   ├── state.test.ts
│   ├── storage.test.ts
│   └── unplugin.test.ts
└── __typecheck.ts     # 원본 SDK 대비 타입 호환성 검증 (빌드에 포함 안 됨)
```

## 코딩 컨벤션

- **외부 의존성 최소화**: panel은 vanilla DOM으로 작성. React/Preact 등 프레임워크 사용 금지.
- **모든 mock 함수는 원본 SDK 시그니처와 호환**: `src/__typecheck.ts`의 `Assert<Mock, Original>` 타입으로 검증.
- **권한이 필요한 함수**는 `withPermission(fn, permissionName)`으로 감싸서 `.getPermission()`, `.openPermissionDialog()` 부착.
- **이벤트 시스템**: `window.dispatchEvent(new CustomEvent('__ait:eventName'))`으로 통신. `aitState.trigger('backEvent')` 사용.
- **Storage mock**: localStorage에 `__ait_storage:` prefix로 저장하여 앱 자체 localStorage와 분리.

## 새 API mock 추가 절차

1. 해당 카테고리 디렉토리에 함수 구현 (예: `src/mock/device/`)
2. `src/mock/index.ts`에 export 추가
3. `src/__typecheck.ts`에 `type _NewApi = Assert<typeof Mock.newApi, typeof Original.newApi>;` 추가
4. `pnpm typecheck`로 원본과 호환되는지 검증
5. 테스트 작성

## SDK 업데이트 대응

- `@apps-in-toss/web-framework`는 devDependencies + optional peerDependencies
- `src/__typecheck.ts`가 컴파일 타임에 시그니처 불일치 감지
- `src/mock/proxy.ts`의 `createMockProxy`가 런타임에 미구현 API를 graceful 처리 (경고 + no-op)
- `.github/workflows/check-sdk-update.yml`이 매주 월요일 자동 감지 → 이슈 생성

## 패키지 export 구조

| Import path | 용도 |
|---|---|
| `@ait-co/devtools` 또는 `@ait-co/devtools/mock` | 번들러 alias 대상, 모든 mock export |
| `@ait-co/devtools/panel` | Floating DevTools Panel (import 시 자동 마운트) |
| `@ait-co/devtools/unplugin` | 번들러 플러그인 (.vite, .webpack, .rspack, .esbuild, .rollup) |

## Playwright MCP를 활용한 QA

Claude Code의 Playwright MCP 플러그인을 사용하면 브라우저를 직접 제어하여 example 앱의 E2E QA를 수행할 수 있다.

### 사전 준비

1. Claude Code에 Playwright 플러그인이 설치되어 있어야 한다 (`.claude/settings.json`의 `enabledPlugins` 확인)
2. 라이브러리를 먼저 빌드한다: `pnpm build`
3. sdk-example 레포를 별도로 clone하여 dev 서버를 띄운다: `cd ../sdk-example && pnpm install && pnpm dev`

### QA 절차

1. **페이지 로드**: `browser_navigate`로 `http://localhost:5173/` 접속
2. **초기 렌더링 확인**: `browser_snapshot`으로 DOM 구조 확인, `browser_take_screenshot`으로 시각적 확인
3. **각 기능 테스트**: `browser_click`으로 버튼 클릭 후 스냅샷/스크린샷으로 결과 검증
   - Login → authorizationCode 반환 확인
   - Storage → setItem 후 getItem으로 값 확인, `browser_evaluate`로 localStorage 직접 검증
   - Environment → getPlatformOS, getOperationalEnvironment, getNetworkStatus 값 확인
   - Location → getCurrentLocation 좌표 반환 확인
   - Haptic → 버튼 클릭 시 에러 없음 확인
   - IAP → getProductItemList mock 상품 목록 반환 확인
   - Analytics → click 이벤트 에러 없음 확인
4. **DevTools 패널 테스트**: AIT 버튼 클릭 → 8개 탭 (Environment, Permissions, Location, Device, IAP, Events, Analytics, Storage) 전환 확인
5. **이벤트 테스트**: Events 탭에서 Trigger Back/Home Event → 앱의 Granite Events 섹션에 수신 표시 확인
6. **콘솔 에러 확인**: `browser_console_messages`로 예기치 않은 에러가 없는지 확인 (favicon.ico 404는 무시)

### 주요 Playwright MCP 도구

| 도구 | 용도 |
|---|---|
| `browser_navigate` | URL 이동 |
| `browser_snapshot` | DOM 접근성 트리 (요소 ref 획득, 클릭 대상 식별) |
| `browser_take_screenshot` | 시각적 확인용 스크린샷 |
| `browser_click` | 버튼/요소 클릭 (ref 필요) |
| `browser_evaluate` | JavaScript 실행 (예: localStorage 직접 확인) |
| `browser_console_messages` | 콘솔 로그/에러 확인 |
| `browser_fill_form` | 입력 필드 값 변경 |
| `browser_close` | 브라우저 종료 |
