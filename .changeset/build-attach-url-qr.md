---
'@ait-co/devtools': patch
---

build_attach_url: ANSI 없는 유니코드 half-block QR + wait_for_attach 옵션 + 에이전트에게 QR 표시 지시

- `renderQr`를 `qrcode-terminal`(ANSI invert 코드 포함)에서 `qrcode` 풀 라이브러리 기반 순수 유니코드 half-block QR로 교체 — 어느 렌더러에서도 깨지지 않고 폰 카메라로 스캔 가능
- `build_attach_url`에 `wait_for_attach` boolean 인자 추가: `true`이면 QR 반환 후 폴링으로 page attach까지 블로킹(최대 90s), attach되면 page 정보 포함 반환, timeout이면 `list_pages` 재확인 안내와 함께 isError
- tool description과 응답 텍스트 머리에 "IMPORTANT: Show this QR to the user verbatim" 지시 추가 — 에이전트가 QR을 요약/생략하지 않고 그대로 출력하게 하는 안전장치
