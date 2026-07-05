---
"@ait-co/devtools": patch
---

fix(test-runner): `devtools-test` CLI가 run 완료 후 종료되지 않는 문제 수정 (#755)

`devtools-test` CLI가 report/캡처 파일을 다 쓴 뒤에도 프로세스가 종료되지 않고 수동 SIGTERM이 필요했던 문제(run7~run10 4회 연속 재현)를 고쳤다.

원인은 두 곳의 `http.Server#close()`가 콜백을 영원히 안 부르는 것이었다:

- QR 대시보드 HTTP 서버(`qr-http-server.ts`) — 열려 있는 대시보드 탭의 `GET /events` SSE 연결(`keep-alive`, 절대 `res.end()` 안 함)이 `server.close()`의 새 연결 차단만으로는 안 끊긴다. `closeAllConnections()`를 먼저 호출해 강제 종료.
- Chii relay 서버(`chii-relay.ts`) — WebSocket 업그레이드가 끝난 소켓은 Node의 HTTP 서버 커넥션 트래킹에서 빠져나가 `closeAllConnections()`로도 안 닫힌다. 열려 있는 CDP WS 연결(폰 target leg 또는 daemon/relay-worker client leg)을 `_wss.clients`로 순회해 명시적으로 `terminate()`.

`devtools-test` CLI의 teardown 경로(Step 6)에 두 fix를 감싸는 bounded teardown orchestrator(`test-runner/teardown.ts`)를 추가했다 — 각 정리 단계를 개별 타임아웃으로 감싸 한 단계가 멈춰도 나머지가 실행되게 하고, 그 바깥에 최후 안전장치로 3초 grace 후 강제 `process.exit()`하는 backstop을 두었다(정상 경로에선 절대 발화하지 않음 — 위 두 근본 수정이 이미 핸들을 정리하기 때문). MCP 데몬 진입점(`devtools-mcp`)은 이 teardown 경로를 타지 않아 무관.
