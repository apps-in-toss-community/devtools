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
import { AutoDevtoolsOpener } from './devtools-opener.js';
import { getEnvironment, getEnvironmentReason, type McpEnvironment } from './environment.js';
import { LocalCdpConnection } from './local-connection.js';
import { launchChromium } from './local-launcher.js';
import { logError, logInfo, logWarn } from './log.js';
import { type QrHttpServer, startQrHttpServer } from './qr-http-server.js';
import { acquireLock, readServerLock } from './server-lock.js';
import {
  BOOTSTRAP_TOOL_NAMES,
  buildAttachUrl,
  callSdk,
  canOpenBrowser,
  DEBUG_TOOL_DEFINITIONS,
  type DiagnosticsCollector,
  evaluate,
  filterToolsByEnvironment,
  getDiagnostics,
  getDomDocument,
  getMockState,
  getOperationalEnvironment,
  getSdkCallHistory,
  getToolAvailability,
  InMemoryDiagnosticsCollector,
  isAitToolName,
  isDebugToolName,
  isToolAvailableIn,
  listConsoleMessages,
  listExceptions,
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
  makeTunnelStatus,
  printAttachBanner,
  type QuickTunnel,
  renderQr,
  startQuickTunnel,
  startTunnelHealthProbe,
} from './tunnel.js';

/**
 * Parses `_deploymentId` from the query string of a scheme URL.
 *
 * Returns `null` when the param is absent or empty — callers treat that as
 * "no deploymentId filter; match on presence only" and fall back to the
 * original `attachedPages.length > 0` condition.
 *
 * SECRET-HANDLING: deploymentId is a public identifier and may appear in
 * debug output. Never confuse it with TOTP secrets or relay tunnel URLs.
 */
export function extractDeploymentId(schemeUrl: string): string | null {
  try {
    // scheme URLs like `intoss-private://host?_deploymentId=xxx` are not
    // parseable by `new URL()` in all environments, so we extract the query
    // string manually.
    const qIndex = schemeUrl.indexOf('?');
    if (qIndex === -1) return null;
    const params = new URLSearchParams(schemeUrl.slice(qIndex + 1));
    const id = params.get('_deploymentId');
    return id && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

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
  /**
   * 로컬 QR HTTP 서버 — `build_attach_url` tool이 브라우저로 열 HTTP URL을 제공.
   * 없으면 text QR fallback으로만 동작 (GUI 없는 환경 호환).
   */
  qrHttpServer?: QrHttpServer;
  /**
   * Resolves the current MCP environment (`mock` | `relay`) per RFC #277.
   * Used by `tools/list` to filter Tier A/B tools and by Tier C tools (e.g.
   * `measure_safe_area`) to label the `source` provenance field.
   *
   * Optional — defaults to a function that asks `getEnvironment(input)` with
   * the live connection. Tests inject a fake to pin the env without touching
   * `setEnvironmentOverride` (which is process-global).
   */
  getEnvironment?: () => McpEnvironment;
  /** Resolves the reason for the current env decision (for logs). */
  getEnvironmentReason?: () => string;
  /**
   * Diagnostics collector — records server-side errors, attach/detach events,
   * and surfaces them via `get_diagnostics`. When omitted a no-op collector is
   * used (backwards-compatible with existing tests that don't inject one).
   */
  diagnosticsCollector?: DiagnosticsCollector;
}

/**
 * Waits for the first target matching `filterFn` to attach, using the
 * event-driven `waitForFirstTarget()` on `ChiiCdpConnection` instances, or
 * falling back to a polling loop for generic `CdpConnection` fakes (tests).
 *
 * This eliminates the polling-only race that previously caused `wait_for_attach`
 * to resolve before the relay had observed the first inbound CDP message from
 * the phone.
 *
 * @param connection - The CDP connection (production or fake).
 * @param filterFn   - Resolves when this predicate is satisfied.
 * @param timeoutMs  - Maximum wait time in ms.
 * @param pollIntervalMs - Fallback poll interval for non-ChiiCdpConnection.
 */
function waitForAttachWithEvents(
  connection: CdpConnection,
  filterFn: (targets: ReturnType<CdpConnection['listTargets']>) => boolean,
  timeoutMs: number,
  pollIntervalMs = 1_000,
): Promise<ReturnType<CdpConnection['listTargets']>> {
  // Use event-driven path when available (ChiiCdpConnection production instances).
  if (connection instanceof ChiiCdpConnection) {
    return connection.waitForFirstTarget(filterFn, timeoutMs, pollIntervalMs);
  }
  // Generic fallback for test fakes that implement CdpConnection but not
  // waitForFirstTarget (they don't emit 'target:attached').
  return new Promise<ReturnType<CdpConnection['listTargets']>>((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    let settled = false;
    const poll = setInterval(() => {
      const targets = connection.listTargets();
      if (filterFn(targets)) {
        settled = true;
        clearInterval(poll);
        resolve(targets);
      } else if (Date.now() >= deadline) {
        settled = true;
        clearInterval(poll);
        reject(new Error(`waitForAttachWithEvents: 타임아웃 (${timeoutMs}ms)`));
      }
    }, pollIntervalMs);
    // Also check immediately.
    const targets = connection.listTargets();
    if (!settled && filterFn(targets)) {
      settled = true;
      clearInterval(poll);
      resolve(targets);
    }
  });
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
  const {
    connection,
    aitSource,
    getTunnelStatus,
    waitForAttachTimeoutMs = 90_000,
    qrHttpServer,
    getEnvironment: getEnvDep,
    getEnvironmentReason: getEnvReasonDep,
    diagnosticsCollector: collectorDep,
  } = deps;

  // Env SSoT — production wires the real `getEnvironment` with the connection;
  // tests inject fakes. Lazy so each request reflects the live connection.
  const resolveEnvironment: () => McpEnvironment =
    getEnvDep ?? (() => getEnvironment({ connection }));
  const resolveEnvironmentReason: () => string =
    getEnvReasonDep ?? (() => getEnvironmentReason({ connection }));

  // Diagnostics collector — production uses an `InMemoryDiagnosticsCollector`;
  // tests may inject a no-op or fake. A no-op is created lazily when none
  // is supplied so existing tests that don't inject one continue to work.
  const collector: DiagnosticsCollector = collectorDep ?? new InMemoryDiagnosticsCollector();

  const server = new Server(
    { name: 'ait-debug', version: __VERSION__ },
    // listChanged: true — the server emits notifications/tools/list_changed when
    // a page attaches (0→N target transition), promoted attach-dependent tools.
    { capabilities: { tools: { listChanged: true } } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => {
    const env = resolveEnvironment();
    const attached = connection.listTargets().length > 0;
    // Tier A/B filter first (env), then bootstrap tier (attach state).
    const envFiltered = filterToolsByEnvironment(DEBUG_TOOL_DEFINITIONS, env);
    const tools = attached
      ? envFiltered.map((tool) => ({ ...tool }))
      : envFiltered
          .filter((tool) => BOOTSTRAP_TOOL_NAMES.has(tool.name))
          .map((tool) => ({ ...tool }));
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

    // Tier A/B env-mismatch guard (RFC #277). Tier C tools pass through.
    // We return a tool-result error (not an MCP protocol error) so the client
    // sees a structured isError + reason text rather than a thrown exception —
    // the MCP SDK still surfaces this as an error to the agent, but with the
    // explanatory `data.reason` payload preserved as text.
    const env = resolveEnvironment();
    if (!isToolAvailableIn(name, env)) {
      const requiredEnv = getToolAvailability(name);
      const reason =
        `tool ${name} is available only in ${requiredEnv}. ` +
        `Current environment is ${env} (${resolveEnvironmentReason()}).`;
      // Log structured (no secrets — only stable env strings + tool name).
      logWarn('tool.error', { tool: name, reason, errorKind: 'tier-filter' });
      return {
        content: [{ type: 'text' as const, text: reason }],
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

    // get_diagnostics is a bootstrap tool — it works before any page attaches
    // and must not require enableDomains. It aggregates all server state into a
    // single response so the agent can diagnose session problems in one call.
    if (name === 'get_diagnostics') {
      try {
        const rawLimit = request.params.arguments?.recent_errors_limit;
        const recentErrorsLimit = typeof rawLimit === 'number' && rawLimit > 0 ? rawLimit : 10;
        const result = await getDiagnostics({
          tunnel: getTunnelStatus(),
          connection,
          env: resolveEnvironment(),
          envReason: resolveEnvironmentReason(),
          collector,
          readLock: readServerLock,
          recentErrorsLimit,
        });
        return jsonResult(result);
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

      // Parse _deploymentId from scheme_url to filter stale attached pages.
      // null → "no filter; match on presence only" (original behaviour preserved).
      const deploymentId = extractDeploymentId(schemeUrl);
      if (!deploymentId) {
        logInfo('tool.call', {
          tool: 'build_attach_url',
          msg: 'no _deploymentId in scheme_url; matching on presence only',
        });
      }

      /** Returns true when the page list satisfies the attach condition. */
      const isMatchingPage = (pages: ReturnType<CdpConnection['listTargets']>): boolean => {
        if (pages.length === 0) return false;
        if (deploymentId === null) return true;
        return pages.some((p) => p.url.includes(deploymentId));
      };

      /** Builds a timeout error message with diagnostic context. */
      const buildTimeoutError = (
        baseText: string,
        timeoutSec: number,
        observed: ReturnType<CdpConnection['listTargets']>,
      ): string => {
        const observedUrls = observed
          .slice(0, 3)
          .map((p) => p.url.slice(0, 80))
          .join(', ');
        const observedNote =
          observed.length > 0 ? ` — previously attached pages: [${observedUrls}]` : '';
        const deploymentNote = deploymentId ? ` matching deploymentId=${deploymentId}` : '';
        return (
          `${baseText}\n\nNo page${deploymentNote} attached within ${timeoutSec}s${observedNote} — ` +
          'call list_pages to retry.'
        );
      };

      try {
        const { attachUrl, relayUrl, authorityWarning } = buildAttachUrl(
          schemeUrl,
          getTunnelStatus(),
        );

        // Prepend a non-fatal authority warning when the scheme URL host looks wrong.
        const warningPrefix = authorityWarning ? `⚠️  scheme_url 경고: ${authorityWarning}\n\n` : '';

        const header =
          'This tool result is shown to the user directly — do NOT re-print the QR below in your reply (it wastes output tokens). Just tell the user to scan the QR in this output (Ctrl+O to expand if collapsed).';

        // canOpenBrowser()를 한 번만 호출하여 이 요청 안에서 일관된 값을 사용한다.
        // mockReturnValueOnce 등 테스트 대역이 여러 번 호출로 소비되지 않도록.
        const guiAvailable = canOpenBrowser();

        // headless 환경 감지: open_in_browser=true인데 GUI가 없는 경우 안내 후 text QR fallback.
        if (openInBrowser && !guiAvailable) {
          const headlessNote =
            '[open_in_browser] GUI 환경이 감지되지 않았습니다 (headless/remote 환경). ' +
            'open_in_browser=false로 자동 폴백합니다. ' +
            '텍스트 QR을 폰 카메라로 스캔하거나, 로컬 GUI 환경에서 실행하세요.\n\n';
          const qrHeadless = await renderQr(attachUrl);
          const headlessText = `${warningPrefix}${headlessNote}${header}\n${JSON.stringify({ attachUrl, relayUrl }, null, 2)}\n\n${qrHeadless}`;

          if (!waitForAttach) {
            return { content: [{ type: 'text' as const, text: headlessText }] };
          }

          // wait_for_attach + headless fallback
          let attachedPagesHl: ReturnType<CdpConnection['listTargets']> = [];
          try {
            attachedPagesHl = await waitForAttachWithEvents(
              connection,
              isMatchingPage,
              waitForAttachTimeoutMs,
            );
          } catch {
            attachedPagesHl = connection.listTargets();
            return {
              content: [
                {
                  type: 'text' as const,
                  text: buildTimeoutError(
                    headlessText,
                    waitForAttachTimeoutMs / 1000,
                    attachedPagesHl,
                  ),
                },
              ],
              isError: true,
            };
          }

          const pagesResultHl = listPages(connection, getTunnelStatus());
          return {
            content: [
              {
                type: 'text' as const,
                text: `${headlessText}\n\n${JSON.stringify(pagesResultHl, null, 2)}`,
              },
            ],
          };
        }

        // Try to open QR in browser when requested, a GUI is available, and the HTTP server is up.
        if (openInBrowser && guiAvailable && qrHttpServer) {
          const httpUrl = qrHttpServer.buildAttachPageUrl(attachUrl);
          const pngUrl = `http://127.0.0.1:${qrHttpServer.port}/qr.png?u=${encodeURIComponent(attachUrl)}`;

          const browserResult = await openQrInBrowser(httpUrl, pngUrl);

          if (browserResult.opened) {
            // Opened successfully — HTTP URL을 사용자에게 명시.
            // SECRET-HANDLING: attachUrl은 httpUrl query string 안에 있고, tool result에는 httpUrl만 노출.
            const retriedNote = browserResult.retried ? ' (1회 retry 후 성공)' : '';
            const openResult = {
              attempted: true,
              succeeded: true,
              ...(browserResult.retried ? { retried: true } : {}),
            };
            const shortText =
              `${warningPrefix}${header}\n` +
              `${JSON.stringify({ relayUrl, openResult }, null, 2)}\n\n` +
              `브라우저에서 QR을 열었습니다${retriedNote}. 폰 카메라로 스캔하세요.\n` +
              `URL: ${browserResult.httpUrl}`;

            if (!waitForAttach) {
              return { content: [{ type: 'text' as const, text: shortText }] };
            }

            // wait_for_attach path (browser opened) — event-driven via waitForAttachWithEvents.
            let attachedPages: ReturnType<CdpConnection['listTargets']> = [];
            try {
              attachedPages = await waitForAttachWithEvents(
                connection,
                isMatchingPage,
                waitForAttachTimeoutMs,
              );
            } catch {
              attachedPages = connection.listTargets();
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: buildTimeoutError(
                      shortText,
                      waitForAttachTimeoutMs / 1000,
                      attachedPages,
                    ),
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

          // Browser open failed — openResult 포함 구조화 에러 + URL 안내 + text QR fallback.
          const openResult = {
            attempted: true,
            succeeded: false,
            failureReason: browserResult.error ?? '브라우저 실행 후보 모두 실패',
            pngUrl: browserResult.pngUrl,
            ...(browserResult.stderrSummary ? { stderrSummary: browserResult.stderrSummary } : {}),
          };
          const stderrNote = browserResult.stderrSummary
            ? `\nstderr: ${browserResult.stderrSummary}`
            : '';
          const fallbackNote =
            `[open_in_browser] 브라우저 자동 열기에 실패했습니다. ` +
            `다음 URL을 직접 브라우저에서 여세요:\n` +
            `${browserResult.httpUrl}\n` +
            `또는 PNG로 받기: ${browserResult.pngUrl}` +
            stderrNote +
            '\n\n';
          const qr = await renderQr(attachUrl);
          const baseText = `${warningPrefix}${fallbackNote}${header}\n${JSON.stringify({ attachUrl, relayUrl, openResult }, null, 2)}\n\n${qr}`;

          if (!waitForAttach) {
            return { content: [{ type: 'text' as const, text: baseText }] };
          }

          // wait_for_attach + fallback path — event-driven via waitForAttachWithEvents.
          let attachedPagesFb: ReturnType<CdpConnection['listTargets']> = [];
          try {
            attachedPagesFb = await waitForAttachWithEvents(
              connection,
              isMatchingPage,
              waitForAttachTimeoutMs,
            );
          } catch {
            attachedPagesFb = connection.listTargets();
            return {
              content: [
                {
                  type: 'text' as const,
                  text: buildTimeoutError(baseText, waitForAttachTimeoutMs / 1000, attachedPagesFb),
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

        // open_in_browser=false or no GUI available or no HTTP server: text QR fallback.
        const qr = await renderQr(attachUrl);
        const baseText = `${warningPrefix}${header}\n${JSON.stringify({ attachUrl, relayUrl }, null, 2)}\n\n${qr}`;

        if (!waitForAttach) {
          return {
            content: [{ type: 'text' as const, text: baseText }],
          };
        }

        // wait_for_attach=true: event-driven via waitForAttachWithEvents.
        // enableDomains is NOT called here — listTargets is a buffered target list
        // read and does not require domain negotiation.
        // The deploymentId filter (parsed above) ensures we don't return a stale
        // page from a previous session — resolves only when an attached page's
        // URL contains the expected deploymentId.
        let attachedPages: ReturnType<CdpConnection['listTargets']> = [];
        try {
          attachedPages = await waitForAttachWithEvents(
            connection,
            isMatchingPage,
            waitForAttachTimeoutMs,
          );
        } catch {
          attachedPages = connection.listTargets();
          return {
            content: [
              {
                type: 'text' as const,
                text: buildTimeoutError(baseText, waitForAttachTimeoutMs / 1000, attachedPages),
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
        // Refresh from relay first so evicted-then-reattached targets are not
        // served as stale empty (#281 — stale cache diagnosis).
        if (connection instanceof ChiiCdpConnection) {
          try {
            await connection.refreshTargets();
          } catch {
            // Ignore refresh errors — still return cached state.
          }
        }
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
        case 'list_exceptions': {
          const rawLimit = request.params.arguments?.limit;
          const limit = typeof rawLimit === 'number' && rawLimit > 0 ? rawLimit : 50;
          return jsonResult({ exceptions: listExceptions(connection, limit) });
        }
        case 'list_network_requests':
          return jsonResult(listNetworkRequests(connection));
        case 'list_pages':
          // Refresh from relay so evict→reattach transitions are not served stale.
          if (connection instanceof ChiiCdpConnection) {
            try {
              await connection.refreshTargets();
            } catch {
              // Ignore refresh errors — still return cached state.
            }
          }
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
          // Pass env to attach `source: 'mock' | 'relay'` to the result (Tier C
          // parity per RFC #277 — the same Runtime.evaluate probe runs in both
          // envs; only the provenance label differs).
          return jsonResult(await measureSafeArea(connection, resolveEnvironment()));
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

/**
 * Detects whether an error is a relay/websocket disconnect error.
 * These are distinguished from "no page attached yet" errors because they
 * require enableDomains() to be called again (re-establish the websocket),
 * not just waiting for a target to appear.
 */
function isDisconnectError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  return (
    msg.includes('relay에 연결되어 있지 않습니다') ||
    msg.includes('relay WebSocket') ||
    msg.includes('replaced-by-new-attach') ||
    msg.includes('Chii relay connection closed')
  );
}

function errorResult(err: unknown, name: string) {
  const message = err instanceof Error ? err.message : String(err);
  // Provide disconnect-specific guidance so the agent knows to re-enable domains.
  const hint = isDisconnectError(err)
    ? '\n\nrelay 연결이 끊겼습니다. list_pages → enableDomains() 재호출로 재연결하세요. ' +
      '폰이 백그라운드로 내려갔거나 미니앱이 종료됐을 수 있습니다.'
    : '\nCall list_pages to confirm a mini-app has attached over the relay.';
  return {
    content: [
      {
        type: 'text' as const,
        text: `${name} failed: ${message}${hint}`,
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
 * `onFirstAttach` is called once on the 0→N transition (or immediately when
 * already attached). Use this to trigger side-effects such as auto-opening
 * Chrome DevTools (issue #282). The callback is optional; omitting it preserves
 * the previous behaviour exactly.
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
  onFirstAttach?: () => void,
): { stop(): void } {
  let wasAttached = connection.listTargets().length > 0;
  // If already attached when the watcher starts, send once immediately.
  if (wasAttached) {
    void server.sendToolListChanged();
    onFirstAttach?.();
  }

  const handle = setInterval(() => {
    const isAttached = connection.listTargets().length > 0;
    if (!wasAttached && isAttached) {
      wasAttached = true;
      // Emit once on 0→N transition so the MCP client refreshes its tool list.
      void server.sendToolListChanged();
      onFirstAttach?.();
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
  // Enforce a single debug session per machine. If another server is alive,
  // ServerLockConflictError is thrown — the MCP host surfaces the message to
  // the agent without a relay or cloudflared ever starting.
  const lockHandle = acquireLock();

  // Default 0: OS picks a free port. Prevents EADDRINUSE from stale cloudflared
  // orphans (SIGKILL survivors) that would otherwise block a fixed port and
  // cause -32000 MCP handshake failures on reconnect.
  const relayPort = options.relayPort ?? 0;

  // Build the TOTP verifyAuth predicate from env at startup (runtime read).
  const verifyAuth = buildRelayVerifyAuth();
  const totpEnabled = verifyAuth !== undefined;

  const relay = await startChiiRelay({ port: relayPort, verifyAuth });
  // relay.port is the actual OS-assigned port (may differ from relayPort when 0).
  logInfo('server.start', { port: relay.port, totpEnabled });

  let tunnel: QuickTunnel | null = null;
  let tunnelStatus: TunnelStatus = makeTunnelStatus(false, null);
  // generateAttachToken is kept for legacy/non-TOTP token use, but we no
  // longer print it in the banner to avoid accidental secret exposure.
  const _token = generateAttachToken();

  // Health probe handle — started once the initial tunnel is up.
  let tunnelProbe: { stop(): void } | null = null;

  // Bring the cloudflared tunnel up in the background so the MCP stdio
  // transport can answer `initialize` immediately. cloudflared has to lazy-
  // download a ~38 MB binary on first run; awaiting it here pushes the
  // initialize response past Claude Code's MCP connection timeout. Tools that
  // need the tunnel (`build_attach_url`) already gate on `getTunnelStatus()`
  // and return a clear "tunnel not up" message when it isn't ready yet, so
  // dropping the await is safe — the agent retries once the banner prints.
  const tunnelReady = startQuickTunnel(relay.port).then(
    (t) => {
      tunnel = t;
      tunnelStatus = makeTunnelStatus(true, t.wssUrl);
      // Update the lock file with the assigned tunnel URL so a second caller
      // can see the correct wssUrl in the conflict error message.
      lockHandle.updateWssUrl(t.wssUrl);
      // SECRET-HANDLING: wssUrl contains the relay host — do not log it directly.
      logInfo('tunnel.up', { totpEnabled });

      // Start the health probe now that the tunnel URL is known.
      // The probe runs every 60 s and attempts up to 3 reissues on drop.
      tunnelProbe = startTunnelHealthProbe(t, relay.port, {
        onReissue: (newTunnel) => {
          tunnel = newTunnel;
          tunnelStatus = makeTunnelStatus(true, newTunnel.wssUrl, null, 0);
          lockHandle.updateWssUrl(newTunnel.wssUrl);
          // Reprint the banner so the user (and agent) see the new URL + QR.
          void printAttachBanner({ wssUrl: newTunnel.wssUrl, totpEnabled }).then(() => {
            logInfo('tunnel.up', { totpEnabled, reissued: true });
          });
        },
        onPermanentDrop: (droppedAt) => {
          tunnelStatus = makeTunnelStatus(false, null, droppedAt, 3);
          logError('tunnel.down', {
            msg: `tunnel permanently dropped (${droppedAt}). Restart: npx @ait-co/devtools devtools-mcp`,
          });
        },
      });

      return printAttachBanner({ wssUrl: t.wssUrl, totpEnabled });
    },
    (err) => {
      const message = err instanceof Error ? err.message : String(err);
      logError('tunnel.down', {
        msg: `Failed to open cloudflared quick tunnel: ${message}. The relay is up locally; attach over the public URL is unavailable until the tunnel starts.`,
      });
    },
  );
  // Reference the promise to placate the linter — actual completion is observed
  // via the side-effects on `tunnelStatus` from inside `.then`.
  void tunnelReady;

  const connection = new ChiiCdpConnection({ relayBaseUrl: relay.baseUrl });
  // AIT.* methods ride the same Chii channel as CDP commands.
  const aitSource = new ChiiAitSource(connection);

  // 로컬 QR HTTP 서버를 await로 시작 — build_attach_url 첫 호출이 qrHttpServer 확인 전에
  // 도달하는 race를 없애기 위해 cloudflared(fire-and-forget)와 달리 동기 await 사용.
  // GUI 없는 환경에서는 startQrHttpServer가 실패해도 text QR fallback으로 동작한다.
  let qrServer: QrHttpServer | undefined;
  try {
    qrServer = await startQrHttpServer();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logWarn('server.start', { msg: `QR HTTP 서버 시작 실패 (text QR fallback 사용): ${message}` });
  }

  const devtoolsOpener = new AutoDevtoolsOpener();

  // Diagnostics collector — records server-side errors and attach/detach events
  // so `get_diagnostics` can surface them in a single call.
  const diagnosticsCollector = new InMemoryDiagnosticsCollector();

  const server = createDebugServer({
    connection,
    aitSource,
    getTunnelStatus: () => tunnelStatus,
    get qrHttpServer() {
      return qrServer;
    },
    diagnosticsCollector,
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
    tunnelProbe?.stop();
    connection.close();
    // tunnel.stop() is synchronous (child process kill) — safe from exit handler.
    tunnel?.stop();
    // relay.close(), server.close(), qrServer.close() are async — fine for signal handlers.
    void relay.close();
    void server.close();
    void qrServer?.close();
    // Remove the lock file so the next startup can proceed immediately.
    lockHandle.release();
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
      tunnelProbe?.stop();
      tunnel?.stop();
      // Synchronous lock release — rmSync is safe from exit handlers.
      lockHandle.release();
    }
  });

  // Crash safety: shutdown before exiting so cloudflared is killed even on
  // unhandled errors. Covers cases where no signal is delivered (e.g. thrown
  // exception in async code that wasn't caught).
  process.on('uncaughtException', (err) => {
    logError('tool.error', { msg: `uncaughtException: ${String(err)}`, errorKind: 'uncaught' });
    shutdown();
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logError('tool.error', {
      msg: `unhandledRejection: ${String(reason)}`,
      errorKind: 'unhandled-rejection',
    });
    shutdown();
    process.exit(1);
  });

  await server.connect(transport);

  // Start the attach watcher after the transport is connected so
  // sendToolListChanged has a live session to notify.
  // The onFirstAttach callback auto-opens Chrome DevTools when a page attaches
  // over the relay (issue #282). It is a no-op in mock env and when
  // AIT_AUTO_DEVTOOLS=0. The tunnel wssUrl may still be null here when
  // cloudflared is still starting; devtoolsOpener.open() guards against that.
  attachWatcher = startAttachWatcher(connection, server, 1_000, () => {
    diagnosticsCollector.recordAttach();
    devtoolsOpener.open(tunnelStatus.wssUrl, getEnvironment({ connection }));
  });
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
  // Enforce a single debug session per machine (same lock as relay mode).
  const lockHandle = acquireLock();

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
    // Remove the lock file so the next startup can proceed immediately.
    lockHandle.release();
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.once('SIGHUP', shutdown);

  process.on('exit', () => {
    if (!closed) {
      closed = true;
      attachWatcher?.stop();
      chromium.stop();
      lockHandle.release();
    }
  });

  process.on('uncaughtException', (err) => {
    logError('tool.error', {
      msg: `uncaughtException: ${String(err)}`,
      errorKind: 'uncaught',
      mode: 'local',
    });
    shutdown();
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logError('tool.error', {
      msg: `unhandledRejection: ${String(reason)}`,
      errorKind: 'unhandled-rejection',
      mode: 'local',
    });
    shutdown();
    process.exit(1);
  });

  await server.connect(transport);

  // Start the attach watcher after the transport is connected so
  // sendToolListChanged has a live session to notify.
  attachWatcher = startAttachWatcher(connection, server);
}
