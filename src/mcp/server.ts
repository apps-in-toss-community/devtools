/**
 * @ait-co/devtools dev-mode MCP server (stdio).
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
 * Phase 3 tool-surface alignment: dev mode and debug mode now expose the same
 * `AIT.*` tools (`AIT.getMockState`, `AIT.getOperationalEnvironment`,
 * `AIT.getSdkCallHistory`). In dev mode they are backed by the HTTP mock-state
 * endpoint (see `HttpAitSource`); in debug mode by the Chii channel. So an AI
 * sees a coherent tool whether attached to a phone (debug) or a dev browser
 * (dev). `devtools_get_mock_state` (the original devtools#130 name) is kept as a
 * backward-compatible alias of `AIT.getMockState`.
 *
 * This module is reached via the `devtools-mcp --mode=dev` CLI entry (see
 * `cli.ts`); the default (no flag) bin mode is the debug-mode CDP/Chii server.
 *
 * Usage (in your MCP client config, e.g. Claude Desktop):
 *   {
 *     "mcpServers": {
 *       "ait-devtools": {
 *         "command": "pnpm",
 *         "args": ["exec", "devtools-mcp", "--mode=dev"],
 *         "env": { "AIT_DEVTOOLS_URL": "http://localhost:5173" }
 *       }
 *     }
 *   }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { HttpAitSource } from './ait-http-source.js';
import type { AitSource } from './ait-source.js';
import {
  getMockState,
  getOperationalEnvironment,
  getSdkCallHistory,
  isAitToolName,
} from './tools.js';

/** Tool descriptors served by the dev-mode server. */
const DEV_TOOL_DEFINITIONS = [
  {
    name: 'AIT.getMockState',
    description:
      'Returns the devtools mock state snapshot (window.__ait) from the running browser session — ' +
      'environment, permissions, location, auth, network, IAP, and more. Read-only. ' +
      'Requires the Vite dev server running with the @ait-co/devtools unplugin option `mcp: true`. ' +
      'Same tool as in debug mode, where the in-app side reports it over the AIT domain.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'AIT.getOperationalEnvironment',
    description:
      'Returns the operational environment + SDK/app version derived from the dev mock state. ' +
      'Read-only.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'AIT.getSdkCallHistory',
    description:
      'Returns the SDK call trace. In dev mode the HTTP mock-state endpoint records no trace, so ' +
      'this returns an empty list; in debug mode it is populated over the AIT domain. Read-only.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'devtools_get_mock_state',
    description:
      'Backward-compatible alias of AIT.getMockState (the original devtools#130 name). Returns the ' +
      'current AIT DevTools mock state snapshot. Read-only. Prefer AIT.getMockState in new configs.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
] as const;

const DEV_TOOL_NAMES = new Set<string>(DEV_TOOL_DEFINITIONS.map((t) => t.name));

export interface CreateDevServerDeps {
  /** AIT source for the dev tools. Defaults to an HTTP source over the dev server. */
  aitSource?: AitSource;
}

/** Builds the dev-mode MCP server (does not connect a transport). */
export function createDevServer(deps: CreateDevServerDeps = {}): Server {
  const devtoolsUrl = process.env.AIT_DEVTOOLS_URL ?? 'http://localhost:5173';
  const stateEndpoint = `${devtoolsUrl}/api/ait-devtools/state`;
  const aitSource = deps.aitSource ?? new HttpAitSource({ stateEndpoint });

  const server = new Server(
    { name: 'ait-devtools', version: __VERSION__ },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: DEV_TOOL_DEFINITIONS.map((tool) => ({ ...tool })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    if (!DEV_TOOL_NAMES.has(name)) {
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }

    try {
      // `devtools_get_mock_state` is an alias of `AIT.getMockState`.
      const effective = name === 'devtools_get_mock_state' ? 'AIT.getMockState' : name;
      if (!isAitToolName(effective)) {
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
      }
      switch (effective) {
        case 'AIT.getMockState':
          return jsonResult(await getMockState(aitSource));
        case 'AIT.getOperationalEnvironment':
          return jsonResult(await getOperationalEnvironment(aitSource));
        case 'AIT.getSdkCallHistory':
          return jsonResult(await getSdkCallHistory(aitSource));
        default:
          return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [
          {
            type: 'text',
            text:
              `${message}\n` +
              'Is the Vite dev server running with the @ait-co/devtools unplugin option `mcp: true`? ' +
              'Is AIT_DEVTOOLS_URL set correctly?',
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

function jsonResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

/** Builds the dev-mode server and connects it over stdio. */
export async function runDevServer(): Promise<void> {
  const server = createDevServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
