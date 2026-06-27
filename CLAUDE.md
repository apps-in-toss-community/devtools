# CLAUDE.md

## 이 파일의 독자

이 파일(`CLAUDE.md`)은 **메인테이너/contributor 전용**이다 — 코드 구조, 컨벤션, 테스트 경계, SDK 대응 절차를 다룬다.

사용자(미니앱 개발자) 진입점은 **`README.md`(한국어) / `README.en.md`(영어)** 다. README는 "15초 quickstart 4 시나리오 카드 + 자주 겪는 문제 5가지"로 시작해 환경 1·2·3·4를 한 페이지에서 안내한다. README와 CLAUDE.md는 독자가 다르므로 내용을 중복하지 않는다 — README는 사용자 관점의 진입 경로, CLAUDE.md는 메인테이너 관점의 구현·규약.

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
- **unplugin** — 모든 번들러 지원. runtime dependency는 unplugin 외에 `chii`·`ws`·`cloudflared`·`qrcode`·`qrcode-terminal`·`ajv`·`@modelcontextprotocol/sdk` (in-app debug MCP surface가 쓴다)
- ESM only (`"type": "module"`)

## 배포

이 repo는 **npm 패키지** 배포 타입 — Changesets 풀스택 (`@ait-co/devtools` 자동 publish). 버전은 `0.1.x` patch 단계 유지, 다음 minor는 곧바로 `1.0.0`.

같은 코드에서 두 개의 dist-tag를 동시에 운영한다 (`.github/workflows/release.yml`):

- **stable = `latest`** — peer `>=2.6.0 <3.0.0` (web-framework 2.x), 기존 Changesets Version-PR 흐름, `0.1.x` patch. `release` job이 담당하며 무변경.
- **beta = `beta`** — peer `>=3.0.0-beta <4.0.0` (3.0 라인), Changesets **스냅샷**. main push마다 `release-beta` job이 pending changeset이 있을 때만 `0.0.0-beta-<datetime>-<sha>` 버전으로 자동 publish한다. peer range만 job-local로 3.0으로 덮어쓰고 같은 커밋을 publish한다 — `latest`는 2.x로 유지된다(GA flip 아님, #370).

`release-beta`가 ship-safe한 핵심 불변식: ① 버전 base가 `0.0.0`이라 어떤 stable range도 만족하지 않음(`latest`로 새어나갈 수 없음), ② `--tag beta` 명시 + on-disk artifact를 publish 직전 assert(version/peer/optional), ③ pending changeset 없으면 clean no-op, ④ 같은 커밋 재실행은 SHA-동일 버전 → skip-if-exists로 idempotent. peer rewrite는 job-local ephemeral checkout에서만 일어나므로 3.0 peer가 `latest` artifact에 닿지 않는다. 스냅샷 템플릿(`{tag}-{datetime}-{commit}`)은 `.changeset/config.json`의 `snapshot.prereleaseTemplate`이 정본. AUTH는 npm OIDC trusted publishing (NPM_TOKEN 없음, #29에서 제거) — beta job이 release.yml 안에 있어야 trusted-publisher grant(workflow 파일명 바인딩)가 적용된다.

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
├── panel/             # Floating DevTools Panel (React chrome + 명령형 탭 렌더러)
│   ├── index.tsx Panel.tsx tab-host.tsx tab-error-boundary.tsx use-draggable.ts
│   ├── helpers.ts styles.ts viewport.ts device-emulation.ts
│   └── tabs/          # environment, presets, viewport, permissions, notifications, location, device, iap, ads, events, analytics, storage (명령형 renderXTab(): HTMLElement)
├── unplugin/          # Vite/Webpack/Rspack/esbuild/Rollup
├── __tests__/         # vitest
└── __typecheck.ts     # 원본 SDK 대비 타입 호환성 (빌드 미포함)
```

`device/`는 도메인별로 분리(`storage.ts`, `location.ts`, `camera.ts`, `clipboard.ts`, `contacts.ts`, `haptic.ts`, `network.ts`, `_helpers.ts`)되어 mock/web/prompt 모드를 지원한다.

## 코딩 컨벤션

- **사용자 대면 표면은 React + ko/en i18n**: panel·qr-http-server 대시보드·e2e fixture·launcher PWA는 모두 React로 렌더하고 `navigator.language`/`Accept-Language` 기반 ko/en i18n을 지원한다. i18n core는 `src/i18n`(ko.ts가 `StringKey` 정본, en.ts는 typecheck-강제 `Record<StringKey,string>` 미러), React 반응 레이어는 `src/i18n/react.ts`(`useLocale`/`useT`, `LOCALE_CHANGE_EVENT` 위 `useSyncExternalStore`). panel은 chrome(toggle/header/badge/tab bar/body)만 React이고 12개 탭 body는 `renderXTab(): HTMLElement` 명령형 렌더러를 `<TabHost>`로 마운트하는 hybrid다(position은 React state가 아니라 ref+localStorage `__ait_btn_pos`).
- **install-graph 불변식 — react/react-dom은 `devDependencies`만, `dependencies` 절대 금지**: MCP-only 소비자(`npx -y @ait-co/devtools devtools-mcp`)는 React를 install 그래프로 끌어오면 안 된다. 따라서 MCP 데몬 번들(`dist/mcp/cli.js`·`dist/mcp/server.js`)은 react/react-dom을 import하지 않는다 — `scripts/check-mcp-react-free.sh`(ci.yml 배선)가 강제한다. qr-http-server 대시보드는 이 불변식을 지키려 빌드타임 precompile을 쓴다: JSX 템플릿(`scripts/dashboard/*.tsx`) → `scripts/build-dashboard-html.ts`가 `renderToStaticMarkup`으로 커밋된 `src/mcp/dashboard.generated.ts` 문자열 모듈 생성 → 런타임 `qr-http-server.ts`는 그 문자열만 import(`check:dashboard-html-fresh`가 freshness 강제). 런타임에 React를 import하는 표면은 데몬 그래프 밖(panel/fixture/launcher는 소비자 빌드, 대시보드는 precompiled string)이라야 한다.
- **모든 mock은 원본 SDK 시그니처와 호환**: `src/__typecheck.ts`의 `Assert<Mock, Original>`로 검증.
- **권한 함수**: `withPermission(fn, permissionName)`으로 감싸 `.getPermission()`, `.openPermissionDialog()` 부착.
- **이벤트**: `window.dispatchEvent(new CustomEvent('__ait:eventName'))`. `aitState.trigger('backEvent')` 사용.
- **Storage mock**: localStorage `__ait_storage:` prefix로 앱 자체 storage와 분리.

## 새 API mock 추가 절차

1. 카테고리 디렉토리에 함수 구현 (예: `src/mock/device/`)
2. `src/mock/index.ts`에 export
3. **두 typecheck 파일 모두 갱신**: `src/__typecheck.ts`(3.0-beta 라인)와 `src/__typecheck-2x.ts`(2.x stable 라인 — `web-framework-2x` alias)에 각각 `type _NewApi = Assert<typeof Mock.newApi, typeof Original.newApi>;`. 두 라인에 존재 유무가 갈리는 심볼만 `AssertIfPresent`로 capability-gate한다 (현재 skip 대상은 base `PermissionError` 1개뿐).
4. `pnpm typecheck` (두 라인 tsc 모두 통과해야 한다)
5. 테스트 작성

## SDK 업데이트 대응

devtools는 `@apps-in-toss/web-framework` **3.0.0-beta** 프리릴리즈를 추적. devDep은 `3.0.0-beta.3051978` exact pin. published `latest` 태그의 peer range는 `>=2.6.0 <3.0.0` (2.x 소비자 보호용 유지)이고, 3.0 라인 peer는 **`beta` dist-tag로 별도 자동 publish**한다 — `release-beta` job이 main push마다 같은 커밋을 job-local 3.0 peer로 덮어써 `0.0.0-beta-<datetime>-<sha>` 스냅샷으로 올린다(메커니즘 정본은 위 §배포). 3.0-beta를 쓰는 소비자는 `@ait-co/devtools@beta`로 설치한다. (후속 PR에서 CI matrix `compat-check`로 버전 typecheck 자동화 예정.)

**GA Flip 상태:** beta 채택 wave는 머지 완료, GA flip(exact pin→`^3.0.0`, `latest` peer를 3.0 라인으로, dist-tag flip)은 **미착수** — GA ETA 미정으로 대기. 트래킹 #370. GA용으로 비워뒀던 `0.1.54` 슬롯은 무관한 maintenance Version PR이 선점했고 이후 추가 maintenance로 `latest`가 더 올라갔다(현 `latest`는 `npm view @ait-co/devtools dist-tags.latest`로 확인, peer `>=2.6.0 <3.0.0`) → flip은 그 시점 `latest` 다음 patch를 쓴다. `beta` dist-tag 자동 publish는 GA flip의 부분 선행이다(3.0 peer artifact를 미리 검증된 상태로 올려둠) — GA flip 시 그 검증된 peer를 `latest`로 승격하고 `release-beta` job은 정리 대상이 된다.

- peer는 `peerDependenciesMeta.optional: true`. devDep은 고정.
  - **이유**: 이 패키지는 두 사용자 그룹을 함께 다룬다 — (a) mock SDK 사용자(번들러 alias로 unplugin), (b) MCP-only 사용자(`.mcp.json`의 `npx -y @ait-co/devtools devtools-mcp` 진입). (b)는 mock SDK를 절대 import하지 않으므로 peer를 required로 두면 SDK + 그 RN/Babel/Metro 트랜지티브 거대 트리(~분 단위 install)가 강제 설치되어 MCP server spawn이 timeout. (a)는 본인 프로젝트에서 SDK를 직접 import하므로 누락은 빌드 단계에서 명시적으로 깨진다 (vite/webpack resolve fail) — npm missing peer warning에 의존할 필요가 없다. optional로 두어도 (a)의 신뢰성은 손상되지 않는다.
- `src/__typecheck.ts`가 컴파일 타임에 시그니처 불일치 감지.
- `src/mock/proxy.ts`의 `createMockProxy`는 미구현 API 접근 시 **throw** — "잘 되는 척" 방지.
- `.github/workflows/check-sdk-update.yml`이 매주 월요일 새 버전 감지 → 이슈 생성.

**지원 범위 확장:** `pnpm add -D @apps-in-toss/web-framework@<version>` → `pnpm typecheck`로 시그니처 변경 확인 → `package.json` devDep pin 갱신 → 단일 PR로 일관된 상태 유지. (3.0 GA 시 peer range도 `>=3.0.0 <4.0.0`으로 교체.)

**web-framework-2x alias pin 정책:** `@apps-in-toss/web-framework-2x` devDep은 최신 2.x 중 `tsc -p tsconfig.2x.json`이 clean한 버전으로 exact pin한다. 현재 `npm:@apps-in-toss/web-framework@2.10.0`. 2.10.1은 upstream type regression(`@apps-in-toss/web-bridge@2.10.1`이 `@apps-in-toss/native-modules`의 미빌드 raw `.ts` subpath를 import → `tsc`가 RN 0.72.6에 없는 `CodegenTypes` export로 실패)이 있어 회피한다. 새 2.x minors를 올릴 때는 반드시 `tsc -p tsconfig.2x.json`을 실행하고 clean을 확인한 후 pin을 갱신한다.

**SDK breaking change 대응:** 한 devtools 패키지가 호환되지 않는 SDK를 동시 지원하지 않는다 — devtools도 함께 bump한다.

1. 새 SDK 대응은 `main`에서 진행. peer range를 새 SDK 라인 한 줄로 교체, 이전 라인은 제거.
2. 직전 라인은 `release/<prev>.x` maintenance 브랜치로 분기. patch만 cherry-pick으로 백포팅.
3. `__typecheck.ts`의 `import * as Original`을 새 SDK로 바꾸고 깨진 시그니처를 mock에 맞춰 수정. `unplugin/index.ts`의 패키지명 상수(`FRAMEWORK_ID` 등)도 SDK가 rename된 경우 함께 갱신.
4. devtools 자체도 호환성 끊김에 맞춰 bump (Changesets). 사용자는 SDK 업그레이드와 함께 devtools도 같은 라인으로 올린다.

같은 devtools 안에서 SDK 라인별 런타임 분기는 하지 않는다 (mock 본체가 두 벌이 되어 비용이 큼). 동시 지원 윈도우가 정말 필요해지면 그때 별도 결정.

## MCP tool surface — 환경 감지 + Tier 매트릭스 (RFC #277)

debug-mode MCP 서버(`devtools-mcp`)는 env를 **저장하지 않고 매 요청마다 `connection.kind`에서 파생**한다(`deriveEnvironment(kind, relayOrigin)`, `src/mcp/environment.ts`). #348 이전의 `getEnvironment()` 5-step precedence 체인(`MCP_ENV` → CDP URL 패턴 sniffing → `defaultEnv` → baked-in mock)은 **삭제됐다** — env enum이 두 직교 신호로 붕괴했기 때문이다:

- **mock vs relay-\* = `connection.kind`에서 무료 파생.** `CdpConnection` 인터페이스의 `readonly kind: 'relay' | 'local'`이 권위 있는 자기서술 신호다(`ChiiCdpConnection.kind='relay'`, `LocalCdpConnection.kind='local'`). connection이 자기 kind를 알므로 target attach 전에도 정확 → URL 패턴 sniffing·`defaultEnv` intent-passing이 불필요해졌다.
- (env 2는 relay이되 `relayOrigin='external-pwa'` → `relay-mobile`로 파생. #378.)

issue #309의 dead-lock(빈 세션 첫 `tools/list`에서 Tier B `build_attach_url`이 안 보여 env 3 진입을 포기)은 이 모델에서 구조적으로 소멸한다 — relay-kind connection이면 attach 전에도 kind를 알아 진입 도구가 첫 `tools/list`부터 정확히 노출된다(`BOOTSTRAP_TOOL_NAMES`). `connection.kind`는 비-sticky(각 active connection이 자기 kind 보고) — `start_debug`는 `DualConnectionRouter.active`를 flip해 세션 안에서 family를 전환한다(예전 "env는 sticky, 전환 없음" 모델을 의도적으로 초과).

도구는 RFC #277(closed — 구현 완료) Tier 분류를 따른다. 각 descriptor에 `availableIn: 'mock' | 'relay' | 'both'`(`ToolAvailability`)가 박혀 있고, `filterToolsByEnvironment`가 `tools/list`를 env에 맞춰 필터한다 — Tier B(`relay` only, 예: `build_attach_url`)는 local에서 hidden, 환경 불일치 호출은 `tierRejectionError`(한국어 "원인+다음 행동" + 영문 compat 라인을 담은 tool-result error)로 거부된다. Tier A(`mock` only, mock state dial)는 **현재 0개 노출** — webViewType/orientation 등 dial은 패널 UI 전용이고 MCP 표면엔 안 올라와 있다. Tier C(`both`, 평행 15개)에는 `list_console_messages`, `list_network_requests`, `list_pages`, `get_dom_document`, `take_snapshot`, `take_screenshot`, `measure_safe_area`, `evaluate`, `list_exceptions`, `call_sdk`, `AIT.getSdkCallHistory`, `AIT.getMockState`, `AIT.getOperationalEnvironment`, `start_debug`, `get_debug_status`가 든다. `measure_safe_area`는 양쪽에서 같은 `Runtime.evaluate` probe(`SAFE_AREA_PROBE_EXPRESSION`)를 돌리고 결과에 `source: 'mock' | 'relay-dev'`를 attach해 provenance를 노출한다. mock↔relay 결과 평행은 `scripts/fidelity-qa/`가 정량 diff(`whitelist.json`이 EXPECTED_MISMATCH 등재)로 강제한다.

**MCP 도구 명명 규칙**: 동사+명사(verb-first), 군더더기 prefix 금지. 도메인 prefix(`session_`/`observe_` 등)는 한 클러스터가 도구 3개 이상에 도달할 때만 도입한다 — MCP 서버키(`ait-devtools`)가 이미 1차 네임스페이스를 제공하므로 그 전엔 prefix가 거짓 신호다.

## 패키지 export 구조

| Import path | 용도 |
|---|---|
| `@ait-co/devtools` (= `/mock`) | 번들러 alias 대상, 모든 mock export |
| `@ait-co/devtools/panel` | Floating DevTools Panel (import 시 자동 마운트) |
| `@ait-co/devtools/unplugin` | 번들러 플러그인 (.vite/.webpack/.rspack/.esbuild/.rollup) |
| `@ait-co/devtools/mcp/server` | dev-mode MCP stdio server 함수 (Node.js) |
| `@ait-co/devtools/mcp/cli` | `devtools-mcp` bin 진입점 (debug / dev 모드, Node.js) |
| `@ait-co/devtools/in-app` | In-app debug attach — 런타임 gate(layer B·C) + Chii target.js 주입 + eruda 인-페이지 콘솔. 소비자가 `if (__DEBUG_BUILD__)`로 import를 감싸 release 빌드에서 DCE — dogfood 빌드 전용 |

### in-app eruda 콘솔 + 빌드타임 부재 불변식 (#647)

`maybeAttach()`는 gate 통과(`gateResult.attach`) 직후 Chii `target.js` `<script>` 주입과 **나란히** `mountEruda()`(`src/in-app/eruda-overlay.ts`)를 호출해 [eruda](https://github.com/liriliri/eruda) 인-페이지 콘솔을 폰 화면에 띄운다. Chii는 **원격 CDP transport**(폰→relay→PC frontend), eruda는 **폰 화면 로컬 view**라 직교한다 — eruda는 WS를 안 열고(Shadow DOM `#eruda` 격리) chii는 DOM 미마운트라 충돌 없이 공존한다. env 1(데스크톱)은 host allowlist 미통과로 자연 제외(F12 사용), env 2(`*.trycloudflare.com`)·env 3·4(`*.private-apps.tossmini.com`)만 마운트된다 — eruda용 새 host 분기 코드는 없고 `evaluateDebugGate` 결과를 그대로 탄다.

- **`eruda`는 `dependencies`** (devDep/optionalDep 아님): 소비자가 `__DEBUG_BUILD__` 디버그 빌드 시 eruda를 번들에 넣으므로 resolve할 수 있어야 한다. install 그래프엔 있되 release 번들엔 0 bytes(아래) — cloudflared/qrcode-terminal과 같은 "런타임 코드 경로 필요" 예외. `import('eruda')`는 **dynamic import**라 dead branch에서 청크 자체가 emit 안 됨.
- **빌드타임 부재 (zero bytes)**: in-app 디버그 표면(Chii 주입 + eruda)은 release 빌드에 **물리적으로 존재하지 않아야** 한다. 소비자가 `if (__DEBUG_BUILD__) { import('@ait-co/devtools/in-app')... }`로 감싸고 release가 `__DEBUG_BUILD__:false`로 define하면 in-app 그래프 전체가 DCE된다(Vite 8/rolldown 검증). 런타임 gate는 코드가 번들에 남아 추출·재주입 여지가 있지만, 빌드 부재는 표면이 0. `/in-app/auto`는 런타임 self-gate라 dormant chunk가 잔존하므로 "빌드 부재"가 필요하면 쓰지 않는다(deprecated 주석).
- **CI 강제**: `check:debug-surface-absent`(`scripts/check-debug-surface-absent.sh`, ci.yml 배선)가 ① MCP 데몬 번들(`dist/mcp/*.js`)에 eruda 0건(브라우저 UI 미렌더), ② release 모드 fixture 빌드(minify ON — minify 끄면 `if(false){}` husk 식별자 false-positive)에 디버그 표면 0건, ③ positive control(`AIT_DEBUG_BUILD=1` 빌드엔 존재 → 토글 사망 방지)을 강제한다. `e2e/fixture/main.tsx`가 빌드 가드 패턴의 reference다.

## 실기기 미리보기 — 환경 2 (AITC Sandbox App (PWA), tunnel + launcher)

이 섹션은 4겹 fidelity 사다리의 **환경 2 = AITC Sandbox App**을 다룬다. 환경 1(로컬 브라우저 + mock SDK)이 구조적으로 메울 수 없는 실기기 WebKit 엔진·실 터치/뷰포트를 토스 검수·WebView 없이 확인하는 겹이다 — `devtools.aitc.dev/launcher/`에 배포된 installable PWA(`e2e/fixture/launcher/`)가 그 진입점이고, agent-plugin의 `/ait setup-phone-preview`가 이 환경을 배선하는 station 보조 skill이다. 설계 정본은 umbrella `meta/four-environments-fidelity.md` §1.1·§1.2(환경 2 매트릭스).

unplugin `tunnel` 옵션(Vite dev 전용, `src/unplugin/index.ts`의 `vite.configureServer` 분기 + `src/unplugin/tunnel.ts`)이 dev 서버가 listen하면 `cloudflared` quick tunnel(`*.trycloudflare.com`, 계정 불필요)을 띄우고 터미널에 URL + ASCII QR을 출력한다. production은 `forceEnable`이어도 터널을 안 띄운다 (의도치 않은 노출 방지). `cloudflared`/`qrcode-terminal`는 **동적 import**로만 로드 → 터널 미사용 시 그래프에 안 들어옴. 이 둘은 `dependencies`에 들어가는데, "외부 의존성 최소화" 원칙의 의도적 예외다 (런타임 코드 경로에서 필요, 동적 import로 비용 격리). `tunnel.ts`의 `parseTrycloudflareUrl`/`printTunnelBanner`는 순수 함수로 빼서 vitest로 검증하고, cloudflared spawn 자체는 jsdom 범위 밖이라 e2e/수동 검증 ("web 모드는 e2e"와 같은 정신).

`tunnel: { cdp: true }`(opt-in, default false)를 주면 위 HTTP 터널과 **별도로** Chii relay(`src/mcp/chii-relay.ts`의 `startChiiRelay({port:0})`)와 그 relay에 붙는 두 번째 quick tunnel을 띄워 환경 2 PWA에 CDP 디버깅을 배선한다 — launcher QR deep-link가 `&debug=1&relay=<wss>`를 추가로 실어, 폰 PWA iframe이 in-app debug gate(`src/in-app/gate.ts`)를 통과하고 target.js가 주입된다. host-gate는 "완화"가 아니라 host별 분기다: `*.trycloudflare.com` host는 Layer B1을 우회(+B2 `_deploymentId` skip)하되 C1 `debug=1`/C2 relay wss/C3 TOTP는 그대로 적용된다(`isTrycloudflareHost`). 토스 host(`*.private-apps.tossmini.com`) 경로는 positive-allowlist kill-switch(#665)로 보호된다. `chii-relay`는 동적 import이므로 MCP-only 소비자(`npx … devtools-mcp`)의 install 그래프에 정적으로 끌려오지 않는다. 단, `call_sdk`는 환경 2에서 여전히 mock을 친다 — CDP가 메우는 건 실기기 WebKit의 DOM·콘솔·예외·`measure_safe_area` 관측이고, SDK fidelity가 필요하면 환경 3로 올라간다(devtools #377).

CDP 배선(`cdp:true`) + GUI 감지 시, `printTunnelBanner`의 ASCII QR과 **별도로** env 3(`build_attach_url`)와 동일한 `127.0.0.1` HTML 대시보드(QR 이미지 + 연결 방법 + FAQ)를 띄우고 브라우저를 자동으로 연다 — env 3 UX 패리티(devtools #408, `tunnel.ts`의 `startTunnelDashboard`가 `src/mcp/qr-http-server.ts`·`devtools-opener.ts`를 그 lazy `import('./tunnel.js')` 경로 안에서만 동적 import). 대시보드 QR은 `buildLauncherAttachUrl(tunnelUrl, wssUrl, totpCode)`로 TOTP `at=` 코드를 캡슐화하는데, `getDashboardState` 클로저가 매 호출(SSE push·재로드)마다 `generateTotp(secret, Date.now())`로 **새 코드**를 굽기 때문에 폰이 스캔하는 코드는 항상 30초 창 안이다(정적 HTML에 만료 코드 박힘 없음). `tunnel:{qr:false}`·headless(`canOpenBrowser=false`)·`AIT_AUTO_DEVTOOLS=0`이면 대시보드를 띄우지 않고 ASCII QR fallback만 남긴다(회귀 없음). SECRET-HANDLING: tunnel host·relay wss·TOTP 코드는 HTML 본문/`/qr.png` query에만 — 브라우저로 여는 URL은 `http://127.0.0.1:<port>`(로컬)만 로그/오픈한다.

폰 쪽은 고정 URL(`https://devtools.aitc.dev/launcher/`)에 배포된 launcher PWA(`e2e/fixture/launcher/`)를 한 번 홈 화면에 추가하고, 그 안의 풀뷰포트 `<iframe>`으로 그날의 tunnel URL을 띄운다 (quick tunnel URL은 매 실행마다 바뀌어서 URL 자체를 PWA로 설치하면 죽은 링크가 되고, cross-origin 전환은 standalone이 깨짐 → launcher가 same-origin 크롬리스 셸 역할). launcher는 카메라 QR 스캔(`qr-scanner`, **devDependency** — launcher SPA에서만 쓰이고 npm 패키지엔 안 실림) + URL 붙여넣기 fallback + "Rescan" 버튼. 신규 오픈(쿼리 없음)은 항상 스캔 화면 — localStorage 마지막 URL 자동 로드는 #459에서 제거됐다(quick-tunnel host는 세션마다 바뀌고 TOTP `at=` 코드는 30초로 만료 → 저장된 debug deep-link는 항상 stale). live 진입 경로는 `?url=` QR deep-link 단일 경로만. PWA 정적 파일(`manifest.webmanifest`/`sw.js`/아이콘)은 `e2e/fixture/public/launcher/`에 두면 vite가 `dist/launcher/`로 복사. `e2e/fixture/vite.config.ts`는 이 launcher 페이지 때문에 MPA(`rollupOptions.input`에 `index.html` + `launcher/index.html`)이고, 같은 config의 unplugin 호출에 `tunnel: process.env.AIT_TUNNEL_CDP ? { cdp: true } : !!process.env.AIT_TUNNEL`이 있어 `AIT_TUNNEL=1 pnpm exec vite --config e2e/fixture/vite.config.ts`(스크린 미리보기) 또는 `AIT_TUNNEL_CDP=1 pnpm exec vite --config e2e/fixture/vite.config.ts`(CDP relay 포함)로 수동 QA 가능. (named tunnel로 고정 hostname 받는 방식은 추후 `tunnel: { hostname }` 옵션으로 확장 여지.)

**환경 2 MCP-attach 절반** (issue #378, PR-2): MCP server가 `relay-mobile` env로 `build_attach_url`을 호출하면 `AIT_TUNNEL_BASE_URL` + relay `wssUrl`을 조합해 `buildLauncherAttachUrl(tunnelUrl, wssUrl)`로 launcher QR deep-link를 생성한다 (`src/mcp/deeplink.ts`). 이 경로는 intoss-private scheme URL을 쓰지 않고 `scheme_url` 인자도 요구하지 않는다. `AIT_TUNNEL_BASE_URL`은 relay/tunnel host와 같은 민감도 — 절대 stdout/log에 출력하지 않는다. `e2e/fixture/main.tsx`는 `?debug=1&relay=` 파라미터 존재 시 `@ait-co/devtools/in-app`을 dynamic import해 `maybeAttach()`를 호출한다 — localhost에서는 Layer B1 gate가 차단하므로 실 환경(trycloudflare.com 터널)에서만 target.js가 주입된다. 로컬 PC 검증은 `e2e/launcher-cdp.test.ts`가 node-side relay 기동 + launcher 파라미터 포워딩을 자동화하고, browser-side target.js 주입의 수동 잔여를 주석으로 명시한다.

pnpm 10+ 소비자에 대한 안내는 README에 있다: 프로젝트 `package.json`에 `"pnpm": { "onlyBuiltDependencies": ["cloudflared"] }`. pnpm이 기본으로 third-party build script를 차단해 `cloudflared` postinstall(바이너리 ~38 MB 다운로드)이 스킵되면 `pnpm install` 시 'Ignored build scripts' 경고가 남고 바이너리 캐싱이 첫 dev 기동까지 미뤄진다 — 동작은 됨 (`tunnel.ts`가 `cloudflared.install()`을 lazy로 호출). 참조: [sdk-example#60](https://github.com/apps-in-toss-community/sdk-example/pull/60).

## E2E 테스트 플로우

이 repo 내부 자기완결 fixture(`e2e/fixture/`)를 쓴다. 외부 repo 의존 없음. 로컬은 `pnpm test:e2e` 한 줄. `playwright.config.ts`의 `webServer`가 `pnpm build` → fixture vite build → vite preview(:4173)를 자동 수행한다. CI는 `.github/workflows/ci.yml`의 `e2e` job이 동일 절차 실행, Playwright 브라우저는 `@playwright/test` 버전 키로 캐싱. 머지 게이트로 묶으려면 branch protection에서 `e2e` 체크 required로 추가 (job 이름 안정 유지).

같은 fixture는 GitHub Pages로도 배포된다 (<https://devtools.aitc.dev/>). main에 `e2e/fixture/**`·`src/**`·`package.json` 변경이 들어오면 `.github/workflows/deploy-fixture.yml`이 `pnpm e2e:build`로 정적 산출물을 만들어 Pages에 publish한다. CNAME은 `e2e/fixture/public/CNAME`에 source-control되며 vite가 `dist/` 루트에 그대로 복사한다.

**Vite 8 (rolldown) 우회책:**
- `@apps-in-toss/web-framework` → mock 매핑은 unplugin `resolveId` 대신 `vite.config.ts`의 `resolve.alias`로 `dist/mock/index.js` 직접 지정 (rolldown bare string resolveId 버그 우회).
- 패널 주입은 unplugin `transform`이 rolldown 프로덕션 빌드에서 신뢰성 없음 → `main.tsx`에 `import '@ait-co/devtools/panel'` 명시.

**testid 규약** (`e2e/fixture/components.tsx`): `section-<id>` 루트, `<id>-btn` 버튼, `<id>-result` 결과, `<id>-input` 입력, `<id>-value` 즉시 값, `<id>-log`/`<id>-empty` 이벤트 로그.

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
