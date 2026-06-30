---
"@ait-co/devtools": patch
---

fix(test-runner): devtools-test bin now invokes main() — a build-time chunk split had hoisted the self-invoke guard into a shared chunk, so the bin re-export wrapper never ran main() and every `devtools-test` / `pnpm test:env3` invocation exited 0 as a silent no-op. The bin entry is now a dedicated export-free module (`src/test-runner/bin.ts`) that calls main() unconditionally, with a dist-shape guard added to `scripts/check-test-runner-dist.sh` to prevent regression.
