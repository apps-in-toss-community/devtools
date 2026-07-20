---
'@ait-co/devtools': patch
---

env3 러너/대시보드에 "테스트 완료까지 앱 전면 유지" 안내 추가 — 2026-07-08 실기기 관측(46/8/6 부분 run vs 78/0/13 클린 완주)으로 원인이 확정된 백그라운드 suspend 연쇄 실패(iOS WebView JS suspend → evaluate 60s 타임아웃 → relay WS 사망 → 잔여 파일 전연쇄 실패)에 대한 사전 안내. 원인이 사용자 행동이라 suspend 감지/재개 로직 대신 안내 한 줄로 대응(Page visibility 신호가 relay 죽음과 동시에 끊기므로 사전 안내가 실효적 해법).

- QR 대시보드(attach 페이지) 스캔 절차에 마지막 단계로 추가 — sandbox(env 2, `attach.sandbox.step4`)·intoss(env 3, `attach.intoss.step5`) 양쪽 family, ko/en 모두.
- `devtools-test` CLI의 러너 터미널 출력(scan-wait 배너) — `attach-orchestrator.ts`의 공유 `header`에 한 줄 추가, `start_attach` MCP 도구 결과와 CLI 표준출력 양쪽에 동일하게 실림.
- (선택) evaluate 타임아웃이 재시도까지 실패했을 때의 최종 에러 메시지에 진단 힌트 추가(`relay-worker.ts`) — "기기 앱이 백그라운드로 갔을 수 있음"을 덧붙여 사후 진단을 빠르게.

Closes #766.
