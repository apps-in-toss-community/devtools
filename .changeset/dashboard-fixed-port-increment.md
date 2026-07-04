---
"@ait-co/devtools": patch
---

feat(mcp): 대시보드 포트를 고정 기본값 + 점유 시 +1 증가로 (#752)

QR 대시보드 HTTP 서버가 매 run 랜덤 ephemeral 포트에서 시작해 브라우저 탭/북마크가 run마다 무효화되던 문제를 고쳤다. 이제 고정 base 포트(`DEFAULT_DASHBOARD_PORT = 8317`)에서 시작해 `EADDRINUSE`면 +1씩 최대 20회 증가 스캔하고, 전부 점유면 ephemeral로 폴백 + 한국어 안내 1회 출력한다. `AIT_DEBUG_HTTP_PORT` env와 `devtools-test` CLI의 신규 `--dashboard-port <port>` 플래그가 같은 증가 로직의 base를 override한다 — `0`을 명시하면(env/CLI 어느 쪽이든) 기존 순수 ephemeral 동작을 유지한다(opt-out).
