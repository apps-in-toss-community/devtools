# 4 시나리오 수동 QA 체크리스트

M1 acceptance 기준: 환경 1(로컬 브라우저), 환경 3(intoss relay dev), 환경 4(live relay)에서 `list_pages → measure_safe_area → call_sdk(getOperationalEnvironment)` 3종 MCP 도구 호출이 동일 JSON envelope(schema 평행성)로 응답해야 한다. 환경 2(AITC Sandbox PWA)는 MCP relay 대상이 아니므로 별도 acceptance 기준을 따른다 — cloudflared 터널 기동 + 실기기 Safari/WebKit에서 `env(safe-area-inset-*)` 실값 관측.

이 문서는 각 환경 진입 절차, 검증 명령, 예상 응답, 실패 처리를 체크리스트로 정리한다. 각 시나리오의 상세 절차는 `docs/scenarios/env-{1,2,3,4}.md`를 함께 참조한다.

---

## 공통 전제조건

- `devtools-mcp` 실행 중 (`npx -y @ait-co/devtools devtools-mcp` 또는 `.mcp.json` 활성화)
- 에이전트(Claude Code 등)가 MCP 서버에 연결된 상태
- MCP tool 목록에 `list_pages`, `measure_safe_area`, `call_sdk` 노출 확인

## schema 평행성 기준

모든 시나리오에서 다음 JSON envelope이 동일하게 존재해야 한다:

| 도구 | 필수 필드 | 타입 |
|---|---|---|
| `list_pages` | `pages` (array), `tunnel` (object) | — |
| `measure_safe_area` | `source`, `sdkInsetsSource`, `sdkInsets`, `cssEnv`, `userAgent` | string, string, object, object, string |
| `call_sdk` | `ok` (boolean), `value` 또는 `error` | — |

환경 1 (`--mode=local`) non-dogfood fixture와 환경 2 non-dogfood에서 `call_sdk` 결과 `ok: false`는 예상된 결과이며 schema 위반이 아니다. `window.__sdkCall` bridge는 dogfood 빌드(`__DEBUG_BUILD__` 정의)에서만 주입된다. `--mode=dev`는 mock state HTTP 폴링을 사용하므로 dogfood 빌드 없이 `ok: true`를 반환한다.

---

## 시나리오 1 — 로컬 브라우저 (환경 1)

상세 절차: [`docs/scenarios/env-1.md`](../scenarios/env-1.md)

### 진입 절차

**방법 A: `--mode=dev` 권장 (Chromium 불필요)**

```bash
# 1. Vite dev 서버 실행 (unplugin mcp: true 옵션 필요)
pnpm dev

# 2. MCP 서버 실행 (dev 모드)
npx -y @ait-co/devtools devtools-mcp --mode=dev
```

**방법 B: `--target=local` (CDP 도구 포함, Chromium 자동 실행)**

```bash
# 1. 빌드
pnpm build
pnpm exec vite build --config e2e/fixture/vite.config.ts

# 2. fixture 서버 실행
pnpm exec vite preview --config e2e/fixture/vite.config.ts --port 4173 &

# 3. MCP 서버 실행
# DOM/screenshot/safe-area CDP tool 필요 시: --target=local (로컬 Chromium CDP direct-attach)
npx -y @ait-co/devtools devtools-mcp --target=local

# AIT mock state만 필요할 때: --mode=dev (Vite dev server mock state, CDP 없음)
# npx -y @ait-co/devtools devtools-mcp --mode=dev
```

### 검증 명령 (에이전트에서 순서대로)

```
1. list_pages
2. measure_safe_area
3. call_sdk("getOperationalEnvironment", [])
```

### 예상 응답

#### `list_pages`

```json
{
  "pages": [{ "url": "http://localhost:4173/", "lastSeenAt": "<iso8601>" }],
  "tunnel": { "up": false },
  "singleAttachModel": true,
  "crashDetectedAt": null
}
```

- `pages` 길이: 1
- `pages[0].url`: `http://localhost:517x/` 또는 `http://localhost:4173/`
- `tunnel.up`: `false`
- `crashDetectedAt`: `null`

#### `measure_safe_area`

`--mode=dev`:
```json
{
  "source": "mock-vite",
  "sdkInsetsSource": "window.__ait",
  "sdkInsets": { "top": 44, "bottom": 34, "left": 0, "right": 0 }
}
```

`--target=local`:
```json
{
  "source": "mock",
  "sdkInsetsSource": "window.__ait",
  "sdkInsets": { "top": 54, "bottom": 34, "left": 0, "right": 0 },
  "cssEnv": { "top": "0px", "bottom": "0px", "left": "0px", "right": "0px" },
  "userAgent": "<desktop Chrome UA>"
}
```

- `--mode=dev`: `source: "mock-vite"`, `sdkInsetsSource: "window.__ait"`
- `--target=local`: `source: "mock"`, `sdkInsetsSource: "window.__ait"`

#### `call_sdk("getOperationalEnvironment", [])`

**`--mode=dev`** (mock state 폴링, dogfood 빌드 불필요):
```json
{ "ok": true, "value": "sandbox" }
```

**`--mode=local`, non-dogfood fixture** (bridge 부재 — 예상된 결과):
```json
{ "ok": false, "error": "window.__sdkCall이 주입되지 않았습니다 (dogfood 빌드가 아닙니다)" }
```

**`--mode=local`, dogfood 빌드 fixture** (`__DEBUG_BUILD__` 정의, bridge 주입):
```json
{ "ok": true, "value": "sandbox" }
```

- `call_sdk("getOperationalEnvironment", [])` 응답의 `value`는 scalar string (`'toss' | 'sandbox'`) — `{environment, sdkVersion}` 객체가 아니다. 객체 형태는 `AIT.getOperationalEnvironment`(mock-only 도구)의 응답이다.
- `--mode=dev`: `ok: true` — dev-mode는 mock state로 답하므로 dogfood 빌드 불필요.
- `--mode=local`, non-dogfood: `ok: false`는 예상된 결과 (bridge 부재) — schema 위반 아님. 환경 2 non-dogfood 정책과 동일.
- `--mode=local`, dogfood: `ok: true`, `value: "sandbox"` (또는 패널 설정값).

### 체크리스트

- [ ] `list_pages` — `pages` 배열 1개, `tunnel.up: false`
- [ ] `measure_safe_area` — `source: "mock"` (`--mode=local`) 또는 `source: "mock-vite"` (`--mode=dev`), `sdkInsetsSource: "window.__ait"`
- [ ] `call_sdk` — `ok` 필드 존재. `--mode=dev` 또는 dogfood fixture면 `ok: true`, non-dogfood local fixture면 `ok: false` (예상된 결과)
- [ ] 3종 응답 모두 JSON envelope 완전

### 실패 처리

| 증상 | 원인 | 처리 |
|---|---|---|
| `list_pages`가 "Unknown tool" | MCP 서버가 이전 버전 | `@ait-co/devtools` 업데이트 후 서버 재시작 |
| `list_pages`가 빈 배열 (`--target=local`) | fixture 서버 미실행 | 서버 재시작 |
| `measure_safe_area` `source: null` (`--mode=dev`) | Vite dev 서버 미실행 또는 `mcp: true` 옵션 누락 | dev 서버 재시작, unplugin 옵션 확인 |
| `measure_safe_area` 에러 (`--target=local`) | MCP 서버가 mock 모드로 실행 안 됨 | `--target=local` 또는 `MCP_ENV=mock` 확인 |
| `call_sdk` `ok: false` ("dogfood 빌드가 아닙니다") | `--target=local`에서 non-dogfood fixture 실행 중 — `window.__sdkCall` bridge 없음 | **예상된 결과**. `--mode=dev`로 전환하거나 dogfood 빌드(`__DEBUG_BUILD__` 정의) fixture 사용. schema 위반 아님 |
| `call_sdk` `ok: false` (dev-mode-unsupported) | 미지원 메서드 — `--mode=dev`에서 CDP bridge 없음 | `--target=local`로 전환하거나 `getOperationalEnvironment` 사용 |
| `call_sdk` `ok: false` (mock SDK 부재) | fixture alias 누락 | `vite.config.ts`의 `resolve.alias` 확인 |

---

## 시나리오 2 — AITC Sandbox PWA (환경 2)

상세 절차: [`docs/scenarios/env-2.md`](../scenarios/env-2.md)

환경 2는 MCP relay 대상이 아니다(환경 3·4가 relay). cloudflared 터널은 데스크톱 vite dev 서버를 폰의 PWA iframe이 fetch하기 위한 HTTP 미리보기 채널이다. 관측은 데스크톱 Safari 원격 검사 또는 화면 관찰로 한다.

### 진입 절차

```bash
# 방법 A: agent-plugin skill 사용
# /ait setup-phone-preview

# 방법 B: 직접 터널 실행
AIT_TUNNEL=1 pnpm exec vite --config e2e/fixture/vite.config.ts

# 폰: https://devtools.aitc.dev/launcher/ 에서 launcher PWA 설치 후 QR 스캔
```

### 관측 방법

#### `env(safe-area-inset-*)` CSS 실값 (주 관측 지표)

데스크톱 Safari 원격 검사 (Develop 메뉴 → 기기 선택 → 현재 탭 inspect):

```js
const el = document.createElement('div');
el.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
el.style.paddingTop = 'env(safe-area-inset-top)';
document.body.appendChild(el);
console.log('safe-area-inset-top:', getComputedStyle(el).paddingTop);
document.body.removeChild(el);
```

- **환경 2 기대값**: 노치 있는 기기에서 `"47px"` 등 양수 (기기 모델에 따라 다름)
- **환경 1 기준값**: `"0px"` (desktop Chromium — safe-area inset 없음)

Safari 원격 검사를 사용할 수 없는 경우, launcher setup 화면의 padding이 노치 아래에서 시작하는지 눈으로 확인한다.

#### SDK 호출 확인

환경 2는 토스 WebView 브리지가 없으므로 `getOperationalEnvironment()` 호출 시 mock 응답(`'toss' | 'sandbox'`) 반환 — 실 SDK 응답이 아님(예상된 결과).

실기기에서 SDK 동작 검증이 필요하면 환경 3으로 진행한다.

### 체크리스트

- [ ] `AIT_TUNNEL=1 pnpm exec vite ...` 기동 시 터미널에 `*.trycloudflare.com` URL과 QR 출력됨
- [ ] launcher에서 QR 스캔 또는 URL 붙여넣기 후 dev 앱이 iframe 전체 화면으로 로드됨
- [ ] 환경 2에서 `env(safe-area-inset-top)` 또는 `env(safe-area-inset-bottom)` 값이 양수로 관측됨 (또는 화면 관찰로 대체)
- [ ] 환경 1(데스크톱 브라우저)에서 동일 값이 `0px`임을 확인

### 실패 처리

| 증상 | 원인 | 처리 |
|---|---|---|
| launcher iframe 빈 화면 / CORS 오류 | cloudflared 터널 미실행 또는 URL 오입력 | `AIT_TUNNEL=1 pnpm exec vite ...` 재실행 후 URL 재확인 |
| `env(safe-area-inset-top)` 값이 `0px` | 노치 없는 기기이거나 standalone 모드 아님 | 홈 화면 아이콘으로 재진입 (standalone 모드 확인) |
| Safari 원격 검사에 기기 미노출 | Mac Safari "웹 개발자용 기능" 미활성화 또는 USB 미연결 | Safari 설정 → 고급 → "웹 개발자용 기능" 활성화 후 USB 재연결 |

---

## 시나리오 3 — intoss-private relay dev (환경 3)

상세 절차: [`docs/scenarios/env-3.md`](../scenarios/env-3.md)

### 진입 절차

```bash
# 1. devtools MCP 실행 (debug 모드, relay env 명시)
MCP_ENV=relay npx -y @ait-co/devtools devtools-mcp

# 2. dogfood bundle deploy
ait build
ait deploy --scheme-only
# → intoss-private://aitc-sdk-example?_deploymentId=<uuid> 출력

# 3. relay URL 포함 deep-link 생성
# build_attach_url 도구로 scheme URL + debug=1&relay=<wss> 생성

# 4. QR 스캔 (단일 정식 경로)
# 실기기 토스 앱에서 QR 스캔
```

### 검증 명령

```
1. build_attach_url(scheme_url, wait_for_attach=true)
2. list_pages
3. measure_safe_area
4. call_sdk("getOperationalEnvironment", [])
```

### 예상 응답

#### `list_pages`

```json
{
  "pages": [{ "url": "intoss-private://aitc-sdk-example?_deploymentId=<uuid>", "lastSeenAt": "<iso8601>" }],
  "tunnel": { "up": true },
  "singleAttachModel": true
}
```

- `pages[0].url`: `intoss-private://` scheme + `_deploymentId` 포함
- `tunnel.up`: `true`

#### `measure_safe_area`

```json
{
  "source": "relay-dev",
  "sdkInsetsSource": "window.__sdk",
  "sdkInsets": { "top": 44, "bottom": 34, "left": 0, "right": 0 },
  "userAgent": "<Toss WebView UA>"
}
```

- `source`: `"relay-dev"`
- `sdkInsetsSource`: `"window.__sdk"`
- `sdkInsets.top`: 44–54 CSS px (토스 앱 nav bar 높이)
- `userAgent`: `Toss WebView` / `Mobile Safari` 포함

#### `call_sdk("getOperationalEnvironment", [])`

```json
{ "ok": true, "value": "toss" }
```

- `ok`: `true`
- `value`: scalar string (`'toss' | 'sandbox'` — 실기기 검증 후 확정 필요)
- 참고: `value`는 scalar이며 `{environment, sdkVersion}` 객체가 아니다

### 체크리스트

- [ ] `list_pages` — `intoss-private://` scheme, `tunnel.up: true`, `lastSeenAt` 30초 이내
- [ ] `measure_safe_area` — `source: "relay-dev"`, `sdkInsetsSource: "window.__sdk"`, `sdkInsets.top` 44–54
- [ ] `call_sdk` — `ok: true`, `value` scalar string 존재
- [ ] 3종 응답 모두 JSON envelope 완전
- [ ] `measure_safe_area` diff vs 환경 1: `source`, `sdkInsetsSource`, `userAgent`, `sdkInsets.top` 모두 의도된 diff (whitelist 등록됨)

### 실패 처리

| 증상 | 원인 | 처리 |
|---|---|---|
| `list_pages` 빈 배열 | relay attach 미완료 | `wait_for_attach=true` 확인, QR 재스캔 |
| `call_sdk` `ok: false` | dogfood bundle이 아닌 일반 bundle | `ait deploy` 재실행 후 deep-link 갱신 |
| `sdkInsets.top` 0 | non-dogfood 경로 (bridge 없음) | 환경 3 진입 경로(QR/deep-link) 확인 |
| TOTP 인증 실패 | `AIT_DEBUG_TOTP_SECRET` 미설정 또는 불일치 | relay 서버와 동일 시크릿 확인 |

---

## 시나리오 4 — 배포된 앱 live relay debug (환경 4)

상세 절차: [`docs/scenarios/env-4.md`](../scenarios/env-4.md)

### 진입 절차

```bash
# 1. devtools MCP 실행 (debug 모드, LIVE env 명시 — relay-live 필수)
MCP_ENV=relay-live npx -y @ait-co/devtools devtools-mcp
# MCP_ENV=relay-live 만 LIVE side-effect guard를 활성화한다
# MCP_ENV=relay 또는 미설정 시 relay-dev fallback → LIVE guard 비활성화(실유저 영향 위험)

# 2. 검수 통과 + OPENED 상태의 앱 필요 (miniAppId: 31146)
# aitcc app status 31146 으로 OPENED 확인

# 3. live bundle scheme URL 획득
ait deploy --scheme-only
# → intoss-private://aitc-sdk-example?_deploymentId=<live-uuid>

# 4. build_attach_url로 deep-link 생성 후 QR 스캔
```

### 검증 명령

```
1. build_attach_url(scheme_url, wait_for_attach=true)
2. list_pages
3. measure_safe_area
4. call_sdk("getOperationalEnvironment", [], confirm: true)
```

`call_sdk`에 `confirm: true` 필수 — LIVE guard가 없으면 side-effect 호출을 거부한다.

### 예상 응답

#### `list_pages`

```json
{
  "pages": [{ "url": "intoss-private://aitc-sdk-example?_deploymentId=<live-uuid>", "lastSeenAt": "<iso8601>" }],
  "tunnel": { "up": true },
  "singleAttachModel": true,
  "crashDetectedAt": null
}
```

#### `measure_safe_area`

```json
{
  "source": "relay-live",
  "sdkInsetsSource": "window.__sdk",
  "sdkInsets": { "top": 44, "bottom": 34, "left": 0, "right": 0 },
  "userAgent": "<Toss WebView UA>"
}
```

#### `call_sdk("getOperationalEnvironment", [], confirm: true)`

```json
{ "ok": true, "value": "toss" }
```

- `ok`: `true`
- `value`: scalar string (`'toss' | 'sandbox'` — 실기기 검증 후 확정 필요)
- 참고: `value`는 scalar이며 `{environment, sdkVersion}` 객체가 아니다

### 체크리스트

- [ ] `list_pages` — live `_deploymentId` 포함, `tunnel.up: true`, `crashDetectedAt: null`
- [ ] `measure_safe_area` — `source: "relay-live"`, `sdkInsetsSource: "window.__sdk"`
- [ ] `call_sdk` — `ok: true`, `value` scalar string 존재 (`confirm: true`로 호출)
- [ ] 3종 응답 모두 JSON envelope 완전
- [ ] read-only 모드 준수 — side-effect 있는 SDK 호출(navigate, IAP 등)은 `confirm: true` 후 호출

### 실패 처리

| 증상 | 원인 | 처리 |
|---|---|---|
| `call_sdk` LIVE guard 거부 | `confirm: true` 누락 | `call_sdk("getOperationalEnvironment", [], confirm: true)`로 재호출 |
| `call_sdk` `value: "sandbox"` 또는 dev 토큰 | dogfood(dev) bundle로 진입 | live bundle `_deploymentId` 확인 |
| `list_pages` `crashDetectedAt` non-null | 앱 크래시 | crash report 분리 후 환경 3에서 디버깅 |
| 앱이 OPENED 상태 아님 | 검수 미완료 | `aitcc app status 31146` 확인 |
| `measure_safe_area` `source: "relay-dev"` | `MCP_ENV=relay-live` 미설정 | `MCP_ENV=relay-live` 확인 후 서버 재시작 |

---

## 4 시나리오 acceptance 매트릭스

아래 표는 한 번의 QA 세션에서 모든 체크리스트를 통과하면 "M1 평행성 검증 완료"로 마킹할 수 있는 기준이다.

| 시나리오 | `list_pages` schema | `measure_safe_area` schema | `call_sdk` schema | 통과 일자 |
|---|---|---|---|---|
| 1a (로컬 브라우저, `--mode=dev`) | `pages[]`, `tunnel.up: false`, `devMode: true` | `source: "mock-vite"` | `ok: true`, `value` scalar string (mock state 폴링, dogfood 불필요) | — |
| 1b (로컬 브라우저, `--target=local`) | `pages[]`, `tunnel.up: false` | `source: "mock"` | non-dogfood fixture: `ok: false` 예상 / dogfood fixture: `ok: true`, `value` scalar | — |
| 2 (AITC Sandbox PWA) | cloudflared 터널 URL + QR 출력 | `env(safe-area-inset-*)` 실값이 양수 (실기기 WebKit 검증) | `getOperationalEnvironment()` mock 응답 반환 (`'toss' \| 'sandbox'`) | — |
| 3 (intoss dev relay) | `pages[]`, `tunnel.up: true`, intoss-private URL | `source: "relay-dev"`, `sdkInsetsSource: "window.__sdk"` | `ok: true`, `value` scalar string | — |
| 4 (live relay) | `pages[]`, `tunnel.up: true`, live deploymentId | `source: "relay-live"`, `sdkInsetsSource: "window.__sdk"` | `ok: true`, `value` scalar string (`confirm: true`로 호출) | — |

통과 후 이 표의 "통과 일자"를 채우고, [#291](https://github.com/apps-in-toss-community/devtools/issues/291)의 체크리스트 항목을 닫는다.

---

## 자동화 대응 — fidelity-qa parity snapshot

수동 체크리스트와 병행해 `scripts/fidelity-qa/` 가 snapshot 비교를 자동화한다:

```bash
# mock 기준 스냅샷 (CI, 환경 변수 불필요)
pnpm qa:fidelity --scenario-parity

# relay 포함 diff (로컬, WSS_URL 환경 변수 필요)
WSS_URL=wss://... pnpm qa:fidelity --scenario-parity --runner=both --diff
```

- `--scenario-parity`: `list_pages`, `measure_safe_area`, `call_sdk(getOperationalEnvironment)` 3종 schema 검증 probe 활성화
- `WSS_URL` 없으면 relay probe는 skip (CI 안전)
- 의도된 diff(source, sdkInsetsSource, userAgent, sdkInsets.top 등)는 `whitelist.json`에 reason과 함께 등록

---

커뮤니티 오픈소스 프로젝트입니다.
