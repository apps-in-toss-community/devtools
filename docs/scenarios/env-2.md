# 시나리오 2 — AITC Sandbox PWA (환경 2) acceptance 절차

> 대상: 실기기 Safari/WebKit + installable PWA(`devtools.aitc.dev/launcher/`) + cloudflared 터널.
> HMR O (cloudflared quick tunnel). CDP relay는 opt-in(`tunnel: { cdp: true }`) — 켜면 실기기 WebKit 위에서 DOM·콘솔·예외·`measure_safe_area` 관측이 열린다. `call_sdk`는 환경 2에서 mock을 친다(실 SDK는 환경 3·4).

## 전제조건

- 폰 홈 화면에 launcher PWA 설치 (`devtools.aitc.dev/launcher/`)

## 진입 절차

cloudflared 터널은 데스크톱 vite dev 서버를 폰의 PWA iframe이 fetch하기 위한 HTTP 미리보기 채널이다. `tunnel: { cdp: true }`를 켜면 그와 **별도로** Chii relay + 두 번째 터널이 함께 떠서, 같은 QR 한 번으로 화면 미리보기와 CDP attach가 동시에 열린다.

### 1. dev 서버 + tunnel 기동

```bash
# 방법 A: agent-plugin skill 사용
# /ait setup-phone-preview

# 방법 B: 직접 터널 실행
AIT_TUNNEL=1 pnpm exec vite --config e2e/fixture/vite.config.ts
```

`AIT_TUNNEL=1` 환경 변수를 주면 `cloudflared` quick-tunnel(`*.trycloudflare.com`)이 열리고 터미널에 URL과 ASCII QR이 출력된다.

CDP 디버깅까지 켜려면 unplugin 옵션에 `tunnel: { cdp: true }`를 준다(예: `aitDevtools.vite({ tunnel: { cdp: true } })`). 그러면 QR deep-link가 `&debug=1&relay=<wss>`를 추가로 실어 보내고, 배너에 CDP 안내 한 줄이 더 출력된다.

### 2. 폰 launcher PWA에서 tunnel URL 열기

홈 화면의 Launcher 아이콘을 탭(standalone 모드로 열림)한 후 두 가지 방법 중 하나로 tunnel URL을 입력한다.

- **QR 스캔**: "Scan QR with camera" 탭 후 터미널 QR을 폰 카메라로 스캔
- **URL 붙여넣기**: 터미널에 출력된 deep-link(`https://devtools.aitc.dev/launcher/?url=…`)를 입력 필드에 붙여넣고 "Open"

launcher가 URL을 iframe으로 전체 화면에 띄우면 dev 앱이 실기기 Safari/WebKit 위에서 실행된다. `cdp`가 켜진 QR이면 launcher가 `debug=1&relay=<wss>`를 iframe URL에 얹어 in-app debug gate를 통과시키고, 페이지에 Chii target.js가 주입된다.

### 3. 관측

화면 미리보기만 필요하면 CDP 없이도 동작한다.

- **`env(safe-area-inset-*)` CSS 실값**: 데스크톱 Safari → "개발자" 메뉴 → 기기 선택 → 현재 탭 inspect (Safari 원격 검사). 콘솔에서 `getComputedStyle`로 `safe-area-inset-top` 값이 `0px`이 아닌 양수인지 확인한다(노치 있는 기기 기준).
- **화면 관찰**: Safari 원격 검사를 사용할 수 없는 경우, launcher setup 화면의 padding이 노치 아래에서 시작하는지 눈으로 확인한다.

`tunnel.cdp`를 켰다면 AI host MCP를 그 relay에 client로 붙여 에이전트 안에서 관측한다.

- `list_pages`로 attach된 PWA iframe target 확인 → `measure_safe_area`로 실기기 WebKit의 `env(safe-area-inset-*)` 실값을 `source: "relay-*"`로 읽는다. 환경 1(jsdom/데스크톱 Chromium)이 구조적으로 못 주는 실기기 엔진 측정이다.
- DOM 검사·콘솔·`list_exceptions`로 실기기 WebKit 런타임을 관측한다.

### 4. SDK 호출 확인

환경 2는 토스 WebView 브리지가 없으므로 `@apps-in-toss/web-framework` SDK 호출은 devtools mock이 응답한다. CDP를 붙여도 이 점은 바뀌지 않는다 — `call_sdk`는 환경 2에서 mock을 친다.

- `getOperationalEnvironment()` 호출 시 mock 응답(`'toss' | 'sandbox'`) 반환 — 실 SDK 응답이 아님(예상된 결과)
- 실 SDK 거동 검증이 필요하면 환경 3(intoss-private relay dev)으로 진행한다

## Acceptance 체크리스트

- [ ] `AIT_TUNNEL=1 pnpm exec vite ...` 기동 시 터미널에 `*.trycloudflare.com` URL과 QR이 출력됨
- [ ] launcher에서 QR 스캔 또는 URL 붙여넣기 후 dev 앱이 iframe 전체 화면으로 로드됨 (CORS 오류·빈 화면 없음)
- [ ] 환경 2에서 `env(safe-area-inset-top)` 또는 `env(safe-area-inset-bottom)` 값이 `0px`이 아닌 양수로 관측됨 (또는 화면 관찰로 대체)
- [ ] 환경 1(데스크톱 브라우저)에서 동일 값이 `0px`임을 확인
- [ ] (`tunnel.cdp` 켰을 때) QR 스캔 한 번으로 화면 미리보기 + CDP attach가 함께 열림 — `list_pages`가 PWA iframe target을 보여주고 `measure_safe_area`가 `source: "relay-*"`로 실값 반환

상세 절차는 [`docs/env2-pwa-acceptance.md`](../env2-pwa-acceptance.md)를 함께 참조한다.

## 환경 2 한계

- **mock SDK 고정**: `call_sdk`는 환경 2에서 mock을 친다. 토스 WebView native bridge가 없어 실 SDK 응답은 확인할 수 없다 — 이건 환경 2의 알려진 천장이지 결함이 아니다(SDK fidelity가 필요하면 환경 3로 올라간다).
- **CDP는 opt-in**: `tunnel: { cdp: true }`를 켜야 relay가 뜬다. 끄면 화면 미리보기만 동작하고 MCP relay attach는 일어나지 않는다.
- **환경 3·4에서만 가능한 SDK 기능**: 실기기에서 실 SDK 동작 검증이 필요하면 환경 3으로 진행한다
