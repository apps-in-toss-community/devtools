---
"@ait-co/devtools": patch
---

feat: add iPhone 15 Pro viewport preset, align default safe-area insets, and emulate device characteristics for active presets

The Viewport tab now offers an iPhone 15 Pro preset (393×852, DPR 3, Dynamic Island, safe-area top 59 / bottom 34) — a common device that had no exact match in the list (the closest, iPhone 17 at 402×874, has a different CSS viewport). The default `safeAreaInsets` is now `{ top: 59, bottom: 34 }` to match it, so `SafeAreaInsets.get()` returns realistic Dynamic Island insets out of the box instead of the previous notch-era top of 47.

When a device preset is active (i.e. not `none`/`custom`), the browser characteristics now follow that device so the simulated frame is coherent: `navigator.userAgent` (Toss WebView shape — `… AppsInToss TossApp/<appVersion>`), `navigator.platform`, `window.devicePixelRatio`, `screen.width/height`, and the `platform` that `getPlatformOS()` reads (Apple→`ios` / Galaxy→`android`) are all overridden to the preset's device. Selecting `none`/`custom` reverts to the host environment. Note: these overrides only change values JS reads — real CSS media queries, touch events, and engine-level layout stay at host-browser values (use Chrome DevTools device-mode for pixel-exact emulation).
