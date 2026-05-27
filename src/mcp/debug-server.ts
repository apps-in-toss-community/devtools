/**
 * @ait-co/devtools debug-mode MCP server (stdio).
 *
 * Lets an AI coding agent attach to a running mini-app (real Toss WebView, or a
 * browser in dev mode) and read its console/network/DOM/screenshot over CDP plus
 * the AIT.* domain, without a human watching a phone. Transport is CDP-via-Chii:
 * a local Chii relay on an OS-assigned port (default 0) exposed through a
 * cloudflared quick tunnel; the phone attaches over the public wss URL.
 *
 *   AI host  --stdio-->  this server  --CDP client WS-->  Chii relay :<OS-port>
 *                                                          ^-- target WS -- phone
 *
 * Port 0 (default): the OS picks a free ephemeral port on every startup.
 * This prevents EADDRINUSE when a stale cloudflared child (orphaned after
 * SIGKILL, PPID 1) still holds a fixed port — which previously caused the MCP
 * handshake to fail with -32000. With port 0 any orphaned cloudflared is
 * harmless; the new relay always gets a fresh port.
 *
 * Best-effort child cleanup: SIGINT/SIGTERM/SIGHUP handlers call shutdown() to
 * stop cloudflared and the relay. uncaughtException/unhandledRejection also
 * call shutdown() before exit. SIGKILL cannot be intercepted by Node, so
 * cloudflared orphans from SIGKILL remain (port 0 makes them harmless). Users
 * can clean up manually: `pkill -f 'cloudflared.*trycloudflare'`.
 *
 * The tool layer reads from an injectable `CdpConnection` (CDP) and `AitSource`
 * (AIT.*), so every tool is unit-testable with a fake (no phone). This module
 * wires the live pieces (relay + tunnel + production connection); the phone
 * roundtrip is fully wired and pending only on-device acceptance.
 *
 * Dynamic tool registration (issue #208):
 * The server advertises `listChanged: true` so MCP clients can subscribe to
 * `notifications/tools/list_changed`. Before any page attaches, only bootstrap
 * tools (`build_attach_url`, `list_pages`) are listed. Once a target appears,
 * the full attach-dependent tool set is added and a `list_changed` notification
 * is sent — without requiring a session restart. `runDebugServer` and
 * `runLocalDebugServer` start a polling watcher that detects the 0→N target
 * transition and calls `server.sendToolListChanged()`.
 *
 * Note: `src/mcp/server.ts` (dev mode, HTTP mock-state) is NOT subject to this
 * model — it has no attach concept and always exposes the full tool surface.
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
import { LocalCdpConnection } from './local-connection.js';
import { launchChromium } from './local-launcher.js';
import {
  BOOTSTRAP_TOOL_NAMES,
  buildAttachUrl,
  callSdk,
  canOpenBrowser,
  DEBUG_TOOL_DEFINITIONS,
  evaluate,
  getDomDocument,
  getMockState,
  getOperationalEnvironment,
  getSdkCallHistory,
  isAitToolName,
  isDebugToolName,
  listConsoleMessages,
  listNetworkRequests,
  listPages,
  measureSafeArea,
  openQrInBrowser,
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
 *
 * `tools/list` is two-tiered (issue #208):
 *   - bootstrap (always): `build_attach_url`, `list_pages`
 *   - attach-dependent (after `connection.listTargets().length > 0`): all others
 *
 * `CallTool` is NOT tiered — hidden tools still execute (attach errors surface
 * naturally via `enableDomains`). The tier only controls visibility.
 */
export function createDebugServer(deps: DebugServerDeps): Server {
  const { connection, aitSource, getTunnelStatus, waitForAttachTimeoutMs = 90_000 } = deps;

  const server = new Server(
    { name: 'ait-debug', version: __VERSION__ },
    // listChanged: true — the server emits notifications/tools/list_changed when
    // a page attaches (0→N target transition), promoted attach-dependent tools.
    { capabilities: { tools: { listChanged: true } } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => {
    const attached = connection.listTargets().length > 0;
    const tools = attached
      ? DEBUG_TOOL_DEFINITIONS.map((tool) => ({ ...tool }))
      : DEBUG_TOOL_DEFINITIONS.filter((tool) => BOOTSTRAP_TOOL_NAMES.has(tool.name)).map(
          (tool) => ({ ...tool }),
        );
    return { tools };
  });

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
      // open_in_browser defaults to true when not explicitly set.
      const openInBrowser = request.params.arguments?.open_in_browser !== false;

      try {
        const { attachUrl, relayUrl, authorityWarning } = buildAttachUrl(
          schemeUrl,
          getTunnelStatus(),
        );

        // Prepend a non-fatal authority warning when the scheme URL host looks wrong.
        const warningPrefix = authorityWarning ? `⚠️  scheme_url 경고: ${authorityWarning}\n\n` : '';

        const header =
          'This tool result is shown to the user directly — do NOT re-print the QR below in your reply (it wastes output tokens). Just tell the user to scan the QR in this output (Ctrl+O to expand if collapsed).';

        // Try to open QR in browser when requested and a GUI is likely available.
        if (openInBrowser && canOpenBrowser()) {
          // Extract deploymentId from the attachUrl for the HTML label.
          // SECRET-HANDLING: we use only the deploymentId param (not the at= code).
          let deploymentIdLabel: string | undefined;
          try {
            const dpMatch = attachUrl.match(/[?&]_deploymentId=([^&]+)/);
            if (dpMatch?.[1]) {
              deploymentIdLabel = decodeURIComponent(dpMatch[1]).slice(0, 36);
            }
          } catch {
            // Best-effort; ignore parse errors.
          }

          const browserResult = await openQrInBrowser(attachUrl, deploymentIdLabel);

          if (browserResult.opened) {
            // Opened successfully: return a short result (token-saving).
            // SECRET-HANDLING: do NOT include attachUrl in the result text.
            const shortText =
              `${warningPrefix}${header}\n` +
              `${JSON.stringify({ relayUrl }, null, 2)}\n\n` +
              `ブラウザにQRを表示しました。\n` +
              `QR画像: ${browserResult.pngPath}\n` +
              `HTMLページ: ${browserResult.htmlPath}\n\n` +
              `브라우저에 QR을 띄웠습니다. 스마트폰 카메라로 스캔하세요.\n` +
              `PNG: ${browserResult.pngPath}`;

            if (!waitForAttach) {
              return { content: [{ type: 'text' as const, text: shortText }] };
            }

            // wait_for_attach path (browser opened).
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
                      `${shortText}\n\nNo page attached within ${TIMEOUT_MS / 1000}s — ` +
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
                  text: `${shortText}\n\n${JSON.stringify(pagesResult, null, 2)}`,
                },
              ],
            };
          }

          // Browser open failed — fall through to text QR with error note.
          const fallbackNote = `(브라우저 열기 실패: ${browserResult.error ?? 'unknown'} — 텍스트 QR로 대체)\n`;
          const qr = await renderQr(attachUrl);
          const baseText = `${warningPrefix}${fallbackNote}${header}\n${JSON.stringify({ attachUrl, relayUrl }, null, 2)}\n\n${qr}`;

          if (!waitForAttach) {
            return { content: [{ type: 'text' as const, text: baseText }] };
          }

          // wait_for_attach + fallback path.
          const POLL_INTERVAL_MS_FB = 1000;
          const TIMEOUT_MS_FB = waitForAttachTimeoutMs;
          const deadline2 = Date.now() + TIMEOUT_MS_FB;
          let attachedPagesFb: ReturnType<CdpConnection['listTargets']> = [];
          while (Date.now() < deadline2) {
            attachedPagesFb = connection.listTargets();
            if (attachedPagesFb.length > 0) break;
            await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS_FB));
          }

          if (attachedPagesFb.length === 0) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text:
                    `${baseText}\n\nNo page attached within ${TIMEOUT_MS_FB / 1000}s — ` +
                    'call list_pages to retry.',
                },
              ],
              isError: true,
            };
          }

          const pagesResultFb = listPages(connection, getTunnelStatus());
          return {
            content: [
              {
                type: 'text' as const,
                text: `${baseText}\n\n${JSON.stringify(pagesResultFb, null, 2)}`,
              },
            ],
          };
        }

        // open_in_browser=false or no GUI available: text QR path (original behaviour).
        const qr = await renderQr(attachUrl);
        const baseText = `${warningPrefix}${header}\n${JSON.stringify({ attachUrl, relayUrl }, null, 2)}\n\n${qr}`;

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
        case 'measure_safe_area':
          return jsonResult(await measureSafeArea(connection));
        case 'evaluate': {
          const expression = request.params.arguments?.expression;
          if (typeof expression !== 'string' || expression === '') {
            return {
              content: [
                { type: 'text' as const, text: 'evaluate requires a non-empty expression.' },
              ],
              isError: true,
            };
          }
          // SECRET-HANDLING: do not log expression or result value.
          return jsonResult(await evaluate(connection, expression));
        }
        case 'call_sdk': {
          const sdkName = request.params.arguments?.name;
          if (typeof sdkName !== 'string' || sdkName === '') {
            return {
              content: [{ type: 'text' as const, text: 'call_sdk requires a non-empty name.' }],
              isError: true,
            };
          }
          const rawArgs = request.params.arguments?.args;
          const sdkArgs: unknown[] = Array.isArray(rawArgs) ? rawArgs : [];
          // SECRET-HANDLING: do not log name, args, or result value.
          return jsonResult(await callSdk(connection, sdkName, sdkArgs));
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

/**
 * Starts a polling watcher that detects the first 0→N target transition on
 * `connection.listTargets()` and sends a `notifications/tools/list_changed`
 * notification on the given server.
 *
 * The watcher polls every `intervalMs` (default 1 000 ms). It fires
 * `server.sendToolListChanged()` exactly once — on the first transition — then
 * clears itself. Shutdown calls `stop()` to clear the interval.
 *
 * SECRET-HANDLING: target `id`/`title`/`url` are not written to any log here.
 * Only an attach-detected stderr line is emitted (no target details).
 *
 * @returns `stop` — call this during shutdown to clear the interval.
 */
export function startAttachWatcher(
  connection: CdpConnection,
  server: Server,
  intervalMs = 1_000,
): { stop(): void } {
  let wasAttached = connection.listTargets().length > 0;
  // If already attached when the watcher starts, send once immediately.
  if (wasAttached) {
    void server.sendToolListChanged();
  }

  const handle = setInterval(() => {
    const isAttached = connection.listTargets().length > 0;
    if (!wasAttached && isAttached) {
      wasAttached = true;
      // Emit once on 0→N transition so the MCP client refreshes its tool list.
      void server.sendToolListChanged();
      clearInterval(handle);
    }
  }, intervalMs);

  return {
    stop() {
      clearInterval(handle);
    },
  };
}

export interface RunDebugServerOptions {
  /**
   * Local Chii relay port. Default 0 (OS-assigned ephemeral port).
   *
   * Passing 0 lets the OS choose a free port on each startup — this prevents
   * EADDRINUSE when a stale cloudflared orphan still holds a fixed port (the
   * root cause of -32000 MCP handshake failures). Pass an explicit port number
   * only when a fixed port is specifically required (backwards-compatible).
   */
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
 *   1. start the Chii relay on an OS-assigned port (with TOTP auth if
 *      AIT_DEBUG_TOTP_SECRET is set),
 *   2. open a cloudflared quick tunnel to the relay's confirmed port,
 *   3. print relay URL + attach instructions,
 *   4. expose the debug tools backed by a `ChiiCdpConnection` + `ChiiAitSource`.
 */
export async function runDebugServer(options: RunDebugServerOptions = {}): Promise<void> {
  // Default 0: OS picks a free port. Prevents EADDRINUSE from stale cloudflared
  // orphans (SIGKILL survivors) that would otherwise block a fixed port and
  // cause -32000 MCP handshake failures on reconnect.
  const relayPort = options.relayPort ?? 0;

  // Build the TOTP verifyAuth predicate from env at startup (runtime read).
  const verifyAuth = buildRelayVerifyAuth();
  const totpEnabled = verifyAuth !== undefined;

  const relay = await startChiiRelay({ port: relayPort, verifyAuth });
  // relay.port is the actual OS-assigned port (may differ from relayPort when 0).

  let tunnel: QuickTunnel | null = null;
  let tunnelStatus: TunnelStatus = { up: false, wssUrl: null };
  // generateAttachToken is kept for legacy/non-TOTP token use, but we no
  // longer print it in the banner to avoid accidental secret exposure.
  const _token = generateAttachToken();

  try {
    // Use relay.port (confirmed bound port) — not the requested port — so the
    // tunnel always points at the port the relay is actually listening on.
    tunnel = await startQuickTunnel(relay.port);
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

  // ---------------------------------------------------------------------------
  // Shutdown: best-effort cleanup of relay + cloudflared child process.
  //
  // SIGKILL cannot be intercepted — cloudflared may remain orphaned (PPID 1).
  // Port 0 makes such orphans harmless: the next startup gets a fresh port.
  // Manual cleanup if needed: `pkill -f 'cloudflared.*trycloudflare'`
  // ---------------------------------------------------------------------------

  let closed = false;
  let attachWatcher: { stop(): void } | null = null;

  const shutdown = () => {
    // Idempotent: multiple simultaneous signals/exit/uncaught calls run only once.
    if (closed) return;
    closed = true;

    attachWatcher?.stop();
    connection.close();
    // tunnel.stop() is synchronous (child process kill) — safe from exit handler.
    tunnel?.stop();
    // relay.close() and server.close() are async; fine for signal handlers but
    // skipped from the synchronous 'exit' handler below.
    void relay.close();
    void server.close();
  };

  // Graceful termination signals.
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  // SIGHUP: terminal hangup / parent process exit.
  process.once('SIGHUP', shutdown);

  // Synchronous-only cleanup on process.exit (async calls are silently ignored
  // by Node at this stage — only tunnel.stop() which is a sync child kill).
  process.on('exit', () => {
    if (!closed) {
      closed = true;
      attachWatcher?.stop();
      tunnel?.stop();
    }
  });

  // Crash safety: shutdown before exiting so cloudflared is killed even on
  // unhandled errors. Covers cases where no signal is delivered (e.g. thrown
  // exception in async code that wasn't caught).
  process.on('uncaughtException', (err) => {
    process.stderr.write(`[ait-debug] uncaughtException: ${String(err)}\n`);
    shutdown();
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    process.stderr.write(`[ait-debug] unhandledRejection: ${String(reason)}\n`);
    shutdown();
    process.exit(1);
  });

  await server.connect(transport);

  // Start the attach watcher after the transport is connected so
  // sendToolListChanged has a live session to notify.
  attachWatcher = startAttachWatcher(connection, server);
}

export interface RunLocalDebugServerOptions {
  /**
   * CDP remote debugging port for the local Chromium. Default 0 (OS-assigned).
   * Uses an ephemeral free port when 0, avoiding EADDRINUSE on reconnect.
   */
  cdpPort?: number;
  /**
   * URL to open in the launched browser. Defaults to `AIT_DEVTOOLS_URL` env var
   * or `http://localhost:5173`.
   */
  devUrl?: string;
}

/**
 * Boots the local-browser debug stack and serves it over stdio:
 *   1. launch a local Chromium with `--remote-debugging-port=<port>`,
 *   2. attach a `LocalCdpConnection` to the first non-blank page target,
 *   3. expose the debug tools backed by that connection + a `ChiiAitSource`.
 *
 * `build_attach_url` (relay-specific, generates a deep-link + QR for the phone)
 * is not applicable in local mode because there is no relay or tunnel. The tool
 * is still listed (it is part of `DEBUG_TOOL_DEFINITIONS`) but will return a
 * clear "not applicable" message via the tunnel-down path (wssUrl is null).
 *
 * The AIT.* tools (`AIT.getSdkCallHistory`, `AIT.getMockState`,
 * `AIT.getOperationalEnvironment`) ride the same CDP channel via
 * `ChiiAitSource` → `LocalCdpConnection.sendCommand`. They will succeed once
 * the sdk-example dev-bridge (`window.__sdkCall` install) lands in sdk-example;
 * until then they return the sdk-example "bridge absent" message — which is
 * expected and noted in the PR as an explicit out-of-scope follow-up.
 */
export async function runLocalDebugServer(options: RunLocalDebugServerOptions = {}): Promise<void> {
  const cdpPort = options.cdpPort ?? 0;
  const devUrl = options.devUrl ?? process.env.AIT_DEVTOOLS_URL ?? 'http://localhost:5173';

  const chromium = await launchChromium({ port: cdpPort, devUrl });

  // Give Chromium a moment to start the CDP endpoint before we connect.
  // 800 ms is enough on most machines; the connection retries if it fails.
  await new Promise<void>((r) => setTimeout(r, 800));

  const connection = new LocalCdpConnection({ devtoolsHttpUrl: chromium.devtoolsUrl });
  // AIT.* methods ride the same CDP channel via LocalCdpConnection.sendCommand.
  const aitSource = new ChiiAitSource(connection);

  // Local mode has no relay tunnel — tunnelStatus is always "down" which causes
  // build_attach_url to return a clear "tunnel not up" error, communicating to
  // the agent that this tool is relay-only.
  const tunnelStatus: TunnelStatus = { up: false, wssUrl: null };

  const server = createDebugServer({
    connection,
    aitSource,
    getTunnelStatus: () => tunnelStatus,
  });

  const transport = new StdioServerTransport();

  let closed = false;
  let attachWatcher: { stop(): void } | null = null;

  const shutdown = () => {
    if (closed) return;
    closed = true;
    attachWatcher?.stop();
    connection.close();
    chromium.stop();
    void server.close();
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.once('SIGHUP', shutdown);

  process.on('exit', () => {
    if (!closed) {
      closed = true;
      attachWatcher?.stop();
      chromium.stop();
    }
  });

  process.on('uncaughtException', (err) => {
    process.stderr.write(`[ait-local-debug] uncaughtException: ${String(err)}\n`);
    shutdown();
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    process.stderr.write(`[ait-local-debug] unhandledRejection: ${String(reason)}\n`);
    shutdown();
    process.exit(1);
  });

  await server.connect(transport);

  // Start the attach watcher after the transport is connected so
  // sendToolListChanged has a live session to notify.
  attachWatcher = startAttachWatcher(connection, server);
}
