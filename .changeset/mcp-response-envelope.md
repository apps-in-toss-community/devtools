---
"@ait-co/devtools": patch
---

feat(mcp): unified response envelope + chrome-devtools-mcp compat mode (#306)

Introduces `ToolEnvelope<T>` — all MCP debug tool results now share a consistent
`{ ok, data, meta }` shape so agents can use a single parser rather than
branching per tool.

Migrated tools (1차 PR): `list_pages`, `get_diagnostics`, `measure_safe_area`, `call_sdk`.
Remaining tools follow in subsequent PRs.

Set `AIT_MCP_COMPAT=chrome-devtools` to bypass envelope wrapping and restore
0.1.x raw payloads (backward-compat for chrome-devtools-mcp consumers).
