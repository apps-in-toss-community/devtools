---
"@ait-co/devtools": patch
---

feat: add iPhone 15 Pro viewport preset and align default safe-area insets

The Viewport tab now offers an iPhone 15 Pro preset (393×852, DPR 3, Dynamic Island, safe-area top 59 / bottom 34) — a common device that had no exact match in the list (the closest, iPhone 17 at 402×874, has a different CSS viewport). The default `safeAreaInsets` is now `{ top: 59, bottom: 34 }` to match it, so `SafeAreaInsets.get()` returns realistic Dynamic Island insets out of the box instead of the previous notch-era top of 47.
