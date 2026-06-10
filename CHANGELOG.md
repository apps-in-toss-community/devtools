# Changelog

## 0.1.68

### Patch Changes

- af56569: dashboard: /attach 스캔 절차·진단 체크리스트를 세션 mode별로 분기 — 환경 2(AITC Sandbox PWA)는 launcher 인앱 QR 스캔 카피, 환경 3·4는 기존 토스 앱 deep-link 카피 + 환경 4 LIVE read-only 안내 라인, 페이지 상단에 현재 환경 라벨 표시(#468)
- 2c15c54: fix: launcher standalone letterbox 대응 (#469) — 레거시 apple-mobile-web-app meta 제거(manifest 단독 정본), iframe 사이징 inset:0 단일화, 런타임 letterbox 감지 라벨 + 뷰포트 진단 패널(ko/en i18n 키 추가)
- 94a583e: relay TOTP 게이트에 폰 target 측 코드 전달 경로 추가 + 인증 거부 관측성 (#466, #467)

  - in-app attach가 페이지 URL의 `at` 코드를 `/at/<code>/target.js` path-prefix로 script src에 실어, chii target.js가 파생하는 WS 업그레이드가 relay TOTP 게이트를 통과할 수 있게 함 (기존에는 전달 경로 자체가 없어 TOTP 활성 시 모든 실기기 attach가 조용히 401)
  - relay가 `/at/<code>/…` prefix를 검증 후 쿼리 형태로 재작성·strip — 기존 쿼리(`at=`) 전달 경로는 그대로 동작 (back-compat)
  - 인증 거부를 secret-free 카운터로 기록해 `get_debug_status`/`get_diagnostics`에 `authRejects` 노출, recentErrors 요약 1건 + next_recommended_action에 QR 재스캔 안내 추가

## 0.1.67

### Patch Changes

- e7a400f: launcher: 신규 오픈은 항상 스캔 화면 — last-URL 자동 진입·프리필 제거(#459)
- 6e378d5: dashboard·attach url-box에 click-to-copy + 복사 버튼 추가, SSE 재렌더 시 /attach url-box 이중 표시 결함 수정

## 0.1.66

### Patch Changes

- 2744790: fix: attach/dashboard HTML default locale을 ko로 + ko/en lang switcher + ?lang= override 추가 (#455)

  - `parseAcceptLanguage` fallback을 `'en'`에서 `'ko'`로 변경 (빈/없는 Accept-Language 헤더 시 한국어 기본)
  - `/attach`·`/` 대시보드 양쪽에 ko/en lang switcher 추가 (SSR 방식 — `?lang=` query param 기반 `<a href>` 링크, JS 핸들러 없음)
  - `?lang=ko|en` query param이 Accept-Language 헤더보다 우선 적용
  - switcher 링크는 기존 query(`u=` attachUrl, TOTP `at=` 캡슐 포함)를 보존하고 `lang`만 교체

## 0.1.65

### Patch Changes

- 2f992ce: fix: launcher PWA URL input auto-zoom 방지(16px) + build_attach_url relay 모드 TOTP fail-closed (defense-in-depth)

  - launcher PWA(`e2e/fixture/launcher/Launcher.tsx`) URL 입력 input의 font-size를 15px→16px로 올림. iOS Safari는 focus 가능 요소의 font-size < 16px이면 auto-zoom하므로, 16px이 트리거 자체를 막는 정석 해법 (#451).
  - `build_attach_url` relay-mobile·relay-dev/live 경로에서 TOTP secret이 없으면 `at=` 없는 URL을 발급하는 대신 명시적 mcpError로 거부 (#452 defense-in-depth). `assertRelayAuthConfigured`가 relay boot 시 이미 방어하므로 dead code지만, 하류 fail-open 가지를 닫는다.

## 0.1.64

### Patch Changes

- daa42db: fix: env2·env1 relay 전환·unplugin 터널 대시보드에도 TOTP at= 주기 갱신 적용 — #446을 모든 대시보드 진입점으로 확장 (방치 시 90초 stale 갭 잔여 수정)

## 0.1.63

### Patch Changes

- 60f3a54: fix: MCP dashboard·/attach 페이지 TOTP at= 코드 주기 갱신 — 방치된 페이지가 90초 후 stale되던 갭 수정 (20초 주기로 SSE push)

## 0.1.62

### Patch Changes

- 3143e1f: fix: /attach 페이지 QR 이미지 가운데 정렬 (img.qr에 display:block; margin:0 auto 추가)
- f29e3fc: fix: launcher PWA 가로 잘림 수정 (WebKit standalone에서 iframe·fixed 요소를 visual viewport 폭에 clamp)

## 0.1.61

### Patch Changes

- 8ec343c: env-2 PWA TOTP 인증 실패 시 launcher에 에러 배너 표면화 (Defect 2, #436)
- d0217ef: MCP 대시보드·`/attach` 페이지 TOTP `at=` 코드 실시간 재발급 (Defect 1, #435): `lastAttachUrl` 문자열 캐시를 `AttachUrlParts` 컴포넌트로 교체해 `getDashboardState` 호출마다 `generateTotp()`로 신선한 코드를 mint하도록 수정. `/attach` HTML에 SSE 구독 스크립트를 주입하고 `id="attach-section"` wrapper를 추가해 QR 실시간 갱신을 지원.
- a24ecf5: relay TOTP 활성 시 MCP client WS에 at= 코드 첨부 → 401 self-reject 해소

## 0.1.60

### Patch Changes

- 30f7cde: build_attach_url(env-2/relay-mobile): inputSchema에 projectRoot 추가 — .ait_urls의 tunnelBaseUrl 자동발견이 MCP 클라이언트에서 도달 가능해진다 (start_debug와 대칭). 핸들러는 이미 인자를 읽고 있었고 inputSchema 선언만 누락돼 dead path였다. (#430)
- 8ada9f5: launcher PWA install UX를 pwa-install 라이브러리에 위임 — iOS 설치 안내 복원, 손수 만든 openOnce 탈출구 제거

## 0.1.59

### Patch Changes

- dadd97e: cloudflared 종료/타임아웃 에러에 stderr 진단 첨부: cloudflared가 URL 보고 전에 죽으면 이제 에러 메시지에 마지막 15줄의 stderr 출력이 포함되어 근본 원인(Cloudflare error 1101 등)을 즉시 확인할 수 있습니다. trycloudflare.com 호스트명은 `<HOST>.trycloudflare.com` 플레이스홀더로 마스킹됩니다. (#421)
- 30c297c: e2e fixture(`e2e/fixture/`)를 vanilla DOM에서 client-side React 19로 전환한다 (#413 PR4). `helpers.ts`의 `apiSection`/`apiButton`/`apiInput`/`apiValue`/`apiSubscriber` DOM 헬퍼를 React 컴포넌트(`components.tsx`)로 재구현하되 emit하는 DOM 구조와 `data-testid` 계약(`section-<id>`, `<id>-btn`, `<id>-result`, `<id>-input`, `<id>-value`, `<id>-log`, `<id>-empty`)을 byte-identical로 유지한다. `main.ts` 549줄 IIFE 블록을 `main.tsx` JSX로 변환하고 `createRoot`로 마운트한다. `@ait-co/devtools/panel` import 최상단 순서와 ENV-2 CDP gate(`?debug=1&relay=` → `@ait-co/devtools/in-app` dynamic import) 블록을 그대로 보존한다. `pnpm test:e2e` 40/40 무수정 통과 확인. fixture는 npm 패키지에 포함되지 않으므로 package surface 변경 없음.
- b72967c: 환경 2(unplugin 터널 대시보드 + launcher PWA)에서 PR #409가 실기기에서 드러낸 절반 패리티 결함 두 개를 정정한다 (#411).

  - 대시보드 "연결된 Pages" 섹션: env 2(unplugin 터널)는 plugin 핸들이 connected target을 노출하지 않아 라이브 page 목록을 알 수 없는데도 항상 빈 목록을 보여줬다. 거짓 빈 목록 대신 섹션 자체를 숨긴다 — `DashboardState.pages`를 `Array | null`로 넓혀 `null`이면 정적 렌더와 SSE 갱신 양쪽에서 섹션을 생략하고, env 3/4(MCP)는 기존대로 `router.active.listTargets()`로 실제 목록(빈 배열은 "attach된 페이지 없음")을 채운다.
  - launcher deep-link: 미설치 브라우저 탭에서 `?url=` deep-link가 도착하면 곧장 live로 넘어가 설치 안내(install CTA)를 영구히 가려버렸다. 미설치(`!standalone && !local-dev`) 상태면 deep-link/저장 URL을 보존한 채 설치 화면을 먼저 띄우고 "설치 없이 이번만 열기" 버튼으로 막다른 길을 피한다. standalone/local-dev는 기존대로 바로 live, 설치 완료(`appinstalled`) 시 보존된 URL로 진입한다.

- a59da69: 환경 2(unplugin `tunnel: { cdp: true }`) 터널에 HTML 대시보드 + 브라우저 자동 오픈을 더해 환경 3/4(`build_attach_url`)와 UX 패리티를 맞춘다 (#408). CDP가 배선되고 GUI가 감지되면 env 3/4가 쓰는 것과 동일한 `127.0.0.1` 대시보드(QR 이미지 + 연결 방법 + FAQ)를 띄우고 브라우저로 연다. QR에는 폰이 relay WS upgrade를 통과하도록 매 요청마다 새로 생성한 TOTP 코드가 캡슐화되며(SSE/재로드 시 갱신 — 만료 없음), 터미널 ASCII QR fallback은 headless·`tunnel:{qr:false}`·`AIT_AUTO_DEVTOOLS=0`에서 회귀 없이 유지된다. `qrcode`/QR HTTP 서버는 기존대로 동적 import만 거치므로 터널 미사용 빌드 그래프엔 들어가지 않는다.
- 912d43b: 환경 2 cold-start URL을 `.ait_urls` 파일 자동 발견으로 대체 (#424)

  env-2(AITC Sandbox PWA) cold-start 시 `AIT_RELAY_BASE_URL`·`AIT_TUNNEL_BASE_URL`을 매번 수동으로 env var에 복붙해야 했던 문제를 파일 기반 자동 발견으로 대체한다. unplugin이 tunnel/relay URL을 `<projectRoot>/.ait_urls`(mode 0600)에 기록하고, MCP 데몬은 env가 설정되지 않은 경우 해당 파일에서 URL을 읽는다(env가 있으면 env 우선). `cleanup()` 시 파일을 삭제해 stale URL이 다음 부팅에 남지 않도록 한다. `.ait_relay` TOTP 시크릿 저장 패턴을 그대로 재사용(쓰기=unplugin만, 읽기=daemon 전용 read-only). SECRET-HANDLING: URL 값과 파일 경로는 어느 로그·stderr·오류 메시지에도 절대 출력하지 않는다.

- 1d522c7: qr-http-server 대시보드/attach 페이지에 Accept-Language i18n 적용 및 React 빌드타임 precompile 전환 (#413)

  - `buildDashboardHtml`·`buildAttachHtml` HTML을 React JSX + `renderToStaticMarkup`으로 빌드타임에 precompile해 `src/mcp/dashboard.generated.ts`(plain string exports)로 커밋
  - 런타임 `qr-http-server.ts`는 생성된 string만 import — react/react-dom을 정적·동적으로 절대 import하지 않음, INSTALL-GRAPH 불변식 유지
  - `GET /`·`GET /attach` 요청에서 `Accept-Language` 헤더를 읽어 per-request locale 결정 (`parseAcceptLanguage()`); ko·en 문자열을 공유 i18n 테이블(`ko.ts`/`en.ts`)에서 해결
  - ko.ts/en.ts에 dashboard·attach 전용 키 추가(`dashboard.*`, `attach.*` 32개)
  - `pnpm build:dashboard-html` 스크립트 추가 (빌드 체인에 tsdown 앞에 자동 실행), `check:dashboard-html-fresh` CI 가드 추가
  - `check-mcp-react-free.sh` 가드: `dist/mcp/cli.js`·`dist/mcp/server.js` react 유입 없음 확인

- 5167e29: 사용자 대면 표면 전면 React 전환의 토대를 추가한다 (#413). 기존 vanilla i18n 코어(`src/i18n`) 위에 React 반응성 레이어 `src/i18n/react.ts`(`useLocale`/`useT`, `useSyncExternalStore`로 `LOCALE_CHANGE_EVENT` 구독)를 얹어 두 번째 i18n 시스템 없이 React 표면이 locale 변경에 리렌더하도록 한다. `useT`는 `(key: StringKey, …)` 시그니처를 유지해 `ko.ts` 타입 소스 → `en.ts` typecheck-enforced mirror 안전망이 JSX 호출부까지 전파된다. navigator가 없는 Node 표면(qr-http-server)을 위해 `parseAcceptLanguage`(Accept-Language 헤더 → locale)와 `resolveLocaleStrings`(동일 169키 카탈로그를 공유하는 locale-bound resolver)를 같은 모듈에 더한다. 루트 tsconfig에 `jsx: react-jsx`를 켜고 react-dom·@testing-library/react·@vitejs/plugin-react를 devDependency로만 추가한다(install-graph 불변식 유지 — `dependencies`엔 react가 없다). MCP 데몬 번들(`dist/mcp/cli.js`·`dist/mcp/server.js`)이 react를 import하지 않음을 빌드 후 강제하는 CI 가드(`scripts/check-mcp-react-free.sh`)를 추가한다. 이 PR은 순수 가산 토대로, 어떤 표면도 아직 변환하지 않으며 기존 테스트는 모두 green이다.
- 9d33c2a: launcher PWA를 vanilla DOM에서 client-side React로 전환하고 ko/en i18n을 적용합니다(#413 일부).

  - `e2e/fixture/launcher/main.ts` → `main.tsx`로 전환, `createRoot`로 `<Launcher/>` 마운트
  - `e2e/fixture/launcher/Launcher.tsx` 신규: 모든 data-testid 계약 보존, QrScanner/pwa-install ref·effect 배선, iframe src prop, localStorage 효과, 서비스워커 등록을 React 패턴으로 재구현
  - `entry.ts` 순수 함수 무수정 유지 — entry.vitest.ts 7개 테스트 무변경 통과
  - `src/i18n/ko.ts`·`en.ts`에 `launcher.*` 키 12개 추가(StringKey 타입 확장, en mirror parity 유지)
  - `e2e/fixture/vite.config.ts`에 `@vitejs/plugin-react` 추가
  - `e2e/fixture/tsconfig.json`: JSX 설정 포함 독립 tsconfig로 재작성, `src/i18n/**` 포함
  - `launcher/index.html`을 `<div id="root">` shell로 단순화

- b6d66a8: unplugin 터널 경로에 부모-PID watcher 배선: `startParentWatcher`·`isPidAlive`를 `src/shared/parent-watcher.ts`로 추출하고, vite tunnel boot 완료 후 parent-PID watcher를 등록해 부모 프로세스가 죽거나 reparent될 때 cloudflared 자식 프로세스를 동기적으로 정리하도록 합니다. `process.once('SIGHUP', cleanup)` 핸들러도 추가합니다. (#420)
- 0cb18de: 환경 2 터널 토글을 plugin이 직접 `AIT_TUNNEL` / `AIT_TUNNEL_CDP` env var로 fallback 읽도록 내재화. 소비자 `vite.config.ts`에서 `tunnel: process.env.AIT_TUNNEL_CDP ? { cdp: true } : !!process.env.AIT_TUNNEL` 한 줄이 더 이상 필요 없음. 명시 `tunnel` 옵션(`false` 포함)이 항상 우선(`??` 의미론, non-breaking), 기존 `isDev &&` 가드로 prod 안전성 불변. `resolveTunnelOption(explicit, env)` 순수 함수로 추출해 단위 테스트 추가. (#425)
- 20ecb09: Floating DevTools Panel을 vanilla DOM에서 client-side React 19로 전환하고 i18n을 반응형으로 만든다. locale 변경 시 패널을 disposePanel→mount로 다시 마운트하지 않고, `useT()`(i18n store 구독)로 패널 subtree만 제자리에서 다시 렌더한다 — 현재 탭과 토글 버튼 위치가 그대로 유지된다. 패널 chrome(토글/헤더/배지/탭바/바디)만 React로 바꾸고 탭 본체는 명령형 렌더러로 유지하며, React는 `dist/panel/index.js`에 번들된다(published `dependencies`에는 들어가지 않음). `e2e/panel.test.ts`가 의존하는 CSS 클래스/속성 계약은 그대로 보존된다.

## 0.1.58

### Patch Changes

- 8e54293: get_diagnostics MCP 도구를 get_debug_status로 리네임 — 현재 환경/모드/세션 상태 조회 용도를 이름에서 직접 드러냄 (#405)
- 56ef271: start_debug description 정직화 — relay-staging(환경 3) prereq에 `RELEASE_CHANNEL=dogfood ait build` → `ait deploy --scheme-only`(intoss-private deep-link 발급) 명령 체인 명시하고 env 2(dev-server 터널)와 인프라 대비. relay-sandbox(환경 2)는 single-connection 데몬에서 reject된다는 사실 + full 경로에 AIT_RELAY_BASE_URL·AIT_TUNNEL_BASE_URL 둘 다 필요함을 명시. 동작 변경 없음, description만. (#402)

## 0.1.57

### Patch Changes

- 01546d3: CI: `beta` dist-tag 자동 publish 채널 추가. 같은 main 커밋에서 `latest`(web-framework 2.x peer, 기존 흐름 무변경)와 나란히, 3.0 라인 peer(`>=3.0.0-beta <4.0.0`)를 실은 Changesets 스냅샷(`0.0.0-beta-<datetime>-<sha>`)을 `release-beta` job이 pending changeset이 있을 때만 publish한다. 3.0-beta 소비자는 `@ait-co/devtools@beta`로 설치. base가 `0.0.0`이라 어떤 stable range도 만족하지 않고(`latest`로 누출 불가), peer rewrite는 job-local ephemeral checkout에서만 일어나며, publish 직전 artifact shape(version/peer/optional)을 assert한다. `latest` 채널은 2.x로 유지 — GA flip(#370) 아님.
- c7cd513: MCP debug dashboard (GET / + SSE /events) — tunnel/page/attachUrl 라이브 갱신 (#247 Phase 1)
- 3ce37be: env-2 unplugin relay에서 AIT_DEBUG_TOTP_SECRET 미설정 시 256비트 시크릿 자동 생성·영속화 (#394)
- b5a5885: relay 시크릿 저장을 머신 홈에서 프로젝트 로컬 .ait_relay 단일 파일로 이전, MCP 데몬은 start_debug projectRoot 인자로 받아 read-only 로드. DualConnectionRouter를 all-lazy로 전환해 모든 family 부트가 switchMode(=시크릿 로드)를 거치게 하여 데몬 startup 시점의 시크릿 로드 빈틈을 제거 (#396)
- 5aa69c0: start_debug mode 이름을 환경 계층이 드러나게 하드 리네임 — `local`→`local-browser`(환경 1), `mobile`→`relay-sandbox`(환경 2), `staging`→`relay-staging`(환경 3), `live`→`relay-live`(환경 4). 내부 FamilyKey도 정렬(`local`→`local-browser`, `relay-external`→`relay-sandbox`, `relay-intoss`는 relay-staging·relay-live 두 모드가 공유하는 단일 물리 슬롯으로 유지 — 4개 노출 라벨 → 3개 캐시 키). 옛 이름과 deprecated 별칭은 모두 제거(back-compat 없음, 0.1.x 단계라 허용). LIVE guard(`relay && liveIntent && !confirm → reject`) 동작은 불변 (#398)

## 0.1.56

### Patch Changes

- f2066a9: `call_sdk` 도구 description(에이전트 노출 문자열)에서 환경 2 가용성 서술 모순을 정정했다. 기존 `(env 2 PWA does not inject the SDK — call_sdk is not available there.)`는 code ground truth(`callSdkMethod` JSDoc) 및 docs 4곳과 정반대였다 — `call_sdk` descriptor는 `availableIn: 'both'`라 환경 2에서 tier-gating으로 막히지 않고, 환경 2 relay(`kind:'relay'`)를 타고 폰 PWA iframe의 mock SDK에 닿는다. description을 정합화: `on env 1 (local mock) and env 2 (PWA relay — real WebKit, mock SDK) it hits the mock SDK.` 환경 2를 client로 운전하는 MCP-attach 진입은 별개 관심사로 `start_debug({mode:'mobile'})`(#378)이 담당하며, tool 가용성 서술과 혼동하지 않는다.
- 01b79cf: `call_sdk`의 sdk-absent 에러 안내를 connection 종류에 따라 분기했다 (#360). 같은 "window.\_\_sdkCall 부재"라도 다음 행동은 정반대다 — relay(env 3/4)면 dogfood 빌드가 아니라는 뜻이라 `ait build && aitcc app deploy` 재배포가 맞고, local(`--target=local`, env 1 로컬 브라우저)이면 재배포가 아니라 `pnpm dev` dev 서버와 unplugin alias(`@apps-in-toss/web-framework` → devtools mock) resolve를 확인하는 게 맞다. 이전에는 두 경우 모두 relay/dogfood 안내만 떠서 local 세션 사용자를 잘못된 방향으로 이끌었다. `sdkAbsentError`/`classifyToolError`에 `isLocal` 파라미터를 추가하고(생략 시 기존 relay 안내 유지 — 하위 호환), call_sdk 핸들러와 catch 경로 양쪽이 `conn.kind === 'local'`을 전달하도록 배선했다. `call_sdk` 도구 description도 두 환경의 안내를 함께 명시하도록 갱신했다.
- 50e6bbf: build_attach_url 환경 2(mobile) launcher QR 분기 — AIT_TUNNEL_BASE_URL + buildLauncherAttachUrl로 런처 딥링크 생성, scheme_url 불필요
- 50f3fcd: 환경 2(실기기 PWA)에 CDP 디버깅을 배선했다. `tunnel: { cdp: true }` opt-in을 켜면 dev 서버 HTTP 터널과 별도로 Chii relay + 두 번째 quick tunnel이 떠서, launcher QR deep-link에 `&debug=1&relay=<wss>`를 실어 보낸다. 폰의 PWA iframe이 in-app debug gate를 통과해 target.js를 주입받으므로, 같은 한 번의 QR 스캔으로 화면 미리보기와 on-device CDP가 동시에 열린다.

  in-app debug gate는 `*.trycloudflare.com` host에 대해 Layer B1을 host별로 분기 우회한다(나머지 layer + TOTP는 그대로). 토스 host(`*.private-apps.tossmini.com`) 경로는 한 글자도 바뀌지 않아 환경 4 LIVE 안전 불변식을 유지한다. `call_sdk`는 환경 2에서 여전히 mock을 친다 — CDP가 메우는 건 실기기 WebKit의 DOM·콘솔·예외·`measure_safe_area` 관측이다.

- cc07275: relay 인증 TOTP를 필수 baseline으로 강제한다 (#250). 기존에는 `AIT_DEBUG_TOTP_SECRET`이 설정된 경우에만 §4 Layer C TOTP gate가 켜져, 미설정 시 relay가 공개 `wss://…trycloudflare.com` 터널을 인증 없이 노출했다 — URL이 유출되면 제3자가 dogfood/live 미니앱에 디버거를 attach할 수 있는 갭. 이제 public relay가 실제로 부팅되는 모든 지점에서 fail-fast한다.

  - 새 가드 `assertRelayAuthConfigured()`(`src/mcp/totp.ts`)를 `bootRelayFamily`(intoss env 3/4)와 `bootExternalRelayFamily`(env-2 PWA) 진입에 배치 — eager·lazy(DualConnectionRouter) relay boot 양쪽 모두 relay/CDP가 열리기 전에 검증한다. local-only 세션(relay 미부팅)은 가드를 거치지 않아 그대로 면제.
  - unplugin `tunnel: { cdp: true }`의 env-2 relay도 가드 + `verifyAuth`를 배선 — 이전엔 이 relay가 `verifyAuth` 없이 떠 secret과 무관하게 인증이 비어 있었다. 미설정 시 relay를 띄우지 않고 화면 미리보기로 degrade.
  - 검증은 hex(base16, `Buffer.from(secret, 'hex')` decode 경로에 정합) 형식 + 32자 이상 + 짝수 길이. 미설정/빈 문자열/약형은 거부.
  - fail-fast 안내는 요구사항과 발급 명령(`openssl rand -hex 32`)만 출력하고 secret 값·길이·파생값을 절대 노출하지 않는다.

- 5461a3d: start_debug에 `mobile`(환경 2 실기기 PWA) 모드를 1급 모드로 추가하고 `relay-mobile` 출력 env를 도입했다. unplugin이 `tunnel: { cdp: true }`로 외부에 띄운 Chii relay에 MCP가 attach하는 쪽 절반으로, MCP는 relay/tunnel을 새로 띄우지 않고 `AIT_RELAY_BASE_URL`로 전달된 relay base에 CDP 클라이언트만 연다.

  `mobile`과 `staging`은 둘 다 `kind:'relay'`라 출력에서 구분돼야 하므로, URL을 스니핑하지 않고 부팅된 family에 실어 나르는 `relayOrigin`(`'intoss-webview'` vs `'external-pwa'`) 디스크리미네이터를 `deriveEnvironment`에 넣었다. dual-connection 라우터는 단일 lazy slot을 `FamilyKey`(local/relay-intoss/relay-external) 키 Map으로 일반화해 두 relay family가 같은 슬롯에서 충돌하지 않는다. relay-mobile은 liveIntent가 항상 꺼져 있어 LIVE side-effect 가드 대상이 아니다.

- acca107: start_debug 도구 스키마에 mobile mode(환경 2 PWA) 추가 — 런타임은 이미 지원하나 MCP enum/description에서 누락돼 있던 갭 수정
- 15d30f8: start_debug mode를 local/staging/live 사용자 환경 이름으로 리네이밍 (legacy relay-dev/relay-live/local-browser-\* 별칭 유지), tool description 강화
- e856989: web-framework dev-pin을 새 3.0.0-beta 빌드(9d42c0b→3051978)로 갱신. peer(2.6.x)·GA flip과 무관한 dev-only beta bump.

## 0.1.55

### Patch Changes

- b0900d7: fix(mock): checkPermission()이 per-API \*PermissionError 서브클래스를 throw하도록 변경 (#372)

  권한 거부 시 plain Error 대신 web-framework 3.0의 타입드 PermissionError 서브클래스를
  throw한다 — `instanceof PermissionError` / `instanceof OpenCameraPermissionError` 분기가
  mock에서도 동작하도록 실 SDK 동작과 정렬.

## 0.1.54

### Patch Changes

- d21ca57: fix(mcp): get_diagnostics의 mcpVersion이 여전히 null이던 잔여 결함 수정 (#361)

  #363가 머지됐지만 실기기 relay 데몬에서 `mcpVersion`은 여전히 `null`이었다. 원인은 빌드 타임 resolve(`tsdown.config.ts`)와 런타임 fallback(`tools.ts`) 둘 다 `@modelcontextprotocol/sdk`의 베어 메인 엔트리를 `require.resolve`했기 때문 — SDK는 `.`도 `./package.json`도 `exports`에 노출하지 않아 `MODULE_NOT_FOUND`로 throw, 빌드 define에 `null`이 구워지고 fallback도 throw해 항상 `null`로 떨어졌다. exports에 실제로 노출된 서브패스(`./server/mcp.js`)로 resolve한 뒤 패키지 루트로 marker-walk하도록 양쪽을 고쳐, 번들에 SDK 버전(`1.29.0`)이 정상 주입된다.

## 0.1.53

### Patch Changes

- 8b4df90: debug MCP: fix `get_diagnostics` always reporting `devtoolsVersion: null` and `mcpVersion: null` in a real bundle (issue #361). `readDevtoolsVersion()` read `globalThis.__VERSION__`, but the tsdown `define` only substitutes the bare `__VERSION__` token — the property access always read `undefined`. It now references the bare identifier (the same mechanism the MCP server `version` already used). `readMcpSdkVersion()` resolved `@modelcontextprotocol/sdk/package.json` at runtime, but that subpath is not in the SDK's `exports` map, so the resolve threw and returned null; the version is now baked in at build time via a new `__MCP_SDK_VERSION__` define (with a path-based runtime fallback for unbundled runs). Found by the env-1 runtime acceptance for #348.

## 0.1.52

### Patch Changes

- add2f36: debug MCP: a `--target=local` start can now hot-switch into relay (and back) without restarting the daemon. The `DualConnectionRouter` is generalized to be direction-neutral — an eager family booted at startup plus a lazily-booted opposite-kind family — so both entry points (`runDebugServer` relay-eager and `runLocalDebugServer` local-eager) share the same bidirectional `start_debug` swap. Previously only the default relay-target start carried the dual router; a local start pinned a single-connection router and rejected cross-family switches as "restart required", breaking the env 1 → env 3 fidelity-ladder flow at that entry point.
- 4141b3b: debug MCP: fix a per-call env snapshot regression and a LIVE side-effect guard race introduced with `start_debug(mode)` dual-connection routing. The `CallTool` handler now snapshots the derived environment (`env`/`envReason`) once at entry and reuses it at every output site, so a concurrent `start_debug` swap mid-`await` can no longer stamp the wrong env into a response envelope. The `evaluate` / `call_sdk` LIVE guard now evaluates `connection.kind === 'relay' && getLiveIntent()` with a snapshot `conn.kind` plus a fresh `liveIntent` read at the side-effect boundary — closing a race where a concurrent `start_debug('relay-live')` armed `liveIntent` while a relay-dev call was parked on an await, previously letting a LIVE side-effect run without `confirm: true`.
- c3cfd3d: debug MCP: `start_debug(mode)` single entry to switch environments (env 1/3/4) in-place — one daemon now holds both a local and a relay CDP connection at once and flips the active pointer with no Claude Code restart or MCP re-handshake (warm attach survives the switch). Replaces the URL-sniffing `getEnvironment()` precedence chain with a derived model: `mock` vs `relay-*` comes free from `connection.kind`, and `relay-dev` vs `relay-live` is a single operator-supplied `liveIntent` bit armed only by `start_debug({ mode: 'relay-live' })`. The LIVE side-effect guard collapses to `connection.kind === 'relay' && liveIntent`, so switching back to a local target auto-disarms it. `--mode`/`--target`/`MCP_ENV` (incl. `MCP_ENV=relay-live` seeding LIVE intent) remain as back-compat aliases.

## 0.1.51

### Patch Changes

- 9dc067d: Internal refactor (behavior-preserving): widen `CdpConnection` interface with optional `close`, `refreshTargets`, and `waitForFirstTarget` members, and introduce a `createRelayConnection` factory seam — preparing for dual-connection support (#348, PR-2). No runtime behavior changes.
- 2e20af4: fix(mcp): self-terminate orphaned MCP daemon + surface tunnel-drop in diagnostics

  Adds a parent-pid watcher to the MCP debug server so the daemon exits cleanly
  when the AI host (Claude Code, etc.) dies without sending SIGTERM/SIGHUP.
  Previously, the daemon would run as a zombie indefinitely, holding a stale
  cloudflared tunnel that silently blocked new attach attempts.

  - `startParentWatcher`: new exported function that polls `process.ppid` /
    `isPidAlive` every 5 s and calls `onOrphaned` (→ `shutdown()` + `process.exit(0)`)
    when the parent is gone. Wired into both `runDebugServer` and
    `runLocalDebugServer`. Disabled by `AIT_DEBUG_NO_PARENT_WATCH=1`.
  - stdin `end`/`close` events also trigger shutdown, covering MCP hosts that
    close the pipe without signalling.
  - `get_diagnostics`: `DiagnosticsTunnelInfo` now exposes `droppedAt` and
    `reissueAttempts` (copied from the live `TunnelStatus`), and `DiagnosticsResult`
    gains a `process: { pid, ppid, parentAlive }` block.
  - `computeNextRecommendedAction` Rule 0 (highest priority): when
    `tunnel.droppedAt != null` → returns `restart` with a timestamped reason,
    beating the existing crash/empty-pages rules.

- 0965e37: Auto-trigger `setScreenAwakeMode({ enabled: true })` when a debug session attaches to a real phone via the relay (env 3/4), and restore normal sleep on page unload. Add `noKeepAwake=1` URL param opt-out.

## 0.1.50

### Patch Changes

- c142328: docs(qa): 환경 3·4 runtime 검증 가이드 추가 — 사용자 폰 + QR 스캔 1세션에 효율적으로 끝낼 수 있도록 절차·acceptance·SECRET-HANDLING 박제
- 89ebe7b: fix(mcp): --mode=dev call_sdk(getOperationalEnvironment) value를 scalar string으로 정정. docs(qa/scenarios.md) 정본과 일치.
  docs(scenarios): env-1.md / qa/scenarios.md의 --mode=local 표기를 실제 CLI flag --target=local로 정정.

## 0.1.49

### Patch Changes

- 6095cf9: docs(env-2): PWA iframe 모델로 시나리오 docs 재작성 + manifest description 톤 정렬

## 0.1.48

### Patch Changes

- d849e5d: docs(env-3/4): 자율 검증 발견 5건 정렬 — measure_safe_area.source 토큰, call_sdk schema, README/QA `MCP_ENV=relay-live`, env-4.md acceptance + L88 stale
- e0397f2: fix(docs/mcp): `--mode=local` docs 정정 + local-target nextRecommendedAction 분기 (#321 #325)

  - docs의 `--mode=local` 표기를 올바른 `--target=local`(`--mode=debug --target=local`의 단축형)으로 일괄 정정 (`docs/scenarios/env-1.md`, `docs/qa/scenarios.md`)
  - `computeNextRecommendedAction`에 env 분기 추가: local-target(mock env)에서 `tunnel.up=false`는 정상 상태이므로 "restart" 대신 `wait_for_page`를 반환하도록 수정 — relay env에서만 tunnel down → restart 유지

## 0.1.47

### Patch Changes

- 333bf60: docs(env-1): clarify call_sdk acceptance for non-dogfood fixture (#324)

  `--mode=local`에서 non-dogfood fixture를 사용하면 `call_sdk("getOperationalEnvironment", [])` 결과가 `ok: false`로 반환된다. `window.__sdkCall` bridge는 dogfood 빌드(`__DEBUG_BUILD__` 정의)에서만 주입되므로 non-dogfood fixture에서는 bridge가 없어 `ok: false`가 정상 동작이다. `--mode=dev`는 mock state HTTP 폴링을 사용해 dogfood 빌드 없이 `ok: true`를 반환한다.

  `docs/scenarios/env-1.md`와 `docs/qa/scenarios.md`를 각 모드·빌드 조합별로 예상 결과를 명시하도록 정정.

- 04389f6: feat(mcp): dev-mode envelope 적용 + Tier B 회복 안내 (#322 #323)

  - #322: dev-mode tool handler(list_pages, get_diagnostics, measure_safe_area, call_sdk)에 ToolEnvelope {ok, data, meta} 적용. AIT_MCP_COMPAT=chrome-devtools 시 기존 raw 응답 유지.
  - #323: build_attach_url을 dev-mode tools/list에 Tier B 스텁으로 노출. 호출 시 "--mode=debug + MCP_ENV=relay 재시작" hand-off 안내 반환(옵션 B — debug-server 병행 방식과 surface 통일).

## 0.1.46

### Patch Changes

- fbc116f: feat(mcp): unified response envelope + chrome-devtools-mcp compat mode (#306)

  Introduces `ToolEnvelope<T>` — all MCP debug tool results now share a consistent
  `{ ok, data, meta }` shape so agents can use a single parser rather than
  branching per tool.

  Migrated tools (1차 PR): `list_pages`, `get_diagnostics`, `measure_safe_area`, `call_sdk`.
  Remaining tools follow in subsequent PRs.

  Set `AIT_MCP_COMPAT=chrome-devtools` to bypass envelope wrapping and restore
  0.1.x raw payloads (backward-compat for chrome-devtools-mcp consumers).

- 08e519a: feat(mcp): TOTP auto-splice in build_attach_url (#310)

  When `AIT_DEBUG_TOTP_SECRET` is set, `build_attach_url` now automatically generates the current TOTP code and splices `at=<code>` into the returned `attachUrl`. The response also includes a `totp` field with `enabled`, `ttlSeconds`, and `expiresAt` so callers know when to re-invoke for a fresh code.

## 0.1.45

### Patch Changes

- dc726cf: dev-mode MCP server에 `list_pages`, `get_diagnostics`, `measure_safe_area`, `call_sdk` 도구를 추가하고, CDP 의존 도구들에 tier-filter error를 반환해 "Unknown tool" 실패를 제거한다 (#305).
- cd60044: MCP tool descriptions, error messages, and docs polished for faster agent onboarding (M1.5 patch bundle #311).

  Key changes: `get_diagnostics` response gains `nextRecommendedAction` field with deterministic branch rules (tunnel-down → restart, no-pages relay → build_attach_url, crash → re-attach); error messages for `pageMissingError`, `sdkAbsentError`, and `tierRejectionError` now include exact recovery commands; `evaluate`/`call_sdk` descriptions add explicit secret-safety warnings; `take_screenshot` clarifies it is the only image-returning tool; `build_attach_url` default polling timeout updated to 30 s with retry guidance; `list_pages` description adds `tools/list_changed` notification hint; `get_diagnostics` description notes dev-mode limitation; `docs/scenarios/env-{1,3,4}.md` and `docs/qa/scenarios.md` now consistently show `MCP_ENV=relay` for on-device sessions and document the `--mode=dev` vs `--mode=local` selection criteria; README MCP section tables and config examples updated to match.

- 411e67e: fix(mcp): expose `build_attach_url` on first `tools/list` in debug-relay mode

  debug-mode MCP server now passes a caller-stated `defaultEnv: 'relay'` to
  `getEnvironment()` (precedence step 3), so a fresh session with no `MCP_ENV`
  and no attached target advertises Tier B `build_attach_url` from the very
  first `tools/list` — resolving the M2-5 dead-lock where the agent saw the
  tool hidden, concluded "this MCP doesn't support env 3/4", and gave up.

  The env decision still respects `MCP_ENV` (precedence 1) and the CDP URL
  pattern (precedence 2). Local-target debug mode keeps `defaultEnv: 'mock'`
  because no relay tunnel exists there. RFC #277 Tier A/B/C semantics are
  unchanged.

- 6823c6c: feat(mcp): split relay into relay-dev/relay-live with LIVE side-effect guard (#307)

  `McpEnvironment` 타입을 `'mock' | 'relay-dev' | 'relay-live'`로 확장하고,
  `relay-live` 환경에서 `call_sdk`/`evaluate` 호출 시 `confirm: true` 미명시 시 명시적 거부한다.

  Backward compat: `MCP_ENV=relay`는 `relay-dev`로 폴백, `filterToolsByEnvironment`/`isToolAvailableIn`은 두 relay 변형을 모두 허용, `get_diagnostics` 응답에 legacy `env` 필드 유지.

- ca6572c: feat(mcp): --force flag for server-lock takeover + clear conflict guidance

  두 번째 `devtools-mcp` spawn 시 stderr에 기존 세션의 PID·wssUrl·startedAt과
  회복 명령(`kill <pid>` 또는 `devtools-mcp --force`)을 출력합니다.

  `--force` (alias `--takeover`) 플래그를 추가하면 기존 세션에 SIGTERM → 2s 대기 →
  SIGKILL을 보내고 lock을 takeover합니다. stale lock(dead PID) 자동 회수는 기존과
  동일하게 유지됩니다. `ServerLockConflictError`에 `existingStartedAt` 필드를 추가했습니다.

## 0.1.44

### Patch Changes

- d86c3ae: feat(mcp): add `get_diagnostics` tool — single-call server status snapshot (#286)

  Returns mcpVersion, devtoolsVersion, tunnel state, list_pages result, lastAttachAt/lastDetachAt, recent server-side errors (PII/secret redacted), environment + reason, and serverLockHolder in one call. Tier C (both mock and relay). Bootstrap tier — available before any page attaches.

- 0ece9b7: feat: JSON line server log + allowlist-based secret redact (#287)

  - `src/mcp/log.ts` — structured JSON-line logger (`logInfo`/`logWarn`/`logError`) with event categories: `server.start`, `tunnel.up`, `tunnel.down`, `page.attached`, `page.detached`, `page.crashed`, `tool.call`, `tool.error`
  - Allowlist field filter + value-level secret redact (TOTP 6-digit, Deploy Key `aitcc_` prefix, cookie values, WSS relay URLs)
  - `debug-server.ts` and `chii-connection.ts` core paths migrated from free-form `process.stderr.write` to structured logger
  - Unit tests in `src/mcp/__tests__/log.test.ts` covering redact matrix and JSON-line output contract

- 8385204: MCP tool 거부/에러 응답을 한국어 "원인 + 다음 행동" 포맷으로 통일하고, tunnel 미가동·page 미attach·page crash·SDK 부재 4상태를 차별화.
- 12183cb: test: 4-scenario QA checklist + fidelity-qa parity snapshot (#291)

  - docs/qa/scenarios.md: 4 시나리오 수동 QA 체크리스트 (진입 절차/검증 명령/예상 응답/실패 처리/acceptance 매트릭스)
  - scripts/fidelity-qa/probes/scenario-parity.ts: list_pages / measure_safe_area / call_sdk(getOperationalEnvironment) 3종 schema parity probe 추가
  - --scenario-parity CLI 플래그로 활성화; WSS_URL 없으면 CI-safe mock-only 자동 downgrade
  - whitelist.json에 3종 scenario-parity probe의 의도된 diff (source, sdkInsetsSource, userAgent, environment) 등록

- 4bfdc45: fix: QR open in browser reliability + headless fallback (#288)

  - `open_in_browser=true`인데 GUI 없는 환경(headless/remote)이면 자동으로 text QR fallback으로 폴백 + 안내 메시지
  - 브라우저 열기 실패 시 `openResult: { attempted, succeeded, failureReason?, pngUrl? }` 구조화 필드를 응답에 포함해 에이전트가 실패 원인 파악 가능
  - `openQrInBrowser` retry 1회 추가 (ephemeral process launch 타이밍 문제 대응)
  - `canOpenBrowser()` 결과를 요청당 1회만 평가해 일관성 보장
  - 기존 `브라우저 자동 열기에 실패했습니다` 안내에 `[open_in_browser]` prefix 추가로 구분

- 2f5654b: docs: user-perspective README + 4-scenario quickstart (#289)
- ecb5a6e: feat: tunnel drop recovery — periodic health probe + auto-reissue (#290)

  cloudflared quick tunnel은 수 시간 후 drop될 수 있어, drop 시 다음 호출에서
  timeout으로만 드러나 사용자가 원인을 알 수 없었음.

  - `startTunnelHealthProbe`: 60초 간격 HTTP HEAD probe로 tunnel 생사 확인
  - 2회 연속 실패 시 새 tunnel 자동 재발급 (옵션 A 채택)
  - 재발급 성공 시 새 wssUrl로 attach 배너 재출력, 사용자에게 재스캔 안내
  - 3회 재발급 모두 실패 시 permanent drop으로 마킹 (`droppedAt` 설정) +
    서버 재시작 안내
  - `TunnelStatus`에 `droppedAt` / `reissueAttempts` 필드 추가 →
    `list_pages` 응답에 drop 상태 노출
  - `makeTunnelStatus` 헬퍼로 TunnelStatus 생성 일원화

## 0.1.43

### Patch Changes

- 510abce: feat(mcp): attach 시 Chrome DevTools 자동 open (#282)

  relay attach(환경 2·3·4) 감지 시 Chrome DevTools frontend URL을 조립하여 OS 기본 브라우저로 자동으로 엽니다.

  - `chrome-devtools-frontend.appspot.com`에 `?wss=<relay>&panel=console` 파라미터로 연결
  - 환경 1(로컬 브라우저 mock)에서는 자동 open 비활성 — F12가 이미 사용 가능
  - `AIT_AUTO_DEVTOOLS=0` 환경변수로 opt-out 가능
  - 동일 세션에서 중복 open 방지 (한 번만 실행)
  - 브라우저 open 실패 시 stderr에 URL 출력하여 수동 복사 가능

  PWA(WebKit) caveat: Chii CDP shim이 WebKit에서 동작하므로 DevTools가 연결되지만 Network·Layers 등 일부 패널은 WebKit runtime 제약으로 데이터가 비어 보일 수 있습니다.

## 0.1.42

### Patch Changes

- dad13a3: iPhone 15 Pro landscape safe-area 실측값 반영(#198/#232).

  - iPhone 15 Pro preset에 landscape bottom inset 20 추가 + provenance `measured` 승급 (2026-05-28, portrait + landscape 양쪽 실측).
  - `computeSafeAreaInsets` iPhone landscape 분기를 좌우 대칭으로 수정 — CSS env()와 SDK SafeAreaInsets 모두 `left=right=notchInset` (relay 세션 ground truth).
  - `landscapeSide` 필드 + Panel UI select + state default 제거 (잘못된 mental model).

- 333f0c1: MCP tool surface fidelity (#277): 환경 감지 SSoT + Tier A·B 필터링 + measure_safe_area mock 실측화.

  - `src/mcp/environment.ts` 신규 — `MCP_ENV` 환경변수 → CDP target URL 패턴 → default mock 의 3단 우선순위로 단일 함수가 환경 결정.
  - `src/mcp/tools.ts` 도구 declaration 에 `availableIn` 필드 추가 (Tier A 'mock', Tier B 'relay', Tier C 'both'). `tools/list` 가 환경에 맞는 도구만 노출하고, 호출 시 환경 불일치면 reason 을 담은 tool-result error 로 거부.
  - `measure_safe_area` 가 양쪽 환경에서 같은 `Runtime.evaluate` probe 를 돌리고, 결과 wrapper 에 `source: 'mock' | 'relay'` 를 함께 반환 (Tier B→C 승격).

- 983efc7: MCP attach 신뢰성 개선 + 4 시나리오 acceptance 문서화 (#281)

  - `ChiiCdpConnection.waitForFirstTarget()` 추가: `refreshTargets()` 및 첫 inbound CDP 메시지 양쪽 이벤트를 감지해 `wait_for_attach` polling race 제거
  - `list_pages` stale 캐시 수정: `ChiiCdpConnection` 환경에서 매 호출 시 `/targets` refresh
  - MCP server disconnect 에러 메시지 개선: relay 끊김과 "page 미부착" 오류를 구별해 재연결 방법 명시
  - `docs/scenarios/env-{1,2,3,4}.md` 시나리오별 acceptance 절차 문서화
  - `docs/mock-fidelity-catalog.md`에 4 시나리오 MCP tool 응답 diff snapshot 추가

- b07876d: partner safe-area 모델 정정 — 실기기 fidelity 맞춤(#275).

  - `computeSafeAreaInsets` portrait top=0으로 정정. 토스 native nav bar는 partner WebView viewport 밖이라 SDK top=54는 정보용 — 소비자가 padding으로 적용하면 double-count. mock도 top=0을 반환해 실기기와 같은 결과를 낸다.
  - `applyViewport` body `padding-top` 주입 제거. 실기기 WebView는 top=0부터 콘텐츠 시작.
  - `computeSafeAreaInsets` 시그니처에서 `navBarVisible`/`navBarType` 파라미터 제거 (top이 0 고정이라 불필요).
  - iPhone 15 Pro preset `height` 852→754. 실측: partner type innerHeight=754(native chrome 98pt가 WebView 바깥).
  - fidelity-QA whitelist의 safe-area 항목 reason 갱신.

- 51d7430: debug server에 singleton lock 추가 — 동시에 두 번째 `devtools-mcp` 프로세스를 시작하면 명시적 에러(PID + wssUrl)를 출력하고 즉시 종료. SIGKILL로 죽은 stale lock은 PID alive 검사로 자동 회수. graceful shutdown 시 lock file + cloudflared 자식 cleanup.

## 0.1.41

### Patch Changes

- cb9e470: fix(mcp): call_sdk 인자 시그니처 검증 — 잘못된 인자로 인한 토스 앱 crash 예방 (#264)
- 35537dd: fix(mcp): CDP sendCommand에 per-command timeout(기본 30s) + WebSocket 끊김 시 pending reject 추가 (#252)
- 57dd111: feat(mcp): Runtime.exceptionThrown ring buffer + list_exceptions tool (#267)
- e999b0c: fix: build_attach_url이 qrHttpServer 시작을 await하지 않아 첫 호출 race로 unicode QR fallback이 트리거되던 버그 수정.
- 230d7f9: fix(mcp): page crash 감지 — Inspector.targetCrashed / Target.targetDestroyed / Target.detachedFromTarget CDP 이벤트 구독 + per-target lastSeenAt 추적 + opt-in heartbeat (AIT_CDP_HEARTBEAT_MS). list_pages 응답에 crashDetectedAt / crashWarning / lastSeenAt 필드 추가.
- 53340f4: 단일 미니앱 attach 모델 도입 — last-attach wins. 새 page가 relay에 attach되면 이전 page 세션을 자동 교체(pending 명령 reject + `replaced` lifecycle 이벤트). `list_pages`는 배열을 유지하되 항상 0-1 항목이며 `singleAttachModel: true` 필드로 명시.

## 0.1.40

### Patch Changes

- f45c24f: fix(mcp): measure_safe_area probe가 window.\_\_sdk.SafeAreaInsets.get()과 getSafeAreaInsets() 경로를 올바르게 호출하도록 수정. SDK 호출 실패 시 sdkInsetsError 필드로 명시 (silent null 제거). navBarHeightSource 필드 추가.

## 0.1.39

### Patch Changes

- 4f0542a: build_attach_url: file:// tmp 파일 대신 로컬 HTTP 서버(127.0.0.1) 기반 QR 페이지 서빙 + platform별 fallback chain browser open + 일본어 응답 텍스트 한국어 통일

## 0.1.38

### Patch Changes

- 6984706: `devtools-mcp` bin이 npx/npm bin shim symlink로 실행되면 entrypoint 감지 실패해 MCP server가 기동조차 안 하던 회귀 fix — `argv[1]`을 `realpathSync`로 정규화 후 `import.meta.url`과 비교
- 6984706: MCP `initialize` 응답을 cloudflared 부팅과 분리 — tunnel을 background로 띄워, 첫 spawn에 cloudflared 바이너리(~38 MB) lazy download가 걸려도 Claude Code MCP connection timeout을 치지 않는다

## 0.1.37

### Patch Changes

- 1d366a8: `devtools-mcp` bin이 npx/npm bin shim symlink로 실행되면 entrypoint 감지 실패해 MCP server가 기동조차 안 하던 회귀 fix — `argv[1]`을 `realpathSync`로 정규화 후 `import.meta.url`과 비교

## 0.1.36

### Patch Changes

- a8f5a05: MCP 단독 사용자 install 분 단위 → 6초 — `@apps-in-toss/web-framework` peer를 optional로 (mock SDK 사용자 신뢰성은 본인 import가 빌드 단계에서 강제하므로 손상 없음)

## 0.1.35

### Patch Changes

- 998e395: build_attach_url: tool result가 이미 사용자에게 보이므로 QR 재출력 지시 제거(토큰 절감)
- bb8962d: npx 콜드 install 시 ajv 트리 누락으로 인한 MCP server 시작 실패 fix — `ajv@^8.17.1`을 본인 dependency로 명시
- bee1c8e: build_attach_url: QR PNG + 브라우저 열기(open_in_browser), scheme host authority 검증 추가
- 2794f74: safe-area provenance 패널 뱃지 + catalog 정정 + 측정 절차 문서화 (#198)

## 0.1.34

### Patch Changes

- bd5d8f9: build_attach_url: ANSI 없는 유니코드 half-block QR + wait_for_attach 옵션 + 에이전트에게 QR 표시 지시

  - `renderQr`를 `qrcode-terminal`(ANSI invert 코드 포함)에서 `qrcode` 풀 라이브러리 기반 순수 유니코드 half-block QR로 교체 — 어느 렌더러에서도 깨지지 않고 폰 카메라로 스캔 가능
  - `build_attach_url`에 `wait_for_attach` boolean 인자 추가: `true`이면 QR 반환 후 폴링으로 page attach까지 블로킹(최대 90s), attach되면 page 정보 포함 반환, timeout이면 `list_pages` 재확인 안내와 함께 isError
  - tool description과 응답 텍스트 머리에 "IMPORTANT: Show this QR to the user verbatim" 지시 추가 — 에이전트가 QR을 요약/생략하지 않고 그대로 출력하게 하는 안전장치

- 6438874: fix(mcp): relay 기본 포트를 0(OS 할당)으로 변경해 -32000 EADDRINUSE 재발 차단

  SIGKILL로 즉사한 부모의 cloudflared 자식(PPID 1 orphan)이 고정 포트 9100을
  점유하면 다음 재연결 시 EADDRINUSE → MCP 핸드셰이크 -32000으로 실패했다.
  port 0(기본값)으로 OS가 매 기동마다 빈 포트를 배정하게 해 충돌을 원천 차단한다.

  추가로 SIGHUP, uncaughtException, unhandledRejection, exit 핸들러에도
  shutdown을 등록해 가능한 경로에서 cloudflared 자식을 정리한다(멱등성 가드 포함).

## 0.1.33

### Patch Changes

- 179b466: feat(mock): 광고 더미 fidelity — TossAds 콜백 발화 + destroy 누수 수정 + 인터랙티브 패널 컨트롤 (#196)

  slot 레지스트리로 placeholder를 추적해 `destroy`/`destroyAll`/반환 `destroy`가 실제 엘리먼트를 제거한다(누수 수정). `attachBanner`의 `BannerSlotCallbacks`와 `initialize` 콜백을 결정론적으로 발화하고, AdMob reward의 하드코딩을 `state.ads.rewardUnitType`/`rewardAmount`로 파라미터화한다. 패널 Ads 탭에 콜백 결과(loaded/no-fill/reward/dismissed/clicked/failed)·배너 인터랙티브 컨트롤 추가. 시그니처는 SDK 계약 그대로 보존.

- bc6ca6d: feat(mock): haptic 관측 강화 — navigator.vibrate 매핑 + 패널 가시화 (#197)

  `generateHapticFeedback` 10종 타입을 `navigator.vibrate` 패턴으로 best-effort 매핑하고, `sdkCallLog`에 🟡(partial)로 기록한다. 패널 Device 탭에 마지막 haptic 행과 10종 트리거 버튼 추가.

- 179b466: feat(relay): relay attach TOTP 인증 (relay-side 권위 관문 + in-app gate fail-fast) (#194)

  `AIT_DEBUG_TOTP_SECRET`이 설정되면 relay-side(Node)가 모든 attach upgrade를 RFC 6238 TOTP로 검증한다 — chii.start() 전에 등록한 upgrade 리스너가 권위 있는 관문이고, in-app gate Layer C3은 2차 fail-fast다. 위협 모델은 tunnel URL 유출자 차단으로 한정. 시크릿·코드값은 로그/배너/gate-reason에 출력하지 않는다.

- a752893: feat(mcp): measure_safe_area 툴 추가 + ViewportPreset provenance 필드

  - CdpCommandMap에 Runtime.evaluate 타입 추가 (예고된 확장 지점 실현)
  - measure_safe_area MCP 툴: relay 실기기에서 safe-area 프로브 실행 후 정규화 반환
  - ViewportPreset에 safeAreaProvenance 필드 추가 (measured/extrapolated/placeholder)
  - 패널 Viewport 탭에 추정치/미측정 뱃지 렌더링
  - catalog stale 정정: default top 47→54, iPhone 15 Pro preset 상태 정정

- 179b466: feat(mock): sdkCallLog 관측 layer + no-op API 일괄 가시화 (#195)

  `aitState`에 구조화된 `sdkCallLog` slice(ring buffer, 상한 200)와 `logSdkCall`을 추가하고, 시그니처를 보존하는 `observe(apiName, fidelity, fn)` 래퍼를 도입한다. MCP `AIT.getSdkCallHistory`가 이 로그를 실제 데이터 소스로 읽는다. proxy는 기본 throw를 유지하되 `KNOWN_UNIMPLEMENTED` 이름만 🔴(inert) 기록 후 no-op 반환한다. 패널 Analytics 탭에 fidelity 뱃지(🟢/🟡/🔴) SDK Calls 뷰 추가.

## 0.1.32

### Patch Changes

- 569caa1: feat: add iPhone 15 Pro viewport preset, emulate device characteristics for active presets, correct the safe-area model to relay-measured ground truth, and mirror SDK no-op navigation APIs to observable state

  The Viewport tab now offers an iPhone 15 Pro preset (393×852, DPR 3, Dynamic Island) — a common device that had no exact match in the list (the closest, iPhone 17 at 402×874, has a different CSS viewport).

  The safe-area model is corrected to match relay measurement of a real iPhone 15 Pro (sandbox, `partner` WebView, portrait): `env(safe-area-inset-top)` is 0 (the OS notch stays outside the WebView viewport) and `SafeAreaInsets.get().top` is 54 — the Toss host's top nav bar height, _not_ the notch. The previous model double-counted: it treated the OS notch (59) as the SDK top inset and then added a separate 48px nav bar. `ViewportPreset` now splits these into two fields: `notchInset` (device-specific OS notch, used only for the landscape side inset and to position the visual notch overlay) and `navBarHeight` (device-independent host nav bar = 54 for a `partner` WebView). For a `partner` portrait WebView the SDK top inset is the nav bar height; a `game` WebView is a transparent overlay that does not push content (top 0); when the nav bar is hidden, top is 0. The default `safeAreaInsets` top is now 54 (was 59) so `SafeAreaInsets.get()` matches a `partner` app out of the box. Measured on iOS `partner`; Android values are provisional and `external` is not simulated.

  The simulator layout now matches that stack instead of painting over it: the nav bar sits at the WebView (body) top (0), a `partner` WebView pushes content down by the SDK top inset (so app content starts below the nav bar, as on device), and the visual notch overlay is drawn in a reserved status-bar strip _above_ the WebView (matching `env(safe-area-inset-top)` = 0). Previously the nav bar was offset by the notch inset and painted over the content top.

  When a device preset is active (i.e. not `none`/`custom`), the browser characteristics now follow that device so the simulated frame is coherent: `navigator.userAgent` (Toss WebView shape — `… AppsInToss TossApp/<appVersion>`), `navigator.platform`, `window.devicePixelRatio`, `screen.width/height`, and the `platform` that `getPlatformOS()` reads (Apple→`ios` / Galaxy→`android`) are all overridden to the preset's device. Selecting `none`/`custom` reverts to the host environment. Note: these overrides only change values JS reads — real CSS media queries, touch events, and engine-level layout stay at host-browser values (use Chrome DevTools device-mode for pixel-exact emulation).

  `setIosSwipeGestureEnabled` — which in the real Toss WebView fires over the native bridge and was previously an inert console-log — now mirrors its last call value into an observable `navigation.iosSwipeGestureEnabled` state slice (`null` until first called). The Environment tab gains a read-only Navigation section showing this value, so a `getOperationalEnvironment() === 'toss'`-gated guard (e.g. an app's `useDisableIosSwipeGestureInToss`) can be exercised in the browser by switching Environment to `toss` and watching the value flip — verifiable via the panel or `AIT.getMockState()`.

## 0.1.31

### Patch Changes

- 405600c: fix: `devtools-mcp` bin no longer ships a doubled shebang

  The `mcp/cli` build entry emitted `#!/usr/bin/env node` twice — once from the source file and once from the tsdown `banner` — so the published bin failed to start with `SyntaxError: Invalid or unexpected token` on line 2. This made both `devtools-mcp` (debug) and `devtools-mcp --mode=dev` unrunnable. The shebang now comes from the banner only, and a build-output test guards against the regression.

## 0.1.30

### Patch Changes

- 090d02f: SDK 2.6.0 지원: openPDFViewer·fetchAlbumItems mock 추가

## 0.1.29

### Patch Changes

- 214344d: feat(in-app): add Layer B1 host allowlist to the runtime debug gate

  The runtime gate now requires the page to be served from a
  `*.private-apps.tossmini.com` host before any debug attach is considered.
  A production `intoss://` entry is served from `*.apps.tossmini.com` (no
  `.private-apps.` segment) and is now rejected with `reason: 'host'`.

  This closes a gap: Layer A keeps debug code out of release bundles, but a
  dogfood build that somehow lands on a production entry still had its code
  present. Layer B1 stops that build from attaching on a production host.

  A live CDP probe of dogfood mini-app 31146 confirmed the host is the only
  usable signal — `getSchemeUri()` normalises `intoss-private://` to
  `intoss://`, and `getOperationalEnvironment()` / `getWebViewType()` return
  the same value (`"toss"` / `"partner"`) for dogfood and production entries.

  `GateInput` gains a required `hostname` field; `checkDebugGate()` fills it
  from `window.location.hostname`, so consumers calling it with no arguments
  need no change. New export: `isPrivateAppsHost`.

## 0.1.28

### Patch Changes

- df098d8: fix(in-app): remove Layer A from the runtime gate — it can never pass in a pre-built package

  `evaluateDebugGate`/`checkDebugGate` re-checked `__DEBUG_BUILD__` as "Layer A" and
  returned `reason: 'build'` when it was false. But `@ait-co/devtools` ships pre-built:
  the constant is baked at _this package's_ publish time (always `false`), so the gate
  could never pass on a consumer's phone regardless of query params — the in-app debug
  attach surface was permanently dead.

  Layer A's real mechanism is, and always was, the consumer's
  `if (__DEBUG_BUILD__) { import('@ait-co/devtools/in-app') }` guard, where
  `__DEBUG_BUILD__` is a _consumer_-build-time constant that DCEs the import from
  release bundles. The gate function now evaluates only the runtime layers B
  (`_deploymentId`) and C (`debug=1` + valid `wss:` relay). `GateInput.isDebugBuild`
  and the `'build'` blocked-reason are removed.

## 0.1.27

### Patch Changes

- 3380102: Add `build_attach_url` debug MCP tool: splices `debug=1` + the session's live relay URL into an `ait deploy --scheme-only` deep link so opening it on a phone auto-attaches to the Chii relay with no QR scan or paste. This removes the human-in-loop attach step; the in-app gate already reads the `relay` query param, so the deep link triggers attachment on entry.

## 0.1.26

### Patch Changes

- 6089639: chore: add pnpm-workspace.yaml so sharp/esbuild build scripts run on fresh installs

  `sharp` (used by the OG-image build) and `esbuild` had their postinstall build scripts silently ignored under pnpm 10 because no `onlyBuiltDependencies` allowlist existed. Add `pnpm-workspace.yaml` listing them (and ignoring `@sentry/cli`/`@swc/core`/`protobufjs`), matching the org standard.

## 0.1.25

### Patch Changes

- 1cd518b: fix: remove stdout/stderr listeners on all tunnel exit paths; soften misleading attach-token banner wording; correct CLAUDE.md panel tab list (9→12)

  - `src/unplugin/tunnel.ts`: extract a shared `cleanup()` that calls `tunnel.off('stdout', onUrl)` + `tunnel.off('stderr', onUrl)`, and call it from every exit path — resolve, error handler, exit handler, and the 20 s timeout — so persistent listeners are never left on a stopped process.
  - `src/mcp/tunnel.ts`: replace "secret token used to gate attach" / bare `token:` label with "attach token (pairing hint — relay-side validation lands in a later phase)", matching the existing code comment that ACL enforcement is a future phase.
  - `CLAUDE.md`: update tabs list from 9 to the actual 12 tabs (adds presets, notifications, ads).

## 0.1.24

### Patch Changes

- a1552be: Fix double `res.end()` in the unplugin dev-middleware POST handler. On the
  invalid-JSON path the catch block already ended the response, then a trailing
  `res.end()` ran again and threw `ERR_STREAM_WRITE_AFTER_END`. The success
  response now ends inside its own branch so each path ends the response exactly
  once.

## 0.1.23

### Patch Changes

- e42730a: debug-mode MCP transport을 `devtools-mcp` bin에 추가 (Debugging MCP Phase 1).

  단일 `devtools-mcp` 진입점이 `--mode`로 transport을 분기합니다. 기본(debug) 모드는
  로컬 Chii 릴레이 + cloudflared quick tunnel을 띄워 폰 안 미니앱에 CDP로 attach하고,
  `list_console_messages` / `list_network_requests` / `list_pages` 세 read-only tool을
  `chrome-devtools-mcp` 호환 형태로 노출합니다. `--mode=dev`는 기존 dev-server mock state
  surface(`devtools_get_mock_state`)를 그대로 사용합니다.

  CDP 연결은 주입 가능한 `CdpConnection` 인터페이스 뒤에 있어 tool 계층이 mock으로
  단위 테스트됩니다. 폰 attach 라운드트립은 실기기 검증이 필요해 후속 phase로 분리.

- b8c093f: debug-mode MCP에 DOM/스냅샷/스크린샷 + AIT 도메인 tool 추가 (Debugging MCP Phase 2·3).

  Phase 2 — CDP 커맨드(요청→응답) 기반 read-only tool 3개: `get_dom_document`(`DOM.getDocument`),
  `take_snapshot`(`DOMSnapshot.captureSnapshot`), `take_screenshot`(`Page.captureScreenshot`,
  PNG를 MCP image content block으로 반환). Phase 1의 이벤트 스트림과 달리 요청→응답이라
  `CdpConnection`에 `send(method, params)`를 추가했습니다.

  Phase 3 — CDP가 못 잡는 영역을 위한 AIT 도메인 tool 3개: `AIT.getSdkCallHistory`,
  `AIT.getMockState`, `AIT.getOperationalEnvironment`. debug 모드에서는 Chii 채널로,
  dev 모드에서는 dev server의 mock-state HTTP endpoint로 같은 tool surface를 노출합니다.
  dev 모드(`devtools-mcp --mode=dev`)가 이제 `AIT.*` tool을 노출하며,
  기존 `devtools_get_mock_state`는 `AIT.getMockState`의 하위호환 alias로 유지됩니다.

  모든 tool은 주입 가능한 `CdpConnection` / `AitSource` 뒤에 있어 fake로 단위 테스트됩니다.
  폰 attach 라운드트립(실기기 검증)은 후속 phase로 분리되어 있고, tool 계층은 CI에서 검증됩니다.

- 57bef90: feat(in-app): wire Chii target.js injection — Phase 1 browser-side attach (gate → script inject)
- a46c1ae: feat(in-app): add 3-layer debug activation gate — Phase 1 of Debugging MCP Server (spec 2026-05-18)
- e7e6950: feat(mcp): add stdio MCP server spike with `devtools_get_mock_state` tool

  Adds a minimal MCP (Model Context Protocol) server that exposes the live browser
  mock state to AI coding agents. This is a spike implementation to validate the
  surface and establish the extensibility pattern before adding more tools.

  **What's included:**

  - `src/mcp/server.ts` — Node.js stdio MCP server (`dist/mcp/server.js`)
    Implements `devtools_get_mock_state` tool: fetches a JSON snapshot of the
    current `AitDevtoolsState` from the Vite dev server endpoint.
  - Unplugin option `mcp: true` — registers `GET /api/ait-devtools/state` and
    `POST /api/ait-devtools/state` on the Vite dev server (no-op for other
    bundlers).
  - Panel auto-push — on every `aitState` change the panel silently POSTs the
    current state to the endpoint (fire-and-forget, only active when the endpoint
    exists).

  **Usage:**

  ```js
  // vite.config.ts
  import aitDevtools from "@ait-co/devtools/unplugin";
  export default { plugins: [aitDevtools.vite({ mcp: true })] };
  ```

  ```json
  // MCP client config (e.g. Claude Desktop / Claude Code)
  {
    "mcpServers": {
      "ait-devtools": {
        "command": "node",
        "args": ["node_modules/@ait-co/devtools/dist/mcp/server.js"],
        "env": { "AIT_DEVTOOLS_URL": "http://localhost:5173" }
      }
    }
  }
  ```

  The `AIT_DEVTOOLS_URL` env var defaults to `http://localhost:5173`.

- be23475: docs/config: 2026-05-19 refactor sweep — iPhone Air (est) 라벨에서 (est) 제거 (2026-04 출시 확정), CLAUDE.md 탭 수 9→12 정정, README build tool tsup→tsdown 수정, biome.json·vitest.config.ts에서 .claude/ 워크트리 제외

## 0.1.22

### Patch Changes

- b8c7e92: launcher의 정적 설치 안내 카드를 `@khmyznikov/pwa-install` Web Component로 교체했습니다. "Install launcher to your phone" 버튼 하나로 Android Chrome 인앱 프롬프트, iOS Safari "공유 → 홈 화면에 추가" 일러스트, Firefox/Samsung Internet 수동 안내까지 플랫폼별 네이티브 흐름이 자동으로 안내됩니다 — `beforeinstallprompt` 직접 처리나 플랫폼 분기 코드 없이.

  Replace the launcher's hand-rolled install hint card with the `@khmyznikov/pwa-install` Web Component. A single "Install launcher to your phone" CTA now triggers the platform-native flow automatically — Android Chrome's in-app install prompt, iOS Safari's Share → Add to Home Screen illustration, and Firefox/Samsung Internet's manual instruction card — without us needing to handle `beforeinstallprompt` or branch on user-agent ourselves.

## 0.1.21

### Patch Changes

- bbf2659: launcher PWA를 홈 화면 설치 상태에서만 동작하도록 게이팅하고, 터널 QR을 `…/launcher/?url=<tunnel>` 딥링크로 인코딩해 스캔 한 번으로 자동 진입하도록 변경했습니다. 로컬 dev(`http://localhost`)에서는 게이팅이 풀려 e2e 픽스처가 그대로 동작합니다.

  Gate the launcher PWA to its installed home-screen context (browser-tab visitors now see only the install hint, with the input and scanner hidden) and encode the tunnel QR as a `…/launcher/?url=<tunnel>` deep-link so a single scan auto-opens the dev URL. The gate is relaxed on `http://localhost` so the bundled e2e fixture keeps working in a normal tab.

## 0.1.20

### Patch Changes

- 38db1ce: docs(fixture): SEO/AEO on devtools.aitc.dev — JSON-LD, canonical, sitemap, llms.txt

  Make the live fixture demo (`devtools.aitc.dev`) discoverable:

  - `e2e/fixture/index.html`: descriptive title, meta description, canonical,
    Open Graph + Twitter Card meta with og:image, and a `SoftwareApplication`
    JSON-LD block listing the SDK mock + multi-bundler unplugin + DevTools
    panel.
  - `e2e/fixture/launcher/index.html`: `noindex,nofollow` (the launcher is a
    user-only PWA chrome, not a search target).
  - `e2e/fixture/public/{robots.txt,sitemap.xml,llms.txt}`: standard SEO
    surface + `llmstxt.org` overview for AI answer engines. AI crawlers
    (GPTBot, ClaudeBot, anthropic-ai, PerplexityBot, Applebot-Extended)
    explicitly allowed per org policy; `/launcher/` excluded from crawls.
  - `e2e/fixture/public/og/image.png`: 1200×630 OG image.

- 697870f: feat(telemetry): multi-tier consent — Tier 0 panel-mount ping + Tier 1 retained

  Tier 0 opt-out daily ping (panel mount, fire-and-forget, no anon_id). Tier 1 events
  retain existing behaviour with explicit `tier: 1` field. policy_version bumped to
  `2026-05-18`; existing granted users regress to undecided for re-consent.

- 41add94: docs(npm): add npm/license badges, expand keywords, refresh homepage

  - README.md / README.en.md: add npm version + license badges below the
    lang toggle, move "Reference consumer" section below Install so first-
    paint shows the install command.
  - package.json: extend `keywords` (`miniapp`, `simulator`, `testing`,
    `vite-plugin`, `webpack-plugin`) for better npm discovery; point
    `homepage` at https://devtools.aitc.dev/ instead of the npm page so
    the registry "homepage" link goes to the live demo.

## 0.1.19

### Patch Changes

- aef97d8: feat(panel): full ko/en internationalization

  DevTools panel and consent toast now render in Korean or English based on `navigator.language` (`/^ko\b/i` → ko, else en), persisted under `localStorage['__ait_locale']`. Environment tab gains a Language toggle; switching locales remounts the panel via the new `__ait:localechange` event. Strings are sourced from a typed catalog under `src/i18n/`; missing keys fall back to the key string. Internal devtools chrome (Load / Show / Clear / Apply / Lat / Lng / Send / Cancel) is intentionally left in English in both locales.

- 7ed86f5: unplugin: add a `tunnel` option (Vite dev only) that exposes the dev server via a
  Cloudflare quick tunnel (`*.trycloudflare.com`, no account) and prints the public
  URL + an ASCII QR in the terminal. Pair it with the new launcher PWA at
  `https://devtools.aitc.dev/launcher/` to run the dev app full-screen on a real
  phone — scan/paste the URL once per session; the launcher remembers the last URL.
  `cloudflared` / `qrcode-terminal` are loaded only when the option is on. While
  the tunnel is active the plugin also adds `.trycloudflare.com` to Vite's
  `server.allowedHosts` so the random per-run hostname isn't rejected. See
  "Run on a real phone" in the README.

## 0.1.18

### Patch Changes

- d93ff39: Galaxy S26 시리즈가 2026-03-11 출시되어, viewport preset의 width/height를 phone-simulator.com 측정치(S26 360×773, S26+ 480×1040, S26 Ultra 480×1040, 모두 DPR 3)로 갱신했습니다. 라벨에서 `(S25 fallback)` 접미사가 제거됩니다. safe area insets는 토스 호스트 환경 실측 전까지 S25 값을 잠정 사용합니다.

## 0.1.17

### Patch Changes

- 602a60a: fix(telemetry): use `__VERSION__` compile-time define directly so events carry the actual package version

  `getVersion()` was reading `globalThis.__VERSION__` at runtime, but tsdown's
  `define` substitutes `__VERSION__` at build time (it is not a real global).
  Result: every telemetry event sent `"version":"0.0.0"` instead of the actual
  package version. Switched to a direct `__VERSION__` reference — the same
  pattern the panel header already uses — so the substitution applies.

## 0.1.16

### Patch Changes

- e3bb8e8: Fix telemetry "내 데이터 삭제" button + the 30-day re-prompt after "No, thanks":

  - `deleteMyData` was calling `DELETE https://t.aitc.dev/?anon_id=…` (missing `/e`). Now hits `DELETE /e?anon_id=…` and rotates the local `anon_id` to a fresh UUID on success so future events are unlinkable from deleted history.
  - `shouldShowToast` only re-prompted when consent was `undecided`, so users who picked "No, thanks" never saw the toast again. It now re-prompts denied users once when `reprompt_after` (30 days, or version-bump) has elapsed, and respects `MAX_SAFE_INTEGER` as permanent silence after a second decline.

## 0.1.15

### Patch Changes

- 8ec6337: Add Notifications panel tab for toggling `requestNotificationAgreement` mock result (`newAgreement` / `alreadyAgreed` / `agreementRejected`).
- b0b55c8: Add opt-in anonymous usage telemetry client. Introduces a consent state machine (granted/denied/undecided), a Korean-only bottom-right toast (requestIdleCallback / 1.5 s fallback), send-with-retry-once semantics to `https://t.aitc.dev/e`, session-duration tracking via `pagehide`/sendBeacon, and an Environment-tab Telemetry section (toggle, anon_id display, "내 데이터 삭제", privacy link). Module is panel-internal and not exported to consumers.

## 0.1.14

### Patch Changes

- 6490efa: docs(devices): mark Galaxy S26 / S26+ / S26 Ultra viewport presets as
  unreleased fallback. The dropdown label, source code comment, and README
  device table now make it explicit that these entries currently mirror the
  S25 / S25+ / S25 Ultra spec (`(S25 fallback)`) until the S26 series
  viewport spec is confirmed. Values are unchanged.

## 0.1.13

### Patch Changes

- 8a1fdfb: feat(mock): cover 3 previously-uncovered SDK APIs (getAnonymousKey,
  requestTossPayPaysBilling, requestNotificationAgreement) with proper
  mocks. requestNotificationAgreement signature is verified against
  @apps-in-toss/web-framework via \_\_typecheck.ts; the other two are not
  re-exported from the package's main entry point so their Assert is
  intentionally omitted (mocks remain available for direct deep imports
  and future SDK surface expansion).
- 70d0632: Fix dual `AitStateManager` instance bug in production builds.

  `tsdown.config.ts` builds `mock`, `panel`, and `unplugin` entries as
  self-contained config objects so Rolldown does not emit a shared chunk at
  `dist/` root. As a side effect, `state.ts` was bundled per entry, producing
  two `AitStateManager` instances when consumers imported both
  `@ait-co/devtools` and `@ait-co/devtools/panel` on the same page. The panel
  mutated one instance while the mock SDK observed the other, so toggles in
  Permissions / Presets / Network / IAP appeared to apply in the panel UI but
  had no effect on the running app.

  Fixed with a runtime guard in `src/mock/state.ts`: the `AitStateManager` is
  cached on `globalThis` under `__aitDevtoolsStateSingleton__`, so all entries
  loaded on the same page share a single instance. No build-pipeline change.

  Added two regression tests in `e2e/panel.test.ts` (Layer C):

  - `aitState is a single shared instance (not duplicated per entry)` — asserts
    `window.__ait === globalThis.__aitDevtoolsStateSingleton__` and listener
    count > 0.
  - `preset Apply changes mock state observed by fixture SDK` — applies the
    Offline preset and verifies a subsequent `iap-purchase` call from the
    fixture switches from `success:` to `error:`.

## 0.1.12

### Patch Changes

- 06bdb74: chore(deps): refresh dev dependencies (biome 2.4.15, typescript 6.0.3, vitest 4.1.5, jsdom 29.1.1) and bump `@apps-in-toss/web-framework` peer to `>=2.5.0 <2.6.0` (typecheck green against 2.5.0).

## 0.1.11

### Patch Changes

- 3660a95: feat(panel): export `disposePanel()` for explicit unmount + idempotent re-mount

  Pairs with the existing `disposeViewport()`. The panel side-effect import
  already mounts idempotently; this adds a symmetric teardown for HMR / SPA
  contexts where the panel needs to be removed without a full page reload.
  Removes the toggle, panel root, injected `<style>`, all window/aitState
  listeners, and `disposeViewport()` is called internally. Calling
  `disposePanel()` before mount or twice in a row is a no-op.

## 0.1.10

### Patch Changes

- fca317d: `devtools.aitc.dev`에 `e2e/fixture/`를 GitHub Pages로 배포합니다. 패키지 surface 변경 없음 — 빌드/배포 인프라만 추가.
- 336c447: npm landing용 정적 OG image (1장)을 빌드 시 satori + sharp으로 생성합니다. README 상단에 표시되며 GitHub social preview에 사용됩니다. API 표면 변경 없음.

## 0.1.9

### Patch Changes

- d30bb8b: devtools 패널에 mock state preset library를 추가합니다. 자주 쓰는 QA 시나리오(`permission-denied`, `offline`, `logged-out`, `iap-pending`, `ads-no-fill` 등)를 한 클릭으로 적용/해제할 수 있고, 사용자 정의 preset도 `localStorage`에 저장/불러오기 가능합니다. `applyPreset` / `builtInPresets` / `saveUserPreset` 등은 `@ait-co/devtools`에서도 export되어 코드에서 직접 호출할 수 있습니다. 기존 토글 동작은 변경 없습니다.

## 0.1.8

### Patch Changes

- 236b35c: devtools 패널에 Ads 탭을 추가해 GoogleAdMob/TossAds/FullScreenAd의 load → show → dismiss 이벤트 흐름을 패널에서 직접 trigger/관찰할 수 있습니다. IAP viewer의 짝으로 sdk-example AdsPage 디버깅이 쉬워집니다.

## 0.1.7

### Patch Changes

- 41c185f: devtools 패널 IAP 탭에 pending orders / completed orders viewer 섹션을 추가합니다. mock IAP가 발급한 주문 라이프사이클을 패널 안에서 관찰·조작할 수 있어 sdk-example IAPPage 흐름을 디버깅하기 쉬워집니다.

## 0.1.6

### Patch Changes

- 838fe13: AIT host nav bar `game` 변형을 추가했다. 기존 `partner` 변형(흰 배경 + 뒤로가기 + 앱 아이콘/이름 + ⋯/×)에 더해, `game`은 투명 배경 + ⋯/× 만 그려서 풀스크린 게임 캔버스를 가리지 않게 한다. Viewport 탭의 "Nav bar type" select로 토글 가능하며, `aitState.patch('viewport', { aitNavBarType: 'game' })`로도 변경할 수 있다. 기본값은 `partner`로 기존 동작을 보존한다.

## 0.1.5

### Patch Changes

- ae91fc3: chore(release): switch publish command to `pnpm exec changeset publish` so `changesets/action` creates GitHub Releases. Raw `npm publish` does not emit the `New tag:` lines the action parses, which silently skipped Release creation for 0.1.0–0.1.4 (npm got them, GitHub Releases page did not). No runtime behavior change.

## 0.1.4

### Patch Changes

- eb57b5f: Add device simulation (viewport presets + orientation toggle + optional frame) to the floating panel. Selection persists in sessionStorage under `__ait_viewport`.
- 1a923bf: Polish the device simulation with 2026 presets (iPhone 17 series, iPhone Air, iPhone 16e, SE 3rd gen, Galaxy S26 series, Z Flip7, Z Fold7 folded/unfolded), HiDPI metadata, auto safe-area insets, notch/Dynamic Island/punch-hole overlays, an Apps in Toss host nav bar overlay, and `setDeviceOrientation` sync with the Panel's `auto` orientation mode.
- bf0a40a: Address code-review feedback for the device simulation:

  - Fix `setDeviceOrientation` "auto" mode losing the SDK after the first call. The SDK now writes to a separate `viewport.appOrientation` field; user-controlled `viewport.orientation` stays `auto`, so the same app can rotate freely across multiple calls.
  - Add `viewport.landscapeSide` (`left` | `right`, default `left`). Notch/Dynamic Island insets now move to a single side in landscape, matching real iOS behavior instead of doubling up on both sides.
  - Apps in Toss nav bar now uses `aitState.brand.displayName` (built with `textContent`, not `innerHTML` — XSS-safe) and re-renders when the brand name changes. Back button triggers `__ait:backEvent`; close button calls `closeView()`.
  - Render the home indicator pill at the bottom of the body for devices with `safeAreaBottom > 0`.
  - `body { isolation: isolate }` so notch/navbar z-index can't paint over the floating Panel toggle.
  - Make `initViewport` idempotent (HMR / re-mount safe) and export `disposeViewport()` for consumers that dynamically tear the panel down.
  - Strict integer + clamp on custom width/height (`1 ≤ value ≤ 4096`); session-storage validation matches.
  - Tests for the Viewport tab UI branches (custom inputs, status panel, disabled state, notch-side row visibility).
  - README: document the body-scroll caveat, mark `iPhone Air` and `Galaxy S26` series as `(est)`, drop the bogus Pixel/iPad mentions, refresh the console examples and status-line strings.
  - Reorder Panel tabs so Viewport sits right after Environment (visual setup before SDK plumbing).

## 0.1.3

### Patch Changes

- 0d50bbd: fix(panel): extend fullscreen breakpoint to 720px so panel doesn't overlap mobile containers

  QA로 sdk-example을 브라우저에서 테스트하던 중, viewport 576px에서 DevTools 패널이 mobile-container(`max-w-[430px]` 중앙 정렬) 카드의 오른쪽 절반을 완전히 덮어 실행 버튼을 클릭할 수 없는 UX 이슈가 확인되었다.

  기존에는 `(max-width: 480px)`에서만 패널이 fullscreen이 되어 481~720px 구간에서 360px 폭 floating 패널이 중앙 정렬된 mobile container와 겹쳤다. breakpoint를 720px로 확장해 이 구간에서도 fullscreen으로 동작하도록 한다. 진짜 tablet 이상(768+)에선 floating 모드 유지.

  CSS 미디어쿼리와 `updatePanelPosition`의 JS 분기가 반드시 동일한 값을 써야 해서 `PANEL_FULLSCREEN_BREAKPOINT` 상수를 도입했다.

## 0.1.2

### Patch Changes

- Flip the mock clipboard default mode from `'web'` to `'mock'`. The old default
  called `navigator.clipboard.readText()` directly, which — when paired with
  `@ait-co/polyfill` — recursed infinitely: the polyfill shim routes
  `navigator.clipboard` back to the SDK's `getClipboardText`, which is this
  mock, which calls `navigator.clipboard.readText`, and so on.

  With the new default the mock returns state from `aitState.mockData.clipboardText`,
  so the polyfill + devtools pair works out of the box. Users who still want
  real-browser clipboard integration can flip the mode to `'web'` from the
  DevTools panel.

## 0.1.1

### Patch Changes

- b47021e: Fix unplugin `resolveId` regression that broke Vite dev on 0.1.0. The hook was
  returning the bare specifier `@ait-co/devtools/mock`, which Vite 8+ treats as
  the final resolved id — the module then 404s because no `load` hook is
  provided. `resolveId` now resolves the mock subpath to its absolute file path
  via `import.meta.resolve`, so every supported bundler loads it the normal way.
  Falls back to the bare specifier in runtimes where `import.meta.resolve` is
  unavailable.

## [0.0.3](https://github.com/apps-in-toss-community/devtools/compare/v0.0.2...v0.0.3) (2026-04-18)

### Bug Fixes

- add error boundary to panel mount logic ([#43](https://github.com/apps-in-toss-community/devtools/issues/43)) ([2b3db41](https://github.com/apps-in-toss-community/devtools/commit/2b3db41fa61acf0461f6fc4e4258be44a74b8f55))
- prompt 타임아웃 시 패널 존재 여부에 따라 메시지 분기 ([#44](https://github.com/apps-in-toss-community/devtools/issues/44)) ([c638304](https://github.com/apps-in-toss-community/devtools/commit/c638304b71e2a3d95021c66d80371f21c7530912))

## [0.0.2](https://github.com/apps-in-toss-community/devtools/compare/v0.0.1...v0.0.2) (2026-04-10)

### Features

- add device API mode system (mock/web/prompt) ([#13](https://github.com/apps-in-toss-community/devtools/issues/13)) ([2253a1f](https://github.com/apps-in-toss-community/devtools/commit/2253a1fa8f033f878886e1c37393ac8140cb3e46))
- add GitHub Pages deployment for example app ([#22](https://github.com/apps-in-toss-community/devtools/issues/22)) ([6fa1138](https://github.com/apps-in-toss-community/devtools/commit/6fa113846ead2a5624eafa722596ab477f4e82e1))
- add Vite + React example mini-app ([#3](https://github.com/apps-in-toss-community/devtools/issues/3)) ([16f51fb](https://github.com/apps-in-toss-community/devtools/commit/16f51fb7f4ed0c6f79d1afa22c6752194983d2f2))
- improve panel UX with fixed height, mobile fullscreen, and draggable button ([#27](https://github.com/apps-in-toss-community/devtools/issues/27)) ([4fb5335](https://github.com/apps-in-toss-community/devtools/commit/4fb5335f0439eb2e2b1992ff7bd637639d26650d))
- initial implementation of ait-devtools ([5f263ca](https://github.com/apps-in-toss-community/devtools/commit/5f263ca6fee25b7412d35b1c1e3e1290176b64dc))
- separate mock and panel for production devtools support ([#24](https://github.com/apps-in-toss-community/devtools/issues/24)) ([723ebea](https://github.com/apps-in-toss-community/devtools/commit/723ebea6d2cd5ad972ea27f86c6db0452cfd065b))

### Bug Fixes

- expand type compatibility checks in \_\_typecheck.ts ([#12](https://github.com/apps-in-toss-community/devtools/issues/12)) ([5379b23](https://github.com/apps-in-toss-community/devtools/commit/5379b23fa934ac871f16ec9f1366d0d0b8d1eea1))
- rename mockEnabled to panelEditable and neutralize danger disabled color ([#25](https://github.com/apps-in-toss-community/devtools/issues/25)) ([1a47dfd](https://github.com/apps-in-toss-community/devtools/commit/1a47dfd0fa1adb2e3eab96b69f31053303ea71f7))
- unify code patterns and add window.\_\_ait type declaration ([#23](https://github.com/apps-in-toss-community/devtools/issues/23)) ([59798cc](https://github.com/apps-in-toss-community/devtools/commit/59798cc3fe678fd88bce82d53d6f295e99ac4075))
