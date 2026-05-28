---
'@ait-co/devtools': patch
---

단일 미니앱 attach 모델 도입 — last-attach wins. 새 page가 relay에 attach되면 이전 page 세션을 자동 교체(pending 명령 reject + `replaced` lifecycle 이벤트). `list_pages`는 배열을 유지하되 항상 0-1 항목이며 `singleAttachModel: true` 필드로 명시.
