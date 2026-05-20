/**
 * @ait-co/devtools debug-mode MCP server (stdio) — Phase 1.
 *
 * Lets an AI coding agent attach to a running mini-app (real Toss WebView, or a
 * browser in dev mode) and read its console + network over CDP, without a human
 * watching a phone. Transport is CDP-via-Chii: a local Chii relay :9100 exposed
 * through a cloudflared quick tunnel; the phone attaches over the public wss URL.
 *
 *   AI host  --stdio-->  this server  --CDP client WS-->  Chii relay :9100
 *                                                          ^-- target WS -- phone
 *
 * The tool layer reads from an injectable `CdpConnection`, so the three Phase 1
 * tools are unit-testable with a fake (no phone). This module wires the live
 * pieces (relay + tunnel + production connection); the phone roundtrip itself is
 * phone-gated and deferred.
 *
 * Node-only.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CdpConnection } from './cdp-connection.js';
import { ChiiCdpConnection } from './chii-connection.js';
import { startChiiRelay } from './chii-relay.js';
import {
  DEBUG_TOOL_DEFINITIONS,
  isDebugToolName,
  listConsoleMessages,
  listNetworkRequests,
  listPages,
  type TunnelStatus,
} from './tools.js';
import {
  generateAttachToken,
  printAttachBanner,
  type QuickTunnel,
  startQuickTunnel,
} from './tunnel.js';

/** Live infra the connection reads tunnel status from. */
export interface DebugServerDeps {
  connection: CdpConnection;
  /** Returns current tunnel status (URL changes per spawn). */
  getTunnelStatus(): TunnelStatus;
}

/**
 * Builds the debug-mode MCP server around an injected connection + tunnel
 * status getter. Pure wiring — does not start a relay or tunnel, which is what
 * makes the tool surface unit-testable.
 */
export function createDebugServer(deps: DebugServerDeps): Server {
  const { connection, getTunnelStatus } = deps;

  const server = new Server(
    { name: 'ait-debug', version: __VERSION__ },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: DEBUG_TOOL_DEFINITIONS.map((tool) => ({ ...tool })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    if (!isDebugToolName(name)) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    try {
      // Ensure CDP domains are enabled before reading. No-op once attached;
      // throws a clear message while no page is attached yet.
      await connection.enableDomains();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (name === 'list_pages') {
        // list_pages is still useful pre-attach: report tunnel + empty pages.
        return jsonResult(listPages(connection, getTunnelStatus()));
      }
      return {
        content: [
          {
            type: 'text',
            text: `${message}\nCall list_pages to confirm a mini-app has attached over the relay.`,
          },
        ],
        isError: true,
      };
    }

    switch (name) {
      case 'list_console_messages':
        return jsonResult(listConsoleMessages(connection));
      case 'list_network_requests':
        return jsonResult(listNetworkRequests(connection));
      case 'list_pages':
        return jsonResult(listPages(connection, getTunnelStatus()));
    }
  });

  return server;
}

function jsonResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

export interface RunDebugServerOptions {
  /** Local Chii relay port. Default 9100. */
  relayPort?: number;
}

/**
 * Boots the live debug stack and serves it over stdio:
 *   1. start the Chii relay,
 *   2. open a cloudflared quick tunnel to it,
 *   3. print QR + secret token,
 *   4. expose the three Phase 1 tools backed by a `ChiiCdpConnection`.
 */
export async function runDebugServer(options: RunDebugServerOptions = {}): Promise<void> {
  const relayPort = options.relayPort ?? 9100;

  const relay = await startChiiRelay({ port: relayPort });

  let tunnel: QuickTunnel | null = null;
  let tunnelStatus: TunnelStatus = { up: false, wssUrl: null };
  const token = generateAttachToken();

  try {
    tunnel = await startQuickTunnel(relayPort);
    tunnelStatus = { up: true, wssUrl: tunnel.wssUrl };
    await printAttachBanner({ wssUrl: tunnel.wssUrl, token });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[ait-debug] Failed to open cloudflared quick tunnel: ${message}\n` +
        '[ait-debug] The relay is up locally; attach over the public URL is unavailable until the tunnel starts.\n',
    );
  }

  const connection = new ChiiCdpConnection({ relayBaseUrl: relay.baseUrl });
  const server = createDebugServer({
    connection,
    getTunnelStatus: () => tunnelStatus,
  });

  const transport = new StdioServerTransport();

  const shutdown = () => {
    connection.close();
    tunnel?.stop();
    void relay.close();
    void server.close();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await server.connect(transport);
}
