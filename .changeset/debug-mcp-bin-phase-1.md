---
'@ait-co/devtools': patch
---

debug-mode MCP transport을 `devtools-mcp` bin에 추가 (Debugging MCP Phase 1).

단일 `devtools-mcp` 진입점이 `--mode`로 transport을 분기합니다. 기본(debug) 모드는
로컬 Chii 릴레이 + cloudflared quick tunnel을 띄워 폰 안 미니앱에 CDP로 attach하고,
`list_console_messages` / `list_network_requests` / `list_pages` 세 read-only tool을
`chrome-devtools-mcp` 호환 형태로 노출합니다. `--mode=dev`는 기존 dev-server mock state
surface(`devtools_get_mock_state`)를 그대로 사용합니다.

CDP 연결은 주입 가능한 `CdpConnection` 인터페이스 뒤에 있어 tool 계층이 mock으로
단위 테스트됩니다. 폰 attach 라운드트립은 실기기 검증이 필요해 후속 phase로 분리.
