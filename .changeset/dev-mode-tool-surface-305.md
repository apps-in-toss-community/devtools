---
"@ait-co/devtools": patch
---

dev-mode MCP server에 `list_pages`, `get_diagnostics`, `measure_safe_area`, `call_sdk` 도구를 추가하고, CDP 의존 도구들에 tier-filter error를 반환해 "Unknown tool" 실패를 제거한다 (#305).
