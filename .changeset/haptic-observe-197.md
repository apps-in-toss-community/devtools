---
"@ait-co/devtools": patch
---

feat(mock): haptic 관측 강화 — navigator.vibrate 매핑 + 패널 가시화 (#197)

`generateHapticFeedback` 10종 타입을 `navigator.vibrate` 패턴으로 best-effort 매핑하고, `sdkCallLog`에 🟡(partial)로 기록한다. 패널 Device 탭에 마지막 haptic 행과 10종 트리거 버튼 추가.
