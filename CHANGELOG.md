# Changelog

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
