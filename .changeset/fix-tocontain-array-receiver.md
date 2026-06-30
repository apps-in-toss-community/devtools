---
"@ait-co/devtools": patch
---

fix(test-runner): support array receivers in `toContain` to match Vitest semantics

Previously, `toContain` only handled string receivers (substring check). It now also supports array receivers (membership check via `Array.prototype.includes`), matching real Vitest behavior. This unblocks 22 `expect([...]).toContain(value)` call sites across sdk-example env3 tests that previously threw unconditionally.
