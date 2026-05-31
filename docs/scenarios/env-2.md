# 시나리오 2 — AITC Sandbox PWA (환경 2) acceptance 절차

> 대상: 실기기 Safari/WebKit + installable PWA(`devtools.aitc.dev/launcher/`) + cloudflared 터널.
> HMR O (cloudflared quick tunnel). MCP relay 대상이 아님 — 관측은 데스크톱 Safari 원격 검사 또는 화면 관찰로 한다.

## 전제조건

- 폰 홈 화면에 launcher PWA 설치 (`devtools.aitc.dev/launcher/`)

## 진입 절차

환경 2는 MCP relay 없이 동작한다. cloudflared 터널은 데스크톱 vite dev 서버를 폰의 PWA iframe이 fetch하기 위한 HTTP 미리보기 채널이다.

### 1. dev 서버 + tunnel 기동

```bash
# 방법 A: agent-plugin skill 사용
# /ait setup-phone-preview

# 방법 B: 직접 터널 실행
AIT_TUNNEL=1 pnpm exec vite --config e2e/fixture/vite.config.ts
```

`AIT_TUNNEL=1` 환경 변수를 주면 `cloudflared` quick-tunnel(`*.trycloudflare.com`)이 열리고 터미널에 URL과 ASCII QR이 출력된다.

### 2. 폰 launcher PWA에서 tunnel URL 열기

홈 화면의 Launcher 아이콘을 탭(standalone 모드로 열림)한 후 두 가지 방법 중 하나로 tunnel URL을 입력한다.

- **QR 스캔**: "Scan QR with camera" 탭 후 터미널 QR을 폰 카메라로 스캔
- **URL 붙여넣기**: 터미널에 출력된 `https://…trycloudflare.com` URL을 입력 필드에 붙여넣고 "Open"

launcher가 URL을 iframe으로 전체 화면에 띄우면 dev 앱이 실기기 Safari/WebKit 위에서 실행된다.

### 3. 관측

환경 2는 MCP relay에 attach하지 않는다. 다음 방법으로 관측한다.

- **`env(safe-area-inset-*)` CSS 실값**: 데스크톱 Safari → "개발자" 메뉴 → 기기 선택 → 현재 탭 inspect (Safari 원격 검사). 콘솔에서 `getComputedStyle`로 `safe-area-inset-top` 값이 `0px`이 아닌 양수인지 확인한다(노치 있는 기기 기준).
- **화면 관찰**: Safari 원격 검사를 사용할 수 없는 경우, launcher setup 화면의 padding이 노치 아래에서 시작하는지 눈으로 확인한다.

### 4. SDK 호출 확인

환경 2는 토스 WebView 브리지가 없으므로 `@apps-in-toss/web-framework` SDK 호출은 devtools mock이 응답한다.

- `getOperationalEnvironment()` 호출 시 mock 응답(`'toss' | 'sandbox'`) 반환 — 실 SDK 응답이 아님(예상된 결과)
- 실 SDK 거동 검증이 필요하면 환경 3(intoss-private relay dev)으로 진행한다

## Acceptance 체크리스트

- [ ] `AIT_TUNNEL=1 pnpm exec vite ...` 기동 시 터미널에 `*.trycloudflare.com` URL과 QR이 출력됨
- [ ] launcher에서 QR 스캔 또는 URL 붙여넣기 후 dev 앱이 iframe 전체 화면으로 로드됨 (CORS 오류·빈 화면 없음)
- [ ] 환경 2에서 `env(safe-area-inset-top)` 또는 `env(safe-area-inset-bottom)` 값이 `0px`이 아닌 양수로 관측됨 (또는 화면 관찰로 대체)
- [ ] 환경 1(데스크톱 브라우저)에서 동일 값이 `0px`임을 확인

상세 절차는 [`docs/env2-pwa-acceptance.md`](../env2-pwa-acceptance.md)를 함께 참조한다.

## 환경 2 한계

- **MCP relay 없음**: 환경 2는 MCP relay 대상이 아니다. `build_attach_url`/`list_pages`/`measure_safe_area.source: "relay-*"`/`call_sdk`와 같은 MCP relay 흐름은 환경 3·4에서만 동작한다.
- **토스 WebView native bridge 없음**: 검수 불필요하지만 bridge 부재로 실 SDK 응답 확인 불가
- **환경 3·4에서만 가능한 SDK 기능**: 실기기에서 SDK 동작 검증이 필요하면 환경 3으로 진행한다
