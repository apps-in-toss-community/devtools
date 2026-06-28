# env3 test 실행 UX 재설계 — run_tests auto-attach + 고전 `pnpm test:env3` 경로

설계문서 (구현 전). 추적 이슈 devtools#684. 커뮤니티 오픈소스 프로젝트입니다.

이 문서는 **설계만** 정의한다 — 구현은 아래 §5의 PR 분할로 별도 진행한다. 코드 앵커(파일:줄, 함수명, 타입)는 작성 시점(2026-06-29) 기준이며, 줄번호는 후속 편집으로 밀릴 수 있다.

---

## 0. 문제 진술

env3(실기기 토스 WebView, intoss-private)에서 `.ait.test` 슈트를 돌리는 현재 UX가 어색하다. 에이전트가 다섯 단계를 **수동 오케스트레이션**해야 한다:

```
start_debug({mode:'relay-staging'})       # family 전환
→ start_attach({scheme_url})              # QR 띄우고 폰 스캔 대기
→ (사람이 QR 스캔)
→ evaluate("globalThis.__AIT_CELL__ = {sdkLine,platform}")   # cell 주입
→ run_tests({files})                      # 비로소 테스트
```

두 가지를 원한다:

1. **run_tests auto-attach** — CDP 연결이 없을 때 `run_tests`가 **스스로** QR 대시보드를 띄우고 폰 연결까지 기다린 뒤(+cell 자동 주입) 테스트를 돌린다. 에이전트가 단계별로 제어하지 않는다.
2. **고전 npm script 경로** — 테스트 구동이 MCP 전용이면 안 된다. `pnpm test:env3` 같은 클래식 스크립트로도 실행 가능해야 한다. `devtools-test` bin이 `package.json`에 이미 있으나(`src/test-runner/cli.ts`) `main()`이 stub다.

두 요구는 **같은 막힌 곳**으로 수렴한다: attach 오케스트레이션이 `createDebugServer` 클로저에 인라인되어 있어 MCP 핸들러 밖(run_tests의 auto-attach 분기, CLI main())에서 재사용할 수 없다. run **core**(`runTestFilesOverRelay` 등)는 이미 순수해 `CdpConnection`만 받지만, **연결을 만드는** 부분이 MCP에 갇혀 있다.

---

## 1. 현재 아키텍처 (정독 결과)

### 1.1 run core — 이미 순수, `CdpConnection`만 의존 (재사용 준비됨)

run core는 MCP 결합이 전혀 없다. 인터페이스 경계가 `CdpConnection` 하나다:

| 함수 | 파일:줄 | 시그니처 핵심 | MCP 의존 |
|---|---|---|---|
| `discoverTestFiles(patterns, cwd)` | `src/test-runner/discover.ts:29` | `(string[], string) → Promise<string[]>` (절대경로) | 없음 (순수 Node IO) |
| `bundleTestFile(absPath, opts)` | `src/test-runner/bundle.ts:276` | esbuild iife 번들 + SDK→`window.__sdk` redirect | 없음 (esbuild lazy import) |
| `injectAndRunBundle(conn, code, timeoutMs)` | `src/test-runner/rpc.ts:110` | `Runtime.evaluate`로 주입 + RunReport 수확 | `CdpConnection.send`만 |
| `runTestFilesOverRelay(conn, files, opts)` | `src/test-runner/relay-worker.ts:82` | 파일 순차 bundle→inject→collect, `RelayRunReport` 반환 | `CdpConnection`만 |
| `runWithConnection(conn, files, opts)` | `src/test-runner/cli.ts:71` | `runTestFilesOverRelay` 얇은 래퍼 + printSummary | `CdpConnection`만 |

핵심: `runTestFilesOverRelay`의 docstring이 명시한다 — *"This function does NOT open or manage the relay connection — the caller is responsible for attaching and closing it."* (relay-worker.ts:72-74). 즉 **연결 수명은 호출자 책임**이고, run core는 그걸 받기만 한다. `run_tests` MCP 핸들러(debug-server.ts:1531)도 이 `runWithConnection`을 그대로 호출한다 — `conn`은 daemon이 이미 붙여둔 `router.active`다.

**결론**: run core는 손대지 않는다. 막힌 건 "connection을 누가 만드는가"뿐이다.

### 1.2 attach 오케스트레이션 — `createDebugServer` 클로저에 인라인 (추출 대상)

`createDebugServer(deps)` (debug-server.ts:629) 안에 attach 로직이 **클로저로** 정의되어 있다. 모듈 레벨이 아니라 클로저인 이유는 6개 클로저 변수를 읽기 때문이다(debug-server.ts:691-692 주석이 명시):

| 함수 (클로저) | 파일:줄 | 하는 일 | 읽는 클로저 변수 |
|---|---|---|---|
| `mintAttachUrl(parts)` | :707 | 컴포넌트 → fresh-TOTP attach URL 합성 (단일 mint point) | `getTotpSecret` |
| `buildTotpMeta()` | :719 | TOTP 만료창 메타(`expiresAt`) 빌드 | `getTotpSecret`, `nowMs` |
| `prepareAttach(env, args, conn)` | :737 | env별 검증 + `AttachUrlParts` 번들 + `isMatchingPage`/`buildTimeoutError` 생성 | `getTunnelStatus`, `getTotpSecret`, `stalePageThresholdMs`, `nowMs` |
| `renderAndMaybeWait(prep, wait, timeoutMs, conn)` | :971 | QR 렌더 + 브라우저 open + segmented wait(+in-call TOTP re-mint) | `qrHttpServer`, `onAttachUrlBuilt`, `getTotpSecret`, `nowMs` |
| ↳ `waitWithRemint()` (중첩) | :1011 | segment 슬라이스 대기, code 노후화 시 re-mint | (상위 클로저 전부) |

그리고 **이미 모듈 레벨 순수 함수**인 것:

- `waitForAttachWithEvents(conn, filterFn, timeoutMs, pollIntervalMs)` (debug-server.ts:579) — event-driven attach 대기. `CdpConnection`만 받음. `waitWithRemint`이 segment마다 이걸 호출한다(:1022). **추출 후에도 그대로 재사용** — orchestrator의 대기 primitive.

6개 클로저 변수의 출처 (debug-server.ts:634-653):

| 변수 | 타입 | 출처 | 비고 |
|---|---|---|---|
| `getTunnelStatus` | `() => TunnelStatus` | `deps.getTunnelStatus` | relay 터널 up/wssUrl |
| `getTotpSecret` | `() => string \| undefined` | `deps.getTotpSecret ?? (() => totpSecret)` (:653) | late-bound, env에서 call-time read (#396) |
| `qrHttpServer` | `QrHttpServer \| undefined` | `deps.qrHttpServer` | 127.0.0.1 대시보드. 없으면 text QR fallback |
| `onAttachUrlBuilt` | `(parts) => void` | `deps.onAttachUrlBuilt` | 대시보드 SSE push 콜백 |
| `stalePageThresholdMs` | `number` | `deps.stalePageThresholdMs ?? RELAY_SANDBOX_STALE_PAGE_MS` | ghost page 가드(#610) |
| `nowMs` | `() => number` | `deps.nowMs ?? (() => Date.now())` | 테스트 시계 주입 |

### 1.3 connection을 만드는 곳 — daemon이 lazy boot

CLI가 대비해야 하는 "connection 생성" 경로. env3(`relay-staging`) 기준:

- `bootRelayFamily(opts)` (debug-server.ts:2065) — `startChiiRelay({port:0, verifyAuth, onAuthReject})` (chii-relay.ts:314)로 로컬 relay 기동 → 백그라운드 cloudflared quick tunnel → `createRelayConnection(relay.baseUrl)` (:1887)가 `new ChiiCdpConnection({relayBaseUrl, totpSecret: process.env.AIT_DEBUG_TOTP_SECRET})` (chii-connection.ts:184) 생성. 반환 `BootedFamily`는 `connection` + `getTunnelStatus()` + `stop()`을 노출.
- daemon에서는 `DualConnectionRouter`(:2467)가 `bootRelayFamily`를 `bootLazyFor` 콜백으로 감싸 첫 `start_debug`에 lazy boot한다. `runDebugServer`(:2709)가 그 router + `startQrHttpServer`(:2854) + `createDebugServer`(:2872)를 전부 배선한다.
- TOTP secret은 `loadRelaySecretReadOnly({projectRoot})`가 `<projectRoot>/.ait_relay`를 `process.env.AIT_DEBUG_TOTP_SECRET`로 read-only 로드한다(daemon은 mint 안 함, read만). `switchMode`가 relay boot **전에** 호출한다(:2664).

**CLI는 dual-router/lazy 전체가 필요 없다** — env3 단일 family 1회 boot면 충분하다. `bootRelayFamily`를 직접 부르고, 그 `connection` + `getTunnelStatus`를 orchestrator에 넘기고, 끝나면 `family.stop()`.

### 1.4 cell 주입 — 현재 수동, sdk-example가 소유

`__AIT_CELL__`은 **devtools가 아니라 sdk-example가 소유**한다. `sdk-example/src/test/aitCapture.ts`:

- `globalThis.__AIT_CELL__ = { sdkLine?: '2.x'|'3.x', platform?: 'mock'|'ios'|'android' }` (aitCapture.ts:81, declare global :99).
- `resolvePlatform()`(:135)·`resolveSdkLineSync()`(:156)가 `globalThis.__AIT_CELL__?.{platform,sdkLine}`를 읽어 cell 축을 확정. env3(브라우저)에선 미주입 시 `'2.x'`/`'mock'` fallback이라 **cell이 틀리게 캡처된다** — 그래서 에이전트가 `evaluate`로 손수 주입해야 했다.
- 테스트 번들 안에서 읽으므로, cell 주입은 **테스트 번들 inject 전에 별도 `Runtime.evaluate`로** 페이지 global에 박아야 한다 — 번들 안에 못 섞는다(번들은 매 파일 재실행되고 cell은 세션 전역이라).

devtools 쪽엔 `__AIT_CELL__` 참조가 0건이다(grep 확인) — devtools는 cell **모양**을 모르고 알 필요도 없다. devtools는 "임의의 cell 객체를 attach 직후 페이지에 주입"하는 일반 메커니즘만 제공하면 된다(아래 §4).

### 1.5 소유권 — `test:env3` 스크립트는 어느 패키지?

확인 결과:

- `devtools/package.json` `bin`: `"devtools-test": "./dist/test-runner/cli.js"` (있음).
- `sdk-example/package.json` scripts: `test:env3` **없음**. `.ait.test` 슈트(12개)는 `src/snippets/*/*.ait.test.ts`에 있고, cell 인프라는 `src/test/aitCapture.ts`. vitest alias로 `@apps-in-toss/web-framework` → devtools mock(env1). `@ait-co/devtools` devDep은 현재 None(unplugin은 transitive로 들어와 있을 수 있으나 명시 devDep 아님).

**결론**: 도구(`devtools-test` bin)는 devtools가 소유하고, **스크립트(`test:env3`)는 sdk-example가 소유**한다 — sdk-example가 `"test:env3": "devtools-test 'src/**/*.ait.test.ts' --cell-platform ios"` 식으로 자기 글롭/cell을 박아 호출한다. devtools는 cell 모양을 모르는 일반 bin, sdk-example는 자기 cell 축을 아는 호출자. (이건 `bundle:ait`가 `@apps-in-toss/cli`의 `ait` bin을 sdk-example 스크립트가 부르는 구조와 동형이다.)

---

## 2. 답: attach orchestrator 추출 경계 (질문 1)

### 2.1 추출할 모듈 — `src/mcp/attach-orchestrator.ts` (신규)

`createDebugServer` 클로저의 `mintAttachUrl`/`buildTotpMeta`/`prepareAttach`/`renderAndMaybeWait`/`waitWithRemint`를 **모듈 레벨**로 끌어올린다. 6개 클로저 변수를 명시적 `AttachDeps` 객체로 승격한다. `waitForAttachWithEvents`(이미 순수)는 같은 모듈로 이동(또는 그대로 두고 import) — orchestrator의 대기 primitive.

위치는 `src/mcp/`다(`src/test-runner/`가 아니라). 이유: QR/터널/TOTP는 debug-MCP 인프라이고, `qr-http-server`·`tunnel`·`totp`·`deeplink`가 전부 `src/mcp/`에 있다. test-runner는 이 orchestrator를 **소비**한다(역의존 아님). install-graph 불변식(§3.3)도 이 위치가 안전하다 — orchestrator는 이미 MCP 데몬 그래프에 있는 모듈만 끌어온다.

### 2.2 `AttachDeps` — 6개 클로저 변수의 명시적 승격

```ts
// src/mcp/attach-orchestrator.ts
export interface AttachDeps {
  /** relay 터널 up/wssUrl. CLI는 bootRelayFamily().getTunnelStatus를 그대로 넘긴다. */
  getTunnelStatus(): TunnelStatus;
  /** late-bound TOTP secret (env read at call time, #396). SECRET-HANDLING: 반환값 로그 금지. */
  getTotpSecret(): string | undefined;
  /** 127.0.0.1 QR 대시보드. 없으면 text QR fallback (headless/CLI-no-GUI). */
  qrHttpServer?: QrHttpServer;
  /** attach URL 컴포넌트 확정 직후 콜백 (대시보드 SSE push). CLI는 미주입(no-op). */
  onAttachUrlBuilt?: (parts: AttachUrlParts) => void;
  /** ghost page 가드 임계 (#610). 기본 RELAY_SANDBOX_STALE_PAGE_MS. */
  stalePageThresholdMs?: number;
  /** 테스트 시계 주입. 기본 () => Date.now(). */
  nowMs?: () => number;
  /** GUI 감지 override (테스트/headless). 기본 canOpenBrowser. */
  canOpenBrowser?: () => boolean;
}
```

`canOpenBrowser`를 deps로 추가하는 이유: 현재 `renderAndMaybeWait`이 모듈 함수 `canOpenBrowser()`를 직접 호출(:990)하는데, CLI(특히 `--headless`)와 테스트가 이걸 강제할 수 있어야 한다. 나머지 5개는 기존 클로저 변수 그대로.

### 2.3 추출 함수 시그니처 (타입 스케치)

```ts
// 이미 순수 — 모듈 이동만, 시그니처 무변경
export function waitForAttachWithEvents(
  connection: CdpConnection,
  filterFn: (targets: CdpTarget[]) => boolean,
  timeoutMs: number,
  pollIntervalMs?: number,
): Promise<CdpTarget[]>;

// deps를 첫 인자로 받도록 승격 (구 클로저 변수 → 명시 의존)
export function mintAttachUrl(deps: AttachDeps, parts: AttachUrlParts): string;
export function buildTotpMeta(deps: AttachDeps): AttachTotpMeta | undefined;

export async function prepareAttach(
  deps: AttachDeps,
  env: McpEnvironment,
  args: Record<string, unknown> | undefined,
  conn: CdpConnection,
): Promise<PrepareAttachResult>;

export async function renderAndMaybeWait(
  deps: AttachDeps,
  prep: Extract<PrepareAttachResult, { ok: true }>,
  waitForAttach: boolean,
  callTimeoutMs: number,
  conn: CdpConnection,
): Promise<McpResult>;
```

`PrepareAttachResult`·`AttachUrlParts`·`AttachTotpMeta`·`McpResult`·`McpEnvironment`는 그대로 export해 공유 타입으로 승격(현재 debug-server.ts 내부 type — orchestrator로 이동하거나 별도 types 모듈).

### 2.4 무엇이 순수해지고 무엇이 MCP/CLI별 어댑터로 남는가 (경계선)

**순수해지는 것 (양쪽 공유, deps만 의존):**

- attach URL 합성(`mintAttachUrl`/`buildTotpMeta`), env별 검증·번들(`prepareAttach`), QR 렌더+브라우저 open+segmented wait+re-mint(`renderAndMaybeWait`/`waitWithRemint`), event-driven 대기(`waitForAttachWithEvents`). 전부 `(deps, …)` 시그니처. `CdpConnection`과 `AttachDeps`만 본다.

**MCP별 어댑터로 남는 것:**

- `createDebugServer`의 `start_attach` CallTool 핸들러(debug-server.ts:1211-1277) — MCP request 파싱(`request.params.arguments`), mode prologue/`switchMode`, env-mismatch guard, MCP `McpResult` 반환. 이 핸들러는 추출된 `prepareAttach`/`renderAndMaybeWait`를 `attachDeps`로 호출하는 **얇은 래퍼**가 된다.
- `runDebugServer`(:2709)의 `DualConnectionRouter` + `startQrHttpServer` + lazy boot 배선. 다중 family·`tools/list_changed`·lock은 daemon만의 관심사 — CLI엔 불필요.

**CLI별 어댑터로 남는 것:**

- `cli.ts`의 인자 파싱, `bootRelayFamily` 1회 호출, `AttachDeps` 조립(qrHttpServer/onAttachUrlBuilt 미주입), exit code·stdout 요약, `family.stop()` teardown.

즉 **orchestrator = 순수 코어**, **MCP 핸들러 + CLI main = 두 어댑터**. orchestrator는 어느 쪽도 import하지 않는다(역의존 0).

### 2.5 행동 무변경 보장

PR1(추출)은 **순수 리팩터**다 — `createDebugServer`는 추출된 함수를 `attachDeps`(자기 클로저 변수로 조립)로 호출하도록 바뀔 뿐, 동작은 동일. 기존 debug-server 테스트(start_attach segmented wait/re-mint/timeout/headless 4-path)가 회귀 가드.

---

## 3. 답: run_tests auto-attach (질문 2)

### 3.1 분기 — "이미 연결됨" vs "연결 없음"

현재 `run_tests` 핸들러(debug-server.ts:1469-1542)는 page-missing이면 `pageMissingError`로 즉시 throw한다(:1522-1524). 이걸 **auto-attach 분기**로 교체:

```
run_tests 핸들러:
  1. files/patterns 검증 (기존 :1471-1479)
  2. env = resolveEnvironment()
  3. attached = conn.listTargets().length > 0
  4a. attached → 기존 경로 그대로 (host allowlist → discover → runWithConnection)
  4b. !attached && isRelayEnv(env) → AUTO-ATTACH:
        - prep = prepareAttach(attachDeps, env, args, conn)   # scheme_url/projectRoot는 run_tests args에서
        - renderAndMaybeWait(attachDeps, prep, /*wait*/true, timeoutMs, conn)  # QR 대시보드 + 폰 대기
        - 연결되면 → injectCell(conn, cell)  # §4
        - → 기존 run 경로 (discover → runWithConnection)
  4c. !attached && env === mock(local) → 기존 안내 에러 (mock은 attach 없음)
```

이미 연결된 세션은 **4a로 빠져 행동 무변경** — auto-attach는 page가 0일 때만 발동한다. 그래서 "이미 연결된 세션에서 run_tests"는 안 깨진다(§6 위험 1).

### 3.2 run_tests descriptor 표면 영향

`run_tests`는 이제 attach를 유발할 수 있으므로 입력에 attach 인자를 받아야 한다 — `scheme_url`(env3 필수), `projectRoot`(.ait_relay 로드), 옵션 `cell`(sdkLine/platform). descriptor `inputSchema`에 추가하되 **전부 optional** — 이미 연결된 경우 무시된다. `availableIn`은 `relay`(Tier B) 유지(test 주입은 relay 호스트 전용, #665). mock에서 호출 시 4c 안내.

descriptor 설명문에 한 줄 추가: *"연결이 없으면 QR 대시보드를 띄우고 폰 연결을 기다린 뒤 실행한다(scheme_url 필요)."* — seam을 도구 자체가 안내.

### 3.3 SECRET-HANDLING 유지

auto-attach는 추출된 `renderAndMaybeWait`를 그대로 쓰므로 기존 secret 규율을 자동 상속: TOTP 코드는 `attachUrl`의 `at=` param 안에만, 브라우저로 여는 URL은 `http://127.0.0.1:<port>`(로컬)만(:1090-1092), tunnel/relay wss/scheme host는 stdout/log 금지. run_tests 로그는 count만(:1530-1536) — 파일 경로·번들 코드·결과값 금지(기존 유지). cell 값(sdkLine/platform)은 시크릿이 아니므로 로그 가능.

---

## 4. 답: cell 자동 주입 지점 (질문 4)

### 4.1 devtools 쪽 — 일반 메커니즘 (cell 모양 모름)

devtools는 `__AIT_CELL__`의 sdk-example-특정 모양을 몰라야 한다(§1.4). 일반 주입 helper를 추가:

```ts
// src/test-runner/cell.ts (신규) — react-free, CdpConnection만 의존
export async function injectGlobals(
  conn: CdpConnection,
  globals: Record<string, unknown>,
): Promise<void> {
  // 각 key를 globalThis에 박는 Runtime.evaluate. 테스트 번들 inject 전에 1회.
  // SECRET-HANDLING: globals 값은 비밀이 아님(cell 축) — 단, 값 로그는 최소화.
  const expr = `(() => { Object.assign(globalThis, ${JSON.stringify(globals)}); return true; })()`;
  await conn.send('Runtime.evaluate', { expression: expr, returnByValue: true });
}
```

`run_tests`/CLI는 cell이 주어지면 `injectGlobals(conn, { __AIT_CELL__: cell })`를 **attach 직후, 첫 `bundleTestFile` inject 전에** 1회 호출한다. cell은 세션 global이라 한 번이면 모든 파일에 적용된다(§1.4).

### 4.2 주입 시점 (정확한 위치)

- **MCP auto-attach**: §3.1의 4b에서 `renderAndMaybeWait` 성공(폰 연결) 직후, `runWithConnection` 전. args의 `cell`을 받아 주입. 이미 연결된 4a 경로에선 cell 미주입(에이전트가 이미 했거나 따로 evaluate) — 단, 4a에도 옵션 `cell` 주어지면 주입(idempotent).
- **CLI**: `bootRelayFamily` + attach 성공 직후, run 전. cell은 flag/env에서(§5.3 CLI 인자).

### 4.3 CLI는 cell을 어디서 받나

```
--cell-sdk-line <2.x|3.x>     (또는 env AIT_CELL_SDK_LINE)
--cell-platform <mock|ios|android>   (또는 env AIT_CELL_PLATFORM)
```

`AIT_CELL_PLATFORM`은 sdk-example의 `aitCapture.ts:142`가 이미 Node 경로에서 읽는 env다 — 같은 이름을 CLI flag와 통일해 일관성. sdk-example `test:env3` 스크립트가 `--cell-platform ios`를 박아 호출(§5.3). 둘 다 미지정이면 주입 생략(테스트의 `'2.x'`/`'mock'` fallback이 작동, env1과 동일 — 안전).

---

## 5. 답: `pnpm test:env3` classic path (질문 3) + 단계적 구현 계획 (질문 5)

### 5.1 PR 분할 (3개, 순서 의존)

| PR | 범위 | 검증 | 위험 |
|---|---|---|---|
| **PR1 — orchestrator 추출** (행동 무변경 리팩터) | §2. `src/mcp/attach-orchestrator.ts` 신규: `mint/buildTotpMeta/prepareAttach/renderAndMaybeWait/waitWithRemint/waitForAttachWithEvents`를 `AttachDeps` 시그니처로 모듈 레벨화. `createDebugServer`는 자기 클로저 변수로 `attachDeps` 조립해 호출하는 래퍼로. 공유 타입 export. | 기존 debug-server start_attach 테스트(4-path/re-mint/timeout) green. `pnpm typecheck` 두 라인. `check:mcp-react-free`. | 낮음 — 순수 이동. 클로저→deps 누락 시 컴파일 에러로 잡힘. |
| **PR2 — run_tests auto-attach** | §3 + §4.1·4.2. run_tests 핸들러에 attach 분기, `src/test-runner/cell.ts`(`injectGlobals`), descriptor 인자(scheme_url/projectRoot/cell). | "이미 연결됨" 경로 회귀 테스트(4a 무변경). page-0 + scheme_url → prepare→wait 호출 검증(fake conn). cell 주입 evaluate 검증. | 중 — 기존 수동 플로우 호환(§6 위험 1). page-0 분기만 발동하게 가드. |
| **PR3 — CLI 배선 + test:env3** | §5.2·5.3. `cli.ts main()` 구현(bootRelayFamily + orchestrator + run core + cell). sdk-example `test:env3` 스크립트(별 PR, sdk-example repo). | `devtools-test --help`/glob discovery 기존 테스트 유지. CLI attach는 실기기라 수동 QA(폰 1대) — 단위는 connection 조립까지. install-graph 불변식 §3.3. | 중 — install-graph(§5.4). 실기기 의존이라 CI 자동화 불가, 수동 검증. |

PR1은 PR2/PR3의 전제(공유 orchestrator). PR2/PR3는 PR1 위에서 병렬 가능. sdk-example `test:env3`는 PR3 머지 후 sdk-example repo의 별 PR(§6.2 cross-repo 분리).

### 5.2 `cli.ts main()` — standalone relay attach → run

stub(cli.ts:135-141, "standalone relay attach is not wired yet")를 교체:

```
main(argv):
  1. parseArgs: positionals=globs, --timeout, --cell-sdk-line, --cell-platform,
                --scheme-url (env3 필수), --headless, --project-root
  2. files = discoverTestFiles(positionals, cwd); 0개면 exit 1
  3. family = await bootRelayFamily({ verifyAuth: buildRelayVerifyAuth() })
     # .ait_relay → AIT_DEBUG_TOTP_SECRET 로드(loadRelaySecretReadOnly)를 boot 전에
  4. attachDeps = {
       getTunnelStatus: family.getTunnelStatus,
       getTotpSecret: () => process.env.AIT_DEBUG_TOTP_SECRET,
       qrHttpServer: undefined,        # CLI는 대시보드 없이 text QR (또는 opt-in)
       onAttachUrlBuilt: undefined,    # no-op
       canOpenBrowser: () => !headless,
     }
  5. prep = await prepareAttach(attachDeps, 'relay-dev', { scheme_url }, family.connection)
  6. await renderAndMaybeWait(attachDeps, prep, true, timeoutMs, family.connection)  # text QR + 폰 대기
  7. cell 있으면 await injectGlobals(family.connection, { __AIT_CELL__: cell })
  8. report = await runWithConnection(family.connection, files, { timeoutMs, printSummary: true })
  9. family.stop(); process.exitCode = report.totals.failed > 0 ? 1 : 0
```

CLI는 daemon이 아니므로 lock/router/SSE/tools_list 전부 불필요. `bootRelayFamily` + orchestrator + run core 세 조각만. `qrHttpServer`를 미주입하면 `renderAndMaybeWait`의 path 1/4(text QR fallback, :1080·:1132)로 자연 분기 — 브라우저 대시보드는 daemon 전용. (opt-in `--dashboard`로 `startQrHttpServer`를 CLI에서도 띄우는 건 후속.)

### 5.3 sdk-example `test:env3` 스크립트 (소유권 결론)

sdk-example가 소유(§1.5). 형태:

```jsonc
// sdk-example/package.json scripts
"test:env3": "devtools-test 'src/**/*.ait.test.ts' --cell-platform ios --scheme-url \"$AIT_SCHEME_URL\""
```

- glob·cell·scheme은 **sdk-example가** 자기 맥락으로 박는다(devtools는 모름).
- `AIT_SCHEME_URL`은 `ait deploy --scheme-only` 산출 intoss-private URL(per-run). cell platform은 검증 대상 폰에 맞춰 ios/android.
- devtools는 `devtools-test` bin을 sdk-example의 devDep `@ait-co/devtools`로 제공(현재 None → PR3와 함께 sdk-example가 명시 devDep 추가). `bundle:ait`가 `@apps-in-toss/cli`의 `ait` bin을 부르는 것과 동형 구조.

### 5.4 install-graph 불변식 충돌 점검 (§질문 3 단서)

devtools CLAUDE.md의 **react-free·MCP-only install 불변식**과 충돌하는가?

- `devtools-test` bin(`dist/test-runner/cli.js`)이 끌어오는 것: `discover`(순수 Node), `bundle`(esbuild **lazy import**), `rpc`/`relay-worker`(CdpConnection만), 그리고 PR3에서 추가되는 `bootRelayFamily`/`startChiiRelay`/`ChiiCdpConnection`/`attach-orchestrator`. 이들은 전부 **이미 MCP 데몬 그래프에 있는 모듈**(`chii`·`ws`·`cloudflared`·`qrcode`는 `dependencies`, 동적 import). **react/react-dom은 안 끌어온다** — orchestrator의 QR 대시보드는 `qrHttpServer` 주입 시에만이고 CLI는 미주입(text QR = `qrcode-terminal`). esbuild는 lazy(bundle.ts:60-66 주석)라 import 시점엔 그래프 밖.
- 따라서 `devtools-test`는 react-free 유지. 단 PR3는 `scripts/check-test-runner-dist.sh`(이미 package.json에 배선)에 **test-runner CLI 번들의 react 부재 + esbuild lazy 유지** 체크를 추가/확장해 회귀를 CI 강제한다.
- 주의: CLI가 `startQrHttpServer`를 **정적** import하면 `dashboard.generated.ts`(precompiled string, react-free)는 안전하지만 그래도 CLI는 `--dashboard` opt-in 전까지 **동적 import**로 격리한다(`renderAndMaybeWait`의 qrHttpServer 경로는 주입된 인스턴스만 쓰므로 정적 결합 없음).

---

## 6. 위험·열린 질문 (질문 6)

**위험 1 — auto-attach가 기존 수동 플로우를 깨는가.** 안 깬다(설계상): auto-attach는 `conn.listTargets().length === 0`일 때만 발동(§3.1 4b). 이미 연결된 세션은 4a로 빠져 행동 무변경. 단 **page-0 판정 타이밍**에 주의 — relay-sandbox는 ghost page(stale lastSeenAt, #610)가 남을 수 있어 `listTargets()`가 죽은 page를 0이 아닌 것으로 보고할 위험. `prepareAttach`의 `isSandboxPageFresh`/`stalePageThresholdMs` 가드가 이미 이걸 다루므로 orchestrator 재사용으로 상속되지만, run_tests의 page-0 분기 판정에도 같은 freshness 가드를 써야 한다(단순 `.length > 0` 아님). → **열린 질문**: run_tests의 attach 분기 판정을 `isMatchingPage`(prepareAttach 산출)로 통일할지, 단순 length로 둘지.

**위험 2 — relay 재사용 vs 새 기동.** MCP auto-attach는 daemon의 살아있는 router/relay를 **재사용**(connection은 이미 boot됨, attach만 대기). CLI는 매 실행 **새 relay+tunnel 기동**(daemon 없음) → cloudflared 최초 ~38MB 다운로드 1회 + 매 run 새 quick-tunnel URL(QR 매번 다름). → **열린 질문**: CLI가 살아있는 daemon을 감지해 그 relay에 붙을 수 있나(lock 파일 공유)? 1차는 "CLI는 항상 자기 relay 기동"으로 단순화하고, daemon 공유는 후속(복잡도·lock 경합 회피).

**위험 3 — 테스트 타임아웃 누적.** per-file evaluate 타임아웃 30s(relay-worker 기본) + attach 대기 60s(`waitForAttachTimeoutMs`)가 직렬 누적. 12파일 슈트면 최대 ~6분+attach. CLI는 폰 스캔 대기가 사람 속도라 attach 타임아웃을 넉넉히(CLI 기본 더 길게, `--attach-timeout`). run_tests auto-attach도 segment+re-mint로 최대 600s 대기 가능(:1008 주석) — TOTP 만료를 re-mint가 메우므로 긴 대기 안전.

**위험 4 — 폰 미연결 타임아웃 UX.** attach 타임아웃 시 `buildTimeoutError`(:928)가 "previously attached pages + list_pages 재시도" 안내를 이미 생성. CLI는 이 텍스트를 stderr로 출력 + exit 1. run_tests는 `isError` McpResult로 반환 — 에이전트가 QR 재스캔 유도. → **열린 질문**: 폰 미연결 타임아웃 시 슈트를 fail로 칠지(exit 1) "skipped/no-device"로 칠지 — CI에서 폰 없는 환경 구분 필요(1차: exit 2 = 환경 에러, exit 1 = 테스트 실패로 분리).

**열린 질문 5 — daemon과 CLI의 lock 충돌.** `runDebugServer`는 머신당 단일 lock(`acquireLock`, :2714). CLI가 동시에 자기 relay를 띄우면 lock 경합? CLI는 daemon lock을 안 잡아야 한다(별도 prefix 또는 lock 미사용) — 같은 머신에서 MCP debug 세션과 `pnpm test:env3`가 공존 가능해야. 1차: CLI는 lock 미참여(port 0이라 EADDRINUSE 회피), cloudflared orphan은 port 0이 무해화.

---

## 참고

- run core 재사용 경계: `src/test-runner/relay-worker.ts`(`runTestFilesOverRelay`), `src/test-runner/cli.ts`(`runWithConnection`).
- 추출 대상 클로저: `src/mcp/debug-server.ts:707/737/971/1011`, 순수 primitive `:579`(`waitForAttachWithEvents`).
- connection boot: `src/mcp/debug-server.ts:2065`(`bootRelayFamily`), `:1887`(`createRelayConnection`), `src/mcp/chii-relay.ts:314`(`startChiiRelay`).
- cell 소유: `sdk-example/src/test/aitCapture.ts`(`__AIT_CELL__` sdkLine/platform), env `AIT_CELL_PLATFORM`.
- install-graph 불변식: devtools `CLAUDE.md` "install-graph 불변식" + `scripts/check-mcp-react-free.sh`·`scripts/check-test-runner-dist.sh`.
- 설계 승인 후 구현은 §5 PR 분할로. cross-repo(devtools/sdk-example)는 PR 분리(umbrella §6.2).
