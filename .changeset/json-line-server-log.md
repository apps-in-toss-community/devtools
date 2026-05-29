---
"@ait-co/devtools": patch
---

feat: JSON line server log + allowlist-based secret redact (#287)

- `src/mcp/log.ts` — structured JSON-line logger (`logInfo`/`logWarn`/`logError`) with event categories: `server.start`, `tunnel.up`, `tunnel.down`, `page.attached`, `page.detached`, `page.crashed`, `tool.call`, `tool.error`
- Allowlist field filter + value-level secret redact (TOTP 6-digit, Deploy Key `aitcc_` prefix, cookie values, WSS relay URLs)
- `debug-server.ts` and `chii-connection.ts` core paths migrated from free-form `process.stderr.write` to structured logger
- Unit tests in `src/mcp/__tests__/log.test.ts` covering redact matrix and JSON-line output contract
