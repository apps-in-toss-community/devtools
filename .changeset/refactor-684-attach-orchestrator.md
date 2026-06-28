---
"@ait-co/devtools": patch
---

attach 오케스트레이션을 `createDebugServer` 클로저에서 `src/mcp/attach-orchestrator.ts` 모듈로 추출했습니다 (#684 PR1). attach URL mint·env 검증·QR 렌더·segmented wait(in-call TOTP re-mint)이 6개 클로저 변수를 명시적 `AttachDeps` 객체로 받는 모듈 레벨 함수가 되어, MCP `start_attach` 핸들러 밖에서도 재사용할 수 있습니다. `createDebugServer`는 자기 클로저 변수로 `attachDeps`를 조립해 호출하는 얇은 래퍼가 됐고, 동작은 100% 동일합니다 — 순수 리팩터(행동 무변경).
