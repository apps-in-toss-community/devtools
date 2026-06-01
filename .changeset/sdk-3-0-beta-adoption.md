---
"@ait-co/devtools": patch
---

feat: adopt @apps-in-toss/web-framework 3.0.0-beta.9d42c0b in SDK mock

- Bump devDependency from 2.6.0 to 3.0.0-beta.9d42c0b (exact pin; `peerDependencies` stays `>=2.6.0 <2.7.0` to protect 2.x consumers on the `latest` dist-tag)
- Add `WEBVIEW_BRIDGE_ID` constant to unplugin resolveId so `@apps-in-toss/webview-bridge` (the 3.0 runtime package that absorbed web-bridge + web-analytics) is aliased to the mock; old `BRIDGE_ID`/`ANALYTICS_ID` kept for back-compat
- Add `PermissionError` base class and six per-API `*PermissionError` subclasses (runtime stubs for `instanceof` compatibility; behavior change is a separate issue)
- Export all PermissionError classes from `src/mock/index.ts`
- Add `@deprecated` JSDoc to `onVisibilityChangedByTransparentServiceWeb` (removed in 3.0; export kept for 2.x back-compat)
- Remove `onVisibilityChangedByTransparentServiceWeb` from e2e fixture (not available in 3.0)
- Update `__typecheck.ts`: remove Assert for the removed function; add Asserts for PermissionError hierarchy
- Update `check-sdk-update.ts` and `diff-sdk-exports.ts` to prefer `dist-tags.beta` during prerelease window; fix `exportsOf()` to handle nested condition exports map (3.0 package.json format)
