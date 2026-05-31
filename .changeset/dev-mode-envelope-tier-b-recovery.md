---
"@ait-co/devtools": patch
---

feat(mcp): dev-mode envelope 적용 + Tier B 회복 안내 (#322 #323)

- #322: dev-mode tool handler(list_pages, get_diagnostics, measure_safe_area, call_sdk)에 ToolEnvelope {ok, data, meta} 적용. AIT_MCP_COMPAT=chrome-devtools 시 기존 raw 응답 유지.
- #323: build_attach_url을 dev-mode tools/list에 Tier B 스텁으로 노출. 호출 시 "--mode=debug + MCP_ENV=relay 재시작" hand-off 안내 반환(옵션 B — debug-server 병행 방식과 surface 통일).
