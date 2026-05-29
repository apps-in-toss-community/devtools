# 시나리오 2 — AITC Sandbox PWA (환경 2) acceptance 절차

> 대상: 실기기 Safari/WebKit + installable PWA(`devtools.aitc.dev/launcher/`) + cloudflared 터널.
> HMR O (cloudflared quick tunnel), relay O.

## 전제조건

- `/ait setup-phone-preview` 실행 또는 `AIT_TUNNEL=1 pnpm exec vite --config e2e/fixture/vite.config.ts`
- 폰 홈 화면에 launcher PWA 설치 (`devtools.aitc.dev/launcher/`)
- QR 스캔 또는 tunnel URL 붙여넣기로 mini-app 로드

## MCP 도구 acceptance 체크리스트

```
list_pages → measure_safe_area → call_sdk(getOperationalEnvironment)
```

1. **`list_pages`**
   - `pages` 배열이 1개 항목 — `url`이 `*.trycloudflare.com` 경유
   - `tunnel.up: true`, `tunnel.wssUrl`이 `wss://*.trycloudflare.com` 형태
   - `singleAttachModel: true`
   - `lastSeenAt`이 현재 시각에서 30초 이내 (liveness 확인)
   - `crashDetectedAt: null`

2. **`measure_safe_area`**
   - `source: "relay"`
   - `sdkInsetsSource: "window.__sdk"` (dogfood bundle) 또는 `"window.__ait"` (PWA mock)
   - `userAgent`가 iOS/Android Safari 실기기 UA 포함

3. **`call_sdk("getOperationalEnvironment", [])`**
   - `ok: true` (dogfood bundle의 경우)
   - 또는 `ok: false, error: "window.__sdkCall is not available"` (non-dogfood PWA — 예상 결과)

## attach 절차

1. `build_attach_url(scheme_url, wait_for_attach=true)` 호출
2. QR 스캔 → 폰이 relay에 attach
3. `list_pages`가 page 항목을 반환하면 이후 도구 사용 가능

## 트러블슈팅

### MCP 서버가 "이미 실행 중" 안내가 뜰 때

`devtools-mcp`가 이미 실행 중인 세션을 감지하면 stderr에 PID + wssUrl + 회복 명령을 출력합니다.
`--force` 플래그로 기존 세션을 종료하고 takeover할 수 있습니다:

```bash
npx @ait-co/devtools devtools-mcp --force
```

## 환경 2 한계

- 토스 WebView native bridge 없음 (검수 불필요하지만 bridge 부재)
- 환경 3·4에서만 가능한 SDK 기능 확인 불가
