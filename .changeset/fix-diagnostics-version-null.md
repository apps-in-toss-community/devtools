---
"@ait-co/devtools": patch
---

debug MCP: fix `get_diagnostics` always reporting `devtoolsVersion: null` and `mcpVersion: null` in a real bundle (issue #361). `readDevtoolsVersion()` read `globalThis.__VERSION__`, but the tsdown `define` only substitutes the bare `__VERSION__` token — the property access always read `undefined`. It now references the bare identifier (the same mechanism the MCP server `version` already used). `readMcpSdkVersion()` resolved `@modelcontextprotocol/sdk/package.json` at runtime, but that subpath is not in the SDK's `exports` map, so the resolve threw and returned null; the version is now baked in at build time via a new `__MCP_SDK_VERSION__` define (with a path-based runtime fallback for unbundled runs). Found by the env-1 runtime acceptance for #348.
