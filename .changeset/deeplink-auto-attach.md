---
"@ait-co/devtools": patch
---

Add `build_attach_url` debug MCP tool: splices `debug=1` + the session's live relay URL into an `ait deploy --scheme-only` deep link so opening it on a phone auto-attaches to the Chii relay with no QR scan or paste. This removes the human-in-loop attach step; the in-app gate already reads the `relay` query param, so the deep link triggers attachment on entry.
