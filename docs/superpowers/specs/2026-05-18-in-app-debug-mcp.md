# Production debug surface — AI-loop via CDP (Chii) + 3-layer gate

**작성일**: 2026-05-18 (초안), 2026-05-19 (개정: AI-loop 우선 재정렬 + Chii/CDP 채택 + 3-layer gate)
**상태**: 설계 (구현 전)
**관련**: umbrella TODO "Debugging MCP Server" backlog, devtools#130 (dev-mode MCP spike), sdk-example v0.1.1 dog-food 회귀

## 배경

`@ait-co/devtools`의 mock + 패널은 개발자가 토스 앱 없이 브라우저에서 미니앱을 만들고 디버깅할 수 있게 한다. 그러나 **production `.ait` 번들이 실제 토스 앱 WebView 안에서 돌 때**는 unplugin이 동작하지 않아 mock도 panel도 없다. 그 상태에서 회귀가 발견되면 디버깅 surface가 0이라 — 폰을 USB로 잇거나 Safari Web Inspector를 띄울 수 없는 폰(특히 안드로이드)에서는 console.log조차 못 본다.

2026-05-18 sdk-example v0.1.1 dog-food에서 이 격차가 명확하게 드러났다: swipe-back race로 미니앱이 종료되는 회귀가 폰에서만 재현되는데, native WebView 안의 `history.length`, console 출력, network 요청을 관측할 surface가 없었다. 결과적으로 가설 검증 한 사이클이 통째로 사람에게 의존했다 — AI가 코드를 고치고 tag를 push해도, "실제로 고쳐졌는지"는 폰을 든 사람이 직접 확인해야만 했다. 사이클당 5–10분, 사람의 in-the-loop 대기 포함.

**이 spec의 1순위 목표는 그 in-the-loop 대기를 없애는 것이다.** AI 에이전트가 회귀를 단독으로 진단·검증할 수 있는 read-only debug surface를 production WebView에 노출한다. 사람이 폰에서 직접 보는 eruda overlay는 같은 transport 위에 얹는 부가 view로 다룬다.

기존 devtools#130 spike PR이 dev mode 한정으로 `devtools_get_mock_state` 등 MCP tool 일부를 노출했지만, transport가 vite dev server에 묶여 있어 production WebView로는 갈 수 없다. 이 spec은 그 surface를 production WebView까지 확장한다.

## 핵심 기술 선택 (2026-05-19 개정)

### CDP (Chrome DevTools Protocol)를 표준 surface로 채택

자작 tool 이름을 정의하는 대신 **CDP를 그대로 노출**한다. AI 도구 생태계가 이미 `chrome-devtools-mcp`(40k stars, Google 공식)로 수렴 중이라 AI host들이 같은 tool 호출 패턴을 쓴다. 우리가 따로 tool registry를 만들면 host마다 별도 등록·문서가 필요하지만, CDP를 쓰면 AI는 이미 아는 surface로 attach.

대안 분석:
- **chrome-devtools-mcp 직접 쓰기**: Chrome 또는 CDP를 노출하는 WebView에만 동작. 토스 WebView는 거의 확실히 CDP 미노출. 직접 적용 불가.
- **Eruda 데이터 소스**: programmatic API가 internal getter 의존 + AI 표준성 0 + 50KB UI 포함. 마이너 프로젝트.
- **자작 DebugClient (~200 LOC)**: 가볍지만 AI 표준 surface가 아니라 host마다 별도 wiring 필요.
- **Chii**: CDP를 non-Chrome WebView 안에서 구현 (`chobitsu` 사용). iOS WKWebView / Android WebView 모두 동작. 같은 maintainer가 eruda도 운영 → 토스 WebView 같은 mobile context가 first-class target. v1.15.5 (2025-08 active).

→ **선택**: Chii를 production 번들 안에 동적 import로 부착 + 우리가 얇은 MCP server(stdio)로 Chii의 WebSocket을 CDP-MCP 어댑터로 wrap. AI host는 `chrome-devtools-mcp` 호환 tool로 호출.

### 3-layer activation gate (앱인토스 production 차단)

debug surface는 **dogfood/staging 진입에만 활성**, 일반 사용자에겐 부재. 세 layer를 모두 통과해야 attach:

| Layer | 메커니즘 | 차단 위협 | 통과 조건 |
|---|---|---|---|
| **A. Build-time** | tag-gated workflow에 `RELEASE_CHANNEL=dogfood\|release` 분기. release 빌드는 `__DEBUG_BUILD__` 상수 false → in-app 코드 + Chii import가 dead code elimination | release 번들 코드에 debug surface 부재. 코드 추출당해도 attach 불가 | `v1.2.3-dogfood` 태그 (release tag는 미포함) |
| **B. Runtime entry scheme** | `_deploymentId` query param 존재 확인. intoss-private:// URL은 dogfood 진입에만 있고 일반 진입 경로엔 없음 | dogfood 빌드가 잘못 일반 entry로 노출돼도 attach 거부 | URL에 `_deploymentId=<uuid>` 존재 |
| **C. Explicit query opt-in** | `?debug=1&relay=<wss-url>` 명시 | 운영자가 모르고 dogfood URL 열어도 attach 안 됨 (의도적 선택만) | `debug=1` + 유효 relay URL |

세 layer 결정 매트릭스:

```
build channel | _deploymentId | debug=1 | 결과
release       | (무관)         | (무관)  | attach 불가 (코드 자체 부재)
dogfood       | 부재           | (무관)  | attach 거부 (entry gate B)
dogfood       | 있음           | 없음    | attach 거부 (opt-in gate C)
dogfood       | 있음           | 있음    | attach
```

Layer B의 신뢰성: 토스 SDK가 `getEntryScheme()` 같은 API를 노출하면 그것을 1순위 시그널로 쓰고 `_deploymentId`는 fallback. Phase 1에서 SDK surface 확인 후 결정 (open question 6).

## 목표 (우선순위 순)

1. **AI 자율 검증 피드백 루프**. AI 에이전트가 회귀 가설을 코드로 옮긴 뒤, 사람 개입 없이 폰 안 production 번들의 상태(history, console, network)를 read해서 가설을 검증한다. v0.1.1 swipe-back처럼 "폰에서만 재현"되는 회귀에 대한 사이클 시간을 사람-루프(5–10분) → AI-루프(<1분)로 단축.
2. **MCP 서버**가 dev mode와 production WebView를 같은 tool 이름·JSONSchema로 노출한다 (ports/adapters). Claude Code / OpenAI Codex / 기타 MCP host에서 동일하게 호출.
3. (부수효과) **In-app debug overlay**(eruda 또는 동급)를 동적 로드 옵션으로 제공한다. 같은 transport 위에 얹으면 운영자가 폰에서 직접 본다. 일반 사용자 영향 0.

## 비목표

- Mock 자체를 production WebView에서 동작시키기 (production은 real SDK가 정답).
- 사용자 디바이스에서 임의 JS 실행 권한을 외부에 노출 (security 섹션 참고).
- Auto-discovery / pairing UX 1.0 (수동 query string + secret으로 충분).
- panel UI를 production에 띄우는 것 (`@ait-co/devtools/panel`은 dev 시각화 도구; in-app overlay는 별도 entry).
- Android remote debugging 대체 — Safari Web Inspector / Chrome remote inspect와 공존, 추가 layer.

## AI 검증 루프 (1순위 시나리오)

AI가 단독으로 회귀를 진단·고치고 검증하는 한 사이클:

```
1. AI: 가설 수립 ("BrowserRouter history.length === 1이라 native swipe가 미니앱 종료로 빠짐")
2. AI: 코드 패치 (setIosSwipeGestureEnabled(false) 등)
3. AI: `git push origin main && gh release create v0.1.x` → tag-gated workflow가 deploy
4. AI: `aitcc app bundles test-push --deployment-id ... --params 'debug=1&relay=<url>&session=<uuid>'`
       → 폰의 토스 앱이 push 알림 → 사람이 탭 (이 한 번만 사람 개입, 또는 dev 폰 자동 탭 자동화)
5. 번들 mount 시 query에서 debug+relay+session 감지, WebSocket relay 연결
6. AI MCP 호출: `devtools_get_history` → `{ length: 1, location: { pathname: '/storage' } }`
7. AI: 가설 확인 ("history.length이 메뉴 진입 후 1 — gesture 막혔는지 검증") → swipe 시뮬 후 다시 read
8. AI: 결과 확인 → 다음 가설 / 종료
```

핵심은 **단계 6–8이 AI tool call만으로 도는 것**. 사람이 폰을 보고 보고할 필요 없음. 단계 4의 push 탭은 v1에선 사람, 추후 dev 폰 자동화(예: Android adb send tap, iOS 개발자 메뉴 자동화)로 분리 phase.

### 부수 시나리오 — 사람이 폰에서 직접 보기 (eruda overlay)

같은 WebSocket transport 위에 eruda 같은 in-app overlay를 동적 import해서 부착하면 사람이 폰에서도 console·network·DOM을 직접 본다. AI 루프와 독립적으로 작동 — overlay 없이도 MCP는 동작, MCP 없이도 overlay는 동작. 둘 다 단순히 같은 DebugClient의 view.

### 부수 시나리오 — dev mode (devtools#130 통합)

`pnpm dev`로 dev server를 띄우면 unplugin이 `mcp: true` 옵션으로 stdio MCP를 띄움. 같은 tool surface, transport만 relay → stdio. AI는 폰 없이도 fixture 페이지를 같은 tool로 검증.

## 아키텍처

### 컴포넌트

```
@ait-co/devtools/in-app   (NEW — production 번들이 dogfood 빌드에서만 import)
  ├─ Gate check (build flag + _deploymentId + ?debug=1)
  ├─ Chii client 동적 import (CDP target — chobitsu 기반)
  └─ Optional AIT meta channel: SDK call trace, mock state 등 CDP가 못 잡는 영역만

@ait-co/devtools/mcp      (확장 — devtools#130 base)
  ├─ CDP relay adapter: Chii의 WebSocket → CDP 그대로 forward (Network/Console/Runtime/DOM domain)
  ├─ AIT domain adapter: 우리가 추가한 SDK call trace 등 비표준 영역
  └─ Transport: stdio (Claude Code / Codex / 기타 MCP host)

debug-relay (NEW — Chii server를 cloudflared quick tunnel로 노출, Workers로 확장)
  ├─ Chii's WebSocket pair (in-app client ↔ MCP server)
  ├─ Session manager (Chii의 target id + 옵션 secret)
  └─ Stateless — relay 자체엔 데이터 저장 0
```

### Tool surface — CDP 표준 + AIT 확장

**CDP 표준 domain (Chii가 제공, 우리는 forward만)** — Phase 1 핵심:

| CDP Method | Output | AI-loop 핵심 |
|---|---|---|
| `Runtime.evaluate` | 임의 JS 실행 (Phase 6에서 ACL) | Phase 6 |
| `Runtime.consoleAPICalled` (event) | console.log/warn/error stream | **★ MVP** |
| `Network.requestWillBeSent` (event) | XHR/fetch 요청 stream | Phase 1 |
| `Network.responseReceived` (event) | 응답 stream | Phase 1 |
| `Page.frameNavigated` (event) | history 변화 stream | **★ MVP** |
| `DOM.getDocument` | DOM 트리 read | Phase 2 |
| `DOMSnapshot.captureSnapshot` | 페이지 snapshot | Phase 2 |

`chrome-devtools-mcp` 호환 tool 이름 (`list_console_messages`, `list_network_requests`, `take_snapshot`, `evaluate_script` 등) 이 MCP 측에서 노출되고, AI host는 동일 호출 패턴 사용.

**Phase 1 MVP**: console + page navigation event stream만. v0.1.1 swipe-back 같은 회귀를 `Runtime.consoleAPICalled` + `Page.frameNavigated`로 진단할 수 있는지가 success metric.

**AIT 확장 domain (CDP가 못 잡는 영역, 별도 namespace)** — Phase 3:

| Method | Output | Notes |
|---|---|---|
| `AIT.getSdkCallHistory` | SDK 호출 trace | `@apps-in-toss/web-bridge` proxy로 wrap |
| `AIT.getMockState` | `window.__ait` snapshot | dev mode only |
| `AIT.getOperationalEnvironment` | `getOperationalEnvironment()` 결과 + sdkVersion | 표준 CDP가 못 잡는 메타 |

CDP의 `Runtime.evaluate`로도 우회 가능하지만 (`Runtime.evaluate({ expression: 'window.__ait' })`), 표준 schema를 갖는 게 AI agent prompt에 명시적이라 유리.

**Tier 2 (write, 별도 phase 6)** — CDP의 `Runtime.evaluate`를 ACL로 gate. eval 권한 없는 read-only session은 evaluate 거부.

### Attach 토폴로지 — MCP server가 채널을 부트스트랩

이 기능의 본질은 "dev server에 무언가를 얹는 것"이 아니라 **AI host (Claude Code 등)가 폰 안 production 번들에 MCP attach하는 채널**이다. 사용자 노트북은 NAT/firewall 우회 매개체일 뿐. 다음 흐름:

```
사용자 ~/.mcp.json:
  "ait-debug": { "command": "pnpm", "args": ["exec", "devtools-mcp"] }

AI host 시작:
  → devtools-mcp stdio spawn
    1. 로컬 :9100에 Chii server 띄움
    2. cloudflared quick tunnel → wss://abc123.trycloudflare.com 발급 (계정 불요)
    3. 사용자 터미널 (또는 MCP tool로) 에 QR + secret token 노출
    4. MCP host에 page list tool 등록 (초기엔 attached page 0)

사용자가 폰에서 dogfood 진입:
  → ?debug=1 query gate 통과 → in-app 동적 import
  → 미니앱 내 attach UI (QR 스캐너 또는 paste form) 가 사용자가 노트북에서 본 wss URL + token 받음
  → wss로 attach, secret 검증
  → Chii가 페이지 인식 → MCP server에 알림 → AI host에 page 1 attached로 노출

AI:
  → CDP-호환 MCP tool 호출 (list_console_messages, list_network_requests, etc.)
  → MCP server가 Chii로 CDP forward → 폰 → 응답
```

토폴로지 옵션:

| | Phase 1 (MVP) | Phase 5 (deferred) |
|---|---|---|
| Tunnel | cloudflared **quick tunnel** (`*.trycloudflare.com`, 무계정 무료) | (선택) public Workers relay |
| 사용자 인프라 | 0 (cloudflared 바이너리만, 이미 dev:phone 의존성) | 0 |
| 우리 인프라 | 0 | Workers (oidc-bridge 패턴 재사용) |
| URL 안정성 | 매 spawn마다 바뀜 (QR로 흡수) | 고정 session URL |
| Multi-tenant | 자동 — 사용자마다 자기 quick tunnel | 우리가 session manager 운영 |
| 비용 | 0 | Workers free tier 추정 충분 |

**Named tunnel은 채택하지 않음** — 도메인 + Cloudflare account 공유가 multi-tenant 깨짐 + 운영비.

폰 attach UI는 in-app overlay 또는 미니앱 자체에 작은 진입점:
1. **QR 스캐너** — 미니앱 안에 `?debug=1`로 진입했을 때 화면 상단에 floating "attach" 버튼. 탭 시 카메라 권한 + QR 스캔.
2. **URL paste** — QR 카메라 실패 시 텍스트 입력 fallback.
3. **first-attach 기억** — 한 번 attach한 (wss URL + token)을 `localStorage`에 보관, 같은 폰에서 다시 dogfood 진입하면 자동 reconnect (Cloudflare quick tunnel URL이 바뀌었으면 재실패 후 다시 QR 요청).

### Transport — dev mode stdio (기존 spike 통합)

devtools#130 패턴 유지. vite dev server가 `@ait-co/devtools/mcp/dev`를 띄우고 panel과 직접 통신. Phase 3에서 production adapter와 tool 이름·schema를 통합. 두 모드는 같은 MCP server bin이 transport flag로 분기 (`devtools-mcp --mode=dev` vs default attach mode).

## Phase plan (AI-loop 우선 재정렬)

### Phase 0 — Spec PR (이 문서)

- `docs/superpowers/specs/2026-05-18-in-app-debug-mcp.md` 작성 + 머지 (2026-05-18, devtools#145). 2026-05-19 AI-loop 우선 개정 PR로 갱신.
- umbrella TODO devtools "Debugging MCP Server" backlog 항목에 본 spec 링크.

### Phase 1 — MCP attach MVP via stdio + cloudflared (CDP-호환 tool)

**목표**: AI host가 `~/.mcp.json` 한 줄 등록으로 폰 production 번들에 read-only attach. CDP의 `Runtime.consoleAPICalled` + `Page.frameNavigated`만으로 v0.1.1 swipe-back 류 회귀 단독 진단.

산출물:
- `@ait-co/devtools/in-app` 신규 entry. 3-layer gate (build flag + `_deploymentId` + `?debug=1`) 통과 시 Chii client 동적 import. 폰 attach UI (QR 스캐너 + paste fallback).
- `@ait-co/devtools/mcp` MCP server bin (`devtools-mcp`). spawn 시 Chii server :9100 + cloudflared quick tunnel + QR/token 출력. CDP 메시지를 `chrome-devtools-mcp` 호환 tool로 wrap.
- 빌드 채널 분기: tag-gated workflow가 `RELEASE_CHANNEL=dogfood|release` 받아 `__DEBUG_BUILD__` 상수 주입.
- secret token으로 attach 인증 (quick tunnel URL 노출돼도 token 없으면 거부).

**MVP success metric**: AI가 sdk-example의 swipe-back fix(v0.1.2) 회귀 1건을, 사람 폰 관찰 없이 CDP `consoleAPICalled` stream + `frameNavigated` read만으로 검증 완료.

테스트:
- vitest: in-app gate 로직 단위 (`_deploymentId` 검출, build flag 분기). Chii client는 jsdom에서 mock.
- e2e: fixture에 dogfood 빌드 시뮬레이션, Playwright가 fake quick tunnel + Chii 띄워 attach 라운드트립.
- 수동 dog-food: sdk-example에 통합 후 폰 실기 1회.

### Phase 2 — DOM·network·snapshot tool 확장

- CDP `DOM.getDocument` + `DOMSnapshot.captureSnapshot` 노출 (페이지 시각 회귀 진단).
- `Network.requestWillBeSent` / `responseReceived` stream을 `list_network_requests` tool로.
- `Page.captureScreenshot` (CDP) → AI가 폰 화면 직접 봄.

### Phase 3 — AIT domain (CDP 미커버 영역) + dev mode 통합

- `AIT.getSdkCallHistory` / `AIT.getMockState` / `AIT.getOperationalEnvironment` 비표준 method 추가. 같은 MCP server가 CDP와 AIT 도메인 둘 다 forward.
- devtools#130 dev mode spike의 tool 이름을 본 spec 명명에 정렬. dev mode는 `devtools-mcp --mode=dev`로 분기, 같은 tool surface 노출.
- 사람용 eruda overlay는 optional peer로 in-app에 부착 (`?debug=1&overlay=eruda`). AI-loop와 독립 — overlay 없이 MCP만, 또는 둘 다 동시.

### Phase 4 — sdk-example dog-food 통합

- `pnpm add -D @ait-co/devtools` + (선택) eruda.
- `src/main.tsx`에 gate (3-layer) + `@ait-co/devtools/in-app` 동적 import.
- 미니앱 안 attach UI 추가 (EnvironmentPage 또는 별도 floating).
- v0.1.3 dogfood tag로 폰 dog-food → 회귀 추적 사이클이 AI 단독으로 도는지 확인.
- README ko/en debug 모드 단락.

### Phase 5 — 공용 Cloudflare Workers relay (선택)

- 노트북 부재 시나리오 위한 옵션. quick tunnel 만으론 충분한 케이스는 Phase 5 미진행.
- `debug-relay` 패키지 (별도 repo 또는 oidc-bridge-cloud 옆). WebSocket pair. session UUID + secret. ACL.
- 폰 attach UI가 wss URL이 trycloudflare인지 debug.aitc.dev인지 가리지 않게 디자인.

### Phase 6 — Write tools (CDP `Runtime.evaluate` ACL)

- CDP `Runtime.evaluate`를 ACL로 gate. read-only token vs write token.
- 폰 화면에 "원격 에이전트 eval 요청 — 허용 / 거부" prompt.
- AIT 도메인의 SDK 호출 wrapper도 같은 ACL.

## Security

3-layer activation gate(상단 매트릭스)가 1차 방어선이고, 아래 표는 gate 통과 후의 transport·tool surface 위협을 다룬다.

| 위협 | 대응 |
|---|---|
| Release 사용자에게 debug surface 노출 | **Layer A (build-time)**. `RELEASE_CHANNEL=release` 빌드는 `__DEBUG_BUILD__=false` 상수로 in-app entry + Chii import가 dead code elimination. 번들에 코드 자체가 부재. |
| dogfood 빌드가 잘못 일반 entry로 노출 | **Layer B (runtime entry scheme)**. `_deploymentId` query 부재 시 attach 즉시 거부. intoss-private:// URL은 콘솔 Deploy Key로만 발급, 일반 사용자 진입 경로 없음. |
| 운영자가 모르고 dogfood URL 열어 attach | **Layer C (explicit opt-in)**. `?debug=1` 명시 + 유효 relay URL이 있어야만 attach 시도. 운영자의 의도적 액션 필요. |
| Quick tunnel URL leak (`*.trycloudflare.com`) | URL 노출만으론 attach 불가. **secret token** (32-byte hex, MCP server spawn 시 생성)을 폰이 QR로 직접 받아 첫 attach 시 서버에 제출, mismatch 시 WS 거부. token은 MCP host에만 머묾. |
| Chii WebSocket 도청 | wss:// 강제 (cloudflared quick tunnel 기본 TLS). secret token 노출 시 token rotate (devtools-mcp 재spawn). relay는 stateless — server-side 영구 저장 0. |
| CDP `Runtime.evaluate`로 임의 JS 실행 | **Phase 1–5에서 evaluate 미노출** — MCP server adapter가 `Runtime.evaluate` method를 화이트리스트에서 제외. Phase 6에서 ACL + 폰 prompt 후 노출. |
| Read tool로 console·network에 묻은 PII 유출 | console arg/network req는 사용자 손에 있던 데이터 → 운영자 책임. relay stateless, server-side 영구 저장 0. metrics-ingest와 다름. dogfood 빌드만 attach 가능하므로 일반 사용자 PII는 처음부터 surface 외부. |
| Chii가 내부 CDP target id를 외부에 노출 | Chii session UUID v4 + secret token gate. 단순 GET `/devtools/...`은 404, WS upgrade + 첫 메시지의 token 검증을 통과해야 target list 회신. |

## Open questions

1. **Chii internal CDP target id 안정성** — Chii는 자체 chobitsu CDP 구현이므로 target id 형식·메시지 schema가 chrome-devtools-mcp의 기대와 어디까지 호환되는지 Phase 1 spike에서 확인. mismatch 발견 시 MCP server adapter가 translation layer 흡수. 회귀 대비 Chii 버전 핀 + smoke test.
2. **Entry scheme 시그널 — `_deploymentId` query vs SDK API** — Layer B는 `_deploymentId` query 존재로 판단. 토스 SDK가 `getEntryScheme()` 또는 동급 API를 노출한다면 그게 1순위 시그널이 되어야 함 (query는 사용자가 직접 만질 수 있는 surface). Phase 1 SDK surface 확인 후 우선순위 결정. fallback은 query.
3. **폰 attach UI 배치** — `?debug=1`로 진입한 미니앱에서 attach UI를 어디 둘 것인가: (a) in-app 자체 floating 버튼 (어느 페이지든 보임), (b) sdk-example의 별도 EnvironmentPage 진입점, (c) overlay 라이브러리 부착 시 그 overlay의 sub-panel. Phase 1 MVP는 (a) — 회귀 진단이 페이지 진입과 무관하게 가능해야 함.
4. **MCP host에서의 session 라우팅** — `~/.mcp.json` 한 줄 등록만으로 자동 활용되는가, 아니면 Claude Code에서 명시적 `attach <token>` step 필요한가. MVP는 env (`AITC_DEBUG_SESSION` token) + 첫 tool 호출 시 implicit attach. Phase 5에서 share-link UX.
5. **Console hook 위치** — `console.log` 자체를 proxy로 감싸면 사용자 코드 stack trace에 frame 1개 추가됨. Chii가 기본 wrapping을 제공하므로 우리 쪽 추가 hook은 최소화. AIT 도메인의 SDK call trace만 별도 proxy + ring buffer.
6. **사람-탭 단계의 자동화** — 사람 개입은 두 매듭이었다: (a) attach UI에서 QR 스캔/URL paste, (b) deploy 후 push 알림 탭/딥링크 발사. **(a)는 해소**: `build_attach_url` MCP tool이 `ait deploy --scheme-only` URL에 `debug=1`+이 세션의 relay wss URL을 끼워 self-attach 딥링크를 만든다 — gate(`src/in-app/gate.ts`)가 이미 `relay` query를 읽어 QR 없이 attach하므로 그 딥링크를 폰에서 여는 순간 자동 연결된다. token은 gate 검증 대상이 아니라(pairing hint) 딥링크에 불필요. 전제 두 가지(딥링크 query 전파 O, WebView CSP가 외부 `target.js` 로드 차단 X)는 확인됨. **(b) 딥링크 발사는 device-control 레이어**(Android `adb shell am start -d "<url>"` / iOS 자동화)로 별도 phase — `build_attach_url` 출력을 그대로 `am start`에 넘기면 진입+attach가 한 번에 닫힌다. 네이티브 제스처 회귀 재현(swipe 등)도 같은 device-control 레이어.
7. **`Runtime.evaluate` ACL UX** — Phase 6에서 write 권한 열 때 per-call 폰 prompt vs session-wide write token vs 둘 다. AI-loop 자율성 vs 사용자 통제 trade-off — 현재 안은 session-wide write token + 첫 발급 시 폰 1회 prompt. Phase 6 spec에서 확정.

## 검증 계획

Phase 1 머지 후 sdk-example PR로 통합 (Phase 4) → `v0.1.3` (또는 별도 dogfood tag) 폰 dog-food. 다음 v0.1.1 잔여 회귀 3건을 AI 단독 검증으로 닫을 수 있는지가 success criteria:

- **Swipe-back race (v0.1.2에서 패치 시도된 항목)** — `Page.frameNavigated` event stream으로 history 변화 추적 + `Runtime.consoleAPICalled`로 patch가 심은 진단 로그 확인. AI가 `setIosSwipeGestureEnabled(false)`가 실제 적용되었는지 폰 관찰 없이 검증.
- **Safe-area top inset 잔존** — `Runtime.evaluate`(Phase 6 전이라면 patch 측에서 미리 `console.log`로 출력) 또는 `DOMSnapshot.captureSnapshot`(Phase 2)에서 `--sat` CSS custom property 값 + viewport 확인.
- **`saveBase64Data` 권한 회귀** — `Runtime.consoleAPICalled` error stream에서 SDK 호출 직후 에러 객체 캡처. AIT 도메인 `getSdkCallHistory`(Phase 3)로 호출 trace 확인.

결과를 본 spec의 "Followup" 섹션에 기록한다. 3건 모두 AI 단독으로 닫히면 success metric 충족 → Phase 2–6 우선순위 재조정. 1건 이상 실패하면 실패 사례별 root cause를 본 섹션에 추가하고 phase 재정렬.

## 비고

이 문서는 **spec PR**이고 실 구현은 별도 PR들로 분할된다. 본 spec이 머지된 시점에 umbrella TODO `devtools > Backlog > Debugging MCP Server` 항목을 "spec 머지됨, Phase 1 작업 가능 (AI-loop MVP)" 상태로 갱신한다.
