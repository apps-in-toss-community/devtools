---
'@ait-co/devtools': patch
---

`devtools-test` standalone 러너의 QR 대시보드에서 target attach 후에도 Inspector 섹션이 대기 힌트에 머무는 문제를 수정 (#772). MCP 데몬 경로(`debug-server.ts`)와 달리 러너 경로(`test-runner/relay-factory.ts`)는 세 가지 배선이 빠져 있었다: ① `getDashboardState().pages`가 `null`로 하드코딩돼 있어 SSE 클라이언트의 Inspector 활성 게이트(`Array.isArray(pages) && pages.length > 0`)가 구조적으로 항상 false — 이제 booted relay connection의 `listTargets()`를 반영한다. ② target connect/disconnect 시 `qrServer.notifyStateChange()`가 배선돼 있지 않아 대시보드가 즉시 갱신되지 않음 — `debug-server.ts`의 `startAttachWatcher`(이제 MCP `Server` 인자가 optional — 러너 경로처럼 알릴 MCP 세션이 없는 호출자를 위함, 기존 MCP 데몬 호출부는 항상 실 `Server`를 넘기므로 동작 무변화)를 재사용해 attach/detach 시 즉시 push한다. ③ `getDirectInspectorUrl`이 주입되지 않아 `/inspector` 안정 라우트(#530)가 비활성이었던 것을 `debug-server.ts`와 동일한 방식(`buildChiiInspectorUrl` + 요청 시점 TOTP 발급)으로 조립해 주입한다. MCP 데몬 경로 자체의 대시보드 거동은 무변경.
