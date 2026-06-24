---
"@ait-co/devtools": patch
---

fix(mcp): relay 드롭 시 QR 에러 상태로 교체 (#631)

터널이 영구 드롭된 후에도 대시보드에 dead relay URL이 담긴 QR이 계속 표시되던 문제를 수정합니다.

**Layer 1** (`debug-server.ts`): `BootRelayFamilyOptions`에 `onPermanentDrop` 콜백을 추가하고,
`bootRelayFamily` 내 영구 드롭 핸들러가 `tunnelStatus`를 `up=false`로 갱신한 뒤 이 콜백을 호출합니다.
세 run 함수(`runDebugServer`, `runLocalDebugServer`, `runMobileDebugServer`) 모두 이 콜백으로
`qrServer?.notifyStateChange()`를 호출해 SSE 구독자에게 즉시 down 상태를 푸시합니다.

**Layer 2** (`qr-http-server.ts`): `buildDashboardHtml`과 `buildSseScript` 모두
`tunnel.up=false && attachUrl !== null` 조합일 때 dead QR 대신 에러 메시지를 렌더합니다.
`SseScriptStrings`에 `attachTunnelDown` 필드 추가, i18n 카탈로그(`ko.ts`/`en.ts`)에
`dashboard.attach.tunnelDown` 키 추가.

SECRET-HANDLING: 에러 메시지에 relay URL/wssUrl 값은 포함하지 않고 "재생성 안내" 문자열만 표시합니다.
