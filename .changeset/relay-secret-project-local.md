---
'@ait-co/devtools': patch
---

relay 시크릿 저장을 머신 홈에서 프로젝트 로컬 .ait_relay 단일 파일로 이전, MCP 데몬은 start_debug projectRoot 인자로 받아 read-only 로드. DualConnectionRouter를 all-lazy로 전환해 모든 family 부트가 switchMode(=시크릿 로드)를 거치게 하여 데몬 startup 시점의 시크릿 로드 빈틈을 제거 (#396)
