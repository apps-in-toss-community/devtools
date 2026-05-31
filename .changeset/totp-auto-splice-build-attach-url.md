---
"@ait-co/devtools": patch
---

feat(mcp): TOTP auto-splice in build_attach_url (#310)

When `AIT_DEBUG_TOTP_SECRET` is set, `build_attach_url` now automatically generates the current TOTP code and splices `at=<code>` into the returned `attachUrl`. The response also includes a `totp` field with `enabled`, `ttlSeconds`, and `expiresAt` so callers know when to re-invoke for a fresh code.
