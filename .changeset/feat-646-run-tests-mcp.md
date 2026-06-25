---
"@ait-co/devtools": patch
---

feat(mcp): add run_tests tool — run mini-app tests on the attached page (#646)

Completes the phone test-runner trio (#644 transport, #645 Vitest pool) with the
agent-facing entry point: a `run_tests` MCP tool that bundles, injects, and
executes test files on the attached WebView over CDP, then returns per-file
results plus flattened totals.

- `run_tests` tool (Tier C, `availableIn: 'both'`) — registered in
  `debug-server.ts`, NOT in the bootstrap set, so it only appears once a page is
  attached. Reuses the attached connection (single-attach model) rather than
  opening a second relay connection. Args: `files` (globs/paths), `projectRoot`
  (glob base, defaults to daemon cwd), `timeout_ms` (per-file, default 30000,
  clamped to 1000–600000), `confirm` (required in relay-live). Dev-mode
  (`--mode=dev`) returns a clean CDP-unavailable hand-off (added to
  `CDP_ONLY_TOOL_NAMES`).
- `discoverTestFiles(patterns, cwd)` (`test-runner/discover.ts`) — shared file
  discovery (Node built-in `fs/promises` glob, no new dep) used by both the
  `devtools-test` CLI and the MCP tool so expansion semantics are identical.
- Robustness: single-attach guard (a concurrent `run_tests` is rejected, not
  queued), fail-fast page-missing re-check before bundling, per-file timeout
  passthrough, and per-file results as the progress record (one start/done log
  with counts — no secrets).
- esbuild is now loaded via dynamic import inside `bundleTestFile` so the
  test-runner graph no longer pulls esbuild's jsdom-incompatible startup
  invariant into every module that imports it (and keeps it off the MCP-only
  install path until a bundle is actually built).

Unit-tested with a fake CdpConnection through the full MCP request/response path
(no phone): mapping, empty/no-match/timeout/live-guard/concurrency guards, and
the secret-non-leak invariant. Real-device relay (real WebKit) remains manual QA.
