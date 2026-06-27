# 환경 2 (AITC Sandbox PWA) — fidelity acceptance 절차

## 목적

이 문서는 **환경 2(AITC Sandbox App / PWA)**가 fidelity 사다리의 독립 겹으로서 실제로 작동한다는 것을 메인테이너가 검증하는 절차를 정의한다.

환경 2가 존재하는 이유: 환경 1(로컬 브라우저 + mock SDK)은 desktop Chromium에서 실행되므로 실기기 WebKit 엔진 거동을 구조적으로 재현할 수 없다. 환경 2는 `devtools.aitc.dev/launcher/`에 배포된 installable PWA 셸이 cloudflared 터널을 통해 dev 서버를 iframe으로 띄우는 방식으로, 토스 앱 WebView 없이 실기기 Safari/WebKit 엔진을 타겟으로 삼는다.

설계 정본: [umbrella `meta/four-environments-fidelity.md` §1.1–§1.2 환경 2 매트릭스](https://github.com/apps-in-toss-community/meta/blob/main/four-environments-fidelity.md#환경-2--aitc-sandbox-app-pwa)

---

## 사전 준비 (1회)

### 1. PWA 설치

iOS Safari에서 아래 URL을 연다.

```
https://devtools.aitc.dev/launcher/
```

상단의 **"Install launcher to your phone"** 버튼을 탭하거나, Safari 공유 시트 → "홈 화면에 추가"로 설치한다. 설치 후 홈 화면에 "AITC DevTools Launcher" 아이콘이 생기면 완료.

iOS에서는 `beforeinstallprompt` 이벤트가 없으므로 공유 시트 경로가 정상 동작이다(`e2e/fixture/launcher/main.ts`의 `@khmyznikov/pwa-install` 커스텀 엘리먼트가 이를 처리한다).

---

## dev 세션 (매번)

### 2. dev 서버 + tunnel 기동

리포 루트에서 빌드 후 tunnel 모드로 vite dev를 띄운다.

```bash
pnpm build
AIT_TUNNEL=1 pnpm exec vite --config e2e/fixture/vite.config.ts
```

`AIT_TUNNEL=1` 환경 변수를 주면 `e2e/fixture/vite.config.ts`의 `tunnel: !!process.env.AIT_TUNNEL` 분기가 활성화되어 `cloudflared` quick-tunnel(`*.trycloudflare.com`)이 열리고 터미널에 URL과 ASCII QR이 출력된다.

### 3. 폰 PWA에서 tunnel URL 열기

홈 화면의 Launcher 아이콘을 탭(standalone 모드로 열림)한다. 두 가지 방법 중 하나로 tunnel URL을 입력한다.

- **카메라 QR 스캔**: "Scan QR with camera" 탭 후 터미널 QR을 폰 카메라로 스캔
- **URL 붙여넣기**: 터미널에 출력된 `https://…trycloudflare.com` URL을 입력 필드에 붙여넣고 "Open"

launcher가 URL을 iframe으로 전체 화면에 띄우면 dev 앱이 실기기 Safari/WebKit 위에서 실행된다.

---

## Acceptance 관측 — `env(safe-area-inset-*)` 실값

### 선택 이유

`env(safe-area-inset-*)` CSS 환경 변수는 기기의 노치/홈 인디케이터를 반영하는 실값을 반환한다. desktop Chromium(환경 1)은 이 값이 항상 `0`이지만, 실기기 Safari PWA standalone 모드(환경 2)에서는 노치 상단과 홈 인디케이터 하단에 실값이 나타난다. 이미 launcher `index.html`의 padding 계산에 `env(safe-area-inset-top)`·`env(safe-area-inset-bottom)`이 적용되어 있어 별도 코드 없이 즉시 관측 가능하다.

### 관측 단계

**환경 1에서 먼저 확인 (기준값)**

1. 데스크톱 브라우저(`localhost:5173` 또는 preview 서버)에서 dev 앱을 연다.
2. DevTools 콘솔에서 아래를 실행한다.
   ```js
   const el = document.createElement('div');
   el.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
   el.style.paddingTop = 'env(safe-area-inset-top)';
   document.body.appendChild(el);
   console.log('safe-area-inset-top:', getComputedStyle(el).paddingTop); // "0px"
   document.body.removeChild(el);
   ```
3. 결과: `"0px"` — 환경 1은 safe-area inset이 없다.

**환경 2에서 관측**

1. 폰 PWA에서 dev 앱이 로드된 상태에서 데스크톱 Safari → "개발자" 메뉴 → 기기 선택 → 현재 탭을 inspect한다. (Safari 원격 검사 — Mac의 Safari 설정 → 고급 → "웹 개발자용 기능" 필요)
2. 콘솔에서 동일 코드를 실행한다.
3. 기대 결과: `"47px"` 또는 비슷한 양수(기기 모델에 따라 다름, 노치 없는 기기는 상단 `0` / 하단 홈 인디케이터 영역은 양수). 값이 `0px`이 아니면 관측 성공.

Safari 원격 검사를 사용할 수 없는 경우, launcher setup 화면의 padding이 노치 아래에서 시작하는지(safe-area-inset-top 적용 결과)를 눈으로 확인하는 것으로 대체할 수 있다.

---

## Re-run 체크리스트 (이슈 close 조건)

- [ ] PWA가 iOS Safari에서 정상 설치되어 홈 화면 아이콘이 생성됨
- [ ] Launcher를 standalone 모드로 열면 setup 화면이 나타남 (브라우저 주소창 없음)
- [ ] `AIT_TUNNEL=1 pnpm exec vite --config e2e/fixture/vite.config.ts` 기동 시 터미널에 `*.trycloudflare.com` URL과 QR이 출력됨
- [ ] launcher에서 QR 스캔 또는 URL 붙여넣기 후 dev 앱이 iframe 전체 화면으로 로드됨 (CORS 오류·빈 화면 없음)
- [ ] 환경 2에서 `env(safe-area-inset-top)` 또는 `env(safe-area-inset-bottom)` 값이 `0px`이 아닌 양수로 관측됨
- [ ] 환경 1(데스크톱 브라우저)에서 동일 값이 `0px`임을 확인

---

## 알려진 한계 (환경 2가 검증할 수 없는 것)

환경 2는 순수 PWA다. 아래 항목은 구조적으로 재현 불가능하며, 해당 환경이 별도로 담당한다.

- **토스 WebView 런타임 + SDK 네이티브 브리지**: 토스 앱 WebView가 없으므로 `@apps-in-toss/web-framework` SDK 호출은 여전히 mock(devtools)이 응답한다. CDP를 붙여도(`tunnel.cdp`) `call_sdk`는 mock을 친다. 실 SDK 거동은 환경 3(intoss-private relay)에서만 확인 가능.
- **`*.private-apps.tossmini.com` host-gated 코드**: 환경 2는 `devtools.aitc.dev`(터널은 `*.trycloudflare.com`) origin에서 뜨므로 토스 host를 흉내낼 수 없다.
- **검수 통과 번들 거동**: 앱인토스 검수 후 OPENED 상태의 출시 런타임은 현재 지원하는 debug 환경 범위 밖이다(relay-live 제거 #665).

CDP relay는 환경 2에서도 동작한다(`tunnel: { cdp: true }` opt-in) — 같은 QR 한 번으로 화면 미리보기 + on-device CDP가 열려 실기기 WebKit의 DOM·콘솔·예외·`measure_safe_area`를 `source: "relay-*"`로 관측한다. CDP가 못 메우는 것은 위의 mock SDK 천장뿐이다.

---

커뮤니티 오픈소스 프로젝트입니다.
