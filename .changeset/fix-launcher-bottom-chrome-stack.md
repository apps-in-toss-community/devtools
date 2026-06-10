---
"@ait-co/devtools": patch
---

fix: launcher 하단 chrome(RESCAN·진단 FAB·진단 패널·letterbox 라벨)을 단일 fixed flex 스택으로 재구성해 실기기 겹침 제거 (#475) — letterbox 감지에서 iOS 26 실기기 phantom safe-area-inset-bottom 조건 제거, letterbox 시 phantom inset 무시 bottom 분기, 진단 패널 chrome Δ row 추가
