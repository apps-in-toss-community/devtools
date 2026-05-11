---
'@ait-co/devtools': patch
---

Add opt-in anonymous usage telemetry client. Introduces a consent state machine (granted/denied/undecided), a Korean-only bottom-right toast (requestIdleCallback / 1.5 s fallback), send-with-retry-once semantics to `https://t.aitc.dev/e`, session-duration tracking via `pagehide`/sendBeacon, and an Environment-tab Telemetry section (toggle, anon_id display, "내 데이터 삭제", privacy link). Module is panel-internal and not exported to consumers.
