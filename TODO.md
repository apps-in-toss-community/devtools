# TODO

## High Priority
- [ ] Verify E2E tests pass against the cloned `sdk-example` repo — `playwright.config.ts` was changed to git-clone and build sdk-example before running E2E; run the full suite end-to-end in CI to confirm the migration works
  - [ ] Audit `e2e/panel.test.ts` selectors against the current sdk-example markup; selectors from the old `examples/vite-react` UI will fail
  - [x] Document the new E2E dev loop in `CLAUDE.md`
  - [ ] Wire the E2E suite into PR CI (currently only `build-and-test` runs on PRs; E2E is not gating)

## Medium Priority
- [ ] Consider a stable sdk-example ref for E2E — currently clones `main` which can break E2E when sdk-example ships UI changes. Pin to a tag or commit SHA, bump deliberately.
- [ ] Cut a 0.1.0 release documenting the sdk-example migration — verify the release workflow, write release notes
- [ ] Document the relationship with `sdk-example` in README
  - [ ] Explain that sdk-example is the reference consumer
  - [ ] Link to the deployed web demo (https://apps-in-toss-community.github.io/sdk-example/)
  - [ ] Note the bidirectional SDK update flow (devtools tracks `@apps-in-toss/web-framework`; sdk-example tracks both)

## Low Priority
- [ ] Enrich existing panel tabs to catch up with sdk-example's interactive surface — e.g. IAP pending-orders / completed-orders viewer, Ads event simulator for load/show lifecycle
- [ ] Add a `devtools`-provided mock state preset library — save/load common scenarios (e.g. "permission denied", "offline", "subscription expired") for faster QA
- [ ] (Optional) Set up `devtools.aitc.dev` as a self-contained "open this URL to see the panel" demo by adding a Pages workflow that builds `e2e/fixture/` + writes `CNAME=devtools.aitc.dev` into the artifact. Cloudflare DNS for `devtools.aitc.dev → apps-in-toss-community.github.io` is already in place (added in the org-wide aitc.dev cutover). The broken `apps-in-toss-community.github.io/devtools/` link was removed from `README.md` in the same cutover; `sdk-example.aitc.dev` already exercises devtools end-to-end, so this is purely a "do we want a tiny isolated fixture demo URL" question.

## Viewport / device simulation follow-ups
- [ ] **Apps in Toss nav bar: `game` variant** — Viewport 탭은 현재 `partner` 타입(흰 배경, 앱 아이콘 + 이름 + ⋯ + ×)만 렌더한다. `game` 타입(투명 배경, ⋯ + × 만, 로고/이름 없음)을 토글로 추가. Config docs의 `webViewProps.type: 'game' | 'partner'` 값을 참고.
- [ ] **Galaxy S26 스펙 갱신** — S26 / S26+ / S26 Ultra는 미출시. 현재 S25 기반 값을 사용 중. 출시 후 공식 수치로 갱신.
- [ ] **Landscape nav bar 처리** — 현재 landscape에선 AIT nav bar 오버레이를 숨긴다. 실제 Toss 호스트가 landscape에서 nav bar를 어떻게 처리하는지 공식 docs에 명시되어 있지 않아 안전하게 숨기고 있다. 확인되면 반영.

## Performance
(None)

## Backlog
- [ ] **Debugging MCP Server** — devtools가 제공하는 live 브라우저 상태(mock 상태, SDK intercept 기록, 콘솔/네트워크 로그)를 AI 코딩 에이전트가 직접 읽고 조작할 수 있도록 MCP server 레이어 추가. Playwright MCP / Chrome DevTools MCP 계열이지만 **앱인토스 SDK mock 상태까지 노출**하는 것이 차별점. 에이전트가 `Bash`만으로는 절대 접근할 수 없는 영역이라 MCP가 결정적 가치를 가짐 (판별 기준은 umbrella `../CLAUDE.md`의 MCP 전략 참고).
  - Tool 후보: `devtools_get_mock_state`, `devtools_set_mock_value`, `devtools_get_console_logs`, `devtools_get_network_requests`, `devtools_get_sdk_call_history`
  - 전송: local **stdio** MCP (브라우저-dev server 사이의 기존 채널 재사용)
  - unplugin 옵션으로 MCP 서버를 dev server에 붙일지 선택 가능 (`mcp: true`)
  - `agent-plugin`의 `/ait debug` skill이 이 MCP가 붙어 있으면 활용, 없으면 수동 디버깅 가이드로 graceful degrade
  - 참고: [Playwright MCP](https://github.com/microsoft/playwright-mcp), [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp)
  - 착수 조건: 코어 devtools 안정화 이후, 실사용자 디버깅 pain이 확인된 뒤
