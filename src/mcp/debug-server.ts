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
import { verifyTotp } from './totp.js';
import {
  generateAttachToken,
  printAttachBanner,
  type QuickTunnel,
  renderQr,
  startQuickTunnel,
} from './tunnel.js';

/** Live infra the connection reads tunnel status from. */
export interface DebugServerDeps {
  connection: CdpConnection;
  /** AIT.* domain source — forwarded over the same Chii channel in production. */
  aitSource: AitSource;
  /** Returns current tunnel status (URL changes per spawn). */
  getTunnelStatus(): TunnelStatus;
  /**
   * Maximum time in ms to wait for a page to attach when `wait_for_attach=true`.
   * Default 90 000 ms. Exposed for testing so tests can use a small value without
   * fake timers (which conflict with MCP SDK's own timeouts).
   */
  waitForAttachTimeoutMs?: number;
}

/**
 * Builds the debug-mode MCP server around an injected CDP connection + AIT
 * source + tunnel status getter. Pure wiring — does not start a relay or
 * tunnel, which is what makes the tool surface unit-testable.
 */
export function createDebugServer(deps: DebugServerDeps): Server {
  const { connection, aitSource, getTunnelStatus, waitForAttachTimeoutMs = 90_000 } = deps;

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
      const waitForAttach = request.params.arguments?.wait_for_attach === true;
      try {
        const { attachUrl, relayUrl } = buildAttachUrl(schemeUrl, getTunnelStatus());
        const qr = await renderQr(attachUrl);
        const header =
          'IMPORTANT: Show this QR to the user verbatim in your reply — they scan it with their phone camera. Do not just describe it.';
        const baseText = `${header}\n${JSON.stringify({ attachUrl, relayUrl }, null, 2)}\n\n${qr}`;

        if (!waitForAttach) {
          return {
            content: [{ type: 'text' as const, text: baseText }],
          };
        }

        // wait_for_attach=true: poll listTargets until a page attaches or timeout.
        // enableDomains is NOT called here — listTargets is a buffered target list
        // read and does not require domain negotiation.
        const POLL_INTERVAL_MS = 1000;
        const TIMEOUT_MS = waitForAttachTimeoutMs;
        const deadline = Date.now() + TIMEOUT_MS;
        let attachedPages: ReturnType<CdpConnection['listTargets']> = [];
        while (Date.now() < deadline) {
          attachedPages = connection.listTargets();
          if (attachedPages.length > 0) break;
          await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
        }

        if (attachedPages.length === 0) {
          return {
            content: [
              {
                type: 'text' as const,
                text:
                  `${baseText}\n\nNo page attached within ${TIMEOUT_MS / 1000}s — ` +
                  'call list_pages to retry.',
              },
            ],
            isError: true,
          };
        }

        const pagesResult = listPages(connection, getTunnelStatus());
        return {
          content: [
            {
              type: 'text' as const,
              text: `${baseText}\n\n${JSON.stringify(pagesResult, null, 2)}`,
            },
          ],
        };
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
 * Reads `AIT_DEBUG_TOTP_SECRET` from `process.env` at runtime and builds a
 * `verifyAuth` predicate for the Chii relay's WebSocket upgrade gate.
 *
 * The predicate checks the `at` query parameter against the current and
 * adjacent TOTP time steps (±1 skew) using `verifyTotp`.
 *
 * Returns `undefined` when the env var is not set — callers treat that as
 * "auth disabled" (no predicate registered on the relay).
 *
 * SECRET-HANDLING: The secret value read from env is captured in a closure and
 * is NEVER written to any log, error message, or process output.
 */
export function buildRelayVerifyAuth():
  | ((req: import('node:http').IncomingMessage) => boolean)
  | undefined {
  const secret = process.env.AIT_DEBUG_TOTP_SECRET;
  if (!secret) return undefined;

  return (req) => {
    // Parse the `at` query param from the upgrade request URL.
    // req.url is the raw request path + query, e.g. `/client/id?target=…&at=123456`
    const rawUrl = req.url ?? '';
    const qIndex = rawUrl.indexOf('?');
    const queryStr = qIndex === -1 ? '' : rawUrl.slice(qIndex + 1);
    const params = new URLSearchParams(queryStr);
    const code = params.get('at') ?? '';

    // Do NOT log `code`, `secret`, or any derived value here.
    return verifyTotp(secret, code);
  };
}

/**
 * Boots the live debug stack and serves it over stdio:
 *   1. start the Chii relay (with TOTP auth if AIT_DEBUG_TOTP_SECRET is set),
 *   2. open a cloudflared quick tunnel to it,
 *   3. print relay URL + attach instructions,
 *   4. expose the debug tools backed by a `ChiiCdpConnection` + `ChiiAitSource`.
 */
export async function runDebugServer(options: RunDebugServerOptions = {}): Promise<void> {
  const relayPort = options.relayPort ?? 9100;

  // Build the TOTP verifyAuth predicate from env at startup (runtime read).
  const verifyAuth = buildRelayVerifyAuth();
  const totpEnabled = verifyAuth !== undefined;

  const relay = await startChiiRelay({ port: relayPort, verifyAuth });

  let tunnel: QuickTunnel | null = null;
  let tunnelStatus: TunnelStatus = { up: false, wssUrl: null };
  // generateAttachToken is kept for legacy/non-TOTP token use, but we no
  // longer print it in the banner to avoid accidental secret exposure.
  const _token = generateAttachToken();

  try {
    tunnel = await startQuickTunnel(relayPort);
    tunnelStatus = { up: true, wssUrl: tunnel.wssUrl };
    await printAttachBanner({ wssUrl: tunnel.wssUrl, totpEnabled });
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
