---
"@ait-co/devtools": patch
---

feat(test-runner): MVP relay transport (#644)

Adds `src/test-runner/` — the first phase of running mini-app Vitest tests on
a real device WebView via the CDP relay.

- `bundle.ts` — esbuild bundles a user test file into a self-contained IIFE;
  SDK imports (`@apps-in-toss/web-framework`) are intercepted by a plugin and
  redirected to `window.__sdk` at runtime (2.x/3.x-agnostic).
- `runtime.ts` — lightweight browser-compatible describe/it/test/expect
  runtime; collects results into a JSON-safe `RunReport`.
- `rpc.ts` — Node-side helper that injects the bundle via `Runtime.evaluate`
  and parses the JSON envelope response.
- `relay-worker.ts` — orchestrates bundle→inject→run→collect sequentially
  across multiple test files over a `CdpConnection`.
- `config.ts` — `definePhoneTestConfig` helper for consumer configuration.
- `cli.ts` — `devtools-test` bin skeleton (relay wiring in issue #645).

New package.json entries: `bin.devtools-test`, `exports["./test-runner"]`,
`dependencies` for `@vitest/runner`, `@vitest/expect`, and `esbuild`.
Full Vitest pool integration is tracked in #645; `run_tests` MCP tool in #646.
