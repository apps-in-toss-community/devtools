---
"@ait-co/devtools": patch
---

relay TOTP 수용창 ±6 step 확대 — attach 코드 유효기간 약 3분으로 (#490)

relay WebSocket upgrade gate(`buildRelayVerifyAuth`)의 TOTP 검증 skew를 기본값(±1 step = 90초 창)에서 ±6 step(180–210초 창 = 약 3분)으로 확대했습니다.

실사용 흐름(QR 발급 → 폰 집어들기 → 카메라 스캔 → launcher PWA 로드 → attach)은 90초를 쉽게 초과해 4401 거부를 유발했습니다. 새 창으로 이 문제가 해소됩니다.

`verifyTotp` 자체의 기본 skew=1은 RFC 원형 그대로 유지 — 확대는 relay gate 호출부(`RELAY_VERIFY_SKEW_STEPS = 6` 상수)에만 적용됩니다. `build_attach_url`이 반환하는 `totp.expiresAt`과 `ttlSeconds`, 대시보드/attach 페이지의 만료 안내 카피도 새 기준(약 3분)으로 동기화했습니다.
