---
"@ait-co/devtools": patch
---

relay: WS keepalive ping 추가 — Cloudflare 터널 유휴 ~100s 절단 방지 (#483)

환경 2/3/4 CDP relay 세션에서 Cloudflare proxied 연결이 무트래픽 ~100초에 절단되는 문제를 수정합니다. relay가 보유한 모든 WS 소켓에 45초 간격으로 protocol ping을 전송해 양쪽 leg(폰 target + daemon client)의 edge 유휴 타이머를 리셋합니다. 클라이언트/target 코드 변경 없음 — ws 라이브러리와 브라우저는 pong을 자동으로 응답합니다.

`startChiiRelay({ keepaliveIntervalMs })` 옵션으로 간격을 조정하거나 `0`으로 비활성화할 수 있습니다.
