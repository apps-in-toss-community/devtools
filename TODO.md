# TODO

## High Priority
- [ ] Verify E2E tests pass against the cloned `sdk-example` repo — `playwright.config.ts` was changed to git-clone and build sdk-example before running E2E; run the full suite end-to-end in CI to confirm the migration works
  - [ ] Update e2e test selectors if they reference the old `examples/vite-react` UI (new sdk-example has different markup)
  - [ ] Document the new E2E dev loop in `CLAUDE.md`

## Medium Priority
- [ ] Consider a stable sdk-example ref for E2E — currently clones `main` which can break E2E when sdk-example ships UI changes. Pin to a tag or commit SHA, bump deliberately.
- [ ] Publish `@ait-co/devtools` to npm with real versioning — current `0.0.2`; verify release workflow, write release notes for the sdk-example migration.
- [ ] Document the relationship with `sdk-example` in README
  - [ ] Explain that sdk-example is the reference consumer
  - [ ] Link to the deployed web demo (https://apps-in-toss-community.github.io/sdk-example/)
  - [ ] Note the bidirectional SDK update flow (devtools tracks `@apps-in-toss/web-framework`; sdk-example tracks both)

## Low Priority
- [ ] Expand panel tabs to cover APIs that sdk-example surfaces but the panel doesn't yet mock interactively (e.g. IAP pending orders UI, Ads event simulator)
- [ ] Add a `devtools`-provided mock state preset library — save/load common scenarios (e.g. "permission denied", "offline", "subscription expired") for faster QA

## Out of Scope
- **React Native** — 이 프로젝트는 WebView 미니앱 전용. RN은 지원 범위 밖.
