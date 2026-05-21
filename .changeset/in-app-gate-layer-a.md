---
"@ait-co/devtools": patch
---

fix(in-app): remove Layer A from the runtime gate — it can never pass in a pre-built package

`evaluateDebugGate`/`checkDebugGate` re-checked `__DEBUG_BUILD__` as "Layer A" and
returned `reason: 'build'` when it was false. But `@ait-co/devtools` ships pre-built:
the constant is baked at *this package's* publish time (always `false`), so the gate
could never pass on a consumer's phone regardless of query params — the in-app debug
attach surface was permanently dead.

Layer A's real mechanism is, and always was, the consumer's
`if (__DEBUG_BUILD__) { import('@ait-co/devtools/in-app') }` guard, where
`__DEBUG_BUILD__` is a *consumer*-build-time constant that DCEs the import from
release bundles. The gate function now evaluates only the runtime layers B
(`_deploymentId`) and C (`debug=1` + valid `wss:` relay). `GateInput.isDebugBuild`
and the `'build'` blocked-reason are removed.
