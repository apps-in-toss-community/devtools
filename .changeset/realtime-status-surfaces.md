---
"@ait-co/devtools": patch
---

debug 상태 표면 실시간화 — in-app indicator live 전이 + 대시보드 즉시 push/onerror-first + 종료 시 terminal 이벤트

- in-app debug indicator 배지가 static "Debugger Connected" 표시에서 attached/disconnected 두 상태를 실시간 반영하는 idempotent 컨트롤러로 바뀝니다. relay WebSocket lifecycle을 관찰해(신규 커넥션을 열지 않고 기존 in-page 신호만 관찰) 상태를 갱신하며, 재주입 시 DOM을 중복 생성하지 않고 상태만 업데이트합니다.
- QR 대시보드 SSE가 target attach/detach, 테스트 실행 시작/종료, 서버 종료 시점에 즉시 상태를 push합니다(`notifyStateChange`). 클라이언트 스크립트는 `onerror`를 연결 끊김의 1차 즉시 신호로 처리하고(기존 watchdog은 백업으로 유지), 종료 시 HTTP 서버가 닫히기 전에 terminal SSE 프레임을 먼저 전송합니다.
- CLI 경로(`relay-factory.ts`)에 daemon에는 이미 있던 `onTunnelDown` 연결을 추가해 MCP/CLI 간 처리 격차를 없앴습니다.
