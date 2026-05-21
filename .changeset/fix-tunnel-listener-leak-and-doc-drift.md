---
"@ait-co/devtools": patch
---

fix: remove stdout/stderr listeners on all tunnel exit paths; soften misleading attach-token banner wording; correct CLAUDE.md panel tab list (9→12)

- `src/unplugin/tunnel.ts`: extract a shared `cleanup()` that calls `tunnel.off('stdout', onUrl)` + `tunnel.off('stderr', onUrl)`, and call it from every exit path — resolve, error handler, exit handler, and the 20 s timeout — so persistent listeners are never left on a stopped process.
- `src/mcp/tunnel.ts`: replace "secret token used to gate attach" / bare `token:` label with "attach token (pairing hint — relay-side validation lands in a later phase)", matching the existing code comment that ACL enforcement is a future phase.
- `CLAUDE.md`: update tabs list from 9 to the actual 12 tabs (adds presets, notifications, ads).
