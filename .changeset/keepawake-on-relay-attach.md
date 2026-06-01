---
"@ait-co/devtools": patch
---

Auto-trigger `setScreenAwakeMode({ enabled: true })` when a debug session attaches to a real phone via the relay (env 3/4), and restore normal sleep on page unload. Add `noKeepAwake=1` URL param opt-out.
