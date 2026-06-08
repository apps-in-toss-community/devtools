---
"@ait-co/devtools": patch
---

unplugin 터널 경로에 부모-PID watcher 배선: `startParentWatcher`·`isPidAlive`를 `src/shared/parent-watcher.ts`로 추출하고, vite tunnel boot 완료 후 parent-PID watcher를 등록해 부모 프로세스가 죽거나 reparent될 때 cloudflared 자식 프로세스를 동기적으로 정리하도록 합니다. `process.once('SIGHUP', cleanup)` 핸들러도 추가합니다. (#420)
