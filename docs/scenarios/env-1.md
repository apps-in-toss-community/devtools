# 시나리오 1 — 로컬 브라우저 (환경 1) acceptance 절차

> 대상: desktop Chromium + mock SDK + DevTools 패널. HMR O, relay 없음.

## 전제조건

- `pnpm dev` (Vite dev server + unplugin `mcp: true`)  
- `.mcp.json`의 `devtools-mcp --mode=dev` 활성화 (권장 — HTTP mock-state 기반, relay/Chromium 불필요)

> **참고**: `--mode=local`은 로컬 Chromium을 자동 실행하는 별도 모드다. 환경 1에서 CDP 기능(`evaluate`, `take_screenshot` 등)이 필요하면 `--mode=local`을 쓴다. `--mode=dev`는 CDP 없이 Vite HTTP endpoint만 사용하며 CDP 도구는 tier-filter error로 안내한다.

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
   - `--mode=local`: `source: "mock"`, `sdkInsetsSource: "window.__ait"` — CDP Runtime.evaluate probe
   - `sdkInsets` 값이 DevTools 패널의 현재 viewport preset과 일치

3. **`call_sdk("getOperationalEnvironment", [])`**
   - `ok: true`
   - `value.environment`가 mock state와 일치 (예: `"dev"`)

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

### B. `--mode=local` (CDP 도구 포함, 로컬 Chromium 자동 실행)

```bash
# 1. 빌드 + 픽스처 실행
pnpm build
pnpm exec vite build --config e2e/fixture/vite.config.ts
pnpm exec vite preview --config e2e/fixture/vite.config.ts --port 4173 &

# 2. MCP 서버 실행 (local 모드 — Chromium을 자동 실행하고 CDP로 연결)
npx -y @ait-co/devtools devtools-mcp --mode=local

# 3. 에이전트에서 순서대로 호출
# list_pages → measure_safe_area → call_sdk("getOperationalEnvironment", [])
```

## 환경 1 한계 (구조적 불가)

- 실기기 WebKit 엔진 fidelity: 환경 2(PWA)로 보완
- 토스 WebView native bridge: 환경 3·4로 보완
