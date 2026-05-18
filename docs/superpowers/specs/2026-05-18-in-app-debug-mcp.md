# In-app debug surface + MCP relay for production mini-apps

**작성일**: 2026-05-18
**상태**: 설계 (구현 전)
**관련**: umbrella TODO "Debugging MCP Server" backlog 항목, devtools#130 (dev-mode MCP spike), sdk-example v0.1.1 dog-food 회귀

## 배경

`@ait-co/devtools`의 mock + 패널은 개발자가 토스 앱 없이 브라우저에서 미니앱을 만들고 디버깅할 수 있게 한다. 그러나 **production `.ait` 번들이 실제 토스 앱 WebView 안에서 돌 때**는 unplugin이 동작하지 않으므로 mock도 panel도 없다. 그 상태에서 회귀가 발견되면 디버깅 surface가 0이라 — 폰을 USB로 잇거나 Safari Web Inspector를 띄울 수 없는 폰(특히 안드로이드)에서는 console.log조차 못 본다.

2026-05-18 sdk-example v0.1.1 dog-food에서 정확히 이 문제가 드러났다: swipe-back race로 미니앱이 종료되는 회귀가 폰에서만 재현되는데, native WebView 안의 `history.length`, console 출력, network 요청을 관측할 surface가 없어 가설 검증에 한 사이클(코드 push → tag → workflow → test-push → 폰 실행 → 결과 보고)이 통째로 필요하다. 사이클당 5–10분.

기존 devtools#130 spike PR이 dev mode 한정으로 `devtools_get_mock_state` 등 MCP tool 일부를 노출했지만, transport가 vite dev server에 묶여 있어 production WebView로는 갈 수 없다.

이 spec은 그 surface를 production WebView까지 확장한다.

## 목표

1. 토스 앱 WebView 안에서 도는 production `.ait` 번들에 **in-app debug overlay**(eruda 또는 동급)를 동적 로드 옵션으로 제공한다. 일반 사용자는 영향 0.
2. 같은 번들이 외부 **MCP server**에 WebSocket 등으로 연결되어, AI 에이전트(Claude Code, OpenAI Codex 등)가 폰 안 미니앱의 상태를 read/write할 수 있게 한다.
3. 1과 2는 같은 client SDK를 공유한다 — overlay는 사람용, MCP는 에이전트용, transport는 동일.
4. devtools#130의 dev-mode tool surface와 production surface가 **같은 tool 이름 + JSONSchema**를 쓰도록 ports/adapters로 통합한다.

## 비목표

- Mock 자체를 production WebView에서 동작시키기 (production은 real SDK가 정답).
- 사용자 디바이스에서 임의 JS 실행 권한을 외부에 노출 (security 섹션 참고).
- Auto-discovery / pairing UX 1.0 (수동 query string + secret으로 충분).
- panel UI를 production에 띄우는 것 (`@ait-co/devtools/panel`은 dev 시각화 도구; in-app overlay는 별도 entry).
- Android remote debugging 대체 — Safari Web Inspector / Chrome remote inspect와 공존, 추가 layer.

## 사용 시나리오 (UX)

### 시나리오 A: 폰에서 직접 디버깅

1. 운영자가 `intoss-private://aitc-sdk-example?debug=1&_deploymentId=...` URL을 폰에서 연다 (또는 `aitcc app bundles test-push --params 'debug=1'`로 push).
2. 번들 mount 시 query string에 `debug=1` 있음을 감지, `@ait-co/devtools/in-app`을 동적 import해서 attach.
3. 화면 우측 하단에 작은 톱니바퀴 floating button. 탭하면 eruda 같은 console·network·DOM·history 패널이 sliding up.
4. 운영자가 swipe back 직전·직후의 `history.length`, console 출력, network 요청을 폰에서 직접 본다.

### 시나리오 B: AI 에이전트가 원격으로 디버깅

1. 시나리오 A처럼 폰이 in-app debug client를 띄움. 이때 query에 `relay=https://debug-relay.aitc.dev/?session=abc123` 또는 미리 ENV에 박힌 default가 함께 들어옴.
2. Client가 relay에 WebSocket 연결. session ID로 채널 격리.
3. 개발자 머신에서 `aitcc debug attach --session abc123` 또는 `~/.mcp.json`에 `@ait-co/devtools/mcp` 추가.
4. Claude Code 세션이 `devtools_get_history_depth`, `devtools_get_console_logs`, `devtools_eval('history.go(-1)')` 같은 tool을 호출 → relay → 폰 client → 응답.

### 시나리오 C: dev mode (기존 devtools#130 흐름 통합)

1. `pnpm dev`로 dev server 띄우고 unplugin이 `mcp: true` 옵션으로 켜져 있음.
2. dev server가 stdio MCP server 띄우고 같은 tool surface 제공.
3. relay layer는 안 거치고 직접 채널.

세 시나리오 모두 **client 측 코드와 tool definition은 동일** — adapter만 다름.

## 아키텍처

### 컴포넌트

```
@ait-co/devtools/in-app   (NEW)
  ├─ eruda 동적 import
  ├─ DebugClient: 상태 capture (history, console, network, DOM, SDK mock)
  └─ Transport: WebSocket relay 또는 dev stdio

@ait-co/devtools/mcp      (확장 — devtools#130 base)
  ├─ Tool registry (JSONSchema)
  ├─ Tool implementations
  │  ├─ dev adapter (현재 spike) — vite dev server에서 직접 mock state read/write
  │  └─ production adapter (NEW) — relay client로 MCP request를 폰 client에 forward
  └─ Transport: stdio (Claude Code etc.)

debug-relay (NEW, 별도 repo 또는 cloud sub-package)
  ├─ Cloudflare Workers WebSocket pair (in-app client ↔ MCP server)
  ├─ Session manager (UUID + 옵션 secret으로 page-MCP pair 매칭)
  └─ Stateless — relay 자체엔 데이터 저장 0
```

### Tool surface (commonized)

dev와 production이 같은 이름·schema를 쓰도록 정의. Tier 1 (read-only) 먼저:

| Tool | Input | Output | Dev | Prod |
|---|---|---|---|---|
| `devtools_get_environment` | — | `{ operationalEnv, userAgent, viewport, sdkVersion? }` | ✓ | ✓ |
| `devtools_get_history` | — | `{ length, state, location: { pathname, search, hash } }` | ✓ | ✓ |
| `devtools_get_console_logs` | `{ since?, level? }` | `Array<{ ts, level, args }>` | ✓ | ✓ |
| `devtools_get_network_requests` | `{ since? }` | `Array<{ url, method, status, ts }>` | ✓ | ✓ |
| `devtools_get_mock_state` | — | `window.__ait` snapshot | ✓ | n/a (real SDK) |
| `devtools_get_sdk_call_history` | — | SDK 호출 trace | ✓ | wrapping 필요 (별도 phase) |

Tier 2 (write, 별도 phase):

| Tool | Notes |
|---|---|
| `devtools_eval` | 임의 JS 실행. Security 우려 (아래) — `--allow-eval` flag로만 활성화. |
| `devtools_call_sdk` | SDK 함수 호출 (예: `setIosSwipeGestureEnabled({isEnabled:false})`). |
| `devtools_navigate` | `history.go(-1)` / `pushState` 등 router 조작. |

### Transport — production WebSocket relay

가벼운 옵션부터:

1. **개발자 머신 + `pnpm dev:phone` quick tunnel 재사용** (제로 인프라). 노트북이 켜져 있어야 작동. 폰 client가 `?relay=https://abc123.trycloudflare.com/debug` 처럼 트레일 받아 연결.
2. **공용 Cloudflare Workers relay** (`debug.aitc.dev` 또는 `oidc-bridge.aitc.dev`처럼 Workers per-tenant 패턴). 운영자가 url을 짧게 생성 (`aitcc debug session new` → `relay=...&session=abc123`).
3. **WebRTC P2P** (relay-less). NAT traversal로 STUN/TURN 필요해서 1.0 범위 아님.

권장: **시작은 1번** (zero infra), **공용 인스턴스는 다음 phase**.

### Transport — dev mode stdio (기존 spike)

기존 devtools#130 패턴 유지. vite dev server가 `@ait-co/devtools/mcp/dev`를 띄우고, panel과 직접 통신.

## Phase plan

### Phase 0 — Spec PR (이 문서, 이번 PR)

- `docs/superpowers/specs/2026-05-18-in-app-debug-mcp.md` 작성 + 머지.
- umbrella TODO devtools "Debugging MCP Server" backlog 항목에 본 spec 링크.

### Phase 1 — `@ait-co/devtools/in-app` MVP (eruda only)

- 새 entry `@ait-co/devtools/in-app`. `package.json` exports + tsdown 추가.
- `import('eruda').then(m => m.default.init())` 한 줄 동적 import. eruda는 **optionalPeerDependency** — 사용자가 명시 install (`pnpm add -D eruda`).
- query string `?debug=1` 또는 ENV `DEVTOOLS_DEBUG` 가드.
- README에 sdk-example 적용 예시. 본 repo는 패키지만 노출, 적용은 sdk-example 측.

테스트:
- vitest는 eruda mock하고 attach 함수 단위 검증.
- e2e fixture가 production 모드 build에 eruda를 부착해 floating button이 뜨는지 Playwright로 확인.

### Phase 2 — sdk-example 통합 (별도 PR, 다른 repo)

- `pnpm add -D eruda @ait-co/devtools`.
- `src/main.tsx`에 query gate + `@ait-co/devtools/in-app` 동적 import.
- README ko/en에 debug 모드 사용법 1단락.
- 새 release tag → workflow가 deploy → test-push로 폰에서 확인.

### Phase 3 — Tool surface 통합 + dev adapter 정리

- devtools#130 spike의 tool 이름을 본 spec의 6개 tool로 rename + JSONSchema 명세 추가.
- dev adapter가 본 spec tool surface 전부 구현 (`devtools_get_history`는 dev에서도 의미 있음 = fixture iframe의 history).
- Spike PR을 새 tool surface 기반으로 refresh.

### Phase 4 — Production WebSocket relay client

- DebugClient에 WebSocket transport 추가 (eruda는 그대로).
- 노트북 dev server quick tunnel 모드 — `aitcc debug serve` 또는 `pnpm dev:phone --debug-relay`로 폰 client가 붙을 endpoint 노출.
- MCP server production adapter — relay client 측에서 connect → 같은 tool 호출.

### Phase 5 — 공용 Cloudflare Workers relay (별도 repo 또는 oidc-bridge-cloud 옆)

- `debug-relay` 패키지. WebSocket pair. session UUID + secret.
- 운영자가 `aitcc debug session new`로 short link 발급.
- `debug.aitc.dev` 호스트.

### Phase 6 — Write tools + security gate

- `devtools_eval` 등 write tools. `--allow-eval` flag 또는 client 측에서 명시 opt-in.
- relay session에 ACL 추가 (read-only 토큰 vs write 토큰).
- 폰 화면에 "원격 에이전트 연결됨 — eval 허용 / 거부" prompt.

## Security

| 위협 | 대응 |
|---|---|
| 임의 코드 실행 (XSS-equivalent in production bundle) | `?debug=1` query는 **운영자가 직접 만든 URL에서만** 들어옴 (intoss-private URL은 콘솔 API 키로만 발급). 일반 사용자 진입 경로 없음. eruda 자체엔 eval surface 있으나 폰 owner만 접근. |
| Relay 도청 (WebSocket 평문) | wss:// 강제. session UUID는 unguessable v4. 옵션 secret으로 추가 인증. relay 자체는 stateless (TURN 같이). |
| 잘못된 deploy로 production에 eruda 노출 | bundle entry `if` 가드는 `import.meta.env.DEV`가 아니라 query string 기반. 잘못 들어가도 query 없으면 inactive. tag-gated workflow는 `?debug=1` 자동 추가 안 함. |
| `devtools_eval` 무한 권한 | Phase 6에서 ACL + prompt. Phase 1–5에선 eval 미노출. |
| Relay endpoint enumeration | Cloudflare Workers의 path-based session ID. 단순 GET은 404. WS upgrade에서만 session 확인. |
| PII (console arg 등) | relay는 stateless. eruda는 client only. 운영자가 화면 캡처 시 손수 redact 책임. metrics-ingest와 다르게 server-side 영구 저장 0. |

## Open questions

1. **eruda vs vConsole** — eruda는 50KB gzip + 다양한 패널, vConsole은 25KB + console focus. Phase 1 MVP는 eruda 추천 (DOM/network 패널이 swipe-back 같은 회귀에 결정적). 사용자 결정 사항.
2. **Optional peer vs bundled** — eruda를 `@ait-co/devtools`의 peer로 두면 사용자가 install하지만 graph 깨끗. dependency로 두면 즉시 동작하지만 prod 번들에 50KB 묻을 가능성 (사용자가 `/in-app`을 import하지 않으면 tree-shake되긴 함). 권장: peer.
3. **Session UUID 발급 책임** — `aitcc debug session new` 같은 console-cli 통합 시점이 언제인지. Phase 5와 묶을 수도, Phase 4 노트북 모드는 quick tunnel URL 자체가 session 역할이라 별도 발급 불요.
4. **dev 모드의 panel과 in-app overlay 동시 사용** — 같은 페이지에 panel + eruda가 떠도 충돌 없는지 확인. 충돌 시 in-app overlay는 `getOperationalEnvironment() === 'toss'`에서만 활성화하도록 가드.

## 검증 계획

- Phase 1 머지 후 sdk-example PR로 통합 → `v0.1.2` 또는 별도 tag로 폰 dog-food.
- 회귀 (swipe-back, safe-area 잔존)를 floating panel의 history.length·console·network 출력으로 측정.
- 결과를 본 spec의 "Followup" 섹션에 기록 후 Phase 2–6 우선순위 재조정.

## 비고

이 문서는 **spec PR**이고 실 구현은 별도 PR들로 분할된다. 본 spec이 머지된 시점에 umbrella TODO `devtools > Backlog > Debugging MCP Server` 항목을 "spec 머지됨, Phase 1 작업 가능" 상태로 갱신한다.
