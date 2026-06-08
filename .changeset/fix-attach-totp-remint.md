---
"@ait-co/devtools": patch
---

MCP 대시보드·`/attach` 페이지 TOTP `at=` 코드 실시간 재발급 (Defect 1, #435): `lastAttachUrl` 문자열 캐시를 `AttachUrlParts` 컴포넌트로 교체해 `getDashboardState` 호출마다 `generateTotp()`로 신선한 코드를 mint하도록 수정. `/attach` HTML에 SSE 구독 스크립트를 주입하고 `id="attach-section"` wrapper를 추가해 QR 실시간 갱신을 지원.
