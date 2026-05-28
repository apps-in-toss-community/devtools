---
"@ait-co/devtools": patch
---

MCP tool surface fidelity (#277): 환경 감지 SSoT + Tier A·B 필터링 + measure_safe_area mock 실측화.

- `src/mcp/environment.ts` 신규 — `MCP_ENV` 환경변수 → CDP target URL 패턴 → default mock 의 3단 우선순위로 단일 함수가 환경 결정.
- `src/mcp/tools.ts` 도구 declaration 에 `availableIn` 필드 추가 (Tier A 'mock', Tier B 'relay', Tier C 'both'). `tools/list` 가 환경에 맞는 도구만 노출하고, 호출 시 환경 불일치면 reason 을 담은 tool-result error 로 거부.
- `measure_safe_area` 가 양쪽 환경에서 같은 `Runtime.evaluate` probe 를 돌리고, 결과 wrapper 에 `source: 'mock' | 'relay'` 를 함께 반환 (Tier B→C 승격).
