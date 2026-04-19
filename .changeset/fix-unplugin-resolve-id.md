---
"@ait-co/devtools": patch
---

Fix unplugin `resolveId` regression that broke Vite dev on 0.1.0. The hook was
returning the bare specifier `@ait-co/devtools/mock`, which Vite 8+ treats as
the final resolved id — the module then 404s because no `load` hook is
provided. `resolveId` now resolves the mock subpath to its absolute file path
via `import.meta.resolve`, so every supported bundler loads it the normal way.
Falls back to the bare specifier in runtimes where `import.meta.resolve` is
unavailable.
