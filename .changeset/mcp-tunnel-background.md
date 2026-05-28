---
"@ait-co/devtools": patch
---

MCP `initialize` 응답을 cloudflared 부팅과 분리 — tunnel을 background로 띄워, 첫 spawn에 cloudflared 바이너리(~38 MB) lazy download가 걸려도 Claude Code MCP connection timeout을 치지 않는다
