---
"@ait-co/devtools": patch
---

fix(telemetry): use `__VERSION__` compile-time define directly so events carry the actual package version

`getVersion()` was reading `globalThis.__VERSION__` at runtime, but tsdown's
`define` substitutes `__VERSION__` at build time (it is not a real global).
Result: every telemetry event sent `"version":"0.0.0"` instead of the actual
package version. Switched to a direct `__VERSION__` reference — the same
pattern the panel header already uses — so the substitution applies.
