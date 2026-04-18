# CLAUDE.md

## 프로젝트 성격 (중요)

**`apps-in-toss-community`는 비공식(unofficial) 오픈소스 커뮤니티다.** 토스 팀과 제휴 없음. 사용자에게 보이는 산출물에서 "공식/official/토스가 제공하는/powered by Toss" 등 제휴·후원·인증 암시 표현을 **쓰지 않는다**. 대신 "커뮤니티/오픈소스/비공식"을 사용한다. 의심스러우면 빼라.

## 짝 repo

- **`polyfill`** — devtools가 SDK mock이라면 polyfill은 표준 Web API shim. devtools unplugin이 polyfill을 주입하는 옵션을 추후 지원 고려.
- **`sdk-example`** — devtools의 reference consumer. E2E는 `e2e/fixture/`(자기완결 Vite 앱)로 운영하므로 sdk-example을 직접 clone하지 않는다.

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

## E2E 테스트 플로우

E2E는 이 repo 내부의 자기완결 fixture 앱(`e2e/fixture/`)을 사용한다. sdk-example 등 외부 repo 의존 없음.

`playwright.config.ts`의 `webServer`가 자동으로 다음을 수행한다:

1. `pnpm build` — devtools 빌드 (`dist/mock/`, `dist/panel/`, `dist/unplugin/`)
2. `pnpm exec vite build --config e2e/fixture/vite.config.ts` — fixture 앱 빌드
3. `pnpm exec vite preview --config e2e/fixture/vite.config.ts --port 4173` — 빌드 결과 서빙

로컬에서 `pnpm test:e2e`만 실행하면 된다. fixture 빌드 결과물(`e2e/fixture/dist/`)은 `.gitignore`에 포함되어 있다.

Vite 8(rolldown) 관련 우회책:
- `@apps-in-toss/web-framework` → mock 매핑: unplugin `resolveId` 대신 `vite.config.ts`의 `resolve.alias`로 직접 `dist/mock/index.js`를 지정 (rolldown이 bare string resolveId를 처리 못하는 버그 우회).
- 패널 주입: unplugin `transform`이 rolldown 프로덕션 빌드에서 신뢰성 없음 → `main.ts`에 `import '@ait-co/devtools/panel'`을 명시적으로 추가.

testid 규약 (`e2e/fixture/helpers.ts` 참고):
- `section-<id>` — 도메인 섹션 루트
- `<id>-btn` — API 실행 버튼
- `<id>-result` — 실행 결과 표시
- `<id>-input` — 사용자 입력
- `<id>-value` — 페이지 로드 시 즉시 노출되는 읽기 전용 값
- `<id>-log` / `<id>-empty` — 구독형 이벤트 로그

## Playwright MCP를 활용한 수동 QA

Claude Code의 Playwright MCP 플러그인을 사용하면 브라우저를 직접 제어하여 수동 QA를 수행할 수 있다.

### 사전 준비

1. Claude Code에 Playwright 플러그인이 설치되어 있어야 한다 (`.claude/settings.json`의 `enabledPlugins` 확인)
2. 라이브러리와 fixture 앱을 빌드한다: `pnpm build && pnpm exec vite build --config e2e/fixture/vite.config.ts`
3. fixture preview 서버를 시작한다: `pnpm exec vite preview --config e2e/fixture/vite.config.ts --port 4173`

### QA 절차

1. **페이지 로드**: `browser_navigate`로 `http://localhost:4173/` 접속
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
