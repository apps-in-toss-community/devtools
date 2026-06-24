---
"@ait-co/devtools": patch
---

fix(mcp): QR landing이 relay 드롭 시 죽은 QR을 에러 상태로 전환 (#631)

relay 터널이 영구 드롭(3회 reissue 실패)된 후에도 QR landing 페이지(대시보드
`GET /`·`/attach`·launcher)가 죽은 wss·만료 TOTP를 인코딩한 옛 QR을 계속
스캔 가능한 상태로 노출하던 2계층 갭을 닫는다. 사용자가 그 QR을 스캔하면
죽은 relay로 연결을 시도해 timeout/401로 실패했다.

- **서버** (`debug-server.ts`): `BootRelayFamilyOptions`에 `onTunnelDown`
  콜백을 추가하고 `onPermanentDrop`에서 호출한다. 3개 relay boot 사이트가
  이를 `qrServer?.notifyStateChange()`로 배선해 드롭 즉시 SSE 구독자를
  깨운다(이전엔 다음 TOTP refresh까지 최대 20s 무신호).
- **클라이언트** (`qr-http-server.ts`): 정적 렌더 게이트와 SSE inline 스크립트
  양쪽에 `tunnel.up` 검사를 추가해, 터널이 죽으면 `attachUrl`이 남아 있어도
  QR 대신 에러 카피("relay 끊김 — QR 재생성")를 렌더한다.

SECRET-HANDLING: 에러 카피에 wss/TOTP 값은 포함하지 않으며, 드롭 시 죽은
`attachUrl`(TOTP `at=` 캡슐)을 url-box로 노출하지 않는다.
