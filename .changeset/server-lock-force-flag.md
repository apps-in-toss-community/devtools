---
"@ait-co/devtools": patch
---

feat(mcp): --force flag for server-lock takeover + clear conflict guidance

두 번째 `devtools-mcp` spawn 시 stderr에 기존 세션의 PID·wssUrl·startedAt과
회복 명령(`kill <pid>` 또는 `devtools-mcp --force`)을 출력합니다.

`--force` (alias `--takeover`) 플래그를 추가하면 기존 세션에 SIGTERM → 2s 대기 →
SIGKILL을 보내고 lock을 takeover합니다. stale lock(dead PID) 자동 회수는 기존과
동일하게 유지됩니다. `ServerLockConflictError`에 `existingStartedAt` 필드를 추가했습니다.
