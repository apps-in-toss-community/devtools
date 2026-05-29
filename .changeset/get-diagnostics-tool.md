---
"@ait-co/devtools": patch
---

feat(mcp): add `get_diagnostics` tool — single-call server status snapshot (#286)

Returns mcpVersion, devtoolsVersion, tunnel state, list_pages result, lastAttachAt/lastDetachAt, recent server-side errors (PII/secret redacted), environment + reason, and serverLockHolder in one call. Tier C (both mock and relay). Bootstrap tier — available before any page attaches.
