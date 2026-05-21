/**
 * @ait-co/devtools debug-mode MCP server (stdio).
 *
 * Lets an AI coding agent attach to a running mini-app (real Toss WebView, or a
 * browser in dev mode) and read its console/network/DOM/screenshot over CDP plus
 * the AIT.* domain, without a human watching a phone. Transport is CDP-via-Chii:
 * a local Chii relay :9100 exposed through a cloudflared quick tunnel; the phone
 * attaches over the public wss URL.
 *
 *   AI host  --stdio-->  this server  --CDP client WS-->  Chii relay :9100
 *                                                          ^-- target WS -- phone
 *
 * The tool layer reads from an injectable `CdpConnection` (CDP) and `AitSource`
 * (AIT.*), so every tool is unit-testable with a fake (no phone). This module
 * wires the live pieces (relay + tunnel + production connection); the phone
 * roundtrip is fully wired and pending only on-device acceptance.
 *
 * Node-only.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ChiiAitSource } from './ait-chii-source.js';
import type { AitSource } from './ait-source.js';
import type { CdpConnection } from './cdp-connection.js';
import { ChiiCdpConnection } from './chii-connection.js';
import { startChiiRelay } from './chii-relay.js';
import {
  buildAttachUrl,
  DEBUG_TOOL_DEFINITIONS,
  getDomDocument,
  getMockState,
  getOperationalEnvironment,
  getSdkCallHistory,
  isAitToolName,
  isDebugToolName,
  listConsoleMessages,
  listNetworkRequests,
  listPages,
  type TunnelStatus,
  takeScreenshot,
  takeSnapshot,
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
  /** AIT.* domain source — forwarded over the same Chii channel in production. */
  aitSource: AitSource;
  /** Returns current tunnel status (URL changes per spawn). */
  getTunnelStatus(): TunnelStatus;
}

/**
 * Builds the debug-mode MCP server around an injected CDP connection + AIT
 * source + tunnel status getter. Pure wiring — does not start a relay or
 * tunnel, which is what makes the tool surface unit-testable.
 */
export function createDebugServer(deps: DebugServerDeps): Server {
  const { connection, aitSource, getTunnelStatus } = deps;

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

    // AIT.* tools are served by the AIT source. In production it rides the same
    // Chii websocket as CDP, so the connection must be attached first; the AIT
    // source's sendCommand rejects with a clear message if no page is attached.
    if (isAitToolName(name)) {
      try {
        await connection.enableDomains();
        switch (name) {
          case 'AIT.getSdkCallHistory':
            return jsonResult(await getSdkCallHistory(aitSource));
          case 'AIT.getMockState':
            return jsonResult(await getMockState(aitSource));
          case 'AIT.getOperationalEnvironment':
            return jsonResult(await getOperationalEnvironment(aitSource));
          default:
            return unknownTool(name);
        }
      } catch (err) {
        return errorResult(err, name);
      }
    }

    // build_attach_url is pure synthesis (scheme URL + relay URL → deep link).
    // It works before any page attaches, so it must not require enableDomains.
    if (name === 'build_attach_url') {
      const schemeUrl = request.params.arguments?.scheme_url;
      if (typeof schemeUrl !== 'string' || schemeUrl === '') {
        return {
          content: [{ type: 'text', text: 'build_attach_url requires a non-empty scheme_url.' }],
          isError: true,
        };
      }
      try {
        return jsonResult(buildAttachUrl(schemeUrl, getTunnelStatus()));
      } catch (err) {
        return errorResult(err, name);
      }
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

    try {
      switch (name) {
        case 'list_console_messages':
          return jsonResult(listConsoleMessages(connection));
        case 'list_network_requests':
          return jsonResult(listNetworkRequests(connection));
        case 'list_pages':
          return jsonResult(listPages(connection, getTunnelStatus()));
        case 'get_dom_document':
          return jsonResult(await getDomDocument(connection));
        case 'take_snapshot':
          return jsonResult(await takeSnapshot(connection));
        case 'take_screenshot': {
          const shot = await takeScreenshot(connection);
          return {
            content: [{ type: 'image' as const, data: shot.data, mimeType: shot.mimeType }],
          };
        }
        default:
          return unknownTool(name);
      }
    } catch (err) {
      return errorResult(err, name);
    }
  });

  return server;
}

function jsonResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function unknownTool(name: string) {
  return { content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }], isError: true };
}

function errorResult(err: unknown, name: string) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [
      {
        type: 'text' as const,
        text: `${name} failed: ${message}\nCall list_pages to confirm a mini-app has attached over the relay.`,
      },
    ],
    isError: true,
  };
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
 *   4. expose the debug tools backed by a `ChiiCdpConnection` + `ChiiAitSource`.
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
  // AIT.* methods ride the same Chii channel as CDP commands.
  const aitSource = new ChiiAitSource(connection);
  const server = createDebugServer({
    connection,
    aitSource,
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
