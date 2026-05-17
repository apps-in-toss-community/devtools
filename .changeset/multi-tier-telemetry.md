---
"@ait-co/devtools": patch
---

feat(telemetry): multi-tier consent — Tier 0 panel-mount ping + Tier 1 retained

Tier 0 opt-out daily ping (panel mount, fire-and-forget, no anon_id). Tier 1 events
retain existing behaviour with explicit `tier: 1` field. policy_version bumped to
`2026-05-18`; existing granted users regress to undecided for re-consent.
