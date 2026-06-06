---
'@ait-co/devtools': patch
---

start_debug description 정직화 — relay-staging(환경 3) prereq에 `RELEASE_CHANNEL=dogfood ait build` → `ait deploy --scheme-only`(intoss-private deep-link 발급) 명령 체인 명시하고 env 2(dev-server 터널)와 인프라 대비. relay-sandbox(환경 2)는 single-connection 데몬에서 reject된다는 사실 + full 경로에 AIT_RELAY_BASE_URL·AIT_TUNNEL_BASE_URL 둘 다 필요함을 명시. 동작 변경 없음, description만. (#402)
