---
"@ait-co/devtools": patch
---

debug server에 singleton lock 추가 — 동시에 두 번째 `devtools-mcp` 프로세스를 시작하면 명시적 에러(PID + wssUrl)를 출력하고 즉시 종료. SIGKILL로 죽은 stale lock은 PID alive 검사로 자동 회수. graceful shutdown 시 lock file + cloudflared 자식 cleanup.
