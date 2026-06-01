---
"@ait-co/devtools": patch
---

debug MCP: fix a per-call env snapshot regression and a LIVE side-effect guard race introduced with `start_debug(mode)` dual-connection routing. The `CallTool` handler now snapshots the derived environment (`env`/`envReason`) once at entry and reuses it at every output site, so a concurrent `start_debug` swap mid-`await` can no longer stamp the wrong env into a response envelope. The `evaluate` / `call_sdk` LIVE guard now evaluates `connection.kind === 'relay' && getLiveIntent()` with a snapshot `conn.kind` plus a fresh `liveIntent` read at the side-effect boundary — closing a race where a concurrent `start_debug('relay-live')` armed `liveIntent` while a relay-dev call was parked on an await, previously letting a LIVE side-effect run without `confirm: true`.
