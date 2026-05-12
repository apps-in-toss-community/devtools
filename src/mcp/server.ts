/**
 * @ait-co/devtools MCP Server (stdio)
 *
 * Exposes the live browser mock state from a running Vite dev server to AI
 * coding agents via the Model Context Protocol (MCP).
 *
 * Architecture:
 *   Browser (aitState) → Vite dev server endpoint (/api/ait-devtools/state)
 *                      ← HTTP GET ← this stdio MCP server ← AI agent
 *
 * The Vite endpoint is registered by the unplugin when `mcp: true` is set in
 * the plugin options (see `src/unplugin/index.ts`).
 *
 * Usage (in your MCP client config, e.g. Claude Desktop):
 *   {
 *     "mcpServers": {
 *       "ait-devtools": {
 *         "command": "node",
 *         "args": ["node_modules/@ait-co/devtools/dist/mcp/server.js"],
 *         "env": { "AIT_DEVTOOLS_URL": "http://localhost:5173" }
 *       }
 *     }
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const DEVTOOLS_URL = process.env.AIT_DEVTOOLS_URL ?? 'http://localhost:5173';
const STATE_ENDPOINT = `${DEVTOOLS_URL}/api/ait-devtools/state`;

const server = new Server(
  { name: 'ait-devtools', version: __VERSION__ },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: [
    {
      name: 'devtools_get_mock_state',
      description:
        'Returns a snapshot of the current AIT DevTools mock state from the running browser session. ' +
        'Includes environment config, permissions, location, auth, network status, IAP settings, and more. ' +
        'Requires the Vite dev server to be running with the @ait-co/devtools unplugin option `mcp: true`.',
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'devtools_get_mock_state') {
    return {
      content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }],
      isError: true,
    };
  }

  let state: unknown;
  try {
    const res = await fetch(STATE_ENDPOINT);
    if (!res.ok) {
      return {
        content: [
          {
            type: 'text',
            text:
              `Failed to fetch state from ${STATE_ENDPOINT}: HTTP ${res.status} ${res.statusText}.\n` +
              'Ensure the Vite dev server is running and the unplugin option `mcp: true` is set.',
          },
        ],
        isError: true,
      };
    }
    state = await res.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [
        {
          type: 'text',
          text:
            `Cannot reach AIT DevTools state endpoint at ${STATE_ENDPOINT}: ${message}.\n` +
            'Is the Vite dev server running? Is AIT_DEVTOOLS_URL set correctly?',
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(state, null, 2),
      },
    ],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
