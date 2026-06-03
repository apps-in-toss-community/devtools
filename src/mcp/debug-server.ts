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
import { wrapEnvelope } from './envelope.js';
import {
  deriveEnvironment,
  getLiveIntent,
  type McpEnvironment,
  setLiveIntent,
} from './environment.js';
import {
  classifyToolError,
  liveGuardError,
  mcpError,
  pageCrashError,
  pageMissingError,
  relayDisconnectError,
  sdkAbsentError,
  tierRejectionError,
} from './errors.js';
import { LocalCdpConnection } from './local-connection.js';
import { launchChromium } from './local-launcher.js';
import { logError, logInfo, logWarn } from './log.js';
import { type QrHttpServer, startQrHttpServer } from './qr-http-server.js';
import { acquireLock, isPidAlive, readServerLock } from './server-lock.js';
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

/**
 * The result of a `start_debug` mode switch (issue #348). Reported back to the
 * agent so it knows the active mode, whether the LIVE guard is armed, and the
 * suggested next step — all without a Claude Code restart or MCP re-handshake.
 */
export interface ModeSwitchReport {
  /** The mode now active after the switch. */
  mode: StartDebugMode;
  /** Derived `McpEnvironment` for the now-active connection. */
  environment: McpEnvironment;
  /** Kind of the now-active connection. */
  kind: 'relay' | 'local';
  /** `true` when the relay-live LIVE side-effect guard is now armed. */
  liveGuardActive: boolean;
  /** Human-readable next-step hint for the agent. */
  nextStep: string;
}

/**
 * The three canonical `start_debug` modes (issue #382 — renamed from the old
 * four-value set to user-facing environment names):
 *
 *   - `local`   → env 1: desktop Chromium with the MOCK SDK + local CDP attach.
 *                 Side-effect tools (call_sdk/evaluate) run unguarded against
 *                 the mock; nothing touches a real device or real users.
 *                 No prerequisites — the default, always-available environment.
 *
 *   - `staging` → env 3: real-device Toss WebView dogfood build with the REAL
 *                 SDK over the intoss-private relay. liveIntent off.
 *                 Prerequisite: deployed dogfood bundle + device cold-loaded via
 *                 intoss-private deep-link/QR relay injection.
 *
 *   - `live`    → env 4: REVIEW-PASSED production runtime with the REAL SDK
 *                 over the intoss relay. liveIntent on (requires `confirm: true`).
 *                 Read-only debugging: call_sdk/evaluate require confirm per call.
 *
 * Deprecated aliases (back-compat — pinned .mcp.json / docs / QA runbooks):
 *   `local-browser-dev` / `local-browser-cdp` → `local`
 *   `relay-dev`  → `staging`
 *   `relay-live` → `live`
 * Normalization is handled by `normalizeStartDebugMode`.
 */
export type StartDebugMode = 'local' | 'staging' | 'live';

/** Returns `true` when the mode routes to a relay connection. */
export function isRelayMode(mode: StartDebugMode): boolean {
  return mode === 'staging' || mode === 'live';
}

/**
 * Owns the two coexisting CDP connections (local + relay) and the `active`
 * pointer that `start_debug` flips (issue #348 — DUAL-CONNECTION-COEXIST).
 *
 * The MCP `Server` + transport are created once; the request handlers read the
 * connection through `active`, so swapping the pointer underneath is invisible
 * to the MCP host (no re-handshake, no restart). Inactive infra is left warm —
 * teardown happens only at process exit (see the unified shutdown in the run
 * functions), which is what preserves a warm attach across mode switches.
 */
export interface ConnectionRouter {
  /** The connection the request handlers must read this instant. */
  readonly active: CdpConnection;
  /**
   * Switches the active connection to the family for `mode`, lazily booting
   * that family's infra if needed, re-arming the attach watcher, and emitting
   * `tools/list_changed`. Sets `liveIntent` (true only for `live`).
   *
   * Rejects (without swapping) when a swap is already in flight, or when
   * `live` is requested without `confirm: true`.
   */
  switchMode(mode: StartDebugMode, confirm: boolean): Promise<ModeSwitchReport>;
}

/** Live infra the connection reads tunnel status from. */
export interface DebugServerDeps {
  connection: CdpConnection;
  /**
   * Dual-connection router (issue #348). When provided, the request handlers
   * read the live connection through `router.active` and `start_debug` calls
   * `router.switchMode()`. When omitted (the dominant test path), a trivial
   * router pinned to `deps.connection` is synthesized and `start_debug` reports
   * that dynamic switching is unavailable — back-compat with every existing
   * single-connection test.
   */
  router?: ConnectionRouter;
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
   * Resolves the current MCP environment (`mock` | `relay-dev` | `relay-live`).
   * Used by `tools/list` to filter Tier A/B tools and by Tier C tools (e.g.
   * `measure_safe_area`) to label the `source` provenance field.
   *
   * Optional — defaults (issue #348) to deriving the env from the *active*
   * connection's `kind` + the module-level `liveIntent` bit
   * (`deriveEnvironment(router.active.kind, getLiveIntent())`). No URL sniffing
   * or precedence chain. Tests inject a fake to pin a precise env.
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
  /**
   * Hex-encoded TOTP secret for `build_attach_url` auto-splice.
   *
   * When set, `build_attach_url` generates a fresh TOTP code on every call and
   * splices it as `at=<code>` into the returned `attachUrl`. The response also
   * includes a `totp` field with `ttlSeconds` and `expiresAt` so callers know
   * when to re-invoke.
   *
   * SECRET-HANDLING: this value is captured in a closure and MUST NOT be logged
   * or included in any output other than the `at=` param inside `attachUrl`.
   *
   * Production: passed from `process.env.AIT_DEBUG_TOTP_SECRET` by
   * `runDebugServer`. Tests inject a dummy hex string or omit it.
   */
  totpSecret?: string;
}

/**
 * Waits for the first target matching `filterFn` to attach, using the
 * event-driven `waitForFirstTarget()` when the connection supports it
 * (interface-optional member, present on `ChiiCdpConnection`), or falling
 * back to a polling loop for connections that don't implement it (test fakes,
 * `LocalCdpConnection`).
 *
 * This eliminates the polling-only race that previously caused `wait_for_attach`
 * to resolve before the relay had observed the first inbound CDP message from
 * the phone.
 *
 * @param connection - The CDP connection (production or fake).
 * @param filterFn   - Resolves when this predicate is satisfied.
 * @param timeoutMs  - Maximum wait time in ms.
 * @param pollIntervalMs - Fallback poll interval for connections without waitForFirstTarget.
 */
function waitForAttachWithEvents(
  connection: CdpConnection,
  filterFn: (targets: ReturnType<CdpConnection['listTargets']>) => boolean,
  timeoutMs: number,
  pollIntervalMs = 1_000,
): Promise<ReturnType<CdpConnection['listTargets']>> {
  // Use event-driven path when available (CdpConnection.waitForFirstTarget is
  // optional; ChiiCdpConnection implements it, LocalCdpConnection and test fakes do not).
  if (connection.waitForFirstTarget) {
    return connection.waitForFirstTarget(filterFn, timeoutMs, pollIntervalMs);
  }
  // Generic fallback for connections without waitForFirstTarget
  // (test fakes, LocalCdpConnection — they don't emit 'target:attached').
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
    router: routerDep,
    aitSource,
    getTunnelStatus,
    waitForAttachTimeoutMs = 90_000,
    qrHttpServer,
    getEnvironment: getEnvDep,
    getEnvironmentReason: getEnvReasonDep,
    diagnosticsCollector: collectorDep,
    totpSecret,
  } = deps;

  // Dual-connection router (issue #348). Production passes a real router that
  // holds both the local + relay connections and flips `active` on
  // `start_debug`. Tests (and any single-connection caller) omit it — we
  // synthesize a trivial router pinned to `deps.connection` whose `switchMode`
  // reports that dynamic switching is unavailable. Either way the handlers read
  // the live connection through `router.active`, so per-call snapshots are
  // uniform.
  const router: ConnectionRouter = routerDep ?? makeSingleConnectionRouter(connection);

  // Env SSoT (issue #348) — derived, not detected: `mock` vs `relay-*` is free
  // from the ACTIVE connection's `kind`; `relay-dev` vs `relay-live` is the
  // module-level `liveIntent` bit. No URL sniffing, no precedence chain. Tests
  // inject `getEnvironment`/`getEnvironmentReason` to pin a precise env.
  const resolveEnvironment: () => McpEnvironment =
    getEnvDep ?? (() => deriveEnvironment(router.active.kind, getLiveIntent()));
  const resolveEnvironmentReason: () => string =
    getEnvReasonDep ?? (() => `derived:kind=${router.active.kind},liveIntent=${getLiveIntent()}`);

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
    // Per-request snapshot of the active connection (issue #348). `kind` is
    // authoritative even before any target attaches, so bootstrap visibility
    // (e.g. Tier B `build_attach_url`) is correct from the first `tools/list`.
    const conn = router.active;
    const env = resolveEnvironment();
    const attached = conn.listTargets().length > 0;
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

    // PER-CALL SNAPSHOT (issue #348). Capture the active connection exactly
    // once at handler entry and use ONLY `conn` for the rest of this call.
    // `start_debug` may flip `router.active` mid-flight (and other concurrent
    // requests too); re-reading `router.active` after an `await` would race the
    // swap. This is the hard-constraint that keeps a switch from corrupting an
    // in-flight tool call.
    const conn = router.active;

    // start_debug — single entry to switch families (local ↔ relay) without a
    // Claude Code restart or MCP re-handshake. Always callable (Tier C /
    // bootstrap), so it is handled before the env-mismatch guard below.
    if (name === 'start_debug') {
      const rawMode = request.params.arguments?.mode;
      const mode = normalizeStartDebugMode(rawMode);
      if (mode === null) {
        return mcpError(
          'start_debug: mode가 올바르지 않습니다. ' +
            "'local' | 'staging' | 'live' 중 하나를 전달하세요 " +
            "(deprecated 별칭 'local-browser-dev'/'local-browser-cdp'/'relay-dev'/'relay-live'도 수용).",
        );
      }
      const confirm = request.params.arguments?.confirm === true;
      try {
        const report = await router.switchMode(mode, confirm);
        return jsonResult(report);
      } catch (err) {
        return errorResult(err, name);
      }
    }

    // PER-CALL SNAPSHOT of the derived environment (issue #348 / #354 regression
    // fix). Capture `env` + `envReason` exactly once, right after the start_debug
    // branch (so this call sees the post-switch env when it *is* a switch) and
    // before the first `await`. Every site below reuses these locals instead of
    // re-calling `resolveEnvironment()`/`resolveEnvironmentReason()` — those
    // closures re-read `router.active.kind` + `getLiveIntent()` live, so a
    // concurrent `start_debug` swap mid-await would otherwise corrupt the env
    // stamped into this call's envelope / provenance label.
    const env = resolveEnvironment();
    const envReason = resolveEnvironmentReason();
    // Tier A/B env-mismatch guard (RFC #277). Tier C tools pass through.
    // We return a tool-result error (not an MCP protocol error) so the client
    // sees a structured isError + reason text rather than a thrown exception —
    // the MCP SDK still surfaces this as an error to the agent, but with the
    // explanatory `data.reason` payload preserved as text.
    if (!isToolAvailableIn(name, env)) {
      const requiredEnv = getToolAvailability(name) ?? 'unknown';
      // Log structured (no secrets — only stable env strings + tool name).
      logWarn('tool.error', {
        tool: name,
        errorKind: 'tier-filter',
        requiredEnv,
        currentEnv: env,
        envReason,
      });
      return tierRejectionError(name, requiredEnv, env, envReason);
    }

    // AIT.* tools are served by the AIT source. In production it rides the same
    // Chii websocket as CDP, so the connection must be attached first; the AIT
    // source's sendCommand rejects with a clear message if no page is attached.
    if (isAitToolName(name)) {
      try {
        await conn.enableDomains();
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
          connection: conn,
          env,
          envReason,
          collector,
          readLock: readServerLock,
          recentErrorsLimit,
        });
        const attached = conn.listTargets().length > 0;
        return envelopeResult(result, name, env, attached);
      } catch (err) {
        return errorResult(err, name);
      }
    }

    // build_attach_url is pure synthesis (scheme URL + relay URL → deep link).
    // It works before any page attaches, so it must not require enableDomains.
    if (name === 'build_attach_url') {
      const schemeUrl = request.params.arguments?.scheme_url;
      if (typeof schemeUrl !== 'string' || schemeUrl === '') {
        return mcpError(
          'build_attach_url: scheme_url이 비어 있습니다. ' +
            '`ait deploy --scheme-only`가 출력하는 intoss-private:// URL을 인자로 전달하세요.',
        );
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
        // SECRET-HANDLING: totpSecret is passed to buildAttachUrl only; it is
        // never logged or included in output other than the at= param in attachUrl.
        const { attachUrl, relayUrl, authorityWarning, totp } = buildAttachUrl(
          schemeUrl,
          getTunnelStatus(),
          totpSecret,
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
          const headlessText = `${warningPrefix}${headlessNote}${header}\n${JSON.stringify({ attachUrl, relayUrl, ...(totp ? { totp } : {}) }, null, 2)}\n\n${qrHeadless}`;

          if (!waitForAttach) {
            return { content: [{ type: 'text' as const, text: headlessText }] };
          }

          // wait_for_attach + headless fallback
          let attachedPagesHl: ReturnType<CdpConnection['listTargets']> = [];
          try {
            attachedPagesHl = await waitForAttachWithEvents(
              conn,
              isMatchingPage,
              waitForAttachTimeoutMs,
            );
          } catch {
            attachedPagesHl = conn.listTargets();
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

          const pagesResultHl = listPages(conn, getTunnelStatus());
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
              `${JSON.stringify({ relayUrl, openResult, ...(totp ? { totp } : {}) }, null, 2)}\n\n` +
              `브라우저에서 QR을 열었습니다${retriedNote}. 폰 카메라로 스캔하세요.\n` +
              `URL: ${browserResult.httpUrl}`;

            if (!waitForAttach) {
              return { content: [{ type: 'text' as const, text: shortText }] };
            }

            // wait_for_attach path (browser opened) — event-driven via waitForAttachWithEvents.
            let attachedPages: ReturnType<CdpConnection['listTargets']> = [];
            try {
              attachedPages = await waitForAttachWithEvents(
                conn,
                isMatchingPage,
                waitForAttachTimeoutMs,
              );
            } catch {
              attachedPages = conn.listTargets();
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

            const pagesResult = listPages(conn, getTunnelStatus());
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
          const baseText = `${warningPrefix}${fallbackNote}${header}\n${JSON.stringify({ attachUrl, relayUrl, openResult, ...(totp ? { totp } : {}) }, null, 2)}\n\n${qr}`;

          if (!waitForAttach) {
            return { content: [{ type: 'text' as const, text: baseText }] };
          }

          // wait_for_attach + fallback path — event-driven via waitForAttachWithEvents.
          let attachedPagesFb: ReturnType<CdpConnection['listTargets']> = [];
          try {
            attachedPagesFb = await waitForAttachWithEvents(
              conn,
              isMatchingPage,
              waitForAttachTimeoutMs,
            );
          } catch {
            attachedPagesFb = conn.listTargets();
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

          const pagesResultFb = listPages(conn, getTunnelStatus());
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
        const baseText = `${warningPrefix}${header}\n${JSON.stringify({ attachUrl, relayUrl, ...(totp ? { totp } : {}) }, null, 2)}\n\n${qr}`;

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
            conn,
            isMatchingPage,
            waitForAttachTimeoutMs,
          );
        } catch {
          attachedPages = conn.listTargets();
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

        const pagesResult = listPages(conn, getTunnelStatus());
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
      await conn.enableDomains();
    } catch (err) {
      if (name === 'list_pages') {
        // list_pages is still useful pre-attach: report tunnel + empty pages.
        // Refresh from relay first so evicted-then-reattached targets are not
        // served as stale empty (#281 — stale cache diagnosis).
        try {
          await conn.refreshTargets?.();
        } catch {
          // Ignore refresh errors — still return cached state.
        }
        const pagesData = listPages(conn, getTunnelStatus());
        const attached = conn.listTargets().length > 0;
        return envelopeResult(pagesData, name, env, attached);
      }
      // 4상태 분류: page 미attach vs crash vs relay disconnect
      return classifyEnableDomainError(err, name);
    }

    try {
      switch (name) {
        case 'list_console_messages':
          return jsonResult(listConsoleMessages(conn));
        case 'list_exceptions': {
          const rawLimit = request.params.arguments?.limit;
          const limit = typeof rawLimit === 'number' && rawLimit > 0 ? rawLimit : 50;
          return jsonResult({ exceptions: listExceptions(conn, limit) });
        }
        case 'list_network_requests':
          return jsonResult(listNetworkRequests(conn));
        case 'list_pages': {
          // Refresh from relay so evict→reattach transitions are not served stale.
          try {
            await conn.refreshTargets?.();
          } catch {
            // Ignore refresh errors — still return cached state.
          }
          const listPagesData = listPages(conn, getTunnelStatus());
          const listPagesAttached = conn.listTargets().length > 0;
          return envelopeResult(listPagesData, name, env, listPagesAttached);
        }
        case 'get_dom_document':
          return jsonResult(await getDomDocument(conn));
        case 'take_snapshot':
          return jsonResult(await takeSnapshot(conn));
        case 'take_screenshot': {
          const shot = await takeScreenshot(conn);
          return {
            content: [{ type: 'image' as const, data: shot.data, mimeType: shot.mimeType }],
          };
        }
        case 'measure_safe_area': {
          // Pass the SNAPSHOT env to attach `source: 'mock' | 'relay'` to the
          // result (Tier C parity per RFC #277 — the same Runtime.evaluate probe
          // runs in both envs; only the provenance label differs). The label must
          // match the `conn` the probe actually ran on, so it reads the snapshot
          // `env` (entry-time, same as `conn`) — not a freshly re-derived env that
          // a concurrent swap could have moved.
          const safeAreaData = await measureSafeArea(conn, env);
          const safeAreaAttached = conn.listTargets().length > 0;
          return envelopeResult(safeAreaData, name, env, safeAreaAttached);
        }
        case 'evaluate': {
          const expression = request.params.arguments?.expression;
          if (typeof expression !== 'string' || expression === '') {
            return mcpError(
              'evaluate: expression 인자가 비어 있습니다. 평가할 JavaScript 표현식을 전달하세요.',
            );
          }
          // LIVE guard (issue #348, race fix #354). Evaluated at the side-effect
          // boundary with a SNAPSHOT `conn.kind` + a FRESH `getLiveIntent()` — not
          // the stale entry-time `env`. The side effect always runs on `conn`, so
          // the guard judges by `conn.kind`; reading `liveIntent` fresh closes the
          // false→true race where a concurrent `start_debug('relay-live')` arms
          // liveIntent while this call is parked on an `await`, after the stale
          // entry-time `env` was already computed as non-live. A stale `true`
          // bit stays inert against a local target (conn.kind !== 'relay').
          if (
            conn.kind === 'relay' &&
            getLiveIntent() &&
            request.params.arguments?.confirm !== true
          ) {
            return liveGuardError('evaluate');
          }
          // SECRET-HANDLING: do not log expression or result value.
          return jsonResult(await evaluate(conn, expression));
        }
        case 'call_sdk': {
          const sdkName = request.params.arguments?.name;
          if (typeof sdkName !== 'string' || sdkName === '') {
            return mcpError(
              'call_sdk: name 인자가 비어 있습니다. 호출할 SDK 메서드 이름을 전달하세요.',
            );
          }
          const rawArgs = request.params.arguments?.args;
          const sdkArgs: unknown[] = Array.isArray(rawArgs) ? rawArgs : [];
          // LIVE guard (issue #348, race fix #354): see `evaluate` above —
          // snapshot `conn.kind` + fresh `getLiveIntent()` so the false→true
          // race (concurrent `start_debug('relay-live')` mid-await) is rejected.
          if (
            conn.kind === 'relay' &&
            getLiveIntent() &&
            request.params.arguments?.confirm !== true
          ) {
            return liveGuardError('call_sdk');
          }
          // SECRET-HANDLING: do not log name, args, or result value.
          const sdkResult = await callSdk(conn, sdkName, sdkArgs);
          // 상태 4: SDK 부재 — ok:false + 'sdk-absent:' 패턴은 isError로 승격
          if (
            !sdkResult.ok &&
            typeof sdkResult.error === 'string' &&
            sdkResult.error.startsWith('sdk-absent:')
          ) {
            return sdkAbsentError('call_sdk');
          }
          const callSdkAttached = conn.listTargets().length > 0;
          return envelopeResult(sdkResult, name, env, callSdkAttached);
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

/**
 * Normalizes a raw `start_debug` `mode` argument to a `StartDebugMode`, or
 * `null` when the value is not one of the accepted modes.
 *
 * Accepts the 3 canonical modes + 4 deprecated aliases (back-compat for
 * pinned .mcp.json / docs / QA runbooks that still emit old strings):
 *   'local'           → 'local'   (canonical)
 *   'staging'         → 'staging' (canonical)
 *   'live'            → 'live'    (canonical)
 *   'local-browser-dev'  → 'local'   (deprecated alias)
 *   'local-browser-cdp'  → 'local'   (deprecated alias)
 *   'relay-dev'          → 'staging' (deprecated alias)
 *   'relay-live'         → 'live'    (deprecated alias)
 */
export function normalizeStartDebugMode(raw: unknown): StartDebugMode | null {
  // New canonical values.
  if (raw === 'local' || raw === 'staging' || raw === 'live') return raw;
  // Deprecated aliases (back-compat — pinned .mcp.json / docs / QA runbooks).
  if (raw === 'local-browser-dev' || raw === 'local-browser-cdp') return 'local';
  if (raw === 'relay-dev') return 'staging';
  if (raw === 'relay-live') return 'live';
  return null;
}

/**
 * Builds a trivial `ConnectionRouter` pinned to a single connection (issue
 * #348). Used by `createDebugServer` when no real dual router is injected —
 * every existing single-connection test and the `local`-only / `relay`-only
 * boot path. `switchMode` here cannot lazily boot another family, so it only
 * honors a request that matches the connection's own kind (and arms/disarms
 * `liveIntent` accordingly for relay-live); any cross-family request is
 * rejected with a clear "dynamic switch unavailable in this session" error.
 */
export function makeSingleConnectionRouter(connection: CdpConnection): ConnectionRouter {
  return {
    get active() {
      return connection;
    },
    switchMode(mode: StartDebugMode, confirm: boolean): Promise<ModeSwitchReport> {
      const wantRelay = isRelayMode(mode);
      const haveRelay = connection.kind === 'relay';
      if (wantRelay !== haveRelay) {
        return Promise.reject(
          new Error(
            `start_debug: 이 세션은 단일 ${connection.kind} 연결만 보유합니다 — ` +
              `'${mode}'로 동적 전환할 수 없습니다 (dual-connection 데몬에서만 지원). ` +
              'MCP 서버를 원하는 모드로 재시작하세요.',
          ),
        );
      }
      // live entry gate: confirm:true required (mirrors the per-tool gate).
      if (mode === 'live' && !confirm) {
        return Promise.reject(
          new Error(
            'start_debug: live(실서비스 LIVE)는 confirm: true가 필요합니다 — ' +
              '실유저에게 영향이 갈 수 있는 LIVE 디버깅 진입을 명시적으로 승인하세요.',
          ),
        );
      }
      setLiveIntent(mode === 'live');
      const environment = deriveEnvironment(connection.kind, getLiveIntent());
      return Promise.resolve({
        mode,
        environment,
        kind: connection.kind,
        liveGuardActive: connection.kind === 'relay' && getLiveIntent(),
        nextStep:
          connection.kind === 'relay'
            ? 'build_attach_url로 attach QR을 생성하세요.'
            : 'list_pages로 로컬 페이지 attach를 확인하세요.',
      });
    },
  };
}

function jsonResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

/**
 * Wraps `value` in a `ToolEnvelope` (when compat mode is off) and returns it
 * as a text content block. When `AIT_MCP_COMPAT=chrome-devtools` is set the
 * envelope is skipped and the raw value is returned — identical to `jsonResult`.
 */
function envelopeResult(value: unknown, tool: string, env: McpEnvironment, attached: boolean) {
  const wrapped = wrapEnvelope(value, { tool, env, attached });
  return { content: [{ type: 'text' as const, text: JSON.stringify(wrapped, null, 2) }] };
}

function unknownTool(name: string) {
  return mcpError(`알 수 없는 tool: ${name}`);
}

/**
 * enableDomains()가 던진 에러를 4상태로 분류해 적절한 메시지를 반환한다.
 *
 * - "No mini-app page attached" → page 미attach (상태 2)
 * - crash/destroy/replaced 패턴 → page crash (상태 3)
 * - relay disconnect 패턴 → relay 연결 끊김
 * - 그 외 → 원본 메시지 + list_pages 안내
 */
function classifyEnableDomainError(err: unknown, toolName: string) {
  const message = err instanceof Error ? err.message : String(err);

  // 상태 2: page 미attach
  if (message.includes('No mini-app page attached') || message.includes('페이지가 attach 안')) {
    return pageMissingError(toolName);
  }

  // 상태 3: page crash / target destroyed / replaced
  if (
    message.includes('replaced-by-new-attach') ||
    message.includes('targetCrashed') ||
    message.includes('targetDestroyed') ||
    message.includes('detachedFromTarget')
  ) {
    return pageCrashError(toolName);
  }

  // relay 연결 끊김
  if (
    message.includes('relay에 연결되어 있지 않습니다') ||
    message.includes('relay WebSocket') ||
    message.includes('Chii relay connection closed')
  ) {
    return relayDisconnectError(toolName);
  }

  // 그 외
  return classifyToolError(err, toolName);
}

/**
 * CDP/AIT 명령 실행 중 catch된 에러를 4상태로 분류해 tool 결과로 반환한다.
 * debug-server 내부 try/catch 블록에서 공통으로 사용한다.
 */
function errorResult(err: unknown, name: string) {
  return classifyToolError(err, name);
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

/**
 * Starts a periodic watcher that detects when the parent process (e.g. Claude
 * Code) has died without sending SIGTERM/SIGHUP, and calls `onOrphaned` so the
 * daemon can self-terminate rather than running as a zombie.
 *
 * Mirrors the `startAttachWatcher` pattern: `setInterval`-based, returns
 * `{ stop(): void }`, injectable deps for testability.
 *
 * @param onOrphaned - Called once when the parent is gone.
 * @param opts.intervalMs   - Poll interval in milliseconds (default 5 000).
 * @param opts.initialPpid  - Parent PID to watch (default `process.ppid`).
 * @param opts.isAlive      - Predicate to test if a PID is running (default `isPidAlive`).
 * @param opts.getPpid      - Supplier of current ppid (default `() => process.ppid`).
 *                            Detects ppid changes as well as death.
 * @param opts.log          - Logger (default `process.stderr.write`).
 *
 * @returns `stop` — call during shutdown to clear the interval.
 */
export function startParentWatcher(
  onOrphaned: () => void,
  opts?: {
    intervalMs?: number;
    initialPpid?: number;
    isAlive?: (pid: number) => boolean;
    getPpid?: () => number;
    log?: (msg: string) => void;
  },
): { stop(): void } {
  const {
    intervalMs = 5_000,
    initialPpid = process.ppid,
    isAlive = isPidAlive,
    getPpid = () => process.ppid,
    log = (msg: string) => process.stderr.write(msg),
  } = opts ?? {};

  // PID 1 is init/launchd — running under a process manager or as a detached
  // daemon. There is no meaningful parent to watch; skip the watcher entirely.
  if (initialPpid <= 1) {
    log('[ait-debug] parent-pid watcher: no parent to watch (ppid<=1), skipping\n');
    return { stop() {} };
  }

  let fired = false;

  const handle = setInterval(() => {
    if (fired) return;

    const currentPpid = getPpid();
    const orphaned = currentPpid !== initialPpid || !isAlive(initialPpid);

    if (orphaned) {
      fired = true;
      clearInterval(handle);
      log(
        `[ait-debug] parent-pid watcher: parent PID ${initialPpid} is gone (currentPpid=${currentPpid}) — shutting down\n`,
      );
      onOrphaned();
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
  /**
   * When `true`, terminates the process holding the existing server lock and
   * takes over the session. Corresponds to `--force` / `--takeover` CLI flags.
   *
   * Default `false`.
   */
  force?: boolean;
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
 * Factory that constructs a `ChiiCdpConnection` for the given relay base URL.
 *
 * Introduced as a named seam so PR-2 (dual-connection, #348) can defer
 * construction to first-activation time by moving or replacing this call —
 * without changing the current eager construction order at startup.
 *
 * The relay base URL is only available after `startChiiRelay()` resolves, so
 * the factory is called right after that point (same as before this refactor).
 */
function createRelayConnection(relayBaseUrl: string): ChiiCdpConnection {
  return new ChiiCdpConnection({ relayBaseUrl });
}

/**
 * AIT source that always forwards over the *currently active* connection
 * (issue #348). The single-connection `ChiiAitSource` binds one sender at
 * construction; in the dual-connection daemon the AIT.* domain must follow the
 * active connection across `start_debug` swaps, so this indirection reads
 * `getActive()` on every call.
 *
 * Both `ChiiCdpConnection` and `LocalCdpConnection` expose `sendCommand`, so
 * the active connection is a valid `AitCommandSender`.
 */
class RoutingAitSource extends ChiiAitSource {
  constructor(
    getActive: () => {
      sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
    },
  ) {
    super({
      sendCommand: (method, params) => getActive().sendCommand(method, params),
    });
  }
}

/**
 * A booted infra family the dual router can tear down at process exit.
 *
 * Direction-neutral (issue #356): either family can be the eager (startup) one
 * or the lazy (first cross-family switch) one. The relay family additionally
 * exposes its live tunnel status; the local family leaves it `undefined`
 * (a local browser has no relay tunnel), so the router/handlers read the relay
 * tunnel status from whichever family is the relay one.
 */
export interface BootedFamily {
  connection: CdpConnection;
  /** Synchronous best-effort teardown (closes the connection + any infra). */
  stop(): void;
  /**
   * Live tunnel status — only the relay family provides it (the URL changes per
   * tunnel reissue). `undefined` on the local family.
   */
  getTunnelStatus?: () => TunnelStatus;
}

/**
 * Boots the local-browser family (issues #348, #356). Launches a Chromium with
 * `--remote-debugging-port` and returns a `LocalCdpConnection` attached to it,
 * plus a `stop()` that kills both.
 *
 * Used two ways:
 *   - `runDebugServer` (relay-eager): the dual router's lazy callback, booted at
 *     most once on the first `start_debug({ mode: 'local-*' })`.
 *   - `runLocalDebugServer` (local-eager, #356): the eager family booted at
 *     startup.
 */
export async function bootLocalFamily(): Promise<BootedFamily> {
  const cdpPort = 0; // OS-assigned ephemeral port.
  const devUrl = process.env.AIT_DEVTOOLS_URL ?? 'http://localhost:5173';
  const chromium = await launchChromium({ port: cdpPort, devUrl });
  // Give Chromium a moment to open its CDP endpoint before first attach.
  await new Promise<void>((r) => setTimeout(r, 800));
  const connection = new LocalCdpConnection({ devtoolsHttpUrl: chromium.devtoolsUrl });
  return {
    connection,
    stop() {
      connection.close();
      chromium.stop();
    },
  };
}

/** Options for {@link bootRelayFamily}. */
export interface BootRelayFamilyOptions {
  /** Relay local port. Default 0 (OS-assigned ephemeral). */
  relayPort?: number;
  /**
   * TOTP `verifyAuth` predicate for the relay WS upgrade gate. Built from
   * `AIT_DEBUG_TOTP_SECRET` at the call site via {@link buildRelayVerifyAuth}.
   * `undefined` disables the gate.
   */
  verifyAuth?: (req: import('node:http').IncomingMessage) => boolean;
  /**
   * Called whenever the public tunnel URL is (re)assigned, so the caller can
   * mirror it into the server lock file (`lockHandle.updateWssUrl`). The wssUrl
   * carries the relay host — callers MUST NOT log it directly.
   */
  onWssUrl?: (wssUrl: string) => void;
}

/**
 * Boots the relay family (issues #348, #356): starts the Chii relay on an
 * OS-assigned port (with optional TOTP gate), opens a cloudflared quick tunnel
 * to the relay's confirmed port in the background, prints the attach banner,
 * and arms the tunnel health probe. Returns a {@link BootedFamily} whose
 * `getTunnelStatus()` reflects the live tunnel (it flips up once the background
 * tunnel resolves and follows reissues).
 *
 * Used two ways (symmetry with {@link bootLocalFamily}):
 *   - `runDebugServer` (relay-eager): booted at startup.
 *   - `runLocalDebugServer` (local-eager, #356): the dual router's lazy
 *     callback, booted at most once on the first `start_debug({ mode: 'relay-*' })`.
 *
 * The relay base URL is only known after `startChiiRelay()` resolves, so the
 * `ChiiCdpConnection` (via {@link createRelayConnection}) is constructed inside
 * this function, after the relay port is confirmed.
 *
 * SECRET-HANDLING: the TOTP secret rides only inside `verifyAuth`; the wssUrl
 * (relay host) is never logged here directly.
 */
export async function bootRelayFamily(options: BootRelayFamilyOptions = {}): Promise<BootedFamily> {
  // Default 0: OS picks a free port. Prevents EADDRINUSE from stale cloudflared
  // orphans (SIGKILL survivors) that would otherwise block a fixed port and
  // cause -32000 MCP handshake failures on reconnect.
  const relayPort = options.relayPort ?? 0;
  const totpEnabled = options.verifyAuth !== undefined;

  const relay = await startChiiRelay({ port: relayPort, verifyAuth: options.verifyAuth });
  // relay.port is the actual OS-assigned port (may differ from relayPort when 0).
  logInfo('server.start', { port: relay.port, totpEnabled });

  let tunnel: QuickTunnel | null = null;
  let tunnelStatus: TunnelStatus = makeTunnelStatus(false, null);
  let tunnelProbe: { stop(): void } | null = null;
  // generateAttachToken is kept for legacy/non-TOTP token use, but we no longer
  // print it in the banner to avoid accidental secret exposure.
  const _token = generateAttachToken();

  // Bring the cloudflared tunnel up in the background so the MCP stdio transport
  // can answer `initialize` immediately. cloudflared has to lazy-download a
  // ~38 MB binary on first run; awaiting it here pushes the initialize response
  // past Claude Code's MCP connection timeout. Tools that need the tunnel
  // (`build_attach_url`) already gate on `getTunnelStatus()` and return a clear
  // "tunnel not up" message when it isn't ready yet, so dropping the await is
  // safe — the agent retries once the banner prints.
  const tunnelReady = startQuickTunnel(relay.port).then(
    (t) => {
      tunnel = t;
      tunnelStatus = makeTunnelStatus(true, t.wssUrl);
      options.onWssUrl?.(t.wssUrl);
      // SECRET-HANDLING: wssUrl contains the relay host — do not log it directly.
      logInfo('tunnel.up', { totpEnabled });

      // Start the health probe now that the tunnel URL is known.
      // The probe runs every 60 s and attempts up to 3 reissues on drop.
      tunnelProbe = startTunnelHealthProbe(t, relay.port, {
        onReissue: (newTunnel) => {
          tunnel = newTunnel;
          tunnelStatus = makeTunnelStatus(true, newTunnel.wssUrl, null, 0);
          options.onWssUrl?.(newTunnel.wssUrl);
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

  const connection = createRelayConnection(relay.baseUrl);

  return {
    connection,
    getTunnelStatus: () => tunnelStatus,
    stop() {
      tunnelProbe?.stop();
      // tunnel.stop() is synchronous (child process kill) — safe from exit handler.
      tunnel?.stop();
      connection.close();
      // relay.close() is async — fine for signal/exit handlers.
      void relay.close();
    },
  };
}

/**
 * Options the dual router needs to re-arm the attach watcher and auto-open
 * DevTools after a swap (issues #348, #356).
 *
 * Direction-neutral (#356): `eager` is whichever family was booted at startup
 * (relay in `runDebugServer`, local in `runLocalDebugServer`), and `bootLazy`
 * boots the opposite-kind family on the first cross-family switch. The router
 * never assumes which kind is eager.
 */
export interface DualRouterDeps {
  /** Eagerly-booted family (the connection active at startup). */
  eager: BootedFamily;
  /**
   * Lazy boot for the opposite-kind family — called at most once, on the first
   * `start_debug` to a mode whose kind differs from `eager`'s.
   */
  bootLazy: () => Promise<BootedFamily>;
  /** Diagnostics collector (re-armed watcher records attach there). */
  diagnosticsCollector: DiagnosticsCollector;
  /** Auto-opens Chrome DevTools on the first relay attach (env 3/4 only). */
  devtoolsOpener: AutoDevtoolsOpener;
  /** Attach-watcher poll interval (ms). Default 1 000. */
  attachWatcherIntervalMs?: number;
}

/**
 * Production `ConnectionRouter` (issues #348, #356 — DUAL-CONNECTION-COEXIST).
 *
 * Holds two families — one booted eagerly at startup, the other lazily on the
 * first cross-family switch — an `active` pointer, and the single attach watcher
 * armed on the active connection. The router is **direction-neutral** (#356):
 * either family kind can be the eager one, so a `--target=local` session can
 * hot-switch into relay (and vice versa) without restarting the MCP server.
 *
 * `switchMode`:
 *   1. rejects re-entrant swaps (`swapInFlight`) and an unconfirmed `live`;
 *   2. routes by the requested mode's family kind: same kind as `eager` → reuse
 *      eager; different kind → lazily boot (once) and keep warm;
 *   3. flips `active` (the MCP `Server` never re-handshakes — it reads through
 *      `active` per request);
 *   4. sets `liveIntent` (true only for `live`);
 *   5. stops the old attach watcher and re-arms one on the new connection
 *      (the watcher self-clears, so re-arm is mandatory);
 *   6. emits `tools/list_changed`.
 *
 * Inactive infra is left WARM — teardown happens only at process exit (the
 * unified shutdown in the run functions), which is what keeps a phone attach
 * alive across a local→relay→local round trip.
 */
export class DualConnectionRouter implements ConnectionRouter {
  private readonly deps: DualRouterDeps;
  /** The opposite-kind family, booted lazily on the first cross-family switch. */
  private lazyFamily: BootedFamily | null = null;
  private activeFamily: BootedFamily;
  private server: Server | null = null;
  private attachWatcher: { stop(): void } | null = null;
  private swapInFlight = false;

  constructor(deps: DualRouterDeps) {
    this.deps = deps;
    // The eager family is active until the first cross-family `start_debug`.
    this.activeFamily = deps.eager;
  }

  get active(): CdpConnection {
    return this.activeFamily.connection;
  }

  /** Every booted family (for unified shutdown). */
  bootedFamilies(): BootedFamily[] {
    return this.lazyFamily ? [this.deps.eager, this.lazyFamily] : [this.deps.eager];
  }

  /**
   * Live tunnel status of the relay family, regardless of whether relay is the
   * eager or lazy family (#356). Returns "down" until the relay family has been
   * booted (local-eager sessions before the first relay switch) — which is the
   * correct signal for `build_attach_url` (no tunnel exists yet).
   */
  relayTunnelStatus(): TunnelStatus {
    for (const family of this.bootedFamilies()) {
      if (family.getTunnelStatus) return family.getTunnelStatus();
    }
    return { up: false, wssUrl: null };
  }

  /**
   * Binds the MCP `Server` and arms the initial attach watcher on the active
   * connection. Called once after `createDebugServer` + `connect`.
   */
  start(server: Server): void {
    this.server = server;
    this.armWatcher();
  }

  /** Stops the current attach watcher (for shutdown). */
  stopWatcher(): void {
    this.attachWatcher?.stop();
    this.attachWatcher = null;
  }

  /** Arms a fresh attach watcher on the current active connection. */
  private armWatcher(): void {
    const server = this.server;
    if (!server) return;
    this.attachWatcher = startAttachWatcher(
      this.activeFamily.connection,
      server,
      this.deps.attachWatcherIntervalMs ?? 1_000,
      () => {
        this.deps.diagnosticsCollector.recordAttach();
        // Auto-open Chrome DevTools only for a relay attach (env 3/4). The
        // opener no-ops for a local (mock) connection — guard on the active
        // kind so a local-eager session never tries to open a relay devtools.
        if (this.activeFamily.connection.kind === 'relay') {
          this.deps.devtoolsOpener.open(
            this.relayTunnelStatus().wssUrl,
            deriveEnvironment(this.activeFamily.connection.kind, getLiveIntent()),
          );
        }
      },
    );
  }

  async switchMode(mode: StartDebugMode, confirm: boolean): Promise<ModeSwitchReport> {
    if (this.swapInFlight) {
      throw new Error('start_debug: 이전 전환이 아직 진행 중입니다 — 잠시 후 다시 호출하세요.');
    }
    if (mode === 'live' && !confirm) {
      throw new Error(
        'start_debug: live(실서비스 LIVE)는 confirm: true가 필요합니다 — ' +
          '실유저에게 영향이 갈 수 있는 LIVE 디버깅 진입을 명시적으로 승인하세요.',
      );
    }

    this.swapInFlight = true;
    try {
      const wantRelay = isRelayMode(mode);
      const wantKind: 'relay' | 'local' = wantRelay ? 'relay' : 'local';
      let target: BootedFamily;
      if (wantKind === this.deps.eager.connection.kind) {
        // Same kind as the eager family — reuse it (no boot).
        target = this.deps.eager;
      } else {
        // Cross-family: lazy-boot the opposite kind on first use, keep it warm.
        if (this.lazyFamily === null) {
          this.lazyFamily = await this.deps.bootLazy();
        }
        target = this.lazyFamily;
      }

      // (3) Flip the active pointer. The MCP Server reads through `active` per
      // request, so no re-handshake / restart is needed.
      this.activeFamily = target;

      // (4) Arm/disarm liveIntent. true only for live; any other mode
      // (including a local mode) disarms it.
      setLiveIntent(mode === 'live');

      // (5) Re-arm the attach watcher on the new connection (self-clearing).
      this.stopWatcher();
      this.armWatcher();

      // (6) Tell the MCP host the tool surface may have changed (env flip).
      void this.server?.sendToolListChanged();

      const environment = deriveEnvironment(target.connection.kind, getLiveIntent());
      return {
        mode,
        environment,
        kind: target.connection.kind,
        liveGuardActive: target.connection.kind === 'relay' && getLiveIntent(),
        nextStep: wantRelay
          ? 'build_attach_url로 attach QR을 생성하세요 (relay 세션).'
          : 'list_pages로 로컬 Chromium 페이지 attach를 확인하세요.',
      };
    } finally {
      this.swapInFlight = false;
    }
  }
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
  // `force: true` kills the existing process and takes over the lock.
  const lockHandle = acquireLock({ force: options.force ?? false });

  // Build the TOTP verifyAuth predicate from env at startup (runtime read).
  const verifyAuth = buildRelayVerifyAuth();

  // Boot the relay family eagerly (relay + cloudflared tunnel + health probe +
  // attach banner, all encapsulated). The tunnel comes up in the background so
  // the MCP stdio transport answers `initialize` immediately.
  const relayFamily = await bootRelayFamily({
    relayPort: options.relayPort,
    verifyAuth,
    // Mirror the assigned tunnel URL into the lock file so a second caller can
    // see the correct wssUrl in the conflict error message.
    onWssUrl: (wssUrl) => lockHandle.updateWssUrl(wssUrl),
  });

  // Dual-connection router (issues #348, #356): relay family booted eagerly
  // above, local family lazy-booted on the first `start_debug({ mode: 'local-*' })`.
  const devtoolsOpener = new AutoDevtoolsOpener();
  // Diagnostics collector — records server-side errors and attach/detach events
  // so `get_diagnostics` can surface them in a single call.
  const diagnosticsCollector = new InMemoryDiagnosticsCollector();

  const router = new DualConnectionRouter({
    eager: relayFamily,
    bootLazy: bootLocalFamily,
    diagnosticsCollector,
    devtoolsOpener,
  });

  // AIT.* methods ride the *active* connection's command channel (relay Chii or
  // local CDP), so the AIT source follows `start_debug` swaps.
  const aitSource = new RoutingAitSource(() => {
    const active = router.active as CdpConnection & {
      sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
    };
    return active;
  });

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

  const server = createDebugServer({
    // `connection` is still required by the deps shape; the router overrides
    // which connection the handlers actually read (relay is the initial active).
    connection: router.active,
    router,
    aitSource,
    // Tunnel status follows the relay family regardless of eager/lazy (#356).
    getTunnelStatus: () => router.relayTunnelStatus(),
    get qrHttpServer() {
      return qrServer;
    },
    diagnosticsCollector,
    // SECRET-HANDLING: totpSecret is read from env once at startup and passed
    // through to buildAttachUrl where it is used only to generate the at= code.
    // It is never logged or surfaced in any output.
    ...(process.env.AIT_DEBUG_TOTP_SECRET ? { totpSecret: process.env.AIT_DEBUG_TOTP_SECRET } : {}),
  });

  const transport = new StdioServerTransport();

  // ---------------------------------------------------------------------------
  // Unified dual-family shutdown (issues #348, #356): tears down BOTH families
  // (relay + tunnel + health probe + every booted connection, plus a lazily-
  // booted local Chromium) at process exit. Each family's `stop()` owns its own
  // infra teardown — the relay family stops its tunnel + probe, the local family
  // kills its Chromium. Inactive infra is left warm during the session and only
  // collected here — that is what preserves a warm attach across `start_debug`
  // swaps.
  //
  // SIGKILL cannot be intercepted — cloudflared may remain orphaned (PPID 1).
  // Port 0 makes such orphans harmless: the next startup gets a fresh port.
  // Manual cleanup if needed: `pkill -f 'cloudflared.*trycloudflare'`
  // ---------------------------------------------------------------------------

  let closed = false;
  let parentWatcher: { stop(): void } | null = null;

  const shutdown = () => {
    // Idempotent: multiple simultaneous signals/exit/uncaught calls run only once.
    if (closed) return;
    closed = true;

    parentWatcher?.stop();
    router.stopWatcher();
    // Tear down every booted family (eager always; the lazy one if ever booted).
    // family.stop() is synchronous for the infra (tunnel/Chromium kill) — safe
    // from exit handlers; the relay's relay.close() inside is async fire-and-forget.
    for (const family of router.bootedFamilies()) family.stop();
    // server.close(), qrServer.close() are async — fine for signal handlers.
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
  // by Node at this stage — only family.stop() infra kills which are sync).
  process.on('exit', () => {
    if (!closed) {
      closed = true;
      parentWatcher?.stop();
      router.stopWatcher();
      for (const family of router.bootedFamilies()) family.stop();
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

  // Bind the server to the router and arm the initial attach watcher on the
  // eager (relay) connection. The router re-arms the watcher on every swap.
  router.start(server);

  // Self-terminate when the parent process (Claude Code or another AI host) has
  // died without sending SIGTERM/SIGHUP. Without this watcher the daemon runs
  // as a zombie, holding a stale cloudflared tunnel that silently blocks new
  // attach attempts.
  //
  // AIT_DEBUG_NO_PARENT_WATCH=1 disables the watcher — useful for:
  //   - shells / process managers that legitimately re-parent the daemon
  //   - manual standalone invocations where ppid churn is expected
  if (process.env.AIT_DEBUG_NO_PARENT_WATCH !== '1') {
    parentWatcher = startParentWatcher(
      () => {
        shutdown();
        process.exit(0);
      },
      { intervalMs: 5_000 },
    );
    // Also exit when stdin closes — the MCP host closed the pipe.
    process.stdin.once('end', () => {
      shutdown();
      process.exit(0);
    });
    process.stdin.once('close', () => {
      shutdown();
      process.exit(0);
    });
  }
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
  /**
   * When `true`, terminates the process holding the existing server lock and
   * takes over the session. Corresponds to `--force` / `--takeover` CLI flags.
   *
   * Default `false`.
   */
  force?: boolean;
}

/**
 * Boots the local-browser debug stack and serves it over stdio:
 *   1. launch a local Chromium with `--remote-debugging-port=<port>`,
 *   2. attach a `LocalCdpConnection` to the first non-blank page target,
 *   3. expose the debug tools through the SAME direction-neutral
 *      `DualConnectionRouter` that `runDebugServer` uses (issue #356) — the
 *      local family is eager, the relay family is lazy-booted on the first
 *      `start_debug({ mode: 'relay-*' })`.
 *
 * Symmetry with `runDebugServer` (#356): starting with `--target=local` no
 * longer pins a single-connection router. A `--target=local` session can
 * hot-switch into relay (env 1 → env 3) without restarting the MCP server,
 * closing the asymmetry where only the default (relay-target) entry point had
 * bidirectional hot-switch. The intended fidelity-ladder flow — "validate in
 * env 1 (local), then env 3 (intoss-private) in ONE session, no restart" — now
 * works from either entry point.
 *
 * `build_attach_url` (relay-specific) stays effectively hidden / non-applicable
 * until the relay family is booted: before the first relay switch the env
 * derives to `mock` and `relayTunnelStatus()` reports "down", so the tool fails
 * with a clear "tunnel not up" message. After a relay switch the relay tunnel
 * is live and the tool works.
 *
 * The AIT.* tools (`AIT.getSdkCallHistory`, `AIT.getMockState`,
 * `AIT.getOperationalEnvironment`) ride the *active* connection's CDP channel
 * via `RoutingAitSource`, so they follow `start_debug` swaps.
 */
export async function runLocalDebugServer(options: RunLocalDebugServerOptions = {}): Promise<void> {
  // Enforce a single debug session per machine (same lock as relay mode).
  // `force: true` kills the existing process and takes over the lock.
  const lockHandle = acquireLock({ force: options.force ?? false });

  const cdpPort = options.cdpPort ?? 0;
  const devUrl = options.devUrl ?? process.env.AIT_DEVTOOLS_URL ?? 'http://localhost:5173';

  const chromium = await launchChromium({ port: cdpPort, devUrl });

  // Give Chromium a moment to start the CDP endpoint before we connect.
  // 800 ms is enough on most machines; the connection retries if it fails.
  await new Promise<void>((r) => setTimeout(r, 800));

  const localConnection = new LocalCdpConnection({ devtoolsHttpUrl: chromium.devtoolsUrl });

  // Eager local family (#356) — the active connection at startup. Its stop()
  // closes the CDP connection and kills the launched Chromium.
  const localFamily: BootedFamily = {
    connection: localConnection,
    stop() {
      localConnection.close();
      chromium.stop();
    },
  };

  // Build the TOTP verifyAuth predicate from env at startup (runtime read) so a
  // lazily-booted relay family carries the same gate as `runDebugServer`.
  const verifyAuth = buildRelayVerifyAuth();

  // Dual-connection router (issues #348, #356): local family eager above, relay
  // family lazy-booted on the first `start_debug({ mode: 'relay-*' })`.
  const devtoolsOpener = new AutoDevtoolsOpener();
  const diagnosticsCollector = new InMemoryDiagnosticsCollector();

  const router = new DualConnectionRouter({
    eager: localFamily,
    bootLazy: () =>
      bootRelayFamily({
        verifyAuth,
        onWssUrl: (wssUrl) => lockHandle.updateWssUrl(wssUrl),
      }),
    diagnosticsCollector,
    devtoolsOpener,
  });

  // AIT.* methods ride the *active* connection's command channel (local CDP or,
  // after a relay switch, relay Chii), so the AIT source follows swaps.
  const aitSource = new RoutingAitSource(() => {
    const active = router.active as CdpConnection & {
      sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
    };
    return active;
  });

  // Local QR HTTP server — awaited so the first build_attach_url call (after a
  // relay switch) doesn't race its startup. Failure falls back to text QR.
  let qrServer: QrHttpServer | undefined;
  try {
    qrServer = await startQrHttpServer();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logWarn('server.start', { msg: `QR HTTP 서버 시작 실패 (text QR fallback 사용): ${message}` });
  }

  const server = createDebugServer({
    connection: router.active,
    router,
    aitSource,
    // Tunnel status follows the relay family once it is lazy-booted (#356);
    // until then it reports "down" (no relay tunnel exists), which keeps
    // build_attach_url correctly gated.
    getTunnelStatus: () => router.relayTunnelStatus(),
    get qrHttpServer() {
      return qrServer;
    },
    diagnosticsCollector,
    // SECRET-HANDLING: totpSecret is read from env once at startup and passed
    // through to buildAttachUrl where it is used only to generate the at= code.
    // It is never logged or surfaced in any output.
    ...(process.env.AIT_DEBUG_TOTP_SECRET ? { totpSecret: process.env.AIT_DEBUG_TOTP_SECRET } : {}),
  });

  const transport = new StdioServerTransport();

  // ---------------------------------------------------------------------------
  // Unified dual-family shutdown (issue #356, mirrors runDebugServer): tears
  // down BOTH families at process exit. Each family's stop() owns its infra —
  // the local family kills its Chromium, a lazily-booted relay family stops its
  // tunnel + probe + relay. Inactive infra is left warm during the session.
  // ---------------------------------------------------------------------------

  let closed = false;
  let parentWatcher: { stop(): void } | null = null;

  const shutdown = () => {
    if (closed) return;
    closed = true;
    parentWatcher?.stop();
    router.stopWatcher();
    // Tear down every booted family (local always; relay if ever booted).
    for (const family of router.bootedFamilies()) family.stop();
    void server.close();
    void qrServer?.close();
    // Remove the lock file so the next startup can proceed immediately.
    lockHandle.release();
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.once('SIGHUP', shutdown);

  process.on('exit', () => {
    if (!closed) {
      closed = true;
      parentWatcher?.stop();
      router.stopWatcher();
      for (const family of router.bootedFamilies()) family.stop();
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

  // Bind the server to the router and arm the initial attach watcher on the
  // eager (local) connection. The router re-arms the watcher on every swap.
  router.start(server);

  // Self-terminate when the parent process has died without sending SIGTERM/SIGHUP.
  if (process.env.AIT_DEBUG_NO_PARENT_WATCH !== '1') {
    parentWatcher = startParentWatcher(
      () => {
        shutdown();
        process.exit(0);
      },
      { intervalMs: 5_000 },
    );
    process.stdin.once('end', () => {
      shutdown();
      process.exit(0);
    });
    process.stdin.once('close', () => {
      shutdown();
      process.exit(0);
    });
  }
}
