---
'@ait-co/devtools': patch
---

테스트 러너에 네이티브 브리지 rate limit(`APP_BRIDGE_THROTTLED`) 대응을 추가 (#767). 2026-07-10 실기기 관측: 토스 앱 네이티브가 2.x 브리지 경로에서 같은 메서드를 짧은 시간 내 반복 호출하면 두 번째 호출부터 즉시 거부한다(3.x 경로는 무영향) — 러너의 권한 preflight(6종 일괄 조회)가 첫 트리거였다. 세 부분으로 대응한다: ① preflight를 순차 실행 + 쿼리 간 250ms 간격 + THROTTLED 시 쿼리별 최대 2회 재시도(500ms→1000ms backoff)로 변경, timeout 예산도 새 시간에 맞춰 상향(항상 켬, 플래그 없음). ② 테스트 실패 원인이 THROTTLED일 때 해당 테스트 BODY만 최대 2회 재시도(1s→2s backoff) — beforeEach/afterEach는 매 시도마다 재실행하지 않고 정확히 한 번만 실행되므로 capture 레코드 중복 없음(항상 켬). ③ `--pace <ms>`(`AIT_PACE` env 폴백) opt-in 옵션 신설 — 테스트 간·파일 간 지연을 강제해 2.x cell 스캔 시 rate limit을 사전 회피. 기본값은 전부 0/off로 기존 동작 무변화. `TestResult.throttleRetries`(옵셔널) 필드로 재시도 횟수를 report에 노출하되 기존 필드는 건드리지 않는다.
