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

## Out of Scope
- **React Native** — 이 프로젝트는 WebView 미니앱 전용. RN은 지원 범위 밖.
