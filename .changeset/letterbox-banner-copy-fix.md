---
"@ait-co/devtools": patch
---

fix(launcher): letterbox 배너 `letterboxDetected` 문구 — 반증된 '재설치' 권고 제거 후 실측 부합하는 문구로 교체 (#499)

iOS 18.7 실기기에서 홈 화면 제거 후 재설치해도 letterbox가 재현됨을 확인(#499). `launcher.letterboxDetected`의 "화면 전체를 사용합니다" 문구는 shortfall이 여전히 남는 상태에서 표시될 수 있어 misleading이었다. OS 제약으로 하단 밴드가 남을 수 있음을 담담히 안내하고 회전 트릭(가로→세로)을 해소책으로 제시하는 문구로 교체. ko/en 둘 다 갱신.
