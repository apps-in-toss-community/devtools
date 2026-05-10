---
"@ait-co/devtools": patch
---

Fix dual `AitStateManager` instance bug in production builds.

`tsdown.config.ts` builds `mock`, `panel`, and `unplugin` entries as
self-contained config objects so Rolldown does not emit a shared chunk at
`dist/` root. As a side effect, `state.ts` was bundled per entry, producing
two `AitStateManager` instances when consumers imported both
`@ait-co/devtools` and `@ait-co/devtools/panel` on the same page. The panel
mutated one instance while the mock SDK observed the other, so toggles in
Permissions / Presets / Network / IAP appeared to apply in the panel UI but
had no effect on the running app.

Fixed with a runtime guard in `src/mock/state.ts`: the `AitStateManager` is
cached on `globalThis` under `__aitDevtoolsStateSingleton__`, so all entries
loaded on the same page share a single instance. No build-pipeline change.

Added two regression tests in `e2e/panel.test.ts` (Layer C):

- `aitState is a single shared instance (not duplicated per entry)` — asserts
  `window.__ait === globalThis.__aitDevtoolsStateSingleton__` and listener
  count > 0.
- `preset Apply changes mock state observed by fixture SDK` — applies the
  Offline preset and verifies a subsequent `iap-purchase` call from the
  fixture switches from `success:` to `error:`.
