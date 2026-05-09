---
'@ait-co/devtools': patch
---

devtools 패널에 mock state preset library를 추가합니다. 자주 쓰는 QA 시나리오(`permission-denied`, `offline`, `logged-out`, `iap-pending`, `ads-no-fill` 등)를 한 클릭으로 적용/해제할 수 있고, 사용자 정의 preset도 `localStorage`에 저장/불러오기 가능합니다. `applyPreset` / `builtInPresets` / `saveUserPreset` 등은 `@ait-co/devtools`에서도 export되어 코드에서 직접 호출할 수 있습니다. 기존 토글 동작은 변경 없습니다.
