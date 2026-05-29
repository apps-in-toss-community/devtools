---
"@ait-co/devtools": patch
---

MCP tool descriptions, error messages, and docs polished for faster agent onboarding (M1.5 patch bundle #311).

Key changes: `get_diagnostics` response gains `nextRecommendedAction` field with deterministic branch rules (tunnel-down → restart, no-pages relay → build_attach_url, crash → re-attach); error messages for `pageMissingError`, `sdkAbsentError`, and `tierRejectionError` now include exact recovery commands; `evaluate`/`call_sdk` descriptions add explicit secret-safety warnings; `take_screenshot` clarifies it is the only image-returning tool; `build_attach_url` default polling timeout updated to 30 s with retry guidance; `list_pages` description adds `tools/list_changed` notification hint; `get_diagnostics` description notes dev-mode limitation; `docs/scenarios/env-{1,3,4}.md` and `docs/qa/scenarios.md` now consistently show `MCP_ENV=relay` for on-device sessions and document the `--mode=dev` vs `--mode=local` selection criteria; README MCP section tables and config examples updated to match.
