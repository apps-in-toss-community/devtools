---
"@ait-co/devtools": patch
---

debug MCP: a `--target=local` start can now hot-switch into relay (and back) without restarting the daemon. The `DualConnectionRouter` is generalized to be direction-neutral — an eager family booted at startup plus a lazily-booted opposite-kind family — so both entry points (`runDebugServer` relay-eager and `runLocalDebugServer` local-eager) share the same bidirectional `start_debug` swap. Previously only the default relay-target start carried the dual router; a local start pinned a single-connection router and rejected cross-family switches as "restart required", breaking the env 1 → env 3 fidelity-ladder flow at that entry point.
