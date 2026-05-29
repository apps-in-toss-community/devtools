# 시나리오 1 — 로컬 브라우저 (환경 1) acceptance 절차

> 대상: desktop Chromium + mock SDK + DevTools 패널. HMR O, relay 없음.

## 전제조건

- `pnpm dev` (Vite dev server + unplugin `mcp: true`)  
- `.mcp.json`의 `devtools-mcp --mode=local` 또는 `devtools-mcp --mode=dev` 활성화

## MCP 도구 acceptance 체크리스트

아래 3종 호출이 동일 schema 응답을 반환해야 한다.

```
list_pages → measure_safe_area → call_sdk(getOperationalEnvironment)
```

1. **`list_pages`**
   - `pages` 배열이 1개 항목 — `url`이 `localhost:517x` 형태
   - `tunnel.up: false` (로컬 모드, relay 없음)
   - `singleAttachModel: true`
   - `crashDetectedAt: null`

2. **`measure_safe_area`**
   - `source: "mock"`
   - `sdkInsetsSource: "window.__ait"`
   - `sdkInsets` 값이 DevTools 패널의 현재 viewport preset과 일치
   - `cssEnv` 값이 `env(safe-area-inset-*)` CSS 변수와 일치

3. **`call_sdk("getOperationalEnvironment", [])`**
   - `ok: true`
   - `value.environment`가 mock state와 일치 (예: `"dev"`)

## 검증 스크립트

```bash
# 1. 빌드 + 픽스처 실행
pnpm build
pnpm exec vite build --config e2e/fixture/vite.config.ts
pnpm exec vite preview --config e2e/fixture/vite.config.ts --port 4173 &

# 2. MCP 서버 실행 (local 모드)
npx -y @ait-co/devtools devtools-mcp --mode=local

# 3. 에이전트에서 순서대로 호출
# list_pages → measure_safe_area → call_sdk("getOperationalEnvironment", [])
```

## 트러블슈팅

### MCP 서버가 "이미 실행 중" 안내가 뜰 때

`devtools-mcp`가 이미 실행 중인 세션을 감지하면 stderr에 PID + wssUrl + 회복 명령을 출력합니다.
`--force` 플래그로 기존 세션을 종료하고 takeover할 수 있습니다:

```bash
npx @ait-co/devtools devtools-mcp --target=local --force
```

## 환경 1 한계 (구조적 불가)

- 실기기 WebKit 엔진 fidelity: 환경 2(PWA)로 보완
- 토스 WebView native bridge: 환경 3·4로 보완
