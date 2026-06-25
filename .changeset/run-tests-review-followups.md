---
'@ait-co/devtools': patch
---

run_tests: add per-file `duration` to results and correct tool/CLI docs

The `run_tests` result now carries a per-file `duration` (the in-page run
time) alongside each file's pass/fail/skip counts, so an agent can triage
which file is slow without conflating it with the top-level whole-run
wall-clock.

Documentation accuracy pass: the tool description and the `devtools-test`
CLI no longer claim the CLI can run the same suite standalone (its relay
attach is not wired yet — run via the MCP tool for now), the `confirm`
field is described as ignored in every non-live session, and stale
issue-tracker references in the test-runner internals were removed.
