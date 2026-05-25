---
"@ait-co/devtools": patch
---

feat(relay): relay attach TOTP 인증 (relay-side 권위 관문 + in-app gate fail-fast) (#194)

`AIT_DEBUG_TOTP_SECRET`이 설정되면 relay-side(Node)가 모든 attach upgrade를 RFC 6238 TOTP로 검증한다 — chii.start() 전에 등록한 upgrade 리스너가 권위 있는 관문이고, in-app gate Layer C3은 2차 fail-fast다. 위협 모델은 tunnel URL 유출자 차단으로 한정. 시크릿·코드값은 로그/배너/gate-reason에 출력하지 않는다.
