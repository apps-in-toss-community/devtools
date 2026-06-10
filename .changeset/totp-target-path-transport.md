---
'@ait-co/devtools': patch
---

relay TOTP 게이트에 폰 target 측 코드 전달 경로 추가 + 인증 거부 관측성 (#466, #467)

- in-app attach가 페이지 URL의 `at` 코드를 `/at/<code>/target.js` path-prefix로 script src에 실어, chii target.js가 파생하는 WS 업그레이드가 relay TOTP 게이트를 통과할 수 있게 함 (기존에는 전달 경로 자체가 없어 TOTP 활성 시 모든 실기기 attach가 조용히 401)
- relay가 `/at/<code>/…` prefix를 검증 후 쿼리 형태로 재작성·strip — 기존 쿼리(`at=`) 전달 경로는 그대로 동작 (back-compat)
- 인증 거부를 secret-free 카운터로 기록해 `get_debug_status`/`get_diagnostics`에 `authRejects` 노출, recentErrors 요약 1건 + next_recommended_action에 QR 재스캔 안내 추가
