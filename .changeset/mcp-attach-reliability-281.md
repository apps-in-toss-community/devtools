---
"@ait-co/devtools": patch
---

MCP attach 신뢰성 개선 + 4 시나리오 acceptance 문서화 (#281)

- `ChiiCdpConnection.waitForFirstTarget()` 추가: `refreshTargets()` 및 첫 inbound CDP 메시지 양쪽 이벤트를 감지해 `wait_for_attach` polling race 제거
- `list_pages` stale 캐시 수정: `ChiiCdpConnection` 환경에서 매 호출 시 `/targets` refresh
- MCP server disconnect 에러 메시지 개선: relay 끊김과 "page 미부착" 오류를 구별해 재연결 방법 명시
- `docs/scenarios/env-{1,2,3,4}.md` 시나리오별 acceptance 절차 문서화
- `docs/mock-fidelity-catalog.md`에 4 시나리오 MCP tool 응답 diff snapshot 추가
