---
"@ait-co/devtools": patch
---

fix(mcp): stale lock 회수 시 고아 cloudflared 터널 자식 정리 (#628)

이전 debug-mode 세션의 Node 프로세스가 SIGKILL/크래시로 죽으면 cleanup이
못 돌아 cloudflared 자식이 살아남아 죽은 quick tunnel을 계속 붙잡는다. 다음
세션이 그 stale lock을 회수할 때 고아 자식을 명시적으로 정리하지 않으면
터널이 누적된다.

`acquireLock`이 lock을 회수하는 두 경로(① SIGKILL/크래시로 dead-Node가 된
stale lock 회수, ② `--force` 강제 탈취)에서 lock에 기록된 `tunnelChildPid`가
아직 살아 있으면 `reapOrphanTunnelChild`가 SIGTERM→2s grace→SIGKILL로
정리한다(`isPidAlive`/`killAndWait` 재사용 — #347/#571 zombie-daemon 방어의
짝). `tunnelChildPid`가 없거나(옛 lock 파일) 이미 죽은 경우는 no-op.

SECRET-HANDLING: 정리 로그에는 PID만 출력하고 터널 host/wss는 싣지 않는다
(그 값들은 애초에 lock 파일·이 경로에 들어오지 않는다).
