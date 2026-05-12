---
"@ait-co/devtools": patch
---

feat(mcp): add stdio MCP server spike with `devtools_get_mock_state` tool

Adds a minimal MCP (Model Context Protocol) server that exposes the live browser
mock state to AI coding agents. This is a spike implementation to validate the
surface and establish the extensibility pattern before adding more tools.

**What's included:**
- `src/mcp/server.ts` — Node.js stdio MCP server (`dist/mcp/server.js`)  
  Implements `devtools_get_mock_state` tool: fetches a JSON snapshot of the
  current `AitDevtoolsState` from the Vite dev server endpoint.
- Unplugin option `mcp: true` — registers `GET /api/ait-devtools/state` and
  `POST /api/ait-devtools/state` on the Vite dev server (no-op for other
  bundlers).
- Panel auto-push — on every `aitState` change the panel silently POSTs the
  current state to the endpoint (fire-and-forget, only active when the endpoint
  exists).

**Usage:**

```js
// vite.config.ts
import aitDevtools from '@ait-co/devtools/unplugin';
export default { plugins: [aitDevtools.vite({ mcp: true })] };
```

```json
// MCP client config (e.g. Claude Desktop / Claude Code)
{
  "mcpServers": {
    "ait-devtools": {
      "command": "node",
      "args": ["node_modules/@ait-co/devtools/dist/mcp/server.js"],
      "env": { "AIT_DEVTOOLS_URL": "http://localhost:5173" }
    }
  }
}
```

The `AIT_DEVTOOLS_URL` env var defaults to `http://localhost:5173`.
