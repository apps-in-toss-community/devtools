---
"@ait-co/devtools": patch
---

fix(mcp): daemon stale 근본 방지 — 자식 exit 감지 + 라이브 프로브 + lock health + max-age (#571)

좀비 데몬 버그(cloudflared 자식이 죽었는데도 `get_debug_status`가 `tunnel.up: true`를 계속 보고) 4축 방어:

- FIX 1 `tunnel.ts`: cloudflared 자식 exit 시 `onUnexpectedExit` 콜백으로 즉시 `doReissueOrDrop` 호출 (probe interval 대기 없음)
- FIX 2 `tools.ts` + `debug-server.ts`: `getDiagnostics` 라이브 `isPidAlive` 프로브 — 캐시 `up=true`를 실 PID 사망 시 `false`로 오버라이드; `get_debug_status` 핸들러가 in-memory `activeTunnelChildPid`(소스 a)와 lock 파일 fallback(소스 b)을 모두 `getDiagnostics`에 전달하도록 프로덕션 배선 완성. `onReissue` 시 lock의 `tunnelChildPid`도 새 PID로 갱신
- FIX 3 `server-lock.ts`: lock 파일에 `tunnelChildPid` 저장 — 재기동 시 자식 PID 사망 락 감지 후 좀비 락 자동 해제
- FIX 4 `parent-watcher.ts`: `startMaxAgeWatchdog` 신설 — 데몬 수명 6시간 상한 (`AIT_DEBUG_NO_MAX_AGE=1` opt-out)
