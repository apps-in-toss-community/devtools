---
"@ait-co/devtools": patch
---

feat(mcp): attach 시 Chrome DevTools 자동 open (#282)

relay attach(환경 2·3·4) 감지 시 Chrome DevTools frontend URL을 조립하여 OS 기본 브라우저로 자동으로 엽니다.

- `chrome-devtools-frontend.appspot.com`에 `?wss=<relay>&panel=console` 파라미터로 연결
- 환경 1(로컬 브라우저 mock)에서는 자동 open 비활성 — F12가 이미 사용 가능
- `AIT_AUTO_DEVTOOLS=0` 환경변수로 opt-out 가능
- 동일 세션에서 중복 open 방지 (한 번만 실행)
- 브라우저 open 실패 시 stderr에 URL 출력하여 수동 복사 가능

PWA(WebKit) caveat: Chii CDP shim이 WebKit에서 동작하므로 DevTools가 연결되지만 Network·Layers 등 일부 패널은 WebKit runtime 제약으로 데이터가 비어 보일 수 있습니다.
