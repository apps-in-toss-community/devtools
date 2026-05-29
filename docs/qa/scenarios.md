# 4 시나리오 수동 QA 체크리스트

M1 acceptance 기준: 4 시나리오 각각에서 `list_pages → measure_safe_area → call_sdk(getOperationalEnvironment)` 3종 MCP 도구 호출이 동일 JSON envelope(schema 평행성)로 응답해야 한다.

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

환경 2 non-dogfood에서 `call_sdk` 결과 `ok: false`는 예상된 결과이며 schema 위반이 아니다.

---

## 시나리오 1 — 로컬 브라우저 (환경 1)

상세 절차: [`docs/scenarios/env-1.md`](../scenarios/env-1.md)

### 진입 절차

```bash
# 1. 빌드
pnpm build
pnpm exec vite build --config e2e/fixture/vite.config.ts

# 2. fixture 서버 실행
pnpm exec vite preview --config e2e/fixture/vite.config.ts --port 4173 &

# 3. MCP 서버 실행 (local 모드)
npx -y @ait-co/devtools devtools-mcp --mode=local
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

```json
{
  "source": "mock",
  "sdkInsetsSource": "window.__ait",
  "sdkInsets": { "top": 54, "bottom": 34, "left": 0, "right": 0 },
  "cssEnv": { "top": "0px", "bottom": "0px", "left": "0px", "right": "0px" },
  "userAgent": "<desktop Chrome UA>"
}
```

- `source`: `"mock"`
- `sdkInsetsSource`: `"window.__ait"`

#### `call_sdk("getOperationalEnvironment", [])`

```json
{ "ok": true, "value": { "environment": "sandbox" } }
```

- `ok`: `true`
- `value.environment`: `"sandbox"` (또는 패널 설정값)

### 체크리스트

- [ ] `list_pages` — `pages` 배열 1개, `tunnel.up: false`
- [ ] `measure_safe_area` — `source: "mock"`, `sdkInsetsSource: "window.__ait"`
- [ ] `call_sdk` — `ok: true`, `value.environment` 존재
- [ ] 3종 응답 모두 JSON envelope 완전

### 실패 처리

| 증상 | 원인 | 처리 |
|---|---|---|
| `list_pages`가 빈 배열 | fixture 서버 미실행 또는 MCP 모드 불일치 | `--mode=local` 확인, 서버 재시작 |
| `measure_safe_area` 에러 | MCP 서버가 mock 모드로 실행 안 됨 | `--mode=local` 또는 `MCP_ENV=mock` 확인 |
| `call_sdk` `ok: false` | mock SDK 미주입 (fixture alias 누락) | `vite.config.ts`의 `resolve.alias` 확인 |

---

## 시나리오 2 — AITC Sandbox PWA (환경 2)

상세 절차: [`docs/scenarios/env-2.md`](../scenarios/env-2.md)

### 진입 절차

```bash
# 방법 A: agent-plugin skill 사용
# /ait setup-phone-preview

# 방법 B: 직접 터널 실행
AIT_TUNNEL=1 pnpm exec vite --config e2e/fixture/vite.config.ts

# 폰: https://devtools.aitc.dev/launcher/ 에서 launcher PWA 설치 후 QR 스캔
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
  "pages": [{ "url": "https://<hash>.trycloudflare.com/", "lastSeenAt": "<iso8601>" }],
  "tunnel": { "up": true, "wssUrl": "wss://<hash>.trycloudflare.com" },
  "singleAttachModel": true,
  "crashDetectedAt": null
}
```

- `pages[0].url`: `*.trycloudflare.com`
- `tunnel.up`: `true`
- `lastSeenAt`: 현재 시각에서 30초 이내

#### `measure_safe_area`

```json
{
  "source": "relay",
  "sdkInsetsSource": "window.__ait",
  "userAgent": "<iOS/Android Safari UA>"
}
```

- `source`: `"relay"`
- `userAgent`: iOS/Android 실기기 UA 포함

#### `call_sdk("getOperationalEnvironment", [])`

non-dogfood PWA의 경우:
```json
{ "ok": false, "error": "window.__sdkCall is not available" }
```

- `ok: false`는 예상 결과 (bridge 부재) — schema 위반 아님

### 체크리스트

- [ ] `build_attach_url` — QR/deep-link 생성 성공
- [ ] `list_pages` — `tunnel.up: true`, `lastSeenAt` 30초 이내
- [ ] `measure_safe_area` — `source: "relay"`, 실기기 `userAgent`
- [ ] `call_sdk` — `ok` 필드 존재 (false여도 schema 통과)
- [ ] 3종 응답 모두 JSON envelope 완전

### 실패 처리

| 증상 | 원인 | 처리 |
|---|---|---|
| `list_pages` 빈 배열 | 폰이 relay에 미연결 | QR 재스캔, `lastSeenAt` 확인 |
| `tunnel.up: false` | cloudflared 터널 미실행 | `AIT_TUNNEL=1 pnpm exec vite ...` 재실행 |
| `measure_safe_area` `source: "mock"` | 폰이 아닌 로컬 브라우저에 연결됨 | 폰 QR 스캔 확인 |

---

## 시나리오 3 — intoss-private relay dev (환경 3)

상세 절차: [`docs/scenarios/env-3.md`](../scenarios/env-3.md)

### 진입 절차

```bash
# 1. devtools MCP 실행 (debug 모드 기본)
npx -y @ait-co/devtools devtools-mcp

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
  "source": "relay",
  "sdkInsetsSource": "window.__sdk",
  "sdkInsets": { "top": 44, "bottom": 34, "left": 0, "right": 0 },
  "userAgent": "<Toss WebView UA>"
}
```

- `source`: `"relay"`
- `sdkInsetsSource`: `"window.__sdk"`
- `sdkInsets.top`: 44–54 CSS px (토스 앱 nav bar 높이)
- `userAgent`: `Toss WebView` / `Mobile Safari` 포함

#### `call_sdk("getOperationalEnvironment", [])`

```json
{ "ok": true, "value": { "environment": "dev", "sdkVersion": "<version>" } }
```

- `ok`: `true`
- `value.environment`: `"dev"`
- `value.sdkVersion` 포함

### 체크리스트

- [ ] `list_pages` — `intoss-private://` scheme, `tunnel.up: true`, `lastSeenAt` 30초 이내
- [ ] `measure_safe_area` — `source: "relay"`, `sdkInsetsSource: "window.__sdk"`, `sdkInsets.top` 44–54
- [ ] `call_sdk` — `ok: true`, `value.environment: "dev"`
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
# 1. devtools MCP 실행 (debug 모드)
npx -y @ait-co/devtools devtools-mcp

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
4. call_sdk("getOperationalEnvironment", [])
```

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
  "source": "relay",
  "sdkInsetsSource": "window.__sdk",
  "sdkInsets": { "top": 44, "bottom": 34, "left": 0, "right": 0 },
  "userAgent": "<Toss WebView UA>"
}
```

#### `call_sdk("getOperationalEnvironment", [])`

```json
{ "ok": true, "value": { "environment": "production" } }
```

- `ok`: `true`
- `value.environment`: `"production"`

### 체크리스트

- [ ] `list_pages` — live `_deploymentId` 포함, `tunnel.up: true`, `crashDetectedAt: null`
- [ ] `measure_safe_area` — `source: "relay"`, `sdkInsetsSource: "window.__sdk"`
- [ ] `call_sdk` — `ok: true`, `value.environment: "production"`
- [ ] 3종 응답 모두 JSON envelope 완전
- [ ] read-only 모드 준수 — side-effect 있는 SDK 호출(navigate, IAP 등) 금지

### 실패 처리

| 증상 | 원인 | 처리 |
|---|---|---|
| `call_sdk` `value.environment: "dev"` | dogfood(dev) bundle로 진입 | live bundle `_deploymentId` 확인 |
| `list_pages` `crashDetectedAt` non-null | 앱 크래시 | crash report 분리 후 환경 3에서 디버깅 |
| 앱이 OPENED 상태 아님 | 검수 미완료 | `aitcc app status 31146` 확인 |

---

## 4 시나리오 acceptance 매트릭스

아래 표는 한 번의 QA 세션에서 모든 체크리스트를 통과하면 "M1 평행성 검증 완료"로 마킹할 수 있는 기준이다.

| 시나리오 | `list_pages` schema | `measure_safe_area` schema | `call_sdk` schema | 통과 일자 |
|---|---|---|---|---|
| 1 (로컬 브라우저) | `pages[]`, `tunnel.up: false` | `source: "mock"` | `ok: true` | — |
| 2 (AITC Sandbox PWA) | `pages[]`, `tunnel.up: true` | `source: "relay"` | `ok` 필드 존재 | — |
| 3 (intoss dev relay) | `pages[]`, `tunnel.up: true`, intoss-private URL | `source: "relay"`, `sdkInsetsSource: "window.__sdk"` | `ok: true`, `env: "dev"` | — |
| 4 (live relay) | `pages[]`, `tunnel.up: true`, live deploymentId | `source: "relay"`, `sdkInsetsSource: "window.__sdk"` | `ok: true`, `env: "production"` | — |

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
