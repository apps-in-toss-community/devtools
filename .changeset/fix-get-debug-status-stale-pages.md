---
"@ait-co/devtools": patch
---

`get_debug_status`가 `list_pages`와 동일하게 pages 조립 전 `refreshTargets()`를 호출해 stale 캐시로 인한 pages:0 / 잘못된 `nextRecommendedAction` 보고를 수정한다. relay에 target이 붙어 있어도 status가 "pages 없음"으로 오판하던 문제(#551)를 해결한다. refresh 실패 시에는 기존 캐시를 그대로 사용해 gracefully 동작한다.
