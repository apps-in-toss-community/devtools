---
'@ait-co/devtools': patch
---

Address code-review feedback for the device simulation:

- Fix `setDeviceOrientation` "auto" mode losing the SDK after the first call. The SDK now writes to a separate `viewport.appOrientation` field; user-controlled `viewport.orientation` stays `auto`, so the same app can rotate freely across multiple calls.
- Add `viewport.landscapeSide` (`left` | `right`, default `left`). Notch/Dynamic Island insets now move to a single side in landscape, matching real iOS behavior instead of doubling up on both sides.
- Apps in Toss nav bar now uses `aitState.brand.displayName` (built with `textContent`, not `innerHTML` — XSS-safe) and re-renders when the brand name changes. Back button triggers `__ait:backEvent`; close button calls `closeView()`.
- Render the home indicator pill at the bottom of the body for devices with `safeAreaBottom > 0`.
- `body { isolation: isolate }` so notch/navbar z-index can't paint over the floating Panel toggle.
- Make `initViewport` idempotent (HMR / re-mount safe) and export `disposeViewport()` for consumers that dynamically tear the panel down.
- Strict integer + clamp on custom width/height (`1 ≤ value ≤ 4096`); session-storage validation matches.
- Tests for the Viewport tab UI branches (custom inputs, status panel, disabled state, notch-side row visibility).
- README: document the body-scroll caveat, mark `iPhone Air` and `Galaxy S26` series as `(est)`, drop the bogus Pixel/iPad mentions, refresh the console examples and status-line strings.
- Reorder Panel tabs so Viewport sits right after Environment (visual setup before SDK plumbing).
