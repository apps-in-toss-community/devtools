---
"@ait-co/devtools": patch
---

fix(mcp): relay 기본 포트를 0(OS 할당)으로 변경해 -32000 EADDRINUSE 재발 차단

SIGKILL로 즉사한 부모의 cloudflared 자식(PPID 1 orphan)이 고정 포트 9100을
점유하면 다음 재연결 시 EADDRINUSE → MCP 핸드셰이크 -32000으로 실패했다.
port 0(기본값)으로 OS가 매 기동마다 빈 포트를 배정하게 해 충돌을 원천 차단한다.

추가로 SIGHUP, uncaughtException, unhandledRejection, exit 핸들러에도
shutdown을 등록해 가능한 경로에서 cloudflared 자식을 정리한다(멱등성 가드 포함).
