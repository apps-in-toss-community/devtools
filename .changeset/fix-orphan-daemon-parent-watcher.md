---
"@ait-co/devtools": patch
---

fix(mcp): self-terminate orphaned MCP daemon + surface tunnel-drop in diagnostics

Adds a parent-pid watcher to the MCP debug server so the daemon exits cleanly
when the AI host (Claude Code, etc.) dies without sending SIGTERM/SIGHUP.
Previously, the daemon would run as a zombie indefinitely, holding a stale
cloudflared tunnel that silently blocked new attach attempts.

- `startParentWatcher`: new exported function that polls `process.ppid` /
  `isPidAlive` every 5 s and calls `onOrphaned` (→ `shutdown()` + `process.exit(0)`)
  when the parent is gone. Wired into both `runDebugServer` and
  `runLocalDebugServer`. Disabled by `AIT_DEBUG_NO_PARENT_WATCH=1`.
- stdin `end`/`close` events also trigger shutdown, covering MCP hosts that
  close the pipe without signalling.
- `get_diagnostics`: `DiagnosticsTunnelInfo` now exposes `droppedAt` and
  `reissueAttempts` (copied from the live `TunnelStatus`), and `DiagnosticsResult`
  gains a `process: { pid, ppid, parentAlive }` block.
- `computeNextRecommendedAction` Rule 0 (highest priority): when
  `tunnel.droppedAt != null` → returns `restart` with a timestamped reason,
  beating the existing crash/empty-pages rules.
