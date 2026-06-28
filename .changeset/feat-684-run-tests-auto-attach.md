---
'@ait-co/devtools': patch
---

feat(run_tests): auto-attach when no page is connected (issue #684 PR2)

`run_tests` now auto-attaches to a phone when there is no live CDP page, instead
of immediately returning `pageMissingError`. The attach branch fires only in relay
environments (env 3/relay-dev) and only when `isSandboxPageFresh` confirms there
is no live page (ghost-page safe via the stale-threshold guard from #610).

- **Already-attached path (4a) is unchanged** — existing behaviour, no regression.
- **Auto-attach path (4b)**: no live page + relay env → calls `prepareAttach` +
  `renderAndMaybeWait` (QR dashboard + phone wait), then optionally injects a
  `cell` object via `injectGlobals` into `globalThis` before the first test bundle
  runs, then proceeds with the normal run path.
- **Mock/local guidance path (4c)**: no live page + mock env → returns a clear
  guidance error (mock has no relay, auto-attach not applicable).

New module `src/test-runner/cell.ts` exports `injectGlobals(conn, globals)` — a
react-free, CdpConnection-only helper that atomically assigns any record onto
`globalThis` via a single `Runtime.evaluate` before test bundles are injected.
Callers use `{ "__AIT_CELL__": { sdkLine, platform } }` — devtools does not know
the sdk-example-specific shape.

`run_tests` descriptor gains three optional args: `scheme_url`, `cell`, `projectRoot`
context for the auto-attach flow. `availableIn` stays `both`.
