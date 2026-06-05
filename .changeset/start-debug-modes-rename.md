---
'@ait-co/devtools': patch
---

start_debug mode 이름을 환경 계층이 드러나게 하드 리네임 — `local`→`local-browser`(환경 1), `mobile`→`relay-sandbox`(환경 2), `staging`→`relay-staging`(환경 3), `live`→`relay-live`(환경 4). 내부 FamilyKey도 정렬(`local`→`local-browser`, `relay-external`→`relay-sandbox`, `relay-intoss`는 relay-staging·relay-live 두 모드가 공유하는 단일 물리 슬롯으로 유지 — 4개 노출 라벨 → 3개 캐시 키). 옛 이름과 deprecated 별칭은 모두 제거(back-compat 없음, 0.1.x 단계라 허용). LIVE guard(`relay && liveIntent && !confirm → reject`) 동작은 불변 (#398)
