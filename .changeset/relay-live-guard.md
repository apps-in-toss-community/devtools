---
"@ait-co/devtools": patch
---

feat(mcp): split relay into relay-dev/relay-live with LIVE side-effect guard (#307)

`McpEnvironment` 타입을 `'mock' | 'relay-dev' | 'relay-live'`로 확장하고,
`relay-live` 환경에서 `call_sdk`/`evaluate` 호출 시 `confirm: true` 미명시 시 명시적 거부한다.

Backward compat: `MCP_ENV=relay`는 `relay-dev`로 폴백, `filterToolsByEnvironment`/`isToolAvailableIn`은 두 relay 변형을 모두 허용, `get_diagnostics` 응답에 legacy `env` 필드 유지.
