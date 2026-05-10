---
'@ait-co/devtools': patch
---

feat(panel): export `disposePanel()` for explicit unmount + idempotent re-mount

Pairs with the existing `disposeViewport()`. The panel side-effect import
already mounts idempotently; this adds a symmetric teardown for HMR / SPA
contexts where the panel needs to be removed without a full page reload.
Removes the toggle, panel root, injected `<style>`, all window/aitState
listeners, and `disposeViewport()` is called internally. Calling
`disposePanel()` before mount or twice in a row is a no-op.
