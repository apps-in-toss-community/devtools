---
'@ait-co/devtools': patch
---

build_attach_url(env-2/relay-mobile): inputSchema에 projectRoot 추가 — .ait_urls의 tunnelBaseUrl 자동발견이 MCP 클라이언트에서 도달 가능해진다 (start_debug와 대칭). 핸들러는 이미 인자를 읽고 있었고 inputSchema 선언만 누락돼 dead path였다. (#430)
