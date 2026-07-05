# Changelog

## 0.1.136

### Patch Changes

- 81b6ea5: fix(test-runner): `devtools-test` CLI가 run 완료 후 종료되지 않는 문제 수정 (#755)

  `devtools-test` CLI가 report/캡처 파일을 다 쓴 뒤에도 프로세스가 종료되지 않고 수동 SIGTERM이 필요했던 문제(run7~run10 4회 연속 재현)를 고쳤다.

  원인은 두 곳의 `http.Server#close()`가 콜백을 영원히 안 부르는 것이었다:

  - QR 대시보드 HTTP 서버(`qr-http-server.ts`) — 열려 있는 대시보드 탭의 `GET /events` SSE 연결(`keep-alive`, 절대 `res.end()` 안 함)이 `server.close()`의 새 연결 차단만으로는 안 끊긴다. `closeAllConnections()`를 먼저 호출해 강제 종료.
  - Chii relay 서버(`chii-relay.ts`) — WebSocket 업그레이드가 끝난 소켓은 Node의 HTTP 서버 커넥션 트래킹에서 빠져나가 `closeAllConnections()`로도 안 닫힌다. 열려 있는 CDP WS 연결(폰 target leg 또는 daemon/relay-worker client leg)을 `_wss.clients`로 순회해 명시적으로 `terminate()`.

  `devtools-test` CLI의 teardown 경로(Step 6)에 두 fix를 감싸는 bounded teardown orchestrator(`test-runner/teardown.ts`)를 추가했다 — 각 정리 단계를 개별 타임아웃으로 감싸 한 단계가 멈춰도 나머지가 실행되게 하고, 그 바깥에 최후 안전장치로 3초 grace 후 강제 `process.exit()`하는 backstop을 두었다(정상 경로에선 절대 발화하지 않음 — 위 두 근본 수정이 이미 핸들을 정리하기 때문). MCP 데몬 진입점(`devtools-mcp`)은 이 teardown 경로를 타지 않아 무관.

## 0.1.135

### Patch Changes

- 66774e0: feat(mcp): 대시보드 포트를 고정 기본값 + 점유 시 +1 증가로 (#752)

  QR 대시보드 HTTP 서버가 매 run 랜덤 ephemeral 포트에서 시작해 브라우저 탭/북마크가 run마다 무효화되던 문제를 고쳤다. 이제 고정 base 포트(`DEFAULT_DASHBOARD_PORT = 8317`)에서 시작해 `EADDRINUSE`면 +1씩 최대 20회 증가 스캔하고, 전부 점유면 ephemeral로 폴백 + 한국어 안내 1회 출력한다. `AIT_DEBUG_HTTP_PORT` env와 `devtools-test` CLI의 신규 `--dashboard-port <port>` 플래그가 같은 증가 로직의 base를 override한다 — `0`을 명시하면(env/CLI 어느 쪽이든) 기존 순수 ephemeral 동작을 유지한다(opt-out).

## 0.1.134

### Patch Changes

- 9805c31: fix(test-runner): 러너 shim ctx 미전달 + CLI --timeout 미반영 수정 (#746, #747)

  **FIX 1 (#746, ctx 미전달)**: sdk-example run7(2.x 실기기) 관측 — `it('...', async (ctx) => { ctx.skip(cond, note); ... })` 패턴이 env1(진짜 vitest)에선 통과하지만 env3 러너 shim에선 `undefined is not an object (evaluating 'ctx.skip')`로 fail(camera 1F, contacts 1F). 원인: `runtime.ts`의 in-page shim `it` 구현이 테스트 함수를 인자 없이 호출해 vitest 4 호환 task context가 전달되지 않았다. 수정: 각 테스트 실행 시 최소 vitest 4 호환 context(`{ skip(cond?, note?), task: { name } }`)를 생성해 첫 인자로 전달. `ctx.skip()`(무인자)은 무조건 skip, `ctx.skip(cond, note)`는 cond가 truthy일 때만 skip — 내부 sentinel(`InPageSkipSentinel`)을 throw해 테스트 바디를 즉시 중단하고, 러너가 이를 캐치해 `fail`이 아닌 `skip`으로 기록한다(note는 `TestResult.note` 신규 필드에 실림). cond가 falsy면 스킵 없이 바디가 계속 진행된다.

  **FIX 2 (#747, CLI --timeout 미반영)**: `--timeout` 기본 60s(#732)에도 파일 evaluate가 여전히 `CDP 명령이 타임아웃됐습니다 (Runtime.evaluate, 30000ms)`로 30초에 죽는 현상. 원인: `rpc.ts`의 JS-side race는 caller의 `timeoutMs`(60s)를 쓰지만, 그 아래 `chii-connection.ts`의 `sendCommand()` 자체 watchdog(`commandTimeoutMs` 기본 30s)이 먼저 발동해 rpc-level race를 무력화했다. 수정: `CdpConnection.send`/`ChiiCdpConnection.sendCommand`에 `opts.timeoutMs` per-call override를 추가하고, `injectAndRunBundle`(rpc.ts)이 파일-evaluate 예산(+5s 여유)을 그 override로 흘려보내 connection watchdog가 rpc-level race보다 먼저 끊기지 않게 정렬했다. 전역 기본 30s는 그대로 유지(다른 짧은 명령은 기존처럼 빠르게 fail) — rpc-level race가 여전히 파일 timeout의 권위 있는 기준이다. `LocalCdpConnection`은 자체 watchdog이 없어 override를 무시한다.

## 0.1.133

### Patch Changes

- 73515c8: test-runner 권한-상태 preflight hook 추가 (#739) — 첫 테스트 파일 실행 전 `__AIT_PERMS__`를 노출해 결정적 권한-상태 분기 지원

  - 관련 세션당 한 번(첫 파일 주입 직전, 파일별 아님) `Runtime.evaluate`로 `window.__sdk`의 6개 권한-보유 API(`getClipboardText`/`setClipboardText`/`fetchAlbumPhotos`/`openCamera`/`fetchContacts`/`getCurrentLocation`) `.getPermission()`을 조회(non-blocking — `openPermissionDialog`/`requestPermission` 같은 네이티브 UI는 절대 열지 않음)해 `globalThis.__AIT_PERMS__ = { clipboardRead, clipboardWrite, album, camera, contacts, location }`로 노출합니다. 각 값은 `'allowed'|'denied'|'notDetermined'|'unavailable'`.
  - 설계: 번들이 SDK를 독립적으로 import하지 않고 `window.__sdk`(`src/in-app/auto.ts`가 설치하는 페이지 전역)를 런타임에 참조한다는 사실을 확인하고, preflight를 번들 prepend가 아니라 **독립 페이지-전역 injectGlobals 방식**(`cell.ts`의 `runPermissionPreflight`)으로 구현했습니다 — `rpc.ts`의 번들 실행 경로는 무변경.
  - Non-fatal: 프로브 실패/부재는 `'unavailable'`로 수렴하고, preflight 전체가 실패·타임아웃(10s bound)해도 stderr 한 줄만 남기고 테스트 실행은 계속됩니다.
  - Report provenance: 수집된 권한 상태는 `RelayRunReport.preflight.permissions`와 (`--report-dir` 사용 시) 온디스크 리포트의 `preflight.permissions`에 실려, 4-cell diff가 테스트 결과와 실기기 권한 상태를 상관시킬 수 있습니다.
  - env1(vitest, mock)은 이 러너를 거치지 않으므로 out of scope — sdk-example#265가 mock 자체 상태로 `__AIT_PERMS__`를 채우는 별도 seam을 담당합니다.

## 0.1.132

### Patch Changes

- f86ad72: test-runner `--manual-blocking` 수동-변형 러너 모드 추가 (#741) — blocking 네이티브 UI(포토 피커·권한 다이얼로그·전면 광고) 테스트를 사람이 지켜보며 마지막 순서로 실행

  - `*.manual.ait.test.ts` 파일명 규칙으로 태깅합니다. `--manual-blocking` 없이는 이 파일들이 glob 확장에서 제외되어 기존 무인 실행 경로는 그대로 유지됩니다(zero-diff). `--manual-blocking`을 주면 이 파일들이 포함되고, 항상 나머지 일반 파일 전부보다 뒤에 스케줄됩니다.
  - 수동 파일을 주입하기 직전, 실시간 QR 대시보드(#734 SSE)에 현재 파일명 + 진행도(k/n)를 담은 `manualPrompt` 상태를 push하고 같은 안내를 CLI stdout에도 출력합니다. 사람이 폰을 탭할 시간을 주기 위해 수동 파일의 per-file evaluate timeout은 5분(`MANUAL_FILE_TIMEOUT_MS`)으로 고정되며, 일반 파일의 `--timeout`과는 독립적입니다.
  - 리포트 provenance: 수동 파일의 결과에는 `mode: 'manual'`이 찍히고(부재 = 무인 실행), `--report-dir` 사용 시 수동 파일 결과는 표준 `<sdkLine>.<platform>.json`을 오염시키지 않도록 별도 `<sdkLine>.<platform>.manual.json`에 함께(대체가 아니라 추가로) 기록됩니다.

## 0.1.131

### Patch Changes

- 7cc177b: test-runner: QR attach 대기 기본을 무제한으로 — `--attach-timeout` 명시 시에만 bound(CI용). 인터랙티브 dog-food에서 러너가 스캔 전에 죽는 문제 해소(#735)

  `ait-test-runner`의 QR attach 대기 기본값이 600초(10분)라, 사람이 폰을 들고 스캔하는 인터랙티브 dog-food에서 러너가 스캔 전에 죽는 일이 반복됐다. QR 스캔 대기는 사람 페이스의 행위라 기본은 유저가 명시적으로 러너를 종료할 때까지(Ctrl-C/SIGTERM) 무제한 대기하도록 바꿨다. 시간 제한이 필요한 CI/headless 호출자는 기존 `--attach-timeout <ms>` 플래그로 그대로 opt-in할 수 있다.

  `chii-connection.ts`의 `waitForFirstTarget`에는 non-finite(`Infinity`) timeout 가드를 추가했다 — Node가 `setTimeout(fn, Infinity)`를 ~1ms로 clamp하기 때문에, 가드 없이 그대로 넘기면 무제한 대기가 즉시 reject되어 버린다. 다른 호출자(기존 90초 기본값 경로)는 영향 없음.

  세그먼트 wait의 TOTP `at=` re-mint(30초 슬라이스마다 aging 코드 재발급)는 이번 변경으로도 그대로 무한히 반복된다 — 유출된 stale URL을 거부하는(4401) 보안 모델이 대기 시간과 무관하게 계속 유효하다.

## 0.1.130

### Patch Changes

- 63e7700: debug 상태 표면 실시간화 — in-app indicator live 전이 + 대시보드 즉시 push/onerror-first + 종료 시 terminal 이벤트

  - in-app debug indicator 배지가 static "Debugger Connected" 표시에서 attached/disconnected 두 상태를 실시간 반영하는 idempotent 컨트롤러로 바뀝니다. relay WebSocket lifecycle을 관찰해(신규 커넥션을 열지 않고 기존 in-page 신호만 관찰) 상태를 갱신하며, 재주입 시 DOM을 중복 생성하지 않고 상태만 업데이트합니다.
  - QR 대시보드 SSE가 target attach/detach, 테스트 실행 시작/종료, 서버 종료 시점에 즉시 상태를 push합니다(`notifyStateChange`). 클라이언트 스크립트는 `onerror`를 연결 끊김의 1차 즉시 신호로 처리하고(기존 watchdog은 백업으로 유지), 종료 시 HTTP 서버가 닫히기 전에 terminal SSE 프레임을 먼저 전송합니다.
  - CLI 경로(`relay-factory.ts`)에 daemon에는 이미 있던 `onTunnelDown` 연결을 추가해 MCP/CLI 간 처리 격차를 없앴습니다.

## 0.1.129

### Patch Changes

- 577d611: fix(test-runner): CLI 기본 timeout 30s→60s 정합 + relay 재연결로 파일 간 연쇄 실패 방지 (#731)

  **FIX 1 (CLI 기본값 미반영)**: `cli.ts`가 `--timeout` 미지정 시 자체 기본값 `30_000`을 항상 `opts.timeoutMs`로 내려보내, `rpc.ts`의 `DEFAULT_TIMEOUT_MS = 60_000`(#726 상향분)이 CLI 경로에서 절대 쓰이지 않았다. 수정: CLI 기본값을 `60_000`으로 정합, help text·`relay-worker.ts`의 "(after retry)" 표시용 fallback도 동일하게 갱신.

  **FIX 2 (relay WS 사망 시 파일 간 재연결 없음)**: 실측 run에서 한 파일의 30s×2 timeout 동안 트래픽이 없어 Cloudflare edge가 relay WebSocket을 idle-drop했고, 이후 모든 파일이 죽은 소켓에 즉시 실패하는 연쇄가 관측됐다. 에러 메시지 스스로 "enableDomains()로 재연결하세요"라고 안내하지만 러너는 이를 시도하지 않았다. 수정: `relay-worker.ts`의 파일 루프에서 WS-사망 계열 에러(`isRelayDisconnectMessage`, `chii-connection.ts`에서 export) 발생 시 다음 파일 전에 `enableDomains()` 재연결을 1회 시도(idempotent) — 성공 시 계속 진행, 실패 시 현재처럼 진행(루프 중단 없음). 타임아웃된 파일의 재시도 직전에도 방어적으로 1회 재연결(소켓이 이미 살아있으면 no-op).

  **Out of scope**: 긴 evaluate 중 Cloudflare edge까지 keepalive가 전달되지 않는 근본 원인(#720)은 별도 후속 과제.

## 0.1.128

### Patch Changes

- d431a5e: fix(test-runner): retry-gate 활성화 — timeout 시 throw 대신 return, env3 기본 제한시간 60s 상향 (#726)

  **BUG 1 (retry-gate 비활성)**: `rpc.ts`의 `injectAndRunBundle`이 per-file evaluate 제한 시간 초과 시 `Promise<never>` reject → throw 경로를 타 `relay-worker.ts`의 EVALUATE_TIMEOUT_MARKER 게이트(`return null` → 재시도 분기)에 절대 도달하지 못했다. 0.1.127에서 ship한 per-file retry(#723/#724)가 실질적으로 dead code였다. 수정: timeout arm을 `{ok:false, error:'rpc: evaluate timed out after …ms'}` return으로 변경해 relay-worker의 게이트가 발화하게 함. 진짜 CDP `exceptionDetails`는 계속 throw 유지(비재시도 경로).

  **BUG 2 (env3 30s budget 부족)**: `DEFAULT_TIMEOUT_MS`를 30 000ms → 60 000ms로 상향. storage(13 device round-trip), iap(6–8 RTT), location(GPS cold-fix)이 단일 evaluate 내에서 누적 초과하던 문제 완화. per-it isolation은 별도 follow-up.

  relay-worker.ts의 잘못된 주석("timeout은 ok=false return으로 표면화된다")도 실제 동작에 맞게 정정.

## 0.1.127

### Patch Changes

- a98459c: fix(test-runner): surface per-file failures (including evaluate timeouts) on stdout instead of only aggregate totals, and retry a timed-out file once before dropping it. Previously a file whose native call blocked past the evaluate timeout (e.g. camera's photo picker with no user gesture) was silently dropped to 0 tests and only counted in the aggregate 'N failed' line — two whole APIs could fail to run with no visible hint. The summary now prints each file's result (FAIL with error class, or OK with pass count) and a timed-out file gets one retry to ride out a transient native-dialog/GPS-cold-fix delay.

## 0.1.126

### Patch Changes

- 913e592: fix(test-runner): the CLI devtools-test path now waits for the mini-app page to be attached (enableDomains succeeded) before returning from open(), and enables domains BEFORE injecting the debug indicator/cell globals. Previously open() returned as soon as /targets was non-empty — before the page-level CDP websocket was open — so injectDebugIndicator threw (swallowed), injectGlobals threw fatally when --cell was set, and a transient relay disconnect in that window aborted the whole run. open() now enables domains first, then injects, and retries the attach→enableDomains sequence to ride out a disconnect/reconnect, so once the phone is attached the 12-file batch runs to completion.

## 0.1.125

### Patch Changes

- ab67b2a: fix(test-runner): --timeout no longer collapses the human QR-scan wait into the per-file evaluate timeout. devtools-test passed a single 30s value to both createRelayConnectionFactory (how long to wait for a phone to scan the QR) and the per-file evaluate clock, so the web-QR dashboard was torn down 30s after boot — before anyone could scan it. --timeout now controls only the per-file evaluate timeout (default 30s); a new --attach-timeout controls the QR-scan wait and defaults to the generous 10-minute factory default when omitted.

## 0.1.124

### Patch Changes

- 23f1bb6: fix(test-runner): the CLI web-QR dashboard now shows a scannable QR — createRelayConnectionFactory called prepareAttach before the cloudflared tunnel was up, so the attach URL never reached the dashboard (getDashboardState().attachUrl stayed null) and /qr.png 500'd on the empty u param. open() now wires bootRelayFamily's onWssUrl callback (mirroring the MCP daemon path) to await tunnel readiness before prepareAttach and to re-push dashboard state on late tunnel-up. The failure path also closes the QR server (no leaked listener), and /qr.png degrades gracefully on an empty u instead of 500.

## 0.1.123

### Patch Changes

- e8801df: fix(test-runner): devtools-test bin now invokes main() — a build-time chunk split had hoisted the self-invoke guard into a shared chunk, so the bin re-export wrapper never ran main() and every `devtools-test` / `pnpm test:env3` invocation exited 0 as a silent no-op. The bin entry is now a dedicated export-free module (`src/test-runner/bin.ts`) that calls main() unconditionally, with a dist-shape guard added to `scripts/check-test-runner-dist.sh` to prevent regression.

## 0.1.122

### Patch Changes

- ea9489a: feat(test-runner): serve the relay-attach QR as a loopback web page (browser auto-open) so `devtools-test` is scannable even when stdout is non-interactive

  `createRelayConnectionFactory` now starts the same `qr-http-server` loopback dashboard that the MCP `start_attach` path uses, wires it into `AttachDeps`, and prints `http://127.0.0.1:<port>/` to stderr. The browser auto-opens on GUI machines; headless users see only the stderr URL. If the server fails to start the factory falls back to the existing text-QR path without crashing. TOTP codes and relay wss URLs remain in-memory only — no secrets touch stdout or stderr.

## 0.1.121

### Patch Changes

- d258ae3: fix(debug-server): push dashboard state on silent disconnect so the relay dashboard stops showing a stale 'connected' page

## 0.1.120

### Patch Changes

- 8ef574f: fix(test-runner): support array receivers in `toContain` to match Vitest semantics

  Previously, `toContain` only handled string receivers (substring check). It now also supports array receivers (membership check via `Array.prototype.includes`), matching real Vitest behavior. This unblocks 22 `expect([...]).toContain(value)` call sites across sdk-example env3 tests that previously threw unconditionally.

## 0.1.119

### Patch Changes

- 1f508e6: getRuntimePath가 rolldown이 dist/ 루트로 hoisting한 공유 chunk에서 runtime.js를 못 찾던 회귀(#697 노출)를 depth-robust probe로 수정. env3 run_tests/devtools-test 빌드 실패 해소.

## 0.1.118

### Patch Changes

- 6ff3941: env3 테스트 러너를 러너-중립 코어로 정리: CLI와 Vitest 풀이 공유하는 relay attach 조립을 `createRelayConnectionFactory`로 단일화하고, `runTestFilesOverRelay`가 실행 전 `enableDomains()`를 한 번 보장하도록 했다. `collectCaptures` 옵션을 켜면 라이브 `Runtime.consoleAPICalled` 리스너로 `__AIT_CAPTURE__` 콘솔 라인을 수집한다(기본 false — build-only 경로는 리스너 비용 0). 수집된 라인과 실행 리포트는 secret-free 스키마로 디스크에 직렬화된다(파일 경로는 projectRoot 상대, relay wss/scheme/TOTP 필드 부재). 모두 additive 변경이라 기존 소비자 영향 없음.

## 0.1.117

### Patch Changes

- d7d89df: 디버거 attach 시 폰 화면에 'Debugger Connected' 인디케이터 주입(start_attach·devtools-test CLI 경로, run_tests 측정 경로 제외)

## 0.1.116

### Patch Changes

- 26d77e3: feat(test-runner): devtools-test CLI standalone relay attach 배선 (#684 PR3)

  `devtools-test` bin의 `main()` stub를 완전 구현으로 교체한다. 이제 MCP 데몬 없이
  CLI 단독으로 env3(실기기 토스 WebView)에서 `.ait.test` 슈트를 실행할 수 있다.

  - `src/test-runner/cli.ts` — main() 9단계 구현: parseArgs → discoverTestFiles →
    loadRelaySecretReadOnly → bootRelayFamily → AttachDeps 조립(qrHttpServer 미주입) →
    prepareAttach → renderAndMaybeWait(text QR + 폰 대기) → injectGlobals(**AIT_CELL**) →
    runWithConnection → family.stop(). CLI는 daemon이 아니므로 lock/router/SSE 불필요.
  - `src/test-runner/cell.ts` (신규) — `injectGlobals(conn, globals)`: attach 직후
    첫 번들 inject 전에 `Runtime.evaluate`로 globalThis에 cell 객체를 박는 일반 helper.
    devtools는 `__AIT_CELL__` 모양을 모르고 일반 `Record<string, unknown>`만 다룬다.
  - 새 CLI 플래그: `--scheme-url`, `--cell-sdk-line`, `--cell-platform`, `--headless`,
    `--project-root` (AIT_CELL_PLATFORM env fallback 지원).
  - install-graph 불변식 유지: dist/test-runner/cli.js에 react/react-dom 0건.
    qrHttpServer 미주입 → text QR(qrcode-terminal) 경로를 renderAndMaybeWait이 처리.
    esbuild lazy import 유지.

  sdk-example의 `test:env3` 스크립트는 이 PR에 포함하지 않는다 — devtools PR3 머지 후
  sdk-example repo 별도 PR에서 추가한다(cross-repo 분리).

- 6b64fa3: feat(run_tests): auto-attach when no page is connected (issue #684 PR2)

  `run_tests` now auto-attaches to a phone when there is no live CDP page, instead
  of immediately returning `pageMissingError`. The attach branch fires only in relay
  environments (env 3/relay-dev) and only when `isSandboxPageFresh` confirms there
  is no live page (ghost-page safe via the stale-threshold guard from #610).

  - **Already-attached path (4a) is unchanged** — existing behaviour, no regression.
  - **Auto-attach path (4b)**: no live page + relay env → calls `prepareAttach` +
    `renderAndMaybeWait` (QR dashboard + phone wait), then optionally injects a
    `cell` object via `injectGlobals` into `globalThis` before the first test bundle
    runs, then proceeds with the normal run path.
  - **Mock/local guidance path (4c)**: no live page + mock env → returns a clear
    guidance error (mock has no relay, auto-attach not applicable).

  New module `src/test-runner/cell.ts` exports `injectGlobals(conn, globals)` — a
  react-free, CdpConnection-only helper that atomically assigns any record onto
  `globalThis` via a single `Runtime.evaluate` before test bundles are injected.
  Callers use `{ "__AIT_CELL__": { sdkLine, platform } }` — devtools does not know
  the sdk-example-specific shape.

  `run_tests` descriptor gains three optional args: `scheme_url`, `cell`, `projectRoot`
  context for the auto-attach flow. `availableIn` stays `both`.

- 74e9606: test-runner `expect`에 asymmetric matcher(`expect.any`/`anything`/`objectContaining`/`arrayContaining`/`stringContaining`/`stringMatching`)를 추가했습니다 (#692). deep-equal 헬퍼(`toMatchObject`/`toEqual`/`toHaveProperty`)가 expected 쪽 marker를 인식해 구조 비교 대신 marker의 `asymmetricMatch`로 매칭하며, `not` 부정도 동작합니다. 실기기에서 `expect.any(String)` 등을 쓰는 `.ait.test` 파일이 `expect.any is not a function`으로 깨지던 문제가 풀립니다.
- a899993: attach 오케스트레이션을 `createDebugServer` 클로저에서 `src/mcp/attach-orchestrator.ts` 모듈로 추출했습니다 (#684 PR1). attach URL mint·env 검증·QR 렌더·segmented wait(in-call TOTP re-mint)이 6개 클로저 변수를 명시적 `AttachDeps` 객체로 받는 모듈 레벨 함수가 되어, MCP `start_attach` 핸들러 밖에서도 재사용할 수 있습니다. `createDebugServer`는 자기 클로저 변수로 `attachDeps`를 조립해 호출하는 얇은 래퍼가 됐고, 동작은 100% 동일합니다 — 순수 리팩터(행동 무변경).

## 0.1.115

### Patch Changes

- 9ce5075: QR 대시보드: SSE 주기 갱신이 끊기면 탭 자동 닫기 시도 + 안내 화면 폴백 — stale QR 탭 정리 (#681)

## 0.1.114

### Patch Changes

- 0d6ef05: env3 test-runner 런타임 수정 — sdk-example `.ait.test.ts`가 쓰는 `toMatchObject`/`toHaveProperty`/`toBeInstanceOf`/`toBeTypeOf` matcher 4종, `beforeAll`/`afterAll`/`beforeEach`/`afterEach` lifecycle hook, `vi.spyOn`/`vi.fn`/`vi.restoreAllMocks` shim, `it.skipIf`/`it.runIf` 조건부 등록을 runtime에 추가했습니다. bundle에 `vitest` redirect 플러그인을 추가해 `import { ... } from 'vitest'`가 접근 시점(call-time) globalThis getter로 연결되도록 했습니다 — 번들 평가 시점이 아니라 runtime이 globals를 설치한 뒤 해소되므로 테스트가 정상 등록됩니다.

## 0.1.113

### Patch Changes

- b34a3cb: test-runner: run_tests 번들 경로의 두 독립 버그 수정 (#678)

  1. **getRuntimePath의 co-location 가정 붕괴.** `getRuntimePath()`가 `import.meta.url` 기준으로 co-located `runtime.js`만 탐색하던 것을, 없으면 `../test-runner/runtime.js`(sibling 디렉토리)도 순서대로 시도하도록 확장했다. `dist/mcp/cli.js` 진입에서는 co-located 경로가 존재하지 않아 esbuild "Could not resolve" 오류가 발생하며 `run_tests`가 전부 실패하던 문제를 해결한다.

  2. **userFactoryPlugin이 multi-line import를 정확히 top-level 블록으로 유지.** 줄 단위 휴리스틱이 한 줄로 안 닫히는 `import { … } from '…'`(멤버를 줄마다 나열한 형태)를 분해해, 멤버 줄과 닫는 `} from '…'` 줄이 factory body로 새어 들어가던 문제를 수정했다. 그 결과 top-level에 닫히지 않은 `import {`가 남아 esbuild가 `Expected "as"`를 던졌다 — env3 run_tests에서 multi-line SDK import를 쓰는 테스트 파일이 전부 깨지던 원인이다. import/re-export 문이 종결될 때까지 한 블록으로 묶어 top-level에 유지한다.

## 0.1.112

### Patch Changes

- c90a65b: test-runner 기본 glob을 .phone.test → .ait.test로 변경 (미니앱 test case 컨벤션 정렬)
- 524b76f: run_tests: test-runner/runtime를 dist에 emit — tsdown entry 누락 수정 (모든 미니앱 테스트 빌드 실패 해소)

## 0.1.111

### Patch Changes

- 81c660c: fix(mcp): redact at= TOTP code from list_pages / get_debug_status page url
- a25722a: tunnel:{cdp:true} 첫 실행 및 재로드 시 .ait_relay / .ait_urls 를 프로젝트 .gitignore에 자동 추가(멱등, 실패 시 graceful 강등)

## 0.1.110

### Patch Changes

- a4974a1: 의존성 최신화 — web-framework-2x alias를 2.10.0 exact pin으로 올림 (2.10.1 upstream type regression 회피)

  `web-framework@2.10.1`은 `@apps-in-toss/web-bridge@2.10.1`이 `@apps-in-toss/native-modules`의 미빌드 raw `.ts` subpath를 import하는 upstream type regression이 있어 `tsc -p tsconfig.2x.json`이 실패한다. 2.10.0은 그 import가 없어 clean하다.

  - `@apps-in-toss/web-framework-2x`: `npm:…@2.9.3` → `npm:…@2.10.0` (exact pin, 2.10.1 회피)
  - `@types/react`: `^19.2.14` → `^19.2.17`
  - `react` / `react-dom`: `^19.2.6` → `^19.2.7` (devDependencies only)
  - `@biomejs/biome`: `2.4.15` → `2.5.1` (biome.json schema migration 포함)
  - `@playwright/test`: `^1.59.1` → `^1.61.1`
  - `ajv`: `^8.18.0` → `^8.20.0`
  - `tsx`: `^4.21.0` → `^4.22.4`
  - `unplugin`: `^3.0.0` → `^3.2.0`
  - `vite`: `^8.0.8` → `^8.0.16`
  - `ws`: `^8.18.0` → `^8.21.0`
  - `sharp`: `^0.34.5` → `^0.35.2`
  - `@vitejs/plugin-react`: `^5.1.0` → `^6.0.3` (major 5→6 bump)

  `tsdown`은 0.21.7을 유지한다 — 0.22.3은 rolldown-plugin-dts 0.26으로 올라가면서 트랜지티브 CJS .d.ts(postcss via web-framework) 처리를 warning에서 error로 격상시켜 빌드가 실패한다.

  **`haptic.ts` e2e 회귀 수정 (이번 deps bump로 발생)**: `@ait-co/polyfill/auto`와 함께 사용할 때 `generateHapticFeedback`이 브라우저를 hang시키는 무한 재귀를 수정한다. polyfill이 `navigator.vibrate`를 shim으로 교체하는데 그 shim이 내부적으로 mock의 `generateHapticFeedback`을 호출하고, mock은 다시 `navigator.vibrate`(= shim)를 호출해 무한 async 재귀가 발생했다. Vite 8의 번들 분할 방식이 deps bump 이후 바뀌면서 dynamic import가 즉시 resolve되어 재귀가 발현됐다. 수정: mock이 `Symbol.for('@ait-co/polyfill/vibrate.original')`에 저장된 원본 vibrate를 우선 사용해 재귀를 끊는다.

  런타임 동작 변화 없음. 모든 검증 게이트(build·typecheck·test·lint·check:mcp-react-free·check:debug-surface-absent·check:dashboard-html-fresh·test:e2e) 통과.

- a55747d: feat(gate): env 4 제거 + positive-allowlist kill-switch (#665)

  relay-live (env 4 — 프로덕션 WebView)와 LIVE guard(`liveIntent`/`confirm` 게이트)를 완전 제거하고 positive-allowlist kill-switch로 교체한다.

  **변경 요약:**

  - `isDebugAllowedHost(hostname)` 함수 추가 — 허용 호스트: localhost/loopback, `*.trycloudflare.com` (env 2), `*.private-apps.tossmini.com` (env 3). `apps.tossmini.com` (env 4 LIVE)는 허용 목록에 없어 차단.
  - `McpEnvironment`: `'relay-live'` 제거 → 3-value union (`mock | relay-dev | relay-mobile`).
  - `StartDebugMode`: `'relay-live'` 제거 → 3-value union.
  - `ConnectionRouter.switchMode`: `confirm: boolean` 파라미터 제거.
  - `ModeSwitchReport.liveGuardActive`: 필드 제거.
  - `deriveEnvironment`: `liveIntent` 파라미터 제거, 2-param 시그니처.
  - `liveIntent`/`getLiveIntent`/`setLiveIntent`/`seedLiveIntentFromEnv`/`isLiveRelayEnv`/`liveGuardError` 완전 삭제.
  - `evaluate`/`call_sdk`/`run_tests` 핸들러: LIVE guard → `connectionHostsAllowed(conn)` positive-allowlist 검사로 교체.
  - `DiagnosticsResult.environment.liveGuardActive`: `false` literal 타입으로 고정 (`@deprecated`).
  - `in-app/auto.ts`: `isDebugAllowedHost` 체크 추가 — 허용 호스트 아니면 dormant.
  - `in-app/gate.ts`: Layer B1에 `isDebugAllowedHost` 체크 통합.

  **SECRET-HANDLING:** hostname 값은 로그에 절대 출력하지 않음 — allowlist 검사 결과(boolean)만 사용.

- b1cd2f3: feat: `start_attach` 단일 통합 MCP tool — `build_attach_url` 대체 + 호출 안 attach 대기 + TOTP 자동 재발행

  기존 `build_attach_url`(QR/deep-link 합성) + 별도 attach 폴링의 2호출 흐름을 `start_attach` 단일 tool로 합쳤다. `start_attach`은 attach URL을 합성해 QR을 띄운 뒤 **같은 호출 안에서 폰이 attach될 때까지 대기**하고, 그동안 TOTP 코드를 자동 재발행한다.

  - **단일 진입 tool**: `build_attach_url`을 완전히 대체. descriptor는 bootstrap·`availableIn: 'relay'` 유지.
  - **`mode` 인자**: `local-browser` | `relay-sandbox` | `relay-staging` enum. mode를 주면 `start_debug`처럼 세션 환경을 함께 전환한 뒤(per-call 스냅샷으로 active connection·env 재캡처) 그 환경 기준으로 attach를 진행한다. relay 환경이 아니면 거부한다.
  - **기본 attach 대기**: `wait_for_attach` 인자는 제거됐고, 대기가 기본 동작이다(`wait_timeout_seconds`, 1–600s, 기본 60s로 조절). attach되면 호출이 그대로 페이지 목록을 반환한다.
  - **TOTP 호출-내 자동 재발행**: 대기를 30초 세그먼트로 쪼개고, 코드가 relay 검증 창(±6 step = 180s)에 가까워지면(150s 경과) 새 코드로 URL을 재합성해 대시보드 QR을 갱신한다. 재발행 횟수는 결과의 `totp.reminted`로 노출된다(최대 ~4회/600s). 대기 중 수동 재호출 불필요.

  SECRET-HANDLING 유지: TOTP 코드 값·tunnel host·relay wss·hostname은 stdout/log/tool-result/에러에 노출하지 않는다. tool-result의 `totp` 블록은 `expiresAt` + `reminted`만 싣고, 코드는 attachUrl(QR 페이로드)·`127.0.0.1` 대시보드 안에만 존재한다.

  모든 검증 게이트(typecheck·test·lint·build·check:mcp-react-free·check:debug-surface-absent·check:dashboard-html-fresh) 통과.

## 0.1.109

### Patch Changes

- 9decf3d: fix(test-runner): bundle.ts에 runtime.ts 포함 — describe is not defined 수정 (#656)

  `bundleTestFile`이 사용자 테스트 파일만 번들링하고 `runtime.ts`를 포함하지 않아 WebView에서 `describe is not defined` 오류가 발생하는 버그를 수정한다.

  - `userFactoryPlugin` 추가: 사용자의 최상위 테스트 등록 코드(`describe/it/test` 호출)를 `__userFactory` async 함수로 래핑해 `runTestModule`이 글로벌을 설치한 뒤 실행되도록 함.
  - esbuild `stdin` 래퍼로 runtime.ts와 사용자 팩토리를 단일 IIFE에 함께 번들링.
  - `footer` 옵션으로 `globalThis[globalName]` 명시 할당 — rpc.ts의 async IIFE 래퍼 안에서도 globalThis 접근 가능.
  - `rpc.ts`: `runTestModule(globalThis.__testBundle.__userFactory)` 호출로 팩토리 전달.
  - `e2e/run-tests-integration.test.ts`: 실제 Chromium + 실제 LocalCdpConnection으로 전체 파이프라인을 검증하는 회귀 방지 테스트 추가 (mock 없음).

- d19d3b3: run_tests: add per-file `duration` to results and correct tool/CLI docs

  The `run_tests` result now carries a per-file `duration` (the in-page run
  time) alongside each file's pass/fail/skip counts, so an agent can triage
  which file is slow without conflating it with the top-level whole-run
  wall-clock.

  Documentation accuracy pass: the tool description and the `devtools-test`
  CLI no longer claim the CLI can run the same suite standalone (its relay
  attach is not wired yet — run via the MCP tool for now), the `confirm`
  field is described as ignored in every non-live session, and stale
  issue-tracker references in the test-runner internals were removed.

## 0.1.108

### Patch Changes

- d1c4328: feat(test-runner): MVP relay transport (#644)

  Adds `src/test-runner/` — the first phase of running mini-app Vitest tests on
  a real device WebView via the CDP relay.

  - `bundle.ts` — esbuild bundles a user test file into a self-contained IIFE;
    SDK imports (`@apps-in-toss/web-framework`) are intercepted by a plugin and
    redirected to `window.__sdk` at runtime (2.x/3.x-agnostic).
  - `runtime.ts` — lightweight browser-compatible describe/it/test/expect
    runtime; collects results into a JSON-safe `RunReport`.
  - `rpc.ts` — Node-side helper that injects the bundle via `Runtime.evaluate`
    and parses the JSON envelope response.
  - `relay-worker.ts` — orchestrates bundle→inject→run→collect sequentially
    across multiple test files over a `CdpConnection`.
  - `config.ts` — `definePhoneTestConfig` helper for consumer configuration.
  - `cli.ts` — `devtools-test` bin skeleton (relay wiring in issue #645).

  New package.json entries: `bin.devtools-test`, `exports["./test-runner"]`,
  `dependencies` for `@vitest/runner`, `@vitest/expect`, and `esbuild`.
  Full Vitest pool integration is tracked in #645; `run_tests` MCP tool in #646.

- e1a1e98: feat(test-runner): Vitest 4.x custom pool integration (#645)

  Builds on #644's relay transport with a full Vitest custom pool, so mini-app
  tests run on a real device WebView through Vitest's own runner — reporters,
  watch, UI, and snapshot all work.

  - `pool.ts` — `createRelayPool()` returns a `PoolRunnerInitializer` whose
    in-process `PoolWorker` (modelled on Vitest's `TypecheckPoolWorker`) bundles +
    injects + collects each file over the CDP relay, then reports results through
    `vitest.state`. Single long-lived worker (`isolate: false`) honouring the
    relay's single-attach constraint; the connection opens lazily on first run and
    closes on `stop`.
  - `task-graph.ts` — synthesises a Vitest `File`/`Suite`/`Test` task graph from
    the flat page `RunReport`, rebuilding nested suites from `>`-joined names and
    assigning Vitest-stable ids via `@vitest/runner/utils` (`createFileTask` /
    `calculateSuiteHash`) so reruns and reporter lookups line up. Emits the
    `TaskResultPack`/`TaskEventPack` tuples `state.updateTasks` consumes.
  - `config.ts` — `definePhoneVitestConfig({ connection })` produces the Vitest
    `test` config slice (`pool`/`include`/`testTimeout`) to spread into a project's
    config; files matching `include` route to the relay pool.

  All Vitest packages aligned to 4.1.9 (vitest devDep, `@vitest/runner`,
  `@vitest/expect`) so the custom pool matches the core worker protocol. The
  `run_tests` MCP tool is tracked in #646; real-device reporter verification rides
  on the comparison dog-food run.

- 8c8d9ed: feat(mcp): add run_tests tool — run mini-app tests on the attached page (#646)

  Completes the phone test-runner trio (#644 transport, #645 Vitest pool) with the
  agent-facing entry point: a `run_tests` MCP tool that bundles, injects, and
  executes test files on the attached WebView over CDP, then returns per-file
  results plus flattened totals.

  - `run_tests` tool (Tier C, `availableIn: 'both'`) — registered in
    `debug-server.ts`, NOT in the bootstrap set, so it only appears once a page is
    attached. Reuses the attached connection (single-attach model) rather than
    opening a second relay connection. Args: `files` (globs/paths), `projectRoot`
    (glob base, defaults to daemon cwd), `timeout_ms` (per-file, default 30000,
    clamped to 1000–600000), `confirm` (required in relay-live). Dev-mode
    (`--mode=dev`) returns a clean CDP-unavailable hand-off (added to
    `CDP_ONLY_TOOL_NAMES`).
  - `discoverTestFiles(patterns, cwd)` (`test-runner/discover.ts`) — shared file
    discovery (Node built-in `fs/promises` glob, no new dep) used by both the
    `devtools-test` CLI and the MCP tool so expansion semantics are identical.
  - Robustness: single-attach guard (a concurrent `run_tests` is rejected, not
    queued), fail-fast page-missing re-check before bundling, per-file timeout
    passthrough, and per-file results as the progress record (one start/done log
    with counts — no secrets).
  - esbuild is now loaded via dynamic import inside `bundleTestFile` so the
    test-runner graph no longer pulls esbuild's jsdom-incompatible startup
    invariant into every module that imports it (and keeps it off the MCP-only
    install path until a bundle is actually built).

  Unit-tested with a fake CdpConnection through the full MCP request/response path
  (no phone): mapping, empty/no-match/timeout/live-guard/concurrency guards, and
  the secret-non-leak invariant. Real-device relay (real WebKit) remains manual QA.

- 6092012: env 2·3·4 폰 화면 in-page 콘솔 추가 — eruda를 `maybeAttach()`의 gate 통과 직후 Chii target.js 주입과 나란히 마운트한다. 데스크톱 F12가 없는 모바일(env 2 PWA WebKit, env 3·4 토스 WebView)에서 폰 화면의 console/network/DOM/storage를 직접 본다. 디버그 코드는 소비자의 `if (__DEBUG_BUILD__)` 가드로 release 빌드에서 DCE되어 0 bytes로 사라지고(Vite/rolldown 검증), 들어간 디버그 빌드에서도 host allowlist + `debug=1` + relay + TOTP 4겹 gate를 그대로 상속한다 (#647)

## 0.1.107

### Patch Changes

- 25fa91a: relay TOTP 시크릿 누락 안내 메시지를 `pnpm dev` → `pnpm dev:phone:cdp`로 정정 — `.ait_relay` 자동생성은 tunnel.cdp 분기에서만 일어나므로 (#641)

## 0.1.106

### Patch Changes

- 3a1d8c9: chore(typecheck): web-framework-2x alias 2.8.0 → 2.9.3 (#638)

  `__typecheck-2x.ts`(2.x stable 라인 mock 호환 증명)가 쓰는
  `web-framework-2x` devDep alias를 `2.8.0`에서 `2.9.3`(현 web-framework
  `latest`)로 올린다. published `latest`의 peer range가 `>=2.6.0 <3.0.0`이라
  실 소비자는 2.9.3을 in-range로 pull하므로, 2.x 호환 typecheck도 소비자가
  실제 쓰는 버전을 추적해야 한다(version-agnostic 보장, §5.1).

  2.8.0 핀은 #583/#588 작성 시점 stable 값이었을 뿐 의도적 floor가 아니다.
  `pnpm typecheck` 4개 라인(3.0-beta + 2x + fixture + scripts) 전부 green —
  2.8.0→2.9.3 사이 mock이 못 따라가는 시그니처 drift 없음.

## 0.1.105

### Patch Changes

- 924fcf9: fix(mcp): stale lock 회수 시 고아 cloudflared 터널 자식 정리 (#628)

  이전 debug-mode 세션의 Node 프로세스가 SIGKILL/크래시로 죽으면 cleanup이
  못 돌아 cloudflared 자식이 살아남아 죽은 quick tunnel을 계속 붙잡는다. 다음
  세션이 그 stale lock을 회수할 때 고아 자식을 명시적으로 정리하지 않으면
  터널이 누적된다.

  `acquireLock`이 lock을 회수하는 두 경로(① SIGKILL/크래시로 dead-Node가 된
  stale lock 회수, ② `--force` 강제 탈취)에서 lock에 기록된 `tunnelChildPid`가
  아직 살아 있으면 `reapOrphanTunnelChild`가 SIGTERM→2s grace→SIGKILL로
  정리한다(`isPidAlive`/`killAndWait` 재사용 — #347/#571 zombie-daemon 방어의
  짝). `tunnelChildPid`가 없거나(옛 lock 파일) 이미 죽은 경우는 no-op.

  SECRET-HANDLING: 정리 로그에는 PID만 출력하고 터널 host/wss는 싣지 않는다
  (그 값들은 애초에 lock 파일·이 경로에 들어오지 않는다).

## 0.1.104

### Patch Changes

- 1cefbd9: fix(mcp): QR landing이 relay 드롭 시 죽은 QR을 에러 상태로 전환 (#631)

  relay 터널이 영구 드롭(3회 reissue 실패)된 후에도 QR landing 페이지(대시보드
  `GET /`·`/attach`·launcher)가 죽은 wss·만료 TOTP를 인코딩한 옛 QR을 계속
  스캔 가능한 상태로 노출하던 2계층 갭을 닫는다. 사용자가 그 QR을 스캔하면
  죽은 relay로 연결을 시도해 timeout/401로 실패했다.

  - **서버** (`debug-server.ts`): `BootRelayFamilyOptions`에 `onTunnelDown`
    콜백을 추가하고 `onPermanentDrop`에서 호출한다. 3개 relay boot 사이트가
    이를 `qrServer?.notifyStateChange()`로 배선해 드롭 즉시 SSE 구독자를
    깨운다(이전엔 다음 TOTP refresh까지 최대 20s 무신호).
  - **클라이언트** (`qr-http-server.ts`): 정적 렌더 게이트와 SSE inline 스크립트
    양쪽에 `tunnel.up` 검사를 추가해, 터널이 죽으면 `attachUrl`이 남아 있어도
    QR 대신 에러 카피("relay 끊김 — QR 재생성")를 렌더한다.

  SECRET-HANDLING: 에러 카피에 wss/TOTP 값은 포함하지 않으며, 드롭 시 죽은
  `attachUrl`(TOTP `at=` 캡슐)을 url-box로 노출하지 않는다.

## 0.1.103

### Patch Changes

- 9b6b63b: telemetry 코드 전면 제거 — unplugin consent 엔드포인트·TTY 프롬프트, panel 토글, i18n 키, src/telemetry/ 디렉토리, README 섹션을 모두 제거한다. 추후 일관된 단일 설계로 재구현 예정.

## 0.1.102

### Patch Changes

- a5e3513: GET /devtools/ 경로로 chii DevTools UI 302 redirect 진입로 추가 — dashboard root에 relay active + pages attached 시 "DevTools 열기" 링크 표시 (#248 옵션 A)
- 57bc10e: relay 시크릿: 환경 변수가 `.ait_relay`와 다를 때 불일치 경고 추가 (#620)

## 0.1.101

### Patch Changes

- a21523d: relay-sandbox 재진입 시 `.ait_urls` 재독 + stale ghost 가드로 dev 서버 재시작 후 MCP 도구 먹통 현상 수정 (#610)

## 0.1.100

### Patch Changes

- 1119e43: env-2 launcher iframe에서 CSS env(safe-area-inset-top) 이중 패딩(dead band)을 in-app 보정 스타일로 수정 (#611)

## 0.1.99

### Patch Changes

- f6fc956: fix(launcher): letterbox 보정 전파 누수 2건 수정 (#541)

  1. setup 화면 `minHeight: '100dvh'` ICB 갇힘: `100%`로 교체해 parent fixed div(inset:0)를 통해 html/body force(screen.height)가 전파되도록 수정.
  2. 배너 게이트 비대칭: `|| letterboxShortfallPx > 0` 의존을 `correctionPhase !== 'held'`로 대체해 `letterboxDetected` 기반으로 게이트 통일.

- 80b78cb: fix(launcher): letterbox 배너 `letterboxDetected` 문구 — 반증된 '재설치' 권고 제거 후 실측 부합하는 문구로 교체 (#499)

  iOS 18.7 실기기에서 홈 화면 제거 후 재설치해도 letterbox가 재현됨을 확인(#499). `launcher.letterboxDetected`의 "화면 전체를 사용합니다" 문구는 shortfall이 여전히 남는 상태에서 표시될 수 있어 misleading이었다. OS 제약으로 하단 밴드가 남을 수 있음을 담담히 안내하고 회전 트릭(가로→세로)을 해소책으로 제시하는 문구로 교체. ko/en 둘 다 갱신.

- 5be8019: fix(launcher): letterbox cold-start env() stale-0 보정 게이트 누락 수정 + verdict 사유 노출 (#536)

  iOS standalone cold start에서 env(safe-area-inset-top)가 0/stale을 반환해
  letterbox 보정이 발동하지 않던 WebKit 결함(WebKit #274773)에 대응한다.

  - `scheduleSafeAreaTopPolls()` 순수 함수 추가: 100/300/600/1000ms 4-checkpoint
    multi-timeout으로 env()를 재측정해 stale-0을 벗어난 값이 도착하면 즉시
    보정 게이트를 재평가한다.
  - `detectLetterboxWithReason()` 함수 추가: 판정 사유(detected / notStandalone /
    landscape / shortfallTooSmall / safeAreaTopZero)를 반환해 cold-start 중
    `safeAreaTopZero` 상태를 diag 패널에서 식별 가능하게 한다.
  - Launcher.tsx 뷰포트 측정 effect를 multi-timeout 방식으로 교체, diag 패널에
    판정 사유(`verdict`) + safeAreaTop 재측정 추이(`top re-measure trace`) 행 추가.
  - letterbox.vitest.ts에 cold-start stale-0 → 재측정 후 정정 시나리오 테스트 추가.

- 88575fc: unplugin: in-app attach(`@ait-co/devtools/in-app` → `maybeAttach()`)를 panel 주입과 같은 transform 지점에서 게이트된 dynamic import로 자동 주입한다. 소비자가 `main.tsx`에 수동으로 배선하지 않아도 `?debug=1&relay=` 파라미터 존재 시 relay attach가 동작한다(#465, sdk-example#162 silent seam break 재발 방지). `inApp: false`로 비활성화 가능.

## 0.1.98

### Patch Changes

- 3a2a75b: unplugin forceEnable 옵션 제거 — production 강제 활성화 패턴(boilerplate 청정성 위반) 폐기.

## 0.1.97

### Patch Changes

- 62aeb96: 디버그 대시보드 사용자 URL을 `/attach?u=<deep-link>` 에서 루트 `/`(server-state 렌더)로 수렴 (#595) — 주소창·히스토리에서 TOTP at=·tunnel host 노출 표면 제거. `/attach?u=` 라우트는 back-compat으로 유지.

## 0.1.96

### Patch Changes

- 79b67a4: 타입체크 강화: `Assert<never>` 무음 통과 → `AssertCompat+Expect` TS2344 강제 (#592)

  `Assert<TMock, TOriginal> = TMock extends TOriginal ? true : never` 패턴은 불일치 시 `type _X = never`를 허용해 시그니처 미스매치를 무음으로 통과시켰다. tuple-wrap `AssertCompat<TMock, TOriginal> = [TMock] extends [TOriginal] ? true : false`와 `Expect<T extends true>`를 도입해 불일치 시 TS2344 컴파일 에러를 강제한다. 강화 과정에서 발견된 실제 미스매치(permissions 파라미터 shape, contactsViral onEvent 타입, eventLog log_type, graniteEvent/tdsEvent SDK 타입 직접 사용)를 수정했다.

## 0.1.95

### Patch Changes

- fb20bc2: stable peer를 2.8.0 라인까지 확장(`>=2.6.0 <3.0.0`) + mock을 web-framework 2.8.0·3.0-beta 두 라인 모두에 대해 컴파일 타임 검증(dual-line typecheck). `web-framework-2x` devDep alias(`npm:@apps-in-toss/web-framework@2.8.0`)와 `tsconfig.2x.json`·`__typecheck-2x.ts`를 추가해 `pnpm typecheck`가 양 라인을 모두 돈다. 라인별 표면 차이(2.x 부재 base `PermissionError` 1개)는 `AssertIfPresent`로 capability-gate (#583).
- c71b76e: env-2 launcher가 navigationBar transparentBackground/theme(SDK 2.8.0)를 host chrome으로 재현 + deep-link 자동 주입 — `buildLauncherDeepLink`에 `navBarTransparent`/`navBarTheme` 옵션 추가, unplugin Options에 두 필드 추가, launcher partner bar가 투명 배경 + light/dark 전경 테마를 지원하며 `&navBarTransparent=1`/`&navBarTheme=<v>`로 QR/터널 URL에 자동 실린다 (#587).

## 0.1.94

### Patch Changes

- 06ec8be: env-2 deep-link에 webViewType→navBarType 자동 주입 (game 앱이 launcher에서 자동 game 모드로 진입) — `buildLauncherDeepLink`에 `webViewType:'game'` 옵션 추가, unplugin이 `printTunnelBanner`에 `webViewType`을 전달해 QR/터널 URL에 `&navBarType=game`이 자동 실린다 (#584).

## 0.1.93

### Patch Changes

- 4f11615: launcher: 미니앱이 webViewType을 self-report해 game 모드로 자동 진입 — 수동 navBarType URL 편집 제거. 미니앱이 `{ type: 'ait:web-view-type', value }`를 부모 launcher에 postMessage하고(in-app self-report), launcher가 game 타입에서 자동으로 game 모드로 전환한다. unplugin은 `webViewType` 옵션으로 `__WEB_VIEW_TYPE__` 빌드 상수를 Vite define으로 주입한다(granite.config.ts 자동 읽기는 TS 로더가 필요해 명시 옵션으로 보류, 기본값 `'partner'`) (#580).

## 0.1.92

### Patch Changes

- 970b20c: docs: game webViewType이 SDK(web-framework 2.6.1) deprecated임을 확정 — mock safe-area는 game/partner 동일(top=0) 유지, 분기 미추가 (#577).

## 0.1.91

### Patch Changes

- 17d63d0: launcher: letterbox 보정량이 0일 때 "+0pt 적용됨" 배너를 숨긴다 (held holding 분기 false-positive 제거). 레이아웃 verdict는 불변.

## 0.1.90

### Patch Changes

- 8a49c05: fix(mcp): daemon stale 근본 방지 — 자식 exit 감지 + 라이브 프로브 + lock health + max-age (#571)

  좀비 데몬 버그(cloudflared 자식이 죽었는데도 `get_debug_status`가 `tunnel.up: true`를 계속 보고) 4축 방어:

  - FIX 1 `tunnel.ts`: cloudflared 자식 exit 시 `onUnexpectedExit` 콜백으로 즉시 `doReissueOrDrop` 호출 (probe interval 대기 없음)
  - FIX 2 `tools.ts` + `debug-server.ts`: `getDiagnostics` 라이브 `isPidAlive` 프로브 — 캐시 `up=true`를 실 PID 사망 시 `false`로 오버라이드; `get_debug_status` 핸들러가 in-memory `activeTunnelChildPid`(소스 a)와 lock 파일 fallback(소스 b)을 모두 `getDiagnostics`에 전달하도록 프로덕션 배선 완성. `onReissue` 시 lock의 `tunnelChildPid`도 새 PID로 갱신
  - FIX 3 `server-lock.ts`: lock 파일에 `tunnelChildPid` 저장 — 재기동 시 자식 PID 사망 락 감지 후 좀비 락 자동 해제
  - FIX 4 `parent-watcher.ts`: `startMaxAgeWatchdog` 신설 — 데몬 수명 6시간 상한 (`AIT_DEBUG_NO_MAX_AGE=1` opt-out)

## 0.1.89

### Patch Changes

- d261bb8: relay `/targets` 라우트 TOTP 게이트 추가 — URL-leaker가 코드 없이 세션 메타데이터를 읽을 수 있던 갭 닫기 (#474)

## 0.1.88

### Patch Changes

- 98f5cf0: fix(launcher): iOS letterbox 보정을 geometry-epoch 래치 + html/body force로 재작성 — 자가검증 진동(#563) 제거 + 데드밴드 실제 보정

## 0.1.87

### Patch Changes

- 7f670dd: launcher가 iOS standalone PWA에서 하단 letterbox 띠를 html/body height 강제로 제거(메커니즘을 position:fixed에서 문서흐름 루트로 정정)

## 0.1.86

### Patch Changes

- c87f44d: `build_attach_url` 도구에 `wait_timeout_seconds` param 추가 — `wait_for_attach=true` 시 대기 시간을 1–600 s 범위에서 조절 가능 (default 60 s). 유효 범위 밖 입력(0/음수/NaN/비숫자)은 에러 없이 default로 폴백. `deps.waitForAttachTimeoutMs` 기본값을 90 000 ms → 60 000 ms로 정정, 도구 description의 stale "polls up to 30 s" 문구를 "default 60 s, wait_timeout_seconds로 조절"로 갱신.
- ece5890: `get_debug_status`가 `list_pages`와 동일하게 pages 조립 전 `refreshTargets()`를 호출해 stale 캐시로 인한 pages:0 / 잘못된 `nextRecommendedAction` 보고를 수정한다. relay에 target이 붙어 있어도 status가 "pages 없음"으로 오판하던 문제(#551)를 해결한다. refresh 실패 시에는 기존 캐시를 그대로 사용해 gracefully 동작한다.

## 0.1.85

### Patch Changes

- 826252c: `build_attach_url` 도구에서 `open_in_browser` 입력 옵션을 제거하고 항상 브라우저 대시보드 오픈을 시도하도록 변경합니다. 구버전 클라이언트가 `open_in_browser` 키를 전달해도 에러 없이 무시됩니다(하위호환). GUI 없는 headless 환경에서는 기존과 동일하게 텍스트 QR fallback이 출력됩니다.

## 0.1.84

### Patch Changes

- bd943b9: /attach 페이지에 "디버그 툴 열기" 버튼 추가 및 DevTools auto-open 기본값 OFF 변경 (#544). AIT_AUTO_DEVTOOLS=1 환경 변수를 명시적으로 설정해야 연결 시 자동으로 열립니다(이전: 기본 ON).

## 0.1.83

### Patch Changes

- 7d19037: feat(telemetry): 동의 상태 머신 레벨 영속화 (#542) — origin 회전마다 toast 재노출 제거

  quick-tunnel host·localhost 포트가 세션마다 바뀔 때마다 같은 개발자에게 텔레메트리 동의 toast가 반복 노출되던 문제를 해결한다.

  - `~/.ait-devtools/telemetry.json`에 동의 상태를 머신 레벨로 저장 (consent enum + decided_at + policy_version + anon_id)
  - `pnpm dev` 첫 기동 시 TTY 프롬프트로 1회 묻고 머신 파일에 영속화. 비-TTY(CI/headless)는 조용히 undecided 유지
  - Vite dev server에 `/api/ait-devtools/telemetry-consent` endpoint 추가 — 패널이 GET해서 machine consent를 읽고 toast 스킵, 환경 탭 토글 변경 시 POST로 기록
  - anon_id도 머신 레벨로 승격해 origin별 여러 명 집계 방지
  - 비-dev 표면(GitHub Pages 배포 fixture/launcher) 동작 무변경 — fetch 실패 시 기존 localStorage 경로로 투명하게 fallback
  - `src/telemetry/state.ts`의 localStorage 키 LOCKED 불변식 유지, Tier 0/1 수집 정책 의미 불변

## 0.1.82

### Patch Changes

- b972874: feat(mcp): build_attach_url에 selfdebug 옵션 추가 — launcher self-target QR 발급 (#543)

  `build_attach_url` 도구에 `selfdebug?: boolean` 파라미터를 추가한다.

  - `true`(env 2 / relay-sandbox 전용): `buildLauncherAttachUrl`이 생성하는 URL에 `&selfdebug=1`을 추가. launcher PWA가 자기 문서를 CDP target으로 등록(#531 소비측 완성).
  - env 3/4(relay-staging/relay-live)에서 `selfdebug=true`를 전달하면 명시 에러로 거부 — launcher 전용 기능임을 안내.
  - `false` 또는 생략 시 기존 출력 byte-identical (하위 호환 무변경).
  - 도구 descriptor description에 single-attach 모델 명시: self-target attach 시 미니앱 target evict.

## 0.1.81

### Patch Changes

- 8a4cb8e: fix(launcher): standalone 인앱 QR 스캔 경로에서 selfdebug 미발동 수정 (#535)

  standalone PWA(홈 화면 앱)에서 인앱 QR 스캔으로 `selfdebug=1` + `relay=<wss>` URL을 읽을 때도 `injectSelfTarget()`을 호출한다. start_url 부팅(쿼리 없음)이라 `maybeAttachSelf()`가 발동하지 않는 경로를 `showLive()`에서 보완. selfdebug 모드에서는 iframe에 CDP 파라미터를 포워딩하지 않아 이중 attach를 방지한다(option a). `selfAttached` 가드가 중복 스캔 시 단일 주입을 보장. vitest 커버리지 확장(가드·파싱 경로).

- 44eb06f: letterbox-probe 변형 확장: fullscreen manifest·pxfix(#527 단독 재현)·contain + 허브 인덱스 추가

## 0.1.80

### Patch Changes

- 458a330: 안정 `/inspector` 엔드포인트, env 2 로컬 relay base, 타겟 단위 자동-열기 추가 (issue #530)

  **A. 안정 `/inspector` 엔드포인트 (QR HTTP 서버)**

  `GET http://127.0.0.1:<qr-port>/inspector`를 추가한다. 요청마다 `getDirectInspectorUrl()` getter를
  호출해 활성 타겟의 TOTP를 생성하고 `buildChiiInspectorUrl`로 조립한 URL로 302 redirect한다.
  relay 비활성 또는 타겟 없음이면 502 + ko/en HTML. URL에 시크릿이 없으므로 stdout·대시보드·로그에
  출력 가능. redirect Location은 HTTP 응답으로만 전달 — 로그 금지.

  `getDashboardState().inspectorUrl`(= `/inspector` 자기 자신)을 redirect 대상으로 쓰면
  무한 루프(ERR_TOO_MANY_REDIRECTS)가 발생한다. `/inspector` 라우트는 `getDirectInspectorUrl`
  getter를 별도로 주입받아 직접 chii front_end URL을 조립하도록 분리해 이 루프를 방지한다.

  **B. env 2 inspector는 로컬 base 우선**

  unplugin이 relay 기동 후 `relayLocalUrl: http://127.0.0.1:<relay-port>`를 `.ait_urls`와
  `AIT_RELAY_LOCAL_URL` env var에 기록한다. `bootExternalRelayFamily`는 이를 읽어
  `BootedFamily.relayLocalHttpUrl`에 저장하고, `activeRelayHttpUrl` getter가 tunnel base 대신
  로컬 base를 반환해 inspector URL 조립에 쓴다. CDP 연결 자체는 그대로 tunnel base 사용 (변경 시
  attach 흐름 회귀 위험).

  **C. 타겟 단위 자동-열기**

  `AutoDevtoolsOpener._opened: boolean` (세션 1회 가드)를 `_openedTargets: Set<string>` (타겟 단위 dedupe)로
  교체한다. 새 targetId의 첫 attach마다 자동으로 열리고, 같은 target 재통지는 dedupe(no-op). 여는 URL은
  A의 안정 `/inspector` URL (`inspectorStableUrl`) 우선 — TOTP 만료 레이스 없음. legacy 경로는 하위 호환으로 유지.

- faa5eab: feat(launcher): selfdebug=1 opt-in self-target — launcher 문서 CDP 직접 관측 (#531)

  launcher URL에 `selfdebug=1`과 `relay=<wss>` 파라미터를 추가하면 launcher 문서 자체가 Chii CDP target으로 등록된다. 에이전트가 `measure_safe_area` / `evaluate` / `get_dom_document` 등을 launcher 문서에 직접 실행할 수 있어, 기하·스타일·배너 상태를 사람 눈 없이 관측 가능하다(#499/#527 letterbox 오진 사가의 구조적 해소). 파라미터 없으면 기존 동작 byte-identical 무변경.

## 0.1.79

### Patch Changes

- 09689a7: fix(launcher): letterbox 감지 시 screen.height px 보정 — ICB 오보고 우회 (#527)

  iOS standalone PWA의 letterbox 감지기(#491)가 발화하면 이제 경고 배너 표시에 그치지 않고 실제 레이아웃을 보정한다.

  - 루트 컨테이너에 `height: screen.height px` 명시 — ICB 오보고(797) 우회
  - 파트너 모드 iframe height: `calc(100% - env(top) - 54px)` → `screen.height - envTop - 54` px
  - 게임 모드 iframe height: `100%` → `screen.height` px
  - inset 브리지: 보정 적용 시 bottom inset 실값(34) 복원 — `computeBridgeInsets`에 `letterboxCorrected` 파라미터 추가(기본 true)
  - 배너 메시지 톤 다운: 경고 → 보정 적용 안내 (ko/en 짝)

  미감지 경로는 byte-identical 유지.

  > 터치 히트테스팅 미검증: 보정 영역(하단 47pt)에서의 터치 응답은 페인트만 확인됨 — 폰 재검증 라운드에서 버튼 탭으로 확인 예정.

## 0.1.78

### Patch Changes

- 6b26bf1: fix(mcp): measure_safe_area source enum에 relay-mobile 추가 + terminology drift 정정 (#524)

  - `measure_safe_area` tool description의 source 열거에 `relay-mobile` 4번째 값 추가(실측 확인된 반환값 반영)
  - `get_debug_status` description에 start_debug mode→McpEnvironment kind 매핑 cross-ref 추가
  - MCP tool description 산문의 `MOCK SDK` → `mock SDK`, `deep link` → `deep-link` 표기 정정
  - i18n(ko/en) AITC Sandbox 환경 라벨: `AITC Sandbox PWA` → `AITC Sandbox App (PWA)`, `Env N` → `env N`
  - TOTP 시간 표기 통일: 30초 창 + ~3분(±6 step) 소급 허용을 한 문장에 함께 명시(README ko/en + i18n + dashboard)
  - 산문 주석의 `dogfood` → `dog-food` (코드 식별자 `RELEASE_CHANNEL=dogfood` 등은 불변)
  - README ko: `딥링크` → `deep-link`, `런처 QR`/`런처 PWA` → `launcher QR`/`launcher PWA`
  - README en: 산문 `miniapp` → `mini-app`
  - dashboard.generated.ts 재생성(i18n 소스 변경 반영)

## 0.1.77

### Patch Changes

- eeb2a46: `in-app/auto`: DEV 판정에 `process.env.NODE_ENV` 병행 추가 — 소비자 Vite dev(node_modules) 활성 복구 (#520)

## 0.1.76

### Patch Changes

- ebc9d9b: `in-app/auto` self-gating entry 추가 — `import '@ait-co/devtools/in-app/auto'` 한 줄로 on-device attach + SDK 브리지 설치 (#514)

## 0.1.75

### Patch Changes

- f8e4b63: launcher 파트너 바 뒤로가기 브리지 추가 + 여백 실측 정합 (#510); navigate-back 수신 시 backEvent 구독자 유무에 따라 `__ait:backEvent` 인터셉트 또는 `history.back()` fallback 분기 (env-1 패널 동일 경로)
- 341afa4: 대시보드 탭 stale + idle TOTP 만료 해소 — attach 워처 연속 감지 + 주기 SSE 갱신 (#509)

  ① **대시보드 탭 stale 해소** — `startAttachWatcher`가 기존 one-shot(0→N 한 번 발화 후 interval 정지)에서 **target-id 시그니처 연속 감지**로 전환됐다. 이제 interval이 계속 돌면서 target 교체(1→1, id 변경 — rescan 등)나 detach 후 재attach 때도 콜백(`recordAttach` + `onPageAttach` → `qrServer.notifyStateChange()`)이 발화한다. 결과: 열려 있는 대시보드 브라우저 탭이 SSE를 통해 새 target id + 신선한 TOTP 링크를 받게 된다.

  ② **idle 탭 TOTP 만료 방지** — `startQrHttpServer`가 `sseRefreshIntervalMs`(기본 90,000ms) 주기로 SSE 구독자에게 상태를 push한다. `getDashboardState()` 호출 시점에 `at=` TOTP 코드가 재발급되므로, push 자체가 열린 탭의 인스펙터 링크를 신선하게 유지한다. 90s 주기 < relay gate 허용창 ~3분(±6 steps)이므로 탭이 열려 있는 한 링크가 항상 유효하다.

  ③ **inspector URL fail-closed (defense-in-depth)** — `buildChiiInspectorUrl`이 `mintTotp` getter 없으면 `null`을 반환한다. TOTP 시크릿이 없는 비정상 상태에서 relay gate에 절대 통과할 수 없는 죽은 링크를 노출하는 대신, 대시보드가 대기 안내를 보여주는 방어 계층이다.

## 0.1.74

### Patch Changes

- a9de230: feat(dashboard): 로컬 대시보드에 인스펙터 열기 링크 추가 — 살아있는 세션 기준 DevTools 진입점 (#503)

  relay가 up이고 페이지가 attach된 경우, MCP 데몬 대시보드와 unplugin 터널 대시보드 모두에
  "인스펙터 열기" 링크(ko) / "Open inspector" 링크(en)가 표시된다. 링크는 `target="_blank"`로
  새 탭에서 Chii 인스펙터를 열며, TOTP at= 코드는 매 요청마다 fresh mint된다.

  - `DashboardState`에 `inspectorUrl` 필드 추가
  - 기존 `buildChiiInspectorUrl` (#485 수리) 재사용 — 중복 구현 없음
  - SSE `/events` push로 라이브 갱신 (페이지 attach/detach 즉시 반영)
  - i18n: ko "인스펙터 열기" / en "Open inspector"
  - 환경 2(unplugin 터널): target ID 미노출 → `inspectorUrl: null` → 대기 hint 표시
  - SECRET-HANDLING: 대시보드 HTML anchor href는 의도된 transport, stdout/로그 출력 없음

## 0.1.73

### Patch Changes

- a5200d2: build_attach_url·터널 대시보드가 launcher deep-link에 앱 이름을 싣고, 파트너 상단바에 아이콘 슬롯 추가 (#498)

## 0.1.72

### Patch Changes

- 232e274: fix(launcher): letterbox 판별자를 #479 top-inset 규칙으로 복원 — phantom bottom 실측 반영 (#491)

  실기기 측정(iPhone, iOS 18.7, 2026-06-11): launcher 재설치 직후 cold start에서 letterbox 상태(innerHeight 797 vs screen 844, shortfall 47)임에도 `safeAreaBottom`이 0이 아니라 phantom 34를 보고 — #487이 도입한 `safeAreaBottom===0` 판별자가 false-negative를 냄.

  원인: `safeAreaBottom`은 healthy 상태와 letterbox 상태 **모두**에서 phantom 34를 보고하므로 신호가 없다. #487이 가정한 "letterbox에서 bottom이 0으로 붕괴"는 실기기에서 반증됨.

  변경:

  - `letterbox.ts`: 판별자를 `standalone && portrait && shortfall >= 24 && safeAreaTop > 0`으로 복원 (#479 규칙). `safeAreaBottom`을 판별자에서 완전 배제. black-translucent 하에서 healthy window는 shortfall이 없으므로 top>0 규칙의 false-positive는 성립 불가 — #487의 우려는 shortfall 요건과 결합하면 해소된다. 5-케이스 분석 표를 헤더 주석에 추가.
  - `letterbox.ts`: `computeBridgeInsets()` 순수 함수 추가 — letterbox 감지 시 bridge 전달 insets의 bottom을 0으로 보정 (창이 home indicator에 못 닿으므로 앱 패딩 불필요; top은 그대로). `SafeAreaInsets` interface도 함께 export.
  - `Launcher.tsx`: `postSafeAreaInsetsTo()`가 `computeBridgeInsets()`를 통해 보정된 insets를 전달하도록 수정.
  - `letterbox.vitest.ts`: 실측 기반으로 픽스처 재정정 — 오늘 실측(797/844, top 47, bottom 34) → detected=true, 신메타 healthy(shortfall 0) → false, bottom 값이 0/1/34/99 무관하게 판정에 영향 없음 명시. `computeBridgeInsets()` 테스트 추가.

  이 변경은 #487 변경분의 부분 정정이다.

- 772be22: relay TOTP 수용창 ±6 step 확대 — attach 코드 유효기간 약 3분으로 (#490)

  relay WebSocket upgrade gate(`buildRelayVerifyAuth`)의 TOTP 검증 skew를 기본값(±1 step = 90초 창)에서 ±6 step(180–210초 창 = 약 3분)으로 확대했습니다.

  실사용 흐름(QR 발급 → 폰 집어들기 → 카메라 스캔 → launcher PWA 로드 → attach)은 90초를 쉽게 초과해 4401 거부를 유발했습니다. 새 창으로 이 문제가 해소됩니다.

  `verifyTotp` 자체의 기본 skew=1은 RFC 원형 그대로 유지 — 확대는 relay gate 호출부(`RELAY_VERIFY_SKEW_STEPS = 6` 상수)에만 적용됩니다. `build_attach_url`이 반환하는 `totp.expiresAt`과 `ttlSeconds`, 대시보드/attach 페이지의 만료 안내 카피도 새 기준(약 3분)으로 동기화했습니다.

## 0.1.71

### Patch Changes

- 2d5fb38: 환경 2(AITC Sandbox PWA) 상단 safe-area fidelity 개선 (#484, slice 1+2).

  - launcher PWA를 `apple-mobile-web-app-status-bar-style: black-translucent`로 전환 — standalone 웹뷰가 status bar 밑까지 확장돼 흰 띠 + 죽은 ~54px 공간이 사라진다(game-type 토스 표현에 근접). launcher 자체 UI는 `env(safe-area-inset-top)`을 스스로 패딩.
  - letterbox 감지기(#469/#479)를 새 기하에 맞춰 재설계 — black-translucent에서는 healthy 창도 top inset이 0이 아니라서, 판별자를 top inset에서 bottom inset으로 역전(letterbox = 높이 부족 + bottom 0, healthy = 풀 높이 + bottom>0).
  - launcher가 측정한 실 `env(safe-area-inset-*)` 4값을 framed page로 `postMessage({ type: 'ait:safe-area-insets', insets })` 전달(load·resize·orientationchange 시). framed page의 mock `SafeAreaInsets` 상태가 수신해 preset을 덮어쓰고 subscribe 이벤트를 발화한다. 수신 측은 type·숫자·범위(0~200) 검증, 비정상 메시지는 조용히 무시. 메시지 주도라 desktop 환경 1(launcher 없음)은 preset이 그대로 유지된다.

- d6c16c9: attach 시 자동 오픈되는 DevTools inspector URL을 appspot 의존에서 chii 자가 호스팅 front_end + fresh TOTP(`at=`)로 전환. `buildChiiInspectorUrl`이 relay base 경유 `<relay>/front_end/chii_app.html?ws=<host>/client/<uuid>?target=<id>&at=<code>` 포맷을 조립하며(쿼리 파라미터 이름이 dial scheme을 정한다 — http relay base는 `ws=` plain dial(환경 3/4 로컬 relay), https tunnel base는 `wss=` TLS dial(환경 2)), `AutoDevtoolsOpener.open()`은 기존 2-arg 시그니처 대신 `DevtoolsOpenOptions` 객체를 받아 relay HTTP base URL·target id·mintTotp 클로저를 받는다. relay gate(#478) 4401 거부와 appspot `@` 리비전 미검증 문제를 함께 해소.
- 1454f0d: relay: WS keepalive ping 추가 — Cloudflare 터널 유휴 ~100s 절단 방지 (#483)

  환경 2/3/4 CDP relay 세션에서 Cloudflare proxied 연결이 무트래픽 ~100초에 절단되는 문제를 수정합니다. relay가 보유한 모든 WS 소켓에 45초 간격으로 protocol ping을 전송해 양쪽 leg(폰 target + daemon client)의 edge 유휴 타이머를 리셋합니다. 클라이언트/target 코드 변경 없음 — ws 라이브러리와 브라우저는 pong을 자동으로 응답합니다.

  `startChiiRelay({ keepaliveIntervalMs })` 옵션으로 간격을 조정하거나 `0`으로 비활성화할 수 있습니다.

## 0.1.70

### Patch Changes

- 17f7a0f: launcher letterbox 감지에 `safeAreaTop > 0` 판별자 추가 — 재설치로 치유된 healthy below-status-bar 레이아웃의 false-positive 해소 (#479)
- ed017e3: relay의 TOTP 거부를 close 4401(`totp-rejected`)로 이름 붙이고 in-app 관찰자가 launcher 배너로 중계 — 만료된 디버그 세션이 폰에서 더 이상 조용히 실패하지 않습니다 (#478)

## 0.1.69

### Patch Changes

- 68c3fa5: fix: launcher 하단 chrome(RESCAN·진단 FAB·진단 패널·letterbox 라벨)을 단일 fixed flex 스택으로 재구성해 실기기 겹침 제거 (#475) — letterbox 감지에서 iOS 26 실기기 phantom safe-area-inset-bottom 조건 제거, letterbox 시 phantom inset 무시 bottom 분기, 진단 패널 chrome Δ row 추가

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
