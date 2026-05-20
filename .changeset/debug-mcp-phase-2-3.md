---
'@ait-co/devtools': patch
---

debug-mode MCP에 DOM/스냅샷/스크린샷 + AIT 도메인 tool 추가 (Debugging MCP Phase 2·3).

Phase 2 — CDP 커맨드(요청→응답) 기반 read-only tool 3개: `get_dom_document`(`DOM.getDocument`),
`take_snapshot`(`DOMSnapshot.captureSnapshot`), `take_screenshot`(`Page.captureScreenshot`,
PNG를 MCP image content block으로 반환). Phase 1의 이벤트 스트림과 달리 요청→응답이라
`CdpConnection`에 `send(method, params)`를 추가했습니다.

Phase 3 — CDP가 못 잡는 영역을 위한 AIT 도메인 tool 3개: `AIT.getSdkCallHistory`,
`AIT.getMockState`, `AIT.getOperationalEnvironment`. debug 모드에서는 Chii 채널로,
dev 모드에서는 dev server의 mock-state HTTP endpoint로 같은 tool surface를 노출합니다.
dev 모드(`devtools-mcp --mode=dev`)가 이제 `AIT.*` tool을 노출하며,
기존 `devtools_get_mock_state`는 `AIT.getMockState`의 하위호환 alias로 유지됩니다.

모든 tool은 주입 가능한 `CdpConnection` / `AitSource` 뒤에 있어 fake로 단위 테스트됩니다.
폰 attach 라운드트립(실기기 검증)은 후속 phase로 분리되어 있고, tool 계층은 CI에서 검증됩니다.
