---
'@ait-co/devtools': patch
---

fix(mcp): expose `build_attach_url` on first `tools/list` in debug-relay mode

debug-mode MCP server now passes a caller-stated `defaultEnv: 'relay'` to
`getEnvironment()` (precedence step 3), so a fresh session with no `MCP_ENV`
and no attached target advertises Tier B `build_attach_url` from the very
first `tools/list` — resolving the M2-5 dead-lock where the agent saw the
tool hidden, concluded "this MCP doesn't support env 3/4", and gave up.

The env decision still respects `MCP_ENV` (precedence 1) and the CDP URL
pattern (precedence 2). Local-target debug mode keeps `defaultEnv: 'mock'`
because no relay tunnel exists there. RFC #277 Tier A/B/C semantics are
unchanged.
