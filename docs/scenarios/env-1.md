# 시나리오 1 — 로컬 브라우저 (환경 1) acceptance 절차

> 대상: desktop Chromium + mock SDK + DevTools 패널. HMR O, relay 없음.

## 전제조건

- `pnpm dev` (Vite dev server + unplugin `mcp: true`)  
- `.mcp.json`의 `devtools-mcp --mode=dev` (권장 — HTTP mock-state 기반, relay/Chromium 불필요) 또는 `--target=local` (CDP 필요 시)
- 환경 변수: `MCP_ENV=mock` (명시 권장, 미설정 시 default mock으로 동일 동작)

## `--mode=dev` vs `--target=local` 선택 기준

| 모드/타깃 | 언제 쓰나 | 특징 |
|---|---|---|
| `--mode=dev` | Vite HMR 루프에서 AIT mock state만 관측하고 싶을 때 | Vite dev server의 `/api/ait-devtools/state` endpoint를 읽음. CDP 없음 — DOM/screenshot 불가, tier-filter error로 안내. 빠르고 가볍다. |
| `--target=local` | DOM/screenshot/safe-area 등 CDP tool이 필요할 때 | `--mode=debug --target=local`의 단축형. MCP 서버가 로컬 Chromium을 직접 기동해 CDP direct-attach. relay·터널 불필요. CDP 전체 tool surface 사용 가능. |

일반 mock 개발에서 AIT state 조회만 할 경우 `--mode=dev`가 충분하다. DOM 구조나 스크린샷까지 필요하면 `--target=local`을 선택한다.

## MCP 도구 acceptance 체크리스트

아래 3종 호출이 동일 schema 응답을 반환해야 한다.

```
list_pages → measure_safe_area → call_sdk(getOperationalEnvironment)
```

1. **`list_pages`**
   - `pages` 배열이 1개 항목 — `url`이 `localhost:517x` 형태
   - `tunnel.up: false` (로컬 모드, relay 없음)
   - `singleAttachModel: true`
   - `--mode=dev` 시 `devMode: true` 추가 필드 포함 (shim 표시)

2. **`measure_safe_area`**
   - `--mode=dev`: `source: "mock-vite"`, `sdkInsetsSource: "window.__ait"` — mock state snapshot에서 읽음
   - `--target=local`: `source: "mock"`, `sdkInsetsSource: "window.__ait"` — CDP Runtime.evaluate probe
   - `sdkInsets` 값이 DevTools 패널의 현재 viewport preset과 일치

3. **`call_sdk("getOperationalEnvironment", [])`**
   - `--mode=dev`: mock state HTTP 폴링 경로를 사용하므로 `ok: true`, `value`가 mock state의 environment scalar string과 일치 (예: `"sandbox"`).
   - `--target=local` (non-dogfood fixture): `window.__sdkCall` bridge가 없으므로 `ok: false, error: "window.__sdkCall이 주입되지 않았습니다 (dogfood 빌드가 아닙니다)"` — **예상된 결과이며 schema 위반이 아니다.** dev-mode는 mock state로 답하지만, local 모드는 `window.__sdkCall` 직접 호출이라 dogfood 빌드(`__DEBUG_BUILD__` 정의)가 아니면 bridge가 없다. 환경 2 non-dogfood와 동일한 정책.
   - `--target=local` (dogfood 빌드 fixture): `ok: true`, `value: "sandbox"` (또는 패널 설정값). dogfood 빌드 생성은 `__DEBUG_BUILD__` 전처리 변수 정의 필요 — sdk-example의 `ait build` 패턴과 동일.

## 검증 스크립트

### A. `--mode=dev` (권장 — Chromium 불필요, Vite dev server만 필요)

```bash
# 1. Vite dev 서버 실행 (unplugin mcp: true 설정 필요)
pnpm dev

# 2. MCP 서버 실행
npx -y @ait-co/devtools devtools-mcp --mode=dev

# 3. 에이전트에서 순서대로 호출
# list_pages → measure_safe_area → call_sdk("getOperationalEnvironment", [])
```

### B. `--target=local` (CDP 도구 포함, 로컬 Chromium 자동 실행)

```bash
# 1. 빌드 + 픽스처 실행
pnpm build
pnpm exec vite build --config e2e/fixture/vite.config.ts
pnpm exec vite preview --config e2e/fixture/vite.config.ts --port 4173 &

# 2. MCP 서버 실행 (local 타깃 — Chromium을 자동 실행하고 CDP로 연결)
npx -y @ait-co/devtools devtools-mcp --target=local

# 3. 에이전트에서 순서대로 호출
# list_pages → measure_safe_area → call_sdk("getOperationalEnvironment", [])
```

## 트러블슈팅

### `--target=local`에서 `call_sdk` `ok: false` ("dogfood 빌드가 아닙니다")

`--target=local`에서 `call_sdk("getOperationalEnvironment", [])` 결과 `ok: false`는 **예상된 동작**이다 — `window.__sdkCall` bridge는 dogfood 빌드(`__DEBUG_BUILD__` 전처리 변수 정의)에서만 주입된다. fixture가 일반 dev/production 빌드면 bridge가 없어 `ok: false`가 반환된다.

`call_sdk`를 `ok: true`로 검증하려면 두 가지 옵션 중 하나를 택한다:

1. **`--mode=dev`로 전환** (권장): mock state HTTP 폴링 경로라 dogfood 빌드 불필요. `call_sdk` 포함 AIT state 조회 전체가 `ok: true`로 동작한다.
2. **dogfood 빌드로 fixture 실행**: `__DEBUG_BUILD__=true`(또는 번들러 define에 `__DEBUG_BUILD__: true`)를 설정해 빌드 — sdk-example의 `ait build` 패턴과 동일.

스크린샷/DOM/safe-area CDP tool 없이 AIT state만 확인하는 경우라면 `--mode=dev`가 더 빠르다.

### MCP 서버가 "이미 실행 중" 안내가 뜰 때

`devtools-mcp`가 이미 실행 중인 세션을 감지하면 stderr에 PID + wssUrl + 회복 명령을 출력합니다.
`--force` 플래그로 기존 세션을 종료하고 takeover할 수 있습니다:

```bash
npx @ait-co/devtools devtools-mcp --target=local --force
```

## 환경 1 한계 (구조적 불가)

- 실기기 WebKit 엔진 fidelity: 환경 2(PWA, `/ait setup-phone-preview`)로 보완
- 토스 WebView native bridge: 환경 3·4(`devtools-mcp` + `start_debug(relay-staging/relay-live)`)로 보완

다음 단계: 실기기 검증이 필요하면 `npx @ait-co/devtools devtools-mcp` 실행 후 `start_debug({mode: 'relay-staging'})` → `get_debug_status`로 상태 확인.
