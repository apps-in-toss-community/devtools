---
"@ait-co/devtools": patch
---

launcher 파트너 바 뒤로가기 브리지 추가 + 여백 실측 정합 (#510); navigate-back 수신 시 backEvent 구독자 유무에 따라 `__ait:backEvent` 인터셉트 또는 `history.back()` fallback 분기 (env-1 패널 동일 경로)
