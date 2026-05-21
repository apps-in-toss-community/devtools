# CLAUDE.md

## 프로젝트 성격

`apps-in-toss-community`는 토스/앱인토스 팀과 제휴 관계가 없는 커뮤니티 오픈소스 프로젝트다.

사용자에게 보여지는 모든 산출물(README, UI 카피, 패키지 설명, 커밋/PR 메시지, 코드 주석 등)에서 다음 표현 **금지**:

- "공식(official)", "공식 플러그인/도구", "토스가 제공하는", "앱인토스에서 만든", "powered by Toss"
- 토스와의 제휴/후원/인증을 암시하는 모든 표현

대신 "커뮤니티(community)" 같은 자연스러운 표현. 의심스러우면 빼라.

**톤 가이드** (방어적 disclaimer 금지): README 푸터에 한 줄로 1회만 명시 — ko `README.md`는 `커뮤니티 오픈소스 프로젝트입니다.`, en `README.en.md`는 `Community open-source project.`. "제휴 아님" 같은 방어적 표현 대신 "커뮤니티 오픈소스" 정체성만 자연스럽게. 헤더 직후의 `>` blockquote 박스, ⚠️ 아이콘, 굵은 글씨, `unofficial`/`비공식` 같은 강한 라벨은 쓰지 않는다. 한 파일 안에서 영/한 병기 금지(다중 언어는 ko/en 별도 파일로 분리). 기술적 caveat은 disclaimer에 묶지 않고 자연스러운 본문 섹션에 둔다.

**README i18n**: `README.md`(한국어, GitHub default) + `README.en.md`(영어). 둘 다 상단 상호 link(`[한국어](./README.md)` / `[English](./README.en.md)`), 동등 정본 — 한 쪽 갱신 시 같은 PR에서 반대쪽도 갱신. 자세한 정책은 umbrella `CLAUDE.md` "i18n 정책" 섹션.

이슈/제안은 GitHub Issues로.

## 짝 repo

- **`polyfill`** — devtools가 SDK mock이라면 polyfill은 표준 Web API shim. devtools unplugin이 polyfill 주입 옵션 지원은 추후 고려.
- **`sdk-example`** (downstream consumer) — reference consumer이자 dog-fooding 타겟. E2E는 이 repo 내부 fixture(`e2e/fixture/`)로 운영하므로 sdk-example을 직접 clone하지 않는다.

## 프로젝트 개요

**@ait-co/devtools** — `@apps-in-toss/web-framework` SDK의 mock 라이브러리. 앱인토스 미니앱을 토스 앱 없이 일반 크롬 브라우저에서 개발/테스트.

**Out of scope:** React Native. 이 프로젝트는 WebView 미니앱 전용.

## 기술 스택

공통: **Node 24 LTS**, **pnpm 10.33.0** (`packageManager` 고정), **TypeScript strict**, **Biome** (lint + formatter, ESLint/Prettier 사용 안 함). Commit message는 **Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`).

Pre-commit hook은 source-controlled (`.githooks/pre-commit`), contributor가 수동 활성화:

```bash
git config core.hooksPath .githooks
```

이 repo 고유:

- **tsdown** — 빌드 (ESM + CJS for unplugin)
- **vitest** — 테스트 (jsdom 환경, 아래 "jsdom 제약" 섹션 주의)
- **unplugin** — 모든 번들러 지원. runtime dependency는 unplugin 외에 `chii`·`ws`·`cloudflared`·`qrcode-terminal`·`@modelcontextprotocol/sdk` (in-app debug MCP surface가 쓴다)
- ESM only (`"type": "module"`)

## 배포

이 repo는 **npm 패키지** 배포 타입 — Changesets 풀스택 (`@ait-co/devtools` 자동 publish). 버전은 `0.1.x` patch 단계 유지, 다음 minor는 곧바로 `1.0.0`.

## 명령어

전체 스크립트는 `package.json`. 자주 쓰는 것:

```bash
pnpm dev            # watch 빌드
pnpm build          # tsdown으로 dist/ 빌드
pnpm typecheck      # tsc --noEmit (원본 SDK 시그니처 호환성 검증 포함)
pnpm test           # vitest
pnpm test:e2e       # Playwright E2E (자동 빌드 + preview)
pnpm check-sdk-update  # 새 SDK 버전 감지 (수동 트리거, 매주 월요일 CI도 동일)
```

## 프로젝트 구조

```
src/
├── mock/              # @apps-in-toss/web-framework export를 mock으로 대체
│   ├── state.ts       # AitStateManager, window.__ait
│   ├── proxy.ts       # 미구현 API용 Proxy (접근 시 throw)
│   ├── permissions.ts # withPermission, checkPermission
│   ├── types.ts       # PermissionName, DeviceMode 등
│   ├── auth/ navigation/ device/ iap/ ads/ game/ analytics/ partner/
│   └── index.ts       # 통합 re-export (번들러 alias 대상)
├── panel/             # Floating DevTools Panel (vanilla DOM)
│   ├── index.ts helpers.ts styles.ts viewport.ts
│   └── tabs/          # environment, presets, viewport, permissions, notifications, location, device, iap, ads, events, analytics, storage
├── unplugin/          # Vite/Webpack/Rspack/esbuild/Rollup
├── __tests__/         # vitest
└── __typecheck.ts     # 원본 SDK 대비 타입 호환성 (빌드 미포함)
```

`device/`는 도메인별로 분리(`storage.ts`, `location.ts`, `camera.ts`, `clipboard.ts`, `contacts.ts`, `haptic.ts`, `network.ts`, `_helpers.ts`)되어 mock/web/prompt 모드를 지원한다.

## 코딩 컨벤션

- **외부 의존성 최소화**: panel은 vanilla DOM. React/Preact 등 프레임워크 금지.
- **모든 mock은 원본 SDK 시그니처와 호환**: `src/__typecheck.ts`의 `Assert<Mock, Original>`로 검증.
- **권한 함수**: `withPermission(fn, permissionName)`으로 감싸 `.getPermission()`, `.openPermissionDialog()` 부착.
- **이벤트**: `window.dispatchEvent(new CustomEvent('__ait:eventName'))`. `aitState.trigger('backEvent')` 사용.
- **Storage mock**: localStorage `__ait_storage:` prefix로 앱 자체 storage와 분리.

## 새 API mock 추가 절차

1. 카테고리 디렉토리에 함수 구현 (예: `src/mock/device/`)
2. `src/mock/index.ts`에 export
3. `src/__typecheck.ts`에 `type _NewApi = Assert<typeof Mock.newApi, typeof Original.newApi>;`
4. `pnpm typecheck`
5. 테스트 작성

## SDK 업데이트 대응

devtools는 `@apps-in-toss/web-framework`의 좁은 범위(`>=2.5.0 <2.6.0`)만 지원. devDep은 `2.5.0` 한 버전 고정. (후속 PR에서 CI matrix `compat-check`로 양 끝 버전 typecheck 자동화 예정.)

- peer는 **required**, devDep은 고정.
- `src/__typecheck.ts`가 컴파일 타임에 시그니처 불일치 감지.
- `src/mock/proxy.ts`의 `createMockProxy`는 미구현 API 접근 시 **throw** — "잘 되는 척" 방지.
- `.github/workflows/check-sdk-update.yml`이 매주 월요일 새 버전 감지 → 이슈 생성.

**지원 범위 확장 (예: 2.5.1 publish됨):** `pnpm add -D @apps-in-toss/web-framework@2.5.1` → `pnpm typecheck`로 시그니처 변경 확인 → `package.json` peer range를 `>=2.5.0 <2.5.2`로 → (matrix 도입 후) CI matrix에 `2.5.1` 추가 → 단일 PR로 일관된 상태 유지.

**SDK breaking change 대응:** 한 devtools 패키지가 호환되지 않는 SDK를 동시 지원하지 않는다 — devtools도 함께 bump한다.

1. 새 SDK 대응은 `main`에서 진행. peer range를 새 SDK 라인 한 줄로 교체, 이전 라인은 제거.
2. 직전 라인은 `release/<prev>.x` maintenance 브랜치로 분기. patch만 cherry-pick으로 백포팅.
3. `__typecheck.ts`의 `import * as Original`을 새 SDK로 바꾸고 깨진 시그니처를 mock에 맞춰 수정. `unplugin/index.ts`의 패키지명 상수(`FRAMEWORK_ID` 등)도 SDK가 rename된 경우 함께 갱신.
4. devtools 자체도 호환성 끊김에 맞춰 bump (Changesets). 사용자는 SDK 업그레이드와 함께 devtools도 같은 라인으로 올린다.

같은 devtools 안에서 SDK 라인별 런타임 분기는 하지 않는다 (mock 본체가 두 벌이 되어 비용이 큼). 동시 지원 윈도우가 정말 필요해지면 그때 별도 결정.

## 패키지 export 구조

| Import path | 용도 |
|---|---|
| `@ait-co/devtools` (= `/mock`) | 번들러 alias 대상, 모든 mock export |
| `@ait-co/devtools/panel` | Floating DevTools Panel (import 시 자동 마운트) |
| `@ait-co/devtools/unplugin` | 번들러 플러그인 (.vite/.webpack/.rspack/.esbuild/.rollup) |
| `@ait-co/devtools/mcp/server` | dev-mode MCP stdio server 함수 (Node.js) |
| `@ait-co/devtools/mcp/cli` | `devtools-mcp` bin 진입점 (debug / dev 모드, Node.js) |
| `@ait-co/devtools/in-app` | In-app debug attach — 3-layer gate + Chii target.js 주입 (dogfood 빌드 전용, `__DEBUG_BUILD__=true` 시에만 활성) |

## 실기기 미리보기 (tunnel + launcher)

unplugin `tunnel` 옵션(Vite dev 전용, `src/unplugin/index.ts`의 `vite.configureServer` 분기 + `src/unplugin/tunnel.ts`)이 dev 서버가 listen하면 `cloudflared` quick tunnel(`*.trycloudflare.com`, 계정 불필요)을 띄우고 터미널에 URL + ASCII QR을 출력한다. production은 `forceEnable`이어도 터널을 안 띄운다 (의도치 않은 노출 방지). `cloudflared`/`qrcode-terminal`는 **동적 import**로만 로드 → 터널 미사용 시 그래프에 안 들어옴. 이 둘은 `dependencies`에 들어가는데, "외부 의존성 최소화" 원칙의 의도적 예외다 (런타임 코드 경로에서 필요, 동적 import로 비용 격리). `tunnel.ts`의 `parseTrycloudflareUrl`/`printTunnelBanner`는 순수 함수로 빼서 vitest로 검증하고, cloudflared spawn 자체는 jsdom 범위 밖이라 e2e/수동 검증 ("web 모드는 e2e"와 같은 정신).

폰 쪽은 고정 URL(`https://devtools.aitc.dev/launcher/`)에 배포된 launcher PWA(`e2e/fixture/launcher/`)를 한 번 홈 화면에 추가하고, 그 안의 풀뷰포트 `<iframe>`으로 그날의 tunnel URL을 띄운다 (quick tunnel URL은 매 실행마다 바뀌어서 URL 자체를 PWA로 설치하면 죽은 링크가 되고, cross-origin 전환은 standalone이 깨짐 → launcher가 same-origin 크롬리스 셸 역할). launcher는 카메라 QR 스캔(`qr-scanner`, **devDependency** — launcher SPA에서만 쓰이고 npm 패키지엔 안 실림) + URL 붙여넣기 fallback + `localStorage` 마지막 URL 자동 로드 + "Rescan" 버튼. PWA 정적 파일(`manifest.webmanifest`/`sw.js`/아이콘)은 `e2e/fixture/public/launcher/`에 두면 vite가 `dist/launcher/`로 복사. `e2e/fixture/vite.config.ts`는 이 launcher 페이지 때문에 MPA(`rollupOptions.input`에 `index.html` + `launcher/index.html`)이고, 같은 config의 unplugin 호출에 `tunnel: !!process.env.AIT_TUNNEL`이 있어 `AIT_TUNNEL=1 pnpm exec vite --config e2e/fixture/vite.config.ts`로 수동 QA 가능. (named tunnel로 고정 hostname 받는 방식은 추후 `tunnel: { hostname }` 옵션으로 확장 여지.)

pnpm 10+ 소비자에 대한 안내는 README에 있다: 프로젝트 `package.json`에 `"pnpm": { "onlyBuiltDependencies": ["cloudflared"] }`. pnpm이 기본으로 third-party build script를 차단해 `cloudflared` postinstall(바이너리 ~38 MB 다운로드)이 스킵되면 `pnpm install` 시 'Ignored build scripts' 경고가 남고 바이너리 캐싱이 첫 dev 기동까지 미뤄진다 — 동작은 됨 (`tunnel.ts`가 `cloudflared.install()`을 lazy로 호출). 참조: [sdk-example#60](https://github.com/apps-in-toss-community/sdk-example/pull/60).

## E2E 테스트 플로우

이 repo 내부 자기완결 fixture(`e2e/fixture/`)를 쓴다. 외부 repo 의존 없음. 로컬은 `pnpm test:e2e` 한 줄. `playwright.config.ts`의 `webServer`가 `pnpm build` → fixture vite build → vite preview(:4173)를 자동 수행한다. CI는 `.github/workflows/ci.yml`의 `e2e` job이 동일 절차 실행, Playwright 브라우저는 `@playwright/test` 버전 키로 캐싱. 머지 게이트로 묶으려면 branch protection에서 `e2e` 체크 required로 추가 (job 이름 안정 유지).

같은 fixture는 GitHub Pages로도 배포된다 (<https://devtools.aitc.dev/>). main에 `e2e/fixture/**`·`src/**`·`package.json` 변경이 들어오면 `.github/workflows/deploy-fixture.yml`이 `pnpm e2e:build`로 정적 산출물을 만들어 Pages에 publish한다. CNAME은 `e2e/fixture/public/CNAME`에 source-control되며 vite가 `dist/` 루트에 그대로 복사한다.

**Vite 8 (rolldown) 우회책:**
- `@apps-in-toss/web-framework` → mock 매핑은 unplugin `resolveId` 대신 `vite.config.ts`의 `resolve.alias`로 `dist/mock/index.js` 직접 지정 (rolldown bare string resolveId 버그 우회).
- 패널 주입은 unplugin `transform`이 rolldown 프로덕션 빌드에서 신뢰성 없음 → `main.ts`에 `import '@ait-co/devtools/panel'` 명시.

**testid 규약** (`e2e/fixture/helpers.ts`): `section-<id>` 루트, `<id>-btn` 버튼, `<id>-result` 결과, `<id>-input` 입력, `<id>-value` 즉시 값, `<id>-log`/`<id>-empty` 이벤트 로그.

## jsdom 환경의 제약

`vitest.config.ts`는 `environment: 'jsdom'` 고정. 대부분의 DOM API는 있으나 **`web` 모드 mock이 의존하는 브라우저 전용 API들은 jsdom에 없거나 stub만 있다**. 단위 테스트에서 `web` 모드 경로를 돌리면 silent fallback에 빠지거나, real 브라우저에서만 재현되는 경로가 검증되지 못한다.

| API | jsdom | `web` 모드 영향 | 검증 위치 |
|---|---|---|---|
| `navigator.geolocation` | 없음 | `getCurrentLocationWeb`이 `console.warn` 후 `buildLocation()` fallback (`src/mock/device/location.ts`) | 실제 분기는 e2e |
| `navigator.mediaDevices.getUserMedia` | 없음 | Camera `web` 모드 실패 | e2e |
| `navigator.onLine`/`navigator.connection` | onLine만 있음 | `getNetworkStatus`가 connection 의존 시 state로 fallback (`src/__tests__/device.test.ts:127-130`) | connection 분기는 e2e |
| `Contacts API`/`ContactsManager` | 없음 | Contacts `web` 불가 | mock/prompt만 단위 테스트 |
| `prompt()` 모달 | jsdom DOM으로 동작 | — | 단위 테스트 가능 (`src/mock/device/_helpers.ts#waitForPromptResponse`) |

**원칙:** vitest는 **mock + prompt 모드**만 커버. `web` 모드 브라우저 API 분기는 **`e2e/fixture/` Playwright만 의미 있는 검증**. 이 경계를 흐리면 "테스트 녹색인데 브라우저에서 깨짐"이 재발한다.

## UI 변경 시 검증

이 repo의 시각 산출물(Floating DevTools Panel, fixture 앱, viewport 시뮬레이션)을 변경한 후에는 **반드시 Playwright MCP로 브라우저에서 동작 확인**. 단순 prop 변경이라도 렌더 깨짐 가능. 타입체크/테스트만으로 UI 회귀 못 잡는다.

워크플로: `pnpm build && pnpm exec vite build --config e2e/fixture/vite.config.ts && pnpm exec vite preview --config e2e/fixture/vite.config.ts --port 4173` → `http://localhost:4173/` 접속 → snapshot/screenshot/console 확인 → 인터랙션 시뮬레이션.

확인할 핵심 동작: AIT 버튼 → 12개 탭(Environment/Presets/Viewport/Permissions/Notifications/Location/Device/IAP/Ads/Events/Analytics/Storage) 전환, Events 탭에서 Trigger Back/Home → fixture의 Granite Events 수신 표시, Storage setItem/getItem 왕복, Login → authorizationCode 반환, Location/IAP/Analytics 등 각 섹션 버튼 무에러.
