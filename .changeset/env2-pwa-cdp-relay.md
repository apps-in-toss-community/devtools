---
"@ait-co/devtools": patch
---

환경 2(실기기 PWA)에 CDP 디버깅을 배선했다. `tunnel: { cdp: true }` opt-in을 켜면 dev 서버 HTTP 터널과 별도로 Chii relay + 두 번째 quick tunnel이 떠서, launcher QR deep-link에 `&debug=1&relay=<wss>`를 실어 보낸다. 폰의 PWA iframe이 in-app debug gate를 통과해 target.js를 주입받으므로, 같은 한 번의 QR 스캔으로 화면 미리보기와 on-device CDP가 동시에 열린다.

in-app debug gate는 `*.trycloudflare.com` host에 대해 Layer B1을 host별로 분기 우회한다(나머지 layer + TOTP는 그대로). 토스 host(`*.private-apps.tossmini.com`) 경로는 한 글자도 바뀌지 않아 환경 4 LIVE 안전 불변식을 유지한다. `call_sdk`는 환경 2에서 여전히 mock을 친다 — CDP가 메우는 건 실기기 WebKit의 DOM·콘솔·예외·`measure_safe_area` 관측이다.
