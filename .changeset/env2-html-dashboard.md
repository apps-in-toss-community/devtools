---
'@ait-co/devtools': patch
---

환경 2(unplugin `tunnel: { cdp: true }`) 터널에 HTML 대시보드 + 브라우저 자동 오픈을 더해 환경 3/4(`build_attach_url`)와 UX 패리티를 맞춘다 (#408). CDP가 배선되고 GUI가 감지되면 env 3/4가 쓰는 것과 동일한 `127.0.0.1` 대시보드(QR 이미지 + 연결 방법 + FAQ)를 띄우고 브라우저로 연다. QR에는 폰이 relay WS upgrade를 통과하도록 매 요청마다 새로 생성한 TOTP 코드가 캡슐화되며(SSE/재로드 시 갱신 — 만료 없음), 터미널 ASCII QR fallback은 headless·`tunnel:{qr:false}`·`AIT_AUTO_DEVTOOLS=0`에서 회귀 없이 유지된다. `qrcode`/QR HTTP 서버는 기존대로 동적 import만 거치므로 터널 미사용 빌드 그래프엔 들어가지 않는다.
