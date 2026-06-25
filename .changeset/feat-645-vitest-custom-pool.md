---
"@ait-co/devtools": patch
---

feat(test-runner): Vitest 4.x custom pool integration (#645)

Builds on #644's relay transport with a full Vitest custom pool, so mini-app
tests run on a real device WebView through Vitest's own runner — reporters,
watch, UI, and snapshot all work.

- `pool.ts` — `createRelayPool()` returns a `PoolRunnerInitializer` whose
  in-process `PoolWorker` (modelled on Vitest's `TypecheckPoolWorker`) bundles +
  injects + collects each file over the CDP relay, then reports results through
  `vitest.state`. Single long-lived worker (`isolate: false`) honouring the
  relay's single-attach constraint; the connection opens lazily on first run and
  closes on `stop`.
- `task-graph.ts` — synthesises a Vitest `File`/`Suite`/`Test` task graph from
  the flat page `RunReport`, rebuilding nested suites from ` > `-joined names and
  assigning Vitest-stable ids via `@vitest/runner/utils` (`createFileTask` /
  `calculateSuiteHash`) so reruns and reporter lookups line up. Emits the
  `TaskResultPack`/`TaskEventPack` tuples `state.updateTasks` consumes.
- `config.ts` — `definePhoneVitestConfig({ connection })` produces the Vitest
  `test` config slice (`pool`/`include`/`testTimeout`) to spread into a project's
  config; files matching `include` route to the relay pool.

All Vitest packages aligned to 4.1.9 (vitest devDep, `@vitest/runner`,
`@vitest/expect`) so the custom pool matches the core worker protocol. The
`run_tests` MCP tool is tracked in #646; real-device reporter verification rides
on the comparison dog-food run.
