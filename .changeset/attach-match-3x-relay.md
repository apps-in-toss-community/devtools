---
'@ait-co/devtools': patch
---

attach 페이지 매칭이 3.0 런타임에서 무한 대기하던 문제 수정 (#763). `isMatchingPage`가 페이지 URL에 `_deploymentId` 포함을 요구했지만 3.0 로더는 그 파라미터를 네이티브에서 소비해 페이지 URL로 전파하지 않는다(#760 관측) — target이 connected여도 영원히 unmatched였다. 이번 run의 relay wss URL 매칭(percent-encoded 포함)을 OR로 추가한다: relay 쿼리는 2.x·3.0 모두 페이지 URL로 전파되고 quick tunnel URL은 run마다 고유해 stale-page 필터로 deploymentId보다 정확하다.
