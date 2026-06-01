---
"@ait-co/devtools": patch
---

debug MCP: `start_debug(mode)` single entry to switch environments (env 1/3/4) in-place — one daemon now holds both a local and a relay CDP connection at once and flips the active pointer with no Claude Code restart or MCP re-handshake (warm attach survives the switch). Replaces the URL-sniffing `getEnvironment()` precedence chain with a derived model: `mock` vs `relay-*` comes free from `connection.kind`, and `relay-dev` vs `relay-live` is a single operator-supplied `liveIntent` bit armed only by `start_debug({ mode: 'relay-live' })`. The LIVE side-effect guard collapses to `connection.kind === 'relay' && liveIntent`, so switching back to a local target auto-disarms it. `--mode`/`--target`/`MCP_ENV` (incl. `MCP_ENV=relay-live` seeding LIVE intent) remain as back-compat aliases.
