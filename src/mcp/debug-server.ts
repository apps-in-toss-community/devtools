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
 * tools (`start_attach`, `list_pages`) are listed. Once a target appears,
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
import { isDebugAllowedHost } from '../in-app/gate.js';
import { startMaxAgeWatchdog, startParentWatcher } from '../shared/parent-watcher.js';
// Test-runner core (#646): run_tests reuses the same orchestration the
// `devtools-test` CLI uses. These imports are react-free (node:* + esbuild),
// so they do not break the MCP-daemon react-free invariant.
import { runWithConnection } from '../test-runner/cli.js';
import { discoverTestFiles } from '../test-runner/discover.js';
import type { RelayRunReport } from '../test-runner/relay-worker.js';
import { ChiiAitSource } from './ait-chii-source.js';
import type { AitSource } from './ait-source.js';
import type { CdpConnection } from './cdp-connection.js';
import { ChiiCdpConnection } from './chii-connection.js';
import { startChiiRelay } from './chii-relay.js';
import {
  buildDeepLinkAttachUrl,
  buildLauncherAttachUrl,
  validateSchemeAuthority,
} from './deeplink.js';
import { AutoDevtoolsOpener, buildChiiInspectorUrl } from './devtools-opener.js';
import { wrapEnvelope } from './envelope.js';
import {
  deriveEnvironment,
  isRelayEnv,
  type McpEnvironment,
  type RelayOrigin,
} from './environment.js';
import {
  classifyToolError,
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
import {
  type DashboardState,
  type QrHttpServer,
  type QrHttpServerOptions,
  startQrHttpServer,
} from './qr-http-server.js';
import { loadRelaySecretReadOnly } from './relay-secret-store.js';
import { acquireLock, readServerLock } from './server-lock.js';
import {
  BOOTSTRAP_TOOL_NAMES,
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
import {
  assertRelayAuthConfigured,
  buildRelayVerifyAuth,
  generateTotp,
  RELAY_VERIFY_SKEW_STEPS,
} from './totp.js';

export { startMaxAgeWatchdog, startParentWatcher } from '../shared/parent-watcher.js';

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
 * Maximum age (ms) of a page's `lastSeenAt` before it is treated as a ghost
 * and excluded from the `wait_for_attach` short-circuit in `start_attach`
 * (issue #610).
 *
 * Rationale: the env-2 relay is owned by the dev server (unplugin), so every
 * `dev:phone:cdp` restart produces a new quick-tunnel. The old relay goes
 * offline immediately, but the daemon's warm `ChiiCdpConnection` still lists
 * the last-seen target — its `lastSeenAt` freezes at the moment the old relay
 * died. A 5-minute threshold is large enough to be invisible in normal usage
 * (active CDP sessions see a message every few seconds) while being small
 * enough to catch a relay that went down before the daemon was re-entered.
 *
 * Injectable for tests via {@link DebugServerDeps.stalePageThresholdMs}.
 */
export const RELAY_SANDBOX_STALE_PAGE_MS = 5 * 60 * 1_000; // 5 minutes

/**
 * Segment length (ms) of the `start_attach` wait loop (issue #626 — TOTP in-call
 * re-mint). The single-shot `wait_for_attach` of the old attach tool could
 * not re-mint a TOTP code mid-wait; `start_attach` decomposes the wait into
 * SEGMENT_MS slices so it can detect an aging code between slices and re-mint a
 * fresh one without the agent re-calling the tool. 30 s = one TOTP step.
 */
export const START_ATTACH_SEGMENT_MS = 30_000;

/**
 * Elapsed-since-mint threshold (ms) at which `start_attach` re-mints a fresh
 * TOTP code during its wait loop (issue #626). The relay gate accepts a code for
 * `RELAY_VERIFY_SKEW_STEPS` (6) × 30 s = 180 s backwards from issuance; we re-mint
 * at 150 s to leave a 30 s margin so a phone scan never lands on an expired code.
 */
export const START_ATTACH_REMINT_THRESHOLD_MS = 150_000;

/**
 * Predicate used by `start_attach`'s `wait_for_attach` loop to decide
 * whether the relay-sandbox connection has a genuinely fresh page attached.
 *
 * Stale-ghost gating (issue #610): when the dev server restarts with a new
 * quick-tunnel, the warm `ChiiCdpConnection` still lists the last-seen target
 * but its `lastSeenAt` is frozen. A page whose `lastSeenAt` exceeds
 * `stalePageThresholdMs` is a ghost from the dead relay — it must NOT
 * short-circuit `wait_for_attach`.
 *
 * Rules:
 * - `pages.length === 0` → false (nothing attached).
 * - Connection has no `getLastSeenAt` (test fakes, local-browser) → falls back
 *   to `pages.length > 0` (regression-safe).
 * - `seenMs === null` → treat as fresh (no CDP message received yet, first
 *   message pending — the connection is alive).
 * - Otherwise: at least one page must satisfy `nowMs - seenMs <=
 *   stalePageThresholdMs`.
 *
 * Exported for unit testing.
 */
export function isSandboxPageFresh(
  pages: ReadonlyArray<{ id: string }>,
  getLastSeenAt: ((id: string) => number | null) | null,
  nowMs: number,
  stalePageThresholdMs: number,
): boolean {
  if (pages.length === 0) return false;
  if (getLastSeenAt === null) return true;
  return pages.some((p) => {
    const seenMs = getLastSeenAt(p.id);
    // null = no CDP message yet (fresh attach, first message pending) → fresh.
    if (seenMs === null) return true;
    return nowMs - seenMs <= stalePageThresholdMs;
  });
}

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
  /** Human-readable next-step hint for the agent. */
  nextStep: string;
}

/**
 * The three canonical `start_debug` modes (issues #382, #378, #398, #665 — each
 * names the environment fidelity ladder rung it attaches to):
 *
 *   - `local-browser`  → env 1: desktop Chromium with the MOCK SDK + local CDP
 *                 attach. Side-effect tools (call_sdk/evaluate) run unguarded
 *                 against the mock; nothing touches a real device or real users.
 *                 No prerequisites — the default, always-available environment.
 *
 *   - `relay-sandbox` → env 2: real-device PWA (real WebKit engine + mock SDK)
 *                 over an EXTERNAL CDP relay that the unplugin (`tunnel: { cdp:
 *                 true }`) already brought up. Output env `relay-mobile`.
 *                 Prerequisite: `AIT_RELAY_BASE_URL` set to the unplugin's relay
 *                 base URL. The MCP only attaches a CDP client; it does NOT start
 *                 (or stop) that relay.
 *
 *   - `relay-staging` → env 3: real-device Toss WebView dog-food build with the
 *                 REAL SDK over the intoss-private relay.
 *                 Prerequisite: deployed dog-food bundle + device cold-loaded via
 *                 intoss-private deep-link/QR relay injection.
 *
 * `relay-live` (env 4) has been removed (#665) — the debug surface is now gated
 * by a positive allowlist (localhost/trycloudflare/private-apps). Hosts on
 * `apps.tossmini.com` are blocked at the in-app entry and MCP layer.
 *
 * Normalization is handled by `normalizeStartDebugMode`.
 */
export type StartDebugMode = 'local-browser' | 'relay-sandbox' | 'relay-staging';

/**
 * Returns `true` when the mode routes to a relay connection (`relay-sandbox` or
 * `relay-staging`). Both surface the Tier B / relay-only tool set.
 */
export function isRelayMode(mode: StartDebugMode): boolean {
  return mode === 'relay-sandbox' || mode === 'relay-staging';
}

/**
 * Maps a `StartDebugMode` to the `McpEnvironment` it routes to (issue #626).
 * Used by `start_attach`'s mode prologue to decide whether a `switchMode` is
 * needed: when the active env already equals `envForMode(mode)`, the switch is
 * skipped (no `tools/list_changed` churn).
 *
 *   - `local-browser`  → `mock`
 *   - `relay-sandbox`  → `relay-mobile` (env 2 external-PWA relay)
 *   - `relay-staging`  → `relay-dev`    (env 3 intoss-private relay)
 */
export function envForMode(mode: StartDebugMode): McpEnvironment {
  switch (mode) {
    case 'local-browser':
      return 'mock';
    case 'relay-sandbox':
      return 'relay-mobile';
    case 'relay-staging':
      return 'relay-dev';
  }
}

/**
 * Attach URL components — stored in the run functions instead of a finished
 * URL string so that `getDashboardState` can RE-MINT a fresh TOTP code on
 * every call (Defect 1: baked codes expire → relay 401 reason:'auth').
 *
 * `kind: 'launcher'` = env 2 (launcher PWA QR, `buildLauncherAttachUrl`).
 * `kind: 'scheme'`   = env 3/4 (intoss-private deep-link, `buildDeepLinkAttachUrl`).
 *
 * SECRET-HANDLING: these components contain tunnel/scheme hosts. They are
 * NEVER logged. The TOTP code is minted fresh at call time via `rebuildAttachUrl`
 * and rides inside the assembled URL's `at=` param only.
 */
export type AttachUrlParts =
  | {
      kind: 'launcher';
      tunnelHttpUrl: string;
      wssUrl: string;
      appName?: string;
      selfdebug?: boolean;
    }
  | { kind: 'scheme'; schemeUrl: string; wssUrl: string };

/** TOTP metadata surfaced in an attach tool result (code value never included). */
interface AttachTotpMeta {
  enabled: true;
  ttlSeconds: number;
  expiresAt: string;
}

/**
 * Output of the `prepareAttach` helper (issue #626) — the shared validation +
 * component bundle that the env-2 (relay-mobile) and env-3 (relay-dev) attach
 * paths both produce. On any validation failure the helper returns
 * `{ ok: false, error }` with a ready-to-return `McpResult`.
 */
type PrepareAttachResult =
  | {
      ok: true;
      parts: AttachUrlParts;
      isMatchingPage: (pages: ReturnType<CdpConnection['listTargets']>) => boolean;
      buildTimeoutError: (
        baseText: string,
        timeoutSec: number,
        observed: ReturnType<CdpConnection['listTargets']>,
      ) => string;
      authorityWarning: string | undefined;
      totpMeta: AttachTotpMeta | undefined;
    }
  | { ok: false; error: McpResult };

/** The tool-result shape returned by every CallTool handler branch. */
type McpResult = {
  content: Array<
    { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
  >;
  isError?: boolean;
};

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
   * Relay origin of the currently-active family (issue #378) — the
   * discriminator that distinguishes the env-2 external-PWA relay
   * (`'external-pwa'` → `relay-mobile`) from the intoss-private relay
   * (`'intoss-webview'` → `relay-dev`). `undefined` for a local (mock) active
   * connection, or for a single-connection router that has no family concept.
   * Threaded into `deriveEnvironment` so the output env can tell the two
   * `kind: 'relay'` families apart.
   */
  readonly activeRelayOrigin?: RelayOrigin;
  /**
   * Switches the active connection to the family for `mode`, lazily booting
   * that family's infra if needed, re-arming the attach watcher, and emitting
   * `tools/list_changed`.
   *
   * `projectRoot` (issue #396) is the per-debug-session mini-app project root
   * supplied by `start_debug`. When switching into a relay family the router
   * loads the relay TOTP secret read-only from `<projectRoot>/.ait_relay` into
   * `process.env` (via `loadRelaySecretReadOnly`) BEFORE the relay boots, so the
   * `assertRelayAuthConfigured()` / `buildRelayVerifyAuth()` at the boot site see
   * it. The daemon never mints — it only reads. Ignored for the local family.
   *
   * Rejects (without swapping) when a swap is already in flight.
   * `relay-live` (env 4) is removed — `confirm` parameter is gone (#665).
   */
  switchMode(mode: StartDebugMode, projectRoot?: string): Promise<ModeSwitchReport>;
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
   * Default 60 000 ms. Exposed for testing so tests can use a small value without
   * fake timers (which conflict with MCP SDK's own timeouts).
   */
  waitForAttachTimeoutMs?: number;
  /**
   * 로컬 QR HTTP 서버 — `start_attach` tool이 브라우저로 열 HTTP URL을 제공.
   * 없으면 text QR fallback으로만 동작 (GUI 없는 환경 호환).
   */
  qrHttpServer?: QrHttpServer;
  /**
   * Resolves the current MCP environment (`mock` | `relay-dev` | `relay-mobile`).
   * Used by `tools/list` to filter Tier A/B tools and by Tier C tools (e.g.
   * `measure_safe_area`) to label the `source` provenance field.
   *
   * Optional — defaults (issue #348, #665) to deriving the env from the *active*
   * connection's `kind` + `relayOrigin`
   * (`deriveEnvironment(router.active.kind, router.activeRelayOrigin)`). No URL
   * sniffing or precedence chain. `liveIntent` removed (#665). Tests inject a
   * fake to pin a precise env.
   */
  getEnvironment?: () => McpEnvironment;
  /** Resolves the reason for the current env decision (for logs). */
  getEnvironmentReason?: () => string;
  /**
   * Diagnostics collector — records server-side errors, attach/detach events,
   * and surfaces them via `get_debug_status`. When omitted a no-op collector is
   * used (backwards-compatible with existing tests that don't inject one).
   */
  diagnosticsCollector?: DiagnosticsCollector;
  /**
   * Hex-encoded TOTP secret for `start_attach` auto-splice.
   *
   * When set, `start_attach` generates a fresh TOTP code on every call and
   * splices it as `at=<code>` into the returned `attachUrl`. The response also
   * includes a `totp` field with `ttlSeconds` and `expiresAt` so callers know
   * when to re-invoke.
   *
   * SECRET-HANDLING: this value is captured in a closure and MUST NOT be logged
   * or included in any output other than the `at=` param inside `attachUrl`.
   *
   * Tests inject a dummy hex string or omit it. Production uses the late-bound
   * {@link getTotpSecret} variant instead (read at call time) — see below.
   */
  totpSecret?: string;
  /**
   * Late-bound variant of {@link totpSecret}: read AT `start_attach` CALL
   * TIME rather than captured once at server construction (issue #396).
   *
   * Why late-bound: since #396 the relay TOTP secret lives in a project-local
   * `.ait_relay` file loaded read-only into `process.env.AIT_DEBUG_TOTP_SECRET`
   * by `switchMode` BEFORE a relay family boots — which is AFTER the daemon
   * (and thus `createDebugServer`) already started. Capturing the secret at
   * construction would read an empty value on the all-lazy daemon, so
   * `start_attach` would emit a QR with no `at=` code and every attach would
   * be rejected by the relay gate. Reading it at call time makes the loaded
   * secret visible.
   *
   * When omitted, `createDebugServer` falls back to the captured {@link totpSecret}
   * (preserving all existing test behavior).
   *
   * SECRET-HANDLING: same as {@link totpSecret} — the returned value MUST NOT be
   * logged or included in any output other than the `at=` param inside `attachUrl`.
   *
   * Production: passed as `() => process.env.AIT_DEBUG_TOTP_SECRET` by the three
   * run functions.
   */
  getTotpSecret?: () => string | undefined;
  /**
   * `start_attach` 핸들러가 attach URL 컴포넌트를 확정한 직후 호출되는 콜백.
   * run 함수에서 `lastAttachParts` 갱신 + `qrHttpServer.notifyStateChange()` 트리거에 사용.
   * 테스트에서는 주입하지 않아도 되고, 미주입 시 no-op.
   *
   * 완성된 URL 문자열이 아니라 컴포넌트를 전달하는 이유: `getDashboardState`가
   * 호출될 때마다 최신 TOTP 코드를 freshly mint해 QR을 갱신하기 위함이다.
   * 정적 URL에 구워진 코드는 ~3분 후 만료(RELAY_VERIFY_SKEW_STEPS=6 기준) → relay 401 reason:'auth' (Defect 1).
   * rebuildAttachUrl()이 매 호출 시 generateTotp(secret)를 새로 계산한다.
   *
   * SECRET-HANDLING: 컴포넌트 안의 tunnel/scheme host와 wssUrl은 NEVER 로그 출력.
   * TOTP 코드는 rebuildAttachUrl() 내부에서만 mint되며 attachUrl의 at= param 안에만 노출.
   */
  onAttachUrlBuilt?: (parts: AttachUrlParts) => void;
  /**
   * Returns the cloudflared child PID of the currently active tunnel.
   * When provided, `get_debug_status` passes it to `getDiagnostics` as the
   * live in-memory source for FIX 2 (issue #571) — the PID is also picked up
   * from the lock file as a fallback, but the in-memory value is preferred as
   * it stays current across reissues.
   *
   * Production: injected by the run functions via a captured `activeTunnelChildPid`
   * variable that is updated whenever `onTunnelChildPid` fires (including reissues).
   * Tests inject a controlled value. Omitting it (old tests) falls back to the
   * lock-file path in `getDiagnostics`.
   */
  getTunnelChildPid?: () => number | null | undefined;
  /**
   * Lock-file reader — injected here so tests can control the lock data without
   * touching the filesystem. Defaults to `readServerLock` (the real file).
   *
   * This also enables handler-level tests for FIX 2 (issue #572 review) that
   * need to simulate a stale lock with a dead tunnelChildPid.
   */
  readLock?: () => import('./server-lock.js').LockData | null;
  /**
   * Maximum age (ms) of a page's `lastSeenAt` before it is treated as a
   * ghost and excluded from `wait_for_attach` short-circuit logic (issue #610).
   *
   * Default: {@link RELAY_SANDBOX_STALE_PAGE_MS} (5 minutes).
   * Injectable for tests so they can use a small value without fake timers.
   */
  stalePageThresholdMs?: number;
  /**
   * Monotonic clock for stale-page checks (issue #610). Defaults to
   * `Date.now`. Injectable for tests so they can freeze time without fake
   * timers (which conflict with MCP SDK's own timeouts).
   */
  nowMs?: () => number;
}

/**
 * Single-attach guard for `run_tests` (#646). Two concurrent runs injecting
 * into the same single-attach page would interleave `Runtime.evaluate` and
 * corrupt each other's `globalThis.__testBundle`. The model is "reject the
 * second", not "queue" — a module-level flag is process-wide, which matches the
 * single physical attached page (only one target is live at a time). The
 * entry-time `conn` snapshot ensures a run finishes on the connection it started
 * on even if `router.active` flips mid-run.
 */
let runTestsInFlight = false;

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
 * Timeout note: callers (e.g. the `start_attach` path) always pass an
 * explicit `timeoutMs`, sourced from the factory's `waitForAttachTimeoutMs`
 * (default 60 000). That value is forwarded to `waitForFirstTarget`, so it
 * overrides that method's own 90 000 signature default — the effective
 * wait on the tool path is 60 s, not 90 s.
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
 *   - bootstrap (always): `start_attach`, `list_pages`
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
    waitForAttachTimeoutMs = 60_000,
    qrHttpServer,
    getEnvironment: getEnvDep,
    getEnvironmentReason: getEnvReasonDep,
    diagnosticsCollector: collectorDep,
    totpSecret,
    onAttachUrlBuilt,
    getTunnelChildPid,
    readLock: readLockDep,
    stalePageThresholdMs = RELAY_SANDBOX_STALE_PAGE_MS,
    nowMs = () => Date.now(),
  } = deps;

  // Late-bound TOTP secret accessor (issue #396): production injects
  // `getTotpSecret` so the secret is read from env at `start_attach` call
  // time (after switchMode's project-local .ait_relay load). When absent we fall
  // back to the captured `totpSecret` — preserving existing test behavior.
  // SECRET-HANDLING: the returned value is used only for the at= code, never logged.
  const getTotpSecret = deps.getTotpSecret ?? (() => totpSecret);

  // Lock-file reader — defaults to the real file reader; injected by tests to
  // control lock data without touching the filesystem. Also used by the
  // get_debug_status handler to forward lock data into getDiagnostics for the
  // FIX 2 lock-file fallback (issue #572 review).
  const readLockFn = readLockDep ?? readServerLock;

  // Dual-connection router (issue #348). Production passes a real router that
  // holds both the local + relay connections and flips `active` on
  // `start_debug`. Tests (and any single-connection caller) omit it — we
  // synthesize a trivial router pinned to `deps.connection` whose `switchMode`
  // reports that dynamic switching is unavailable. Either way the handlers read
  // the live connection through `router.active`, so per-call snapshots are
  // uniform.
  const router: ConnectionRouter = routerDep ?? makeSingleConnectionRouter(connection);

  // Env SSoT (issue #348, #665) — derived, not detected: `mock` vs `relay-*` is
  // free from the ACTIVE connection's `kind`; `relay-dev` vs `relay-mobile` is
  // `relayOrigin`. No URL sniffing, no precedence chain. `liveIntent` removed
  // (#665). Tests inject `getEnvironment`/`getEnvironmentReason` to pin a precise env.
  const resolveEnvironment: () => McpEnvironment =
    getEnvDep ?? (() => deriveEnvironment(router.active.kind, router.activeRelayOrigin));
  const resolveEnvironmentReason: () => string =
    getEnvReasonDep ??
    (() => `derived:kind=${router.active.kind},relayOrigin=${router.activeRelayOrigin ?? 'none'}`);

  // Diagnostics collector — production uses an `InMemoryDiagnosticsCollector`;
  // tests may inject a no-op or fake. A no-op is created lazily when none
  // is supplied so existing tests that don't inject one continue to work.
  const collector: DiagnosticsCollector = collectorDep ?? new InMemoryDiagnosticsCollector();

  // ──────────────────────────────────────────────────────────────────────────
  // start_attach shared helpers (issue #626).
  //
  // The old attach-URL handler carried ~640 lines with the env-2
  // (relay-mobile) and env-3 (relay-dev) render-and-wait logic duplicated 8
  // times. `start_attach` factors that into three closures defined here so they
  // can read the closure variables (getTunnelStatus / getTotpSecret /
  // onAttachUrlBuilt / qrHttpServer / nowMs / stalePageThresholdMs):
  //
  //   prepareAttach     — env-specific validation + component bundle
  //   mintAttachUrl     — fresh-TOTP URL synthesis (single mint point)
  //   renderAndMaybeWait— QR render + browser open + segmented attach wait with
  //                       in-call TOTP re-mint
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Synthesizes an attach URL from stored components with a FRESHLY-minted TOTP
   * code (issue #626 §3/§4 — the single mint point). Reads the late-bound secret
   * via `getTotpSecret()` so the project-local `.ait_relay` secret loaded by
   * `switchMode` is visible. SECRET-HANDLING: the minted code rides inside the
   * URL's `at=` param only — never logged or returned separately.
   */
  function mintAttachUrl(parts: AttachUrlParts): string {
    const secret = getTotpSecret();
    const code = secret ? generateTotp(secret) : undefined;
    return parts.kind === 'launcher'
      ? buildLauncherAttachUrl(parts.tunnelHttpUrl, parts.wssUrl, code, {
          name: parts.appName,
          ...(parts.selfdebug ? { selfdebug: true } : {}),
        })
      : buildDeepLinkAttachUrl(parts.schemeUrl, parts.wssUrl, code);
  }

  /** Builds the fresh TOTP metadata (expiresAt window) for a tool result. */
  function buildTotpMeta(): AttachTotpMeta | undefined {
    const secret = getTotpSecret();
    if (secret === undefined || secret === '') return undefined;
    const STEP_SECONDS = 30;
    const expiresAtMs = nowMs() + RELAY_VERIFY_SKEW_STEPS * STEP_SECONDS * 1000;
    return {
      enabled: true,
      ttlSeconds: RELAY_VERIFY_SKEW_STEPS * STEP_SECONDS,
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
  }

  /**
   * Env-specific validation + component bundle for `start_attach` (issue #626).
   * Branches on `env`: `relay-mobile` reads AIT_TUNNEL_BASE_URL + builds launcher
   * parts; `relay-dev` requires scheme_url + builds scheme parts. Returns
   * `{ ok: false, error }` with a ready McpResult on any failure.
   */
  async function prepareAttach(
    env: McpEnvironment,
    args: Record<string, unknown> | undefined,
    conn: CdpConnection,
  ): Promise<PrepareAttachResult> {
    const selfdebug = args?.selfdebug === true;

    // Guard: selfdebug is a launcher-only feature — reject early for env 3
    // so the caller gets a clear diagnostic instead of silently ignoring it.
    if (selfdebug && env !== 'relay-mobile') {
      return {
        ok: false,
        error: mcpError(
          'start_attach: selfdebug=true는 env 2 / relay-sandbox 전용 기능입니다. ' +
            '현재 환경(env 3)에서는 launcher가 없어 self-target 모드를 지원하지 않습니다. ' +
            'launcher self-target이 필요하다면 relay-sandbox 모드로 전환하세요.',
        ),
      };
    }

    // ── relay-mobile branch (env 2 — launcher PWA QR) ──────────────────────
    if (env === 'relay-mobile') {
      // SECRET-HANDLING: AIT_TUNNEL_BASE_URL carries the app tunnel host —
      // NEVER echo it in error messages or logs. (#424) env wins; .ait_urls
      // is the fallback when env is unset.
      const rawProjectRoot = args?.projectRoot;
      const buildProjectRoot = typeof rawProjectRoot === 'string' ? rawProjectRoot : undefined;
      const envTunnelUrl = process.env.AIT_TUNNEL_BASE_URL?.trim() ?? '';
      let tunnelHttpUrl = envTunnelUrl;
      if (tunnelHttpUrl === '' && buildProjectRoot !== undefined) {
        const { readRelayUrls } = await import('./relay-url-store.js');
        const stored = await readRelayUrls({ projectRoot: buildProjectRoot });
        tunnelHttpUrl = stored?.tunnelBaseUrl ?? '';
      }
      if (tunnelHttpUrl === '') {
        return {
          ok: false,
          error: mcpError(
            'start_attach(mobile): AIT_TUNNEL_BASE_URL이 설정되지 않았습니다. ' +
              'dev 서버가 tunnel:{cdp:true}로 기동 중이면 .ait_urls 파일이 자동 생성돼 있어야 합니다. ' +
              '자동 발견이 되지 않을 경우 앱 HTTP 터널 URL을 AIT_TUNNEL_BASE_URL 환경변수로 직접 전달하세요.',
          ),
        };
      }
      const tunnelStatus = getTunnelStatus();
      if (!tunnelStatus.up || tunnelStatus.wssUrl === null) {
        return {
          ok: false,
          error: mcpError(
            'start_attach(mobile): relay wssUrl이 아직 설정되지 않았습니다. ' +
              'unplugin tunnel:{cdp:true}가 relay를 완전히 기동할 때까지 잠시 후 다시 시도하세요.',
          ),
        };
      }

      // Defense-in-depth (#452): relay mode requires TOTP auth — fail-closed if
      // the secret is missing rather than issuing an unauthenticated attach URL.
      // SECRET-HANDLING: error message names the requirement only.
      const secret = getTotpSecret();
      if (secret === undefined || secret === '') {
        return {
          ok: false,
          error: mcpError(
            'start_attach(relay): TOTP secret(AIT_DEBUG_TOTP_SECRET)이 설정되지 않았습니다. ' +
              'relay 환경은 TOTP 인증이 필수입니다 — relay를 secret과 함께 재기동하세요.',
          ),
        };
      }

      // Read the app name from projectRoot/package.json for the launcher
      // partner bar (#498). Failure to read is silently ignored (fail-open).
      let launcherAppName: string | undefined;
      if (buildProjectRoot !== undefined) {
        try {
          const { readFileSync } = await import('node:fs');
          const pkgRaw = readFileSync(`${buildProjectRoot}/package.json`, 'utf8');
          const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
          const rawName = typeof pkg.name === 'string' ? pkg.name : '';
          const stripped = rawName.includes('/')
            ? rawName.slice(rawName.indexOf('/') + 1)
            : rawName;
          launcherAppName = stripped.trim() || undefined;
        } catch {
          // Silently ignore — fail-open.
        }
      }

      const parts: AttachUrlParts = {
        kind: 'launcher',
        tunnelHttpUrl,
        wssUrl: tunnelStatus.wssUrl,
        appName: launcherAppName,
        ...(selfdebug ? { selfdebug: true } : {}),
      };

      // In mobile mode, deploymentId filtering is not applicable — match on
      // presence only, but with a stale-ghost guard (issue #610). The env-2
      // relay is owned by the dev server; a restart leaves a frozen lastSeenAt.
      const connAsAny = conn as unknown as {
        getTargetLastSeenAt?: (id: string) => number | null;
      };
      const getLastSeenAt =
        typeof connAsAny.getTargetLastSeenAt === 'function'
          ? (id: string) => (connAsAny.getTargetLastSeenAt as (id: string) => number | null)(id)
          : null;
      const callNow = nowMs();
      const isMatchingPage = (pages: ReturnType<CdpConnection['listTargets']>): boolean =>
        isSandboxPageFresh(pages, getLastSeenAt, callNow, stalePageThresholdMs);
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
        return (
          `${baseText}\n\nNo page attached within ${timeoutSec}s${observedNote} — ` +
          'launcher QR을 폰 카메라로 스캔한 뒤 call list_pages를 다시 호출하세요.'
        );
      };

      return {
        ok: true,
        parts,
        isMatchingPage,
        buildTimeoutError,
        authorityWarning: undefined, // no scheme authority for launcher
        totpMeta: buildTotpMeta(),
      };
    }
    // ── end relay-mobile branch ────────────────────────────────────────────

    // ── relay-dev branch (env 3 — intoss-private QR) ───────────────────────
    const schemeUrl = args?.scheme_url;
    if (typeof schemeUrl !== 'string' || schemeUrl === '') {
      return {
        ok: false,
        error: mcpError(
          'start_attach: scheme_url이 비어 있습니다. ' +
            '`ait deploy --scheme-only`가 출력하는 intoss-private:// URL을 인자로 전달하세요. ' +
            '환경 2(mobile)라면 scheme_url 대신 AIT_TUNNEL_BASE_URL을 설정하세요.',
        ),
      };
    }

    // Defense-in-depth (#452): relay-dev mode requires TOTP auth.
    // SECRET-HANDLING: error message names the requirement only.
    {
      const relaySecret = getTotpSecret();
      if (relaySecret === undefined || relaySecret === '') {
        return {
          ok: false,
          error: mcpError(
            'start_attach(relay): TOTP secret(AIT_DEBUG_TOTP_SECRET)이 설정되지 않았습니다. ' +
              'relay 환경은 TOTP 인증이 필수입니다 — relay를 secret과 함께 재기동하세요.',
          ),
        };
      }
    }

    // Tunnel-down check (the old buildAttachUrl threw here; we fail-fast with a
    // structured error to keep prepareAttach side-effect-free).
    const tunnelForBuild = getTunnelStatus();
    if (!tunnelForBuild.up || tunnelForBuild.wssUrl === null) {
      return { ok: false, error: classifyToolError(new Error('tunnel-down:'), 'start_attach') };
    }
    const authorityWarning = validateSchemeAuthority(schemeUrl) ?? undefined;

    const parts: AttachUrlParts = {
      kind: 'scheme',
      schemeUrl,
      wssUrl: tunnelForBuild.wssUrl,
    };

    // Parse _deploymentId to filter stale attached pages (null → presence-only).
    const deploymentId = extractDeploymentId(schemeUrl);
    if (!deploymentId) {
      logInfo('tool.call', {
        tool: 'start_attach',
        msg: 'no _deploymentId in scheme_url; matching on presence only',
      });
    }
    const isMatchingPage = (pages: ReturnType<CdpConnection['listTargets']>): boolean => {
      if (pages.length === 0) return false;
      if (deploymentId === null) return true;
      return pages.some((p) => p.url.includes(deploymentId));
    };
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

    return {
      ok: true,
      parts,
      isMatchingPage,
      buildTimeoutError,
      authorityWarning,
      totpMeta: buildTotpMeta(),
    };
  }

  /**
   * QR render + browser open + segmented attach wait with in-call TOTP re-mint
   * (issue #626 §3). Shared by env-2 and env-3 (4 render paths:
   * headless / browser-opened / browser-open-failed / no-http-server).
   *
   * The wait is decomposed into `START_ATTACH_SEGMENT_MS` slices. Between slices,
   * if the current TOTP code has aged past `START_ATTACH_REMINT_THRESHOLD_MS`,
   * a fresh URL is minted via `mintAttachUrl` and pushed to the dashboard via
   * `onAttachUrlBuilt` (SSE refresh — NO browser re-open). The `reminted` count
   * rides in the success/timeout result.
   *
   * SECRET-HANDLING: attachUrl encodes tunnel/scheme host + the TOTP `at=` code
   * in the QR payload only. The browser is opened on a 127.0.0.1 URL only. The
   * tool result carries `totp.expiresAt` + `reminted` count — never the code.
   */
  async function renderAndMaybeWait(
    prep: Extract<PrepareAttachResult, { ok: true }>,
    waitForAttach: boolean,
    callTimeoutMs: number,
    conn: CdpConnection,
  ): Promise<McpResult> {
    const { parts, isMatchingPage, buildTimeoutError, authorityWarning, totpMeta } = prep;

    // Initial mint + dashboard notify (components, not a finished URL, so
    // getDashboardState re-mints on every SSE push — Defect 1).
    let attachUrl = mintAttachUrl(parts);
    onAttachUrlBuilt?.(parts);
    let totpIssuedAt = nowMs();
    let reminted = 0;
    const relayUrl = parts.wssUrl;

    const header =
      'This tool result is shown to the user directly — do NOT re-print the QR below in your reply (it wastes output tokens). Just tell the user to scan the QR in this output (Ctrl+O to expand if collapsed).';
    const warningPrefix = authorityWarning ? `⚠️  scheme_url 경고: ${authorityWarning}\n\n` : '';
    const guiAvailable = canOpenBrowser();

    /** Builds the totp object surfaced in results (fresh expiresAt + reminted). */
    const totpResult = (): Record<string, unknown> | undefined => {
      if (!totpMeta) return undefined;
      const STEP_SECONDS = 30;
      const expiresAtMs = totpIssuedAt + RELAY_VERIFY_SKEW_STEPS * STEP_SECONDS * 1000;
      return {
        enabled: true,
        ttlSeconds: totpMeta.ttlSeconds,
        expiresAt: new Date(expiresAtMs).toISOString(),
        ...(reminted > 0 ? { reminted } : {}),
      };
    };

    /**
     * Segmented wait with TOTP re-mint (issue #626 §3). Resolves with the
     * attached page list, or rejects on timeout. Between SEGMENT_MS slices it
     * re-mints when the code has aged past the threshold (max ~4 re-mints over
     * 600 s). Returns immediately once a matching page attaches (no re-mint).
     */
    async function waitWithRemint(): Promise<ReturnType<CdpConnection['listTargets']>> {
      const deadline = nowMs() + callTimeoutMs;
      // Immediate check — already attached resolves without any wait/re-mint.
      if (isMatchingPage(conn.listTargets())) return conn.listTargets();
      for (;;) {
        const remaining = deadline - nowMs();
        if (remaining <= 0) {
          throw new Error(`start_attach: 타임아웃 (${callTimeoutMs}ms)`);
        }
        const segmentMs = Math.min(START_ATTACH_SEGMENT_MS, remaining);
        try {
          return await waitForAttachWithEvents(conn, isMatchingPage, segmentMs);
        } catch {
          // Segment elapsed without attach — re-mint if the code is aging, then
          // loop into the next segment. SECRET-HANDLING: code never logged.
          if (totpMeta && nowMs() - totpIssuedAt >= START_ATTACH_REMINT_THRESHOLD_MS) {
            attachUrl = mintAttachUrl(parts);
            onAttachUrlBuilt?.(parts);
            totpIssuedAt = nowMs();
            reminted += 1;
          }
        }
      }
    }

    /**
     * Assembles the success result after a page attaches. `baseText` carries the
     * QR + pre-wait JSON block (the QR the user already scanned). The attach
     * itself ends the wait, so the QR is moot — what matters now is the final
     * TOTP state. If the segmented wait re-minted (issue #626 §3), surface the
     * post-wait `totp` block (fresh `expiresAt` + `reminted` count) so the result
     * reflects how many times the code rotated during the wait. SECRET-HANDLING:
     * the totp block carries expiresAt + reminted only — never the code value.
     */
    const successResult = (baseText: string): McpResult => {
      const pagesResult = listPages(conn, getTunnelStatus());
      const finalTotp = totpResult();
      const remintNote =
        finalTotp && reminted > 0 ? `\n\n${JSON.stringify({ totp: finalTotp }, null, 2)}` : '';
      return {
        content: [
          {
            type: 'text',
            text: `${baseText}\n\n${JSON.stringify(pagesResult, null, 2)}${remintNote}`,
          },
        ],
      };
    };

    /** Runs the wait (when requested) and returns success/timeout result. */
    const runWait = async (baseText: string): Promise<McpResult> => {
      if (!waitForAttach) {
        return { content: [{ type: 'text', text: baseText }] };
      }
      try {
        await waitWithRemint();
      } catch {
        const observed = conn.listTargets();
        return {
          content: [
            { type: 'text', text: buildTimeoutError(baseText, callTimeoutMs / 1000, observed) },
          ],
          isError: true,
        };
      }
      return successResult(baseText);
    };

    // Path 1: headless — no GUI, text QR only.
    if (!guiAvailable) {
      const headlessNote =
        'GUI 환경이 감지되지 않았습니다 (headless/remote 환경). ' +
        '텍스트 QR을 폰 카메라로 스캔하거나, 로컬 GUI 환경에서 실행하세요.\n\n';
      const qr = await renderQr(attachUrl);
      const baseText = `${warningPrefix}${headlessNote}${header}\n${JSON.stringify({ attachUrl, relayUrl, ...(totpResult() ? { totp: totpResult() } : {}) }, null, 2)}\n\n${qr}`;
      return runWait(baseText);
    }

    // Path 2 / 3: GUI + HTTP server — open the dashboard in the browser.
    if (guiAvailable && qrHttpServer) {
      const httpUrl = qrHttpServer.buildAttachPageUrl(attachUrl);
      const pngUrl = `http://127.0.0.1:${qrHttpServer.port}/qr.png?u=${encodeURIComponent(attachUrl)}`;
      const browserResult = await openQrInBrowser(httpUrl, pngUrl);

      if (browserResult.opened) {
        const retriedNote = browserResult.retried ? ' (1회 retry 후 성공)' : '';
        const openResult = {
          attempted: true,
          succeeded: true,
          ...(browserResult.retried ? { retried: true } : {}),
        };
        const shortText =
          `${warningPrefix}${header}\n` +
          `${JSON.stringify({ relayUrl, openResult, ...(totpResult() ? { totp: totpResult() } : {}) }, null, 2)}\n\n` +
          `브라우저에서 QR을 열었습니다${retriedNote}. 폰 카메라로 스캔하세요.\n` +
          `URL: ${browserResult.httpUrl}`;
        return runWait(shortText);
      }

      // Browser open failed — structured error + URL hint + text QR fallback.
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
        `브라우저 자동 열기에 실패했습니다. ` +
        `다음 URL을 직접 브라우저에서 여세요:\n${browserResult.httpUrl}\n` +
        `또는 PNG로 받기: ${browserResult.pngUrl}` +
        stderrNote +
        '\n\n';
      const qr = await renderQr(attachUrl);
      const baseText = `${warningPrefix}${fallbackNote}${header}\n${JSON.stringify({ attachUrl, relayUrl, openResult, ...(totpResult() ? { totp: totpResult() } : {}) }, null, 2)}\n\n${qr}`;
      return runWait(baseText);
    }

    // Path 4: GUI but no HTTP server — text QR fallback.
    const qr = await renderQr(attachUrl);
    const baseText = `${warningPrefix}${header}\n${JSON.stringify({ attachUrl, relayUrl, ...(totpResult() ? { totp: totpResult() } : {}) }, null, 2)}\n\n${qr}`;
    return runWait(baseText);
  }

  const server = new Server(
    { name: 'ait-debug', version: __VERSION__ },
    // listChanged: true — the server emits notifications/tools/list_changed when
    // a page attaches (0→N target transition), promoted attach-dependent tools.
    { capabilities: { tools: { listChanged: true } } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => {
    // Per-request snapshot of the active connection (issue #348). `kind` is
    // authoritative even before any target attaches, so bootstrap visibility
    // (e.g. Tier B `start_attach`) is correct from the first `tools/list`.
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
            "'local-browser' | 'relay-sandbox' | 'relay-staging' 중 하나를 전달하세요. " +
            '(relay-live / env 4는 #665에서 제거됐습니다.)',
        );
      }
      // Per-session project root (issue #396): the daemon reads the relay TOTP
      // secret read-only from <projectRoot>/.ait_relay when switching to a relay
      // family. Optional — omitted for local, or when the operator exported the
      // secret. SECRET-HANDLING: projectRoot is a path, never the secret value.
      const rawProjectRoot = request.params.arguments?.projectRoot;
      const projectRoot = typeof rawProjectRoot === 'string' ? rawProjectRoot : undefined;
      try {
        const report = await router.switchMode(mode, projectRoot);
        return jsonResult(report);
      } catch (err) {
        return errorResult(err, name);
      }
    }

    // start_attach — single entry to attach a real device (issue #626). Folds
    // the old attach-URL + start_debug two-step into one call: optional
    // mode switch → QR synthesis → attach wait with in-call TOTP re-mint. Handled
    // before the env-mismatch guard (like start_debug) because its `mode` arg can
    // switch FROM mock INTO a relay family.
    if (name === 'start_attach') {
      const args = request.params.arguments;
      // Mode prologue (optional). When `mode` is given and differs from the
      // active env, switch first. local-browser is rejected below (relay-only).
      let attachConn = conn;
      const rawMode = args?.mode;
      if (rawMode !== undefined) {
        const mode = normalizeStartDebugMode(rawMode);
        // Reject an invalid OR local-browser mode BEFORE any switch — local has
        // no QR attach, so switching into it then failing would needlessly churn
        // the active connection + emit a spurious tools/list_changed.
        if (mode === null || mode === 'local-browser') {
          return mcpError(
            'start_attach: mode가 올바르지 않습니다. ' +
              "'relay-sandbox' | 'relay-staging' 중 하나를 전달하세요 " +
              '(local-browser는 QR attach가 없어 start_attach에서 지원하지 않습니다).',
          );
        }
        const targetEnv = envForMode(mode);
        // Skip the switch when already in the target env (no tools/list churn).
        if (resolveEnvironment() !== targetEnv) {
          const rawProjectRoot = args?.projectRoot;
          const projectRoot = typeof rawProjectRoot === 'string' ? rawProjectRoot : undefined;
          try {
            await router.switchMode(mode, projectRoot);
          } catch (err) {
            return errorResult(err, name);
          }
          // PER-CALL SNAPSHOT re-capture (issue #348 — CRITICAL). switchMode
          // flipped router.active; re-read the connection now so the rest of
          // this call uses the post-switch family, not the stale pre-switch one.
          attachConn = router.active;
        }
      }

      // Resolve env AFTER the (possible) switch.
      const attachEnv = resolveEnvironment();
      if (!isRelayEnv(attachEnv)) {
        return mcpError(
          'start_attach: relay 전용 tool입니다 (env 2 / relay-sandbox 또는 env 3 / relay-staging). ' +
            "현재 환경은 'local-browser'(mock)입니다 — mode 인자로 'relay-sandbox' 또는 'relay-staging'을 " +
            '전달하거나, 먼저 relay 모드로 전환하세요.',
        );
      }

      // wait defaults to true (#626 — behavior change from the old attach tool's
      // opt-in wait_for_attach). callTimeoutMs clamps wait_timeout_seconds to
      // 1–600 s; invalid values fall back to the default.
      const waitForAttach = true;
      const rawWaitTimeout = args?.wait_timeout_seconds;
      const callTimeoutMs = (() => {
        if (typeof rawWaitTimeout !== 'number' || !Number.isFinite(rawWaitTimeout)) {
          return waitForAttachTimeoutMs;
        }
        if (rawWaitTimeout <= 0) return waitForAttachTimeoutMs;
        const clamped = Math.max(1, Math.min(600, rawWaitTimeout));
        return Math.round(clamped) * 1000;
      })();

      try {
        const prep = await prepareAttach(attachEnv, args, attachConn);
        if (!prep.ok) return prep.error;
        return await renderAndMaybeWait(prep, waitForAttach, callTimeoutMs, attachConn);
      } catch (err) {
        return errorResult(err, name);
      }
    }

    // PER-CALL SNAPSHOT of the derived environment (issue #348 / #354 regression
    // fix). Capture `env` + `envReason` exactly once, right after the start_debug
    // branch (so this call sees the post-switch env when it *is* a switch) and
    // before the first `await`. Every site below reuses these locals instead of
    // re-calling `resolveEnvironment()`/`resolveEnvironmentReason()` — those
    // closures re-read `router.active.kind` + `relayOrigin` live, so a
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

    // get_debug_status is a bootstrap tool — it works before any page attaches
    // and must not require enableDomains. It aggregates all server state into a
    // single response so the agent can diagnose session problems in one call.
    if (name === 'get_debug_status') {
      try {
        const rawLimit = request.params.arguments?.recent_errors_limit;
        const recentErrorsLimit = typeof rawLimit === 'number' && rawLimit > 0 ? rawLimit : 10;
        const result = await getDiagnostics({
          tunnel: getTunnelStatus(),
          connection: conn,
          env,
          envReason,
          collector,
          readLock: readLockFn,
          recentErrorsLimit,
          tunnelChildPid: getTunnelChildPid?.() ?? undefined,
        });
        const attached = conn.listTargets().length > 0;
        return envelopeResult(result, name, env, attached);
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
          // Host allowlist kill-switch (#665). Replaces the old LIVE guard.
          // connectionHostsAllowed() checks each attached page's URL hostname
          // against the positive allowlist (localhost/trycloudflare/private-apps).
          // SECRET-HANDLING: hostname never logged — only the boolean.
          if (!connectionHostsAllowed(conn)) {
            return mcpError(
              'evaluate: 현재 연결된 페이지는 debug 허용 호스트가 아닙니다 (#665). ' +
                '허용 호스트: localhost, *.trycloudflare.com, *.private-apps.tossmini.com.',
            );
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
          // Host allowlist kill-switch (#665). Replaces the old LIVE guard.
          // SECRET-HANDLING: hostname never logged — only the boolean.
          if (!connectionHostsAllowed(conn)) {
            return mcpError(
              'call_sdk: 현재 연결된 페이지는 debug 허용 호스트가 아닙니다 (#665). ' +
                '허용 호스트: localhost, *.trycloudflare.com, *.private-apps.tossmini.com.',
            );
          }
          // SECRET-HANDLING: do not log name, args, or result value.
          const sdkResult = await callSdk(conn, sdkName, sdkArgs);
          // 상태 4: SDK 부재 — ok:false + 'sdk-absent:' 패턴은 isError로 승격
          if (
            !sdkResult.ok &&
            typeof sdkResult.error === 'string' &&
            sdkResult.error.startsWith('sdk-absent:')
          ) {
            // issue #360: local(`--target=local`) 세션은 dog-food 재배포가 아니라
            // dev 서버/unplugin alias 확인이 맞는 안내다 — connection.kind로 분기.
            return sdkAbsentError('call_sdk', conn.kind === 'local');
          }
          const callSdkAttached = conn.listTargets().length > 0;
          return envelopeResult(sdkResult, name, env, callSdkAttached);
        }
        case 'run_tests': {
          const rawFiles = request.params.arguments?.files;
          if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
            return mcpError(
              'run_tests: files 인자가 비어 있습니다. 실행할 테스트 파일 glob을 배열로 전달하세요.',
            );
          }
          const patterns = rawFiles.filter((p): p is string => typeof p === 'string' && p !== '');
          if (patterns.length === 0) {
            return mcpError('run_tests: files 인자에 유효한 문자열 glob이 없습니다.');
          }
          const rawRoot = request.params.arguments?.projectRoot;
          const projectRoot = typeof rawRoot === 'string' ? rawRoot : process.cwd();
          const rawTimeout = request.params.arguments?.timeout_ms;
          const timeoutMs =
            typeof rawTimeout === 'number' && rawTimeout >= 1000 && rawTimeout <= 600_000
              ? rawTimeout
              : undefined; // undefined → relay-worker default (30 000)

          // Host allowlist kill-switch (#665). Replaces the old LIVE guard.
          // Test injection runs arbitrary code via Runtime.evaluate — must be on
          // an allowed debug host. SECRET-HANDLING: hostname never logged.
          if (!connectionHostsAllowed(conn)) {
            return mcpError(
              'run_tests: 현재 연결된 페이지는 debug 허용 호스트가 아닙니다 (#665). ' +
                '허용 호스트: localhost, *.trycloudflare.com, *.private-apps.tossmini.com.',
            );
          }

          // Single-attach guard — reject a concurrent run (no queue). The flag
          // MUST be set SYNCHRONOUSLY (no await between the check and the set),
          // or two concurrent calls both read `false` before either suspends and
          // both proceed — a TOCTOU race in JS's cooperative async model. So we
          // claim the lock here and do discovery/fail-fast inside the try, with
          // `finally` always releasing it (covers the no-match/page-missing
          // early returns too).
          if (runTestsInFlight) {
            return mcpError(
              'run_tests: 이미 다른 테스트 실행이 진행 중입니다 ' +
                '(single-attach 모델: 페이지는 한 번에 하나의 실행만 처리). 완료 후 다시 시도하세요.',
            );
          }
          runTestsInFlight = true;
          try {
            const files = await discoverTestFiles(patterns, projectRoot);
            if (files.length === 0) {
              return mcpError(
                `run_tests: 매칭된 테스트 파일이 없습니다 (patterns: ${patterns.join(', ')}).`,
              );
            }

            // Fail-fast: if the page was evicted between the enableDomains gate
            // and here, surface the re-attach hint instead of bundling N files.
            if (conn.listTargets().length === 0) {
              return pageMissingError('run_tests');
            }

            // Progress is the per-file results array (MCP is request/response —
            // no mid-call streaming). Log only counts, never file content/paths
            // as secrets / relay URLs. SECRET-HANDLING: do not log bundle code,
            // expression, or result values.
            logInfo('run_tests.start', { fileCount: files.length });
            const report = await runWithConnection(conn, files, { timeoutMs });
            logInfo('run_tests.done', {
              passed: report.totals.passed,
              failed: report.totals.failed,
              skipped: report.totals.skipped,
            });
            const runAttached = conn.listTargets().length > 0;
            return envelopeResult(toRunTestsResult(report), name, env, runAttached);
          } finally {
            runTestsInFlight = false;
          }
        }
        default:
          return unknownTool(name);
      }
    } catch (err) {
      // issue #360: sdk-absent 분류가 local 세션이면 dev-bridge 안내로 분기하도록
      // connection 종류를 넘긴다. 다른 에러 분류에는 영향 없음(isLocal 미사용).
      return errorResult(err, name, conn.kind === 'local');
    }
  });

  return server;
}

/**
 * Normalizes a raw `start_debug` `mode` argument to a `StartDebugMode`, or
 * `null` when the value is not one of the three accepted modes:
 *   'local-browser' | 'relay-sandbox' | 'relay-staging'
 *
 * Hard rename (issue #398): the older `local`/`mobile`/`staging`/`live` names
 * and their aliases are no longer accepted — pre-1.0, no back-compat.
 * `relay-live` (env 4) removed in #665.
 */
export function normalizeStartDebugMode(raw: unknown): StartDebugMode | null {
  if (raw === 'local-browser' || raw === 'relay-sandbox' || raw === 'relay-staging') {
    return raw;
  }
  return null;
}

/**
 * Positive-allowlist kill-switch for side-effect MCP tools (#665).
 *
 * Returns `true` when the connection's attached targets are all on allowed
 * debug hosts (localhost / trycloudflare / private-apps). Returns `false` when
 * any target's page URL is on a non-allowed host (e.g. `apps.tossmini.com`).
 *
 * For local connections this always returns `true` — the local Chromium is
 * always on localhost. For relay connections without any pages it returns
 * `true` (no pages = nothing to block; the caller's page-missing guard fires
 * first).
 *
 * SECRET-HANDLING: hostnames are NEVER logged here — only the boolean result
 * is returned to the caller.
 */
export function connectionHostsAllowed(conn: CdpConnection): boolean {
  if (conn.kind === 'local') return true;
  const pages = conn.listTargets();
  if (pages.length === 0) return true;
  return pages.every((p) => {
    try {
      const url = new URL(p.url ?? '');
      return isDebugAllowedHost(url.hostname);
    } catch {
      // Unparseable URL — fail-closed (#665 positive-allowlist).
      // A relay target with an unparseable URL cannot have a known-good host;
      // blocking it preserves the positive-allowlist invariant.
      return false;
    }
  });
}

/**
 * Builds a trivial `ConnectionRouter` pinned to a single connection (issue
 * #348). Used by `createDebugServer` when no real dual router is injected —
 * every existing single-connection test and the `local`-only / `relay`-only
 * boot path. `switchMode` here cannot lazily boot another family, so it only
 * honors a request that matches the connection's own kind; any cross-family
 * request is rejected with a clear "dynamic switch unavailable in this session"
 * error. `confirm` parameter and `relay-live` gate removed (#665).
 */
export function makeSingleConnectionRouter(connection: CdpConnection): ConnectionRouter {
  return {
    get active() {
      return connection;
    },
    // A single-connection router has no family concept, so it carries no relay
    // origin discriminator (issue #378). Env derives as `relay-dev` for a relay
    // connection here — `relay-sandbox` (external-PWA origin) is rejected below
    // since this router cannot boot the external relay family.
    activeRelayOrigin: undefined,
    // `_projectRoot` (issue #396) is accepted for interface conformance but
    // unused here: this router never lazily boots a relay family — its single
    // connection (and thus any relay verifyAuth) was already built at startup,
    // so a per-session project-local secret cannot retroactively rewire it. The
    // dual router below performs the read-only load before a lazy relay boot.
    switchMode(mode: StartDebugMode, _projectRoot?: string): Promise<ModeSwitchReport> {
      // `relay-sandbox` (env 2) needs a distinct external-PWA relay family this
      // single-connection router cannot synthesize. Reject the same way a
      // cross-family switch is rejected (issue #378).
      if (mode === 'relay-sandbox') {
        return Promise.reject(
          new Error(
            'start_debug: 이 세션은 단일 연결만 보유합니다 — ' +
              "'relay-sandbox'(환경 2 PWA, 외부 relay)로 동적 전환할 수 없습니다 (dual-connection 데몬에서만 지원). " +
              'MCP 서버를 relay-sandbox 모드로 재시작하세요.',
          ),
        );
      }
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
      const environment = deriveEnvironment(connection.kind);
      return Promise.resolve({
        mode,
        environment,
        kind: connection.kind,
        nextStep:
          connection.kind === 'relay'
            ? 'start_attach로 attach QR 생성 + 폰 attach까지 한 번에 진행하세요.'
            : 'list_pages로 로컬 페이지 attach를 확인하세요.',
      });
    },
  };
}

/**
 * Re-builds an attach URL from stored components with a FRESHLY-minted TOTP code,
 * so the dashboard/`/attach` QR is never an expired bake-in (Defect 1).
 * SECRET-HANDLING: reads AIT_DEBUG_TOTP_SECRET at call time (mirrors tunnel.ts
 * getDashboardState). The minted code rides inside attachUrl's at= param only —
 * never logged. generateTotp() relies on its Date.now() default.
 */
function rebuildAttachUrl(parts: AttachUrlParts): string {
  const secret = process.env.AIT_DEBUG_TOTP_SECRET;
  const code = secret ? generateTotp(secret) : undefined;
  return parts.kind === 'launcher'
    ? buildLauncherAttachUrl(parts.tunnelHttpUrl, parts.wssUrl, code, {
        name: parts.appName,
        ...(parts.selfdebug ? { selfdebug: true } : {}),
      })
    : buildDeepLinkAttachUrl(parts.schemeUrl, parts.wssUrl, code);
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

/**
 * Maps a {@link RelayRunReport} to a flat, agent-friendly object for the
 * `run_tests` tool result. SECRET-HANDLING: a RelayRunReport carries only
 * startedAt/duration/totals and per-file `{file, result}` — file paths are
 * surfaced (allowed), relay wss/TOTP URLs never appear in it. No stripping
 * needed; this only reshapes for readability.
 */
function toRunTestsResult(report: RelayRunReport) {
  return {
    startedAt: report.startedAt,
    duration: report.duration,
    totals: report.totals,
    files: report.files.map((f) =>
      'error' in f.result
        ? { file: f.file, error: f.result.error }
        : {
            file: f.file,
            // Per-file in-page run time (from the runtime's RunReport) helps
            // an agent triage which file is slow — the top-level `duration` is
            // the whole-run wall-clock (bundling + sequential injection), not
            // this per-file figure.
            duration: f.result.duration,
            passed: f.result.passed,
            failed: f.result.failed,
            skipped: f.result.skipped,
            tests: f.result.tests,
          },
    ),
  };
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
function errorResult(err: unknown, name: string, isLocal = false) {
  return classifyToolError(err, name, isLocal);
}

/**
 * Starts a polling watcher that detects target-set changes on
 * `connection.listTargets()` and sends a `notifications/tools/list_changed`
 * notification on the given server.
 *
 * The watcher polls every `intervalMs` (default 1 000 ms). It fires
 * `server.sendToolListChanged()` + `onAttach()` whenever the sorted target-id
 * signature changes AND the new target set is non-empty. This covers:
 *   - 0→N first attach
 *   - 1→1 target replacement (same count, different id — e.g. rescan)
 *   - N→M any change where the result is still non-empty
 *
 * Full detach (→ empty) updates the stored signature but does NOT fire the
 * callback — `onAttach` semantics are about a live target being present.
 *
 * The interval is **never cleared automatically** — it keeps running until
 * `stop()` is called during shutdown. This ensures that a target replacement
 * after the first attach is always detected.
 *
 * `onAttach` is called on every non-empty signature change (or immediately when
 * already attached). Use this to trigger side-effects such as pushing a fresh
 * SSE state to open dashboard tabs (issue #509). The callback is optional;
 * omitting it preserves the previous behaviour exactly.
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
  onAttach?: () => void,
): { stop(): void } {
  /** Sorted, comma-joined target-id string — '' means no targets attached. */
  function signature(): string {
    return connection
      .listTargets()
      .map((t) => t.id)
      .sort()
      .join(',');
  }

  let lastSignature = signature();
  // If already attached when the watcher starts, send once immediately.
  if (lastSignature !== '') {
    void server.sendToolListChanged();
    onAttach?.();
  }

  const handle = setInterval(() => {
    const current = signature();
    if (current !== lastSignature) {
      lastSignature = current;
      if (current !== '') {
        // Non-empty signature change — new or replaced target(s).
        void server.sendToolListChanged();
        onAttach?.();
      }
      // Empty signature (full detach): signature updated above, callback skipped.
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

// `buildRelayVerifyAuth` now lives in `./totp.js` (lightweight, node:crypto
// only) so the unplugin's env-2 relay can wire the same TOTP upgrade gate
// without pulling the heavy MCP server module graph. Re-exported here so
// existing importers (and tests) keep resolving it from `debug-server.js`.
export { buildRelayVerifyAuth };

/**
 * Factory that constructs a `ChiiCdpConnection` for the given relay base URL.
 *
 * Introduced as a named seam so PR-2 (dual-connection, #348) can defer
 * construction to first-activation time by moving or replacing this call. Since
 * #396 every family (relay included) is constructed lazily on its first
 * `start_debug`, so this is always called from the lazy boot path.
 *
 * The relay base URL is only available after `startChiiRelay()` resolves, so
 * the factory is called right after that point (same as before this refactor).
 */
function createRelayConnection(relayBaseUrl: string): ChiiCdpConnection {
  // Pass the SECRET (not a code) so the connection mints a fresh TOTP per
  // (re)connect. Read from env directly: both callers run
  // assertRelayAuthConfigured() first, so when a TOTP-gated relay is up this is
  // a valid hex secret; when TOTP is disabled it is undefined and no `at=` is
  // appended (backward compatible). SECRET-HANDLING: forwarded, never logged.
  return new ChiiCdpConnection({
    relayBaseUrl,
    totpSecret: process.env.AIT_DEBUG_TOTP_SECRET,
  });
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
 * Direction-neutral (issue #356): any of the three families can be the first one
 * booted. Since #396 every family is lazy-booted on its first `start_debug`. The
 * relay family additionally exposes its live tunnel status; the local family
 * leaves it `undefined` (a local browser has no relay tunnel), so the
 * router/handlers read the relay tunnel status from whichever family is the
 * relay one.
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
  /**
   * Relay origin discriminator (issue #378) — set by the boot fn, NOT sniffed
   * from the URL. `'intoss-webview'` for the intoss-private relay
   * (`bootRelayFamily`), `'external-pwa'` for the env-2 external relay
   * (`bootExternalRelayFamily`). `undefined` for the local family (kind is
   * `'local'`, so the origin is irrelevant). Threaded into `deriveEnvironment`
   * so `relay-mobile` can be told apart from `relay-dev`.
   */
  relayOrigin?: RelayOrigin;
  /**
   * Local HTTP base URL of the Chii relay (e.g. `http://127.0.0.1:9100` for
   * the intoss relay, or the external cloudflare URL for env-2). Used by
   * {@link AutoDevtoolsOpener} to build the Chii self-hosted inspector URL
   * (`<relayHttpUrl>/front_end/chii_app.html`). `undefined` for the local-
   * browser family (no relay, F12 is available directly).
   *
   * SECRET-HANDLING: this value contains the relay host. MUST NOT be logged.
   */
  relayHttpUrl?: string;
  /**
   * LOCAL loopback HTTP base URL of the Chii relay for env-2
   * (`http://127.0.0.1:<relay-port>`). When set, the MCP uses this instead of
   * `relayHttpUrl` (the cloudflare tunnel base) to build inspector URLs — so
   * front_end page load and the client WS leg stay on the loopback and do not
   * traverse the tunnel (issue #530).
   *
   * Only relevant for `bootExternalRelayFamily` (env-2): the intoss relay
   * (`bootRelayFamily`) already uses a loopback `relay.baseUrl`.
   *
   * Safe to log/surface: loopback address contains no tunnel host.
   */
  relayLocalHttpUrl?: string;
}

/**
 * Boots the local-browser family (issues #348, #356). Launches a Chromium with
 * `--remote-debugging-port` and returns a `LocalCdpConnection` attached to it,
 * plus a `stop()` that kills both.
 *
 * Booted lazily via the dual router's `bootLazyFor('local-browser')` callback,
 * at most once on the first `start_debug({ mode: 'local-browser' })` (all-lazy,
 * #396 — no run function boots a family at startup anymore).
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
  /**
   * Secret-free observability callback for relay auth rejections (issue #467) —
   * forwarded to {@link startChiiRelay}'s `onAuthReject`. Receives only the
   * rejection kind; never the URL, query, code, or secret. Boot sites wire it
   * to `DiagnosticsCollector.recordAuthReject()` so `get_debug_status` can
   * surface silent 401s.
   */
  onAuthReject?: (event: import('./chii-relay.js').RelayAuthRejectEvent) => void;
  /**
   * Called with the cloudflared child PID once the tunnel is up.
   *
   * FIX 3 (issue #571): callers wire this to
   * `lockHandle.updateTunnelChildPid(pid)` so the lock file records the child
   * PID and a subsequent `acquireLock` can detect a zombie daemon (Node
   * process alive, tunnel child dead) without requiring `--force`.
   */
  onTunnelChildPid?: (pid: number) => void;
  /**
   * Called when the tunnel goes permanently down (3 reissue attempts failed),
   * so the caller can immediately push the new state to dashboard SSE clients
   * via `qrServer?.notifyStateChange()`. Without this, the dashboard keeps a
   * scannable-but-dead QR on screen until the next periodic TOTP refresh
   * happens to push (issue #631) — the render gate only flips once `tunnel.up`
   * reaches the client. Carries no arguments (the droppedAt timestamp rides
   * inside `tunnelStatus`, surfaced via `getTunnelStatus()`).
   */
  onTunnelDown?: () => void;
}

/**
 * Boots the relay family (issues #348, #356): starts the Chii relay on an
 * OS-assigned port (with optional TOTP gate), opens a cloudflared quick tunnel
 * to the relay's confirmed port in the background, prints the attach banner,
 * and arms the tunnel health probe. Returns a {@link BootedFamily} whose
 * `getTunnelStatus()` reflects the live tunnel (it flips up once the background
 * tunnel resolves and follows reissues).
 *
 * Booted lazily via the dual router's `bootLazyFor('relay-intoss')` callback
 * (symmetry with {@link bootLocalFamily}), at most once on the first
 * `start_debug({ mode: 'relay-staging' })` (all-lazy, #396 — every relay boot now
 * flows through `switchMode` after the project-local secret load). `relay-live`
 * removed (#665).
 *
 * The relay base URL is only known after `startChiiRelay()` resolves, so the
 * `ChiiCdpConnection` (via {@link createRelayConnection}) is constructed inside
 * this function, after the relay port is confirmed.
 *
 * SECRET-HANDLING: the TOTP secret rides only inside `verifyAuth`; the wssUrl
 * (relay host) is never logged here directly.
 */
export async function bootRelayFamily(options: BootRelayFamilyOptions = {}): Promise<BootedFamily> {
  // Relay-auth baseline (issue #250): this boots a public-internet-exposed relay
  // (cloudflared quick tunnel), so a configured TOTP secret is MANDATORY — Layer
  // C is the only fail-fast layer that stops a leaked tunnel URL from attaching.
  // Fail fast before opening the relay/tunnel. Local-only sessions never call
  // this fn and so stay exempt. SECRET-HANDLING: the guard never logs the value.
  assertRelayAuthConfigured();

  // Default 0: OS picks a free port. Prevents EADDRINUSE from stale cloudflared
  // orphans (SIGKILL survivors) that would otherwise block a fixed port and
  // cause -32000 MCP handshake failures on reconnect.
  const relayPort = options.relayPort ?? 0;
  const totpEnabled = options.verifyAuth !== undefined;

  const relay = await startChiiRelay({
    port: relayPort,
    verifyAuth: options.verifyAuth,
    onAuthReject: options.onAuthReject,
  });
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
  // (`start_attach`) already gate on `getTunnelStatus()` and return a clear
  // "tunnel not up" message when it isn't ready yet, so dropping the await is
  // safe — the agent retries once the banner prints.
  const tunnelReady = startQuickTunnel(relay.port).then(
    (t) => {
      tunnel = t;
      tunnelStatus = makeTunnelStatus(true, t.wssUrl);
      options.onWssUrl?.(t.wssUrl);
      // FIX 3 (issue #571): notify caller of the cloudflared child PID so it
      // can be persisted in the server lock file for zombie detection.
      // childPid is a plain integer — not a secret.
      if (t.childPid !== undefined) {
        options.onTunnelChildPid?.(t.childPid);
      }
      // SECRET-HANDLING: wssUrl contains the relay host — do not log it directly.
      logInfo('tunnel.up', { totpEnabled });

      // Start the health probe now that the tunnel URL is known.
      // The probe runs every 60 s and attempts up to 3 reissues on drop.
      tunnelProbe = startTunnelHealthProbe(t, relay.port, {
        onReissue: (newTunnel) => {
          tunnel = newTunnel;
          tunnelStatus = makeTunnelStatus(true, newTunnel.wssUrl, null, 0);
          options.onWssUrl?.(newTunnel.wssUrl);
          // FIX (issue #572 review): update the lock's tunnelChildPid so a later
          // acquireLock sees the reissued tunnel's child — not the original dead one.
          // childPid is a plain integer — not a secret.
          if (newTunnel.childPid !== undefined) {
            options.onTunnelChildPid?.(newTunnel.childPid);
          }
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
          // Wake open dashboard SSE clients immediately so the render gate
          // swaps the now-dead QR for the tunnel-down error state (issue #631).
          // Mirrors the onWssUrl path — without it the page shows a scannable
          // dead QR until the next periodic refresh push (up to 20s later).
          options.onTunnelDown?.();
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
    // Intoss-private dog-food relay (env 3) → relay-dev. env 4 removed (#665).
    relayOrigin: 'intoss-webview',
    // Local HTTP base of the Chii relay — used by AutoDevtoolsOpener to build
    // the self-hosted inspector URL. SECRET-HANDLING: not logged.
    relayHttpUrl: relay.baseUrl,
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
 * Boots the EXTERNAL relay family for env 2 (real-device PWA, issue #378).
 *
 * Unlike {@link bootRelayFamily}, this does NOT start a relay or a tunnel —
 * the unplugin (`tunnel: { cdp: true }`) already brought up a Chii relay for
 * the env-2 PWA and exposed its public base URL via `AIT_RELAY_BASE_URL`. Here
 * the MCP only opens a CDP client (`createRelayConnection`) against that
 * external relay. The relay's lifecycle is owned by the unplugin, so `stop()`
 * closes ONLY the CDP client — it must never tear down the relay or a tunnel
 * we did not start.
 *
 * `getTunnelStatus()` reports `up: true` with a `wssUrl` derived from
 * `relayBaseUrl` (http→ws, https→wss) so the `start_attach` gate
 * (`up: true && wssUrl !== null`) is satisfied even though we never opened a
 * cloudflared tunnel ourselves.
 *
 * SECRET-HANDLING: `relayBaseUrl` carries the relay host (same sensitivity as a
 * wss URL) — it is NEVER logged here. The caller validates presence and passes
 * the value straight to the CDP client.
 */
/**
 * Attempts to read the local loopback HTTP base URL of the env-2 Chii relay
 * (issue #530). Resolution order:
 *   1. `AIT_RELAY_LOCAL_URL` env var, if set and non-empty.
 *   2. `relayLocalUrl` from the `.ait_urls` file, if `projectRoot` is given.
 *   3. `undefined` — caller falls back to the tunnel base (existing behavior).
 *
 * This is a best-effort read — never throws. The returned value is a plain
 * `http://127.0.0.1:<port>` loopback URL; no secret exposure.
 */
export async function readRelayLocalUrl(
  env: NodeJS.ProcessEnv = process.env,
  projectRoot?: string,
): Promise<string | undefined> {
  const envValue = (env.AIT_RELAY_LOCAL_URL ?? '').trim();
  if (envValue !== '') return envValue;

  if (projectRoot !== undefined) {
    try {
      const { readRelayUrls } = await import('./relay-url-store.js');
      const stored = await readRelayUrls({ projectRoot });
      if (stored?.relayLocalUrl) return stored.relayLocalUrl;
    } catch {
      // Silent best-effort.
    }
  }
  return undefined;
}

export async function bootExternalRelayFamily(
  relayBaseUrl: string,
  relayLocalUrl?: string,
): Promise<BootedFamily> {
  // Relay-auth baseline (issue #250): the env-2 PWA relay is reachable over a
  // public `*.trycloudflare.com` tunnel (started by the unplugin). The Layer C
  // TOTP gate is what blocks a leaked tunnel URL, so a configured secret is
  // MANDATORY here too. The unplugin's relay reads the SAME `AIT_DEBUG_TOTP_SECRET`,
  // so this also fails fast when the operator forgot to set it. Fail before
  // opening the CDP client. SECRET-HANDLING: the guard never logs the value.
  assertRelayAuthConfigured();

  const connection = createRelayConnection(relayBaseUrl);
  // Derive the public wss URL from the relay base so start_attach's
  // `up && wssUrl !== null` gate passes. SECRET-HANDLING: not logged.
  const externalWss = relayBaseUrl.replace(/^http/, 'ws');
  const tunnelStatus = makeTunnelStatus(true, externalWss);
  return {
    connection,
    // External env-2 PWA relay → relay-mobile (distinct from relay-dev).
    relayOrigin: 'external-pwa',
    // HTTP base of the external relay — used as fallback for inspector URL.
    // For env-2 this is the cloudflare tunnel URL (https://<host>.trycloudflare.com).
    // SECRET-HANDLING: not logged.
    relayHttpUrl: relayBaseUrl,
    // LOCAL loopback base for inspector URL assembly (issue #530) — preferred
    // over relayHttpUrl when available so front_end + client WS stay local.
    // Safe to log: loopback URL contains no tunnel host.
    relayLocalHttpUrl: relayLocalUrl,
    getTunnelStatus: () => tunnelStatus,
    stop() {
      // The unplugin owns the relay + its tunnel — close ONLY our CDP client.
      connection.close();
    },
  };
}

/**
 * Identifies a booted family slot in the dual router (issue #378).
 *
 * Before #378 the router warm-kept a single "opposite-kind" lazy family, which
 * could not hold both an intoss relay (`relay-staging`) AND an external relay
 * (`relay-sandbox`) at once — they are both `kind: 'relay'` and would collide
 * in the single slot. The three keys separate the three distinct families (3
 * exposed modes → 3 physical slots, see {@link familyKeyForMode}).
 * `relay-live` removed (#665):
 *
 *   - `'local-browser'` — local Chromium + mock SDK (env 1).
 *   - `'relay-intoss'`  — intoss-private relay (env 3/4, `bootRelayFamily`).
 *   - `'relay-sandbox'` — env-2 external PWA relay (`bootExternalRelayFamily`).
 */
export type FamilyKey = 'local-browser' | 'relay-intoss' | 'relay-sandbox';

/**
 * Maps a `StartDebugMode` to the {@link FamilyKey} that serves it (issue #378).
 *   local-browser → 'local-browser'; relay-sandbox → 'relay-sandbox';
 *   relay-staging → 'relay-intoss' (the intoss-private relay slot).
 *   `relay-live` removed (#665).
 */
export function familyKeyForMode(mode: StartDebugMode): FamilyKey {
  switch (mode) {
    case 'local-browser':
      return 'local-browser';
    case 'relay-sandbox':
      return 'relay-sandbox';
    case 'relay-staging':
      return 'relay-intoss';
  }
}

/** The error thrown / surfaced when entering `mobile` without AIT_RELAY_BASE_URL. */
export const MOBILE_RELAY_BASE_URL_MISSING_MESSAGE =
  'start_debug(mobile): AIT_RELAY_BASE_URL이 설정되지 않았습니다. ' +
  'dev 서버가 tunnel:{cdp:true}로 기동 중이면 .ait_urls 파일이 자동 생성돼 있어야 합니다. ' +
  '자동 발견이 되지 않을 경우 relay base URL을 AIT_RELAY_BASE_URL 환경변수로 직접 전달하세요. ' +
  '환경 2(실기기 PWA) 진입은 외부 relay base가 필요합니다.';

/**
 * Reads the env-2 relay base URL for the `mobile` boot site (issue #378, #424).
 *
 * Resolution order (env wins — file is the fallback):
 *   1. `env.AIT_RELAY_BASE_URL` set and non-empty → return it (operator override).
 *   2. `projectRoot` given → read `<nearest package.json dir>/.ait_urls`;
 *      if `relayBaseUrl` is present → return it (auto-discovered from dev server).
 *   3. Neither → throw {@link MOBILE_RELAY_BASE_URL_MISSING_MESSAGE}.
 *
 * SECRET-HANDLING: `AIT_RELAY_BASE_URL` and the file-discovered value carry the
 * relay host. On the missing path the thrown message names the env var and notes
 * that the dev server auto-publishes it — it NEVER echoes any URL value. The
 * present value is returned to the caller (the CDP client) but never logged.
 */
export async function readMobileRelayBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
  projectRoot?: string,
): Promise<string> {
  // 1. Env wins — operator override.
  const raw = env.AIT_RELAY_BASE_URL;
  const envValue = typeof raw === 'string' ? raw.trim() : '';
  if (envValue !== '') {
    return envValue;
  }

  // 2. File fallback — auto-discovered from dev server (#424).
  if (projectRoot !== undefined) {
    const { readRelayUrls } = await import('./relay-url-store.js');
    const stored = await readRelayUrls({ projectRoot });
    if (stored?.relayBaseUrl !== undefined) {
      return stored.relayBaseUrl;
    }
  }

  // 3. Neither source — throw the precise guidance message.
  throw new Error(MOBILE_RELAY_BASE_URL_MISSING_MESSAGE);
}

/**
 * Options the dual router needs to re-arm the attach watcher and auto-open
 * DevTools after a swap (issues #348, #356, #378, #396).
 *
 * All-lazy (#396): NO family is booted at startup — every family boots lazily on
 * its first `start_debug` via `bootLazyFor(key)`. This routes EVERY relay boot
 * through `switchMode` (which runs `loadRelaySecretReadOnly` first), closing the
 * gap where an eager startup boot bypassed the project-local secret load. The
 * router is direction-neutral (#356): any of the three families can be the first
 * one booted, so a session can hot-switch in any direction without a restart.
 */
export interface DualRouterDeps {
  /**
   * Lazy boot for the family identified by `key` — called at most once per key,
   * on the first `start_debug` whose family key has not yet been booted (issue
   * #378 — keyed so an intoss relay and an external relay can be warm-kept
   * simultaneously). Since #396 NO family is booted eagerly, so this boots the
   * family for ANY of the three FamilyKey values on first use.
   *
   * `projectRoot` is threaded from the per-session `start_debug` call (#424) so
   * `relay-sandbox` boot can fall back to the `.ait_urls` file discovery when
   * `AIT_RELAY_BASE_URL` is not set.
   */
  bootLazyFor: (key: FamilyKey, projectRoot?: string) => Promise<BootedFamily>;
  /**
   * Reads the current relay base URL for the `relay-sandbox` family (issue #610).
   *
   * Called on every `relay-sandbox` re-entry when a warm family is already
   * cached — the result is compared against the cached family's `relayHttpUrl`.
   * When they differ the stale family is torn down and a fresh one is booted.
   * When they match the warm family is reused (no unnecessary teardown).
   *
   * Returns `null` on any failure (missing file, missing env var) — the caller
   * keeps the warm family on null (fail-open: better a stale connection than a
   * surprise disconnect).
   *
   * SECRET-HANDLING: the returned URL carries the relay host. Callers MUST NOT
   * log it. Only boolean same/different is safe to surface.
   *
   * Production: injected by the run functions as
   * `(pr) => readMobileRelayBaseUrl(process.env, pr).catch(() => null)`.
   * Tests inject a controlled function.
   */
  readSandboxRelayUrl?: (projectRoot?: string) => Promise<string | null>;
  /** Diagnostics collector (re-armed watcher records attach there). */
  diagnosticsCollector: DiagnosticsCollector;
  /** Auto-opens Chrome DevTools on the first relay attach (env 3/4 only). */
  devtoolsOpener: AutoDevtoolsOpener;
  /** Attach-watcher poll interval (ms). Default 1 000. */
  attachWatcherIntervalMs?: number;
  /**
   * Called on every non-empty target-signature change (first attach, target
   * replacement, or re-attach after detach). Used by run functions to push a
   * dashboard SSE notification so open browser tabs receive fresh target id
   * and TOTP links (issue #509).
   */
  onPageAttach?: () => void;
  /**
   * Returns the stable `/inspector` URL from the QR HTTP server (issue #530).
   * Called by `armWatcher` to pass to `AutoDevtoolsOpener.open()` so it can
   * open the secret-free stable URL instead of building a direct TOTP URL.
   * Returns null if the QR server is not yet started.
   */
  getInspectorStableUrl?: () => string | null;
}

/**
 * Sentinel connection returned by {@link DualConnectionRouter.active} before the
 * first `start_debug` boots a family (all-lazy, issue #396). It satisfies the
 * full {@link CdpConnection} interface but holds nothing: `listTargets()` is
 * empty, every command rejects with a clear "call start_debug first" message,
 * and all event/teardown members are safe no-ops. Callers that read tools before
 * any switchMode therefore get an honest empty/down state instead of an NPE.
 */
const NULL_CDP_CONNECTION: CdpConnection = {
  kind: 'local',
  enableDomains: () => Promise.resolve(),
  listTargets: () => [],
  getBufferedEvents: () => [],
  on: () => () => {},
  send: () => Promise.reject(new Error('no family booted yet — call start_debug first')),
  close: () => {},
};

/**
 * Production `ConnectionRouter` (issues #348, #356, #378 — DUAL-CONNECTION-COEXIST).
 *
 * Holds a keyed set of lazily-booted families ({@link FamilyKey} →
 * `BootedFamily`, issue #378) with NO family active at startup (issue #396); the
 * first `start_debug` boots and activates one. Plus an `active` pointer and the
 * single attach watcher armed on the active connection. The router is
 * **direction-neutral** (#356): any family can be the first one booted, so a
 * `--target=local` session can hot-switch into relay (and vice versa) without
 * restarting the MCP server.
 *
 * Why a KEYED map and not a single lazy slot (#378): `relay-sandbox` (env-2
 * external relay) and `relay-staging` (intoss relay) are BOTH `kind: 'relay'`.
 * A single "opposite-kind" slot could not warm-keep both at once — they would
 * collide. The three `FamilyKey`s (`local-browser` / `relay-intoss` /
 * `relay-sandbox`) give each its own warm slot. `relay-live` (env 4) removed
 * (#665) — `relay-intoss` slot now maps only to `relay-staging`.
 *
 * Why all-lazy (#396): the relay TOTP secret now lives in a project-local
 * `.ait_relay` file loaded read-only by `switchMode` BEFORE a relay family boots.
 * Booting any family eagerly at startup would bypass that load. With NO eager
 * boot every relay boot flows through `switchMode → loadRelaySecretReadOnly`, so
 * the secret is always populated before `assertRelayAuthConfigured()` /
 * `buildRelayVerifyAuth()` run at the boot site.
 *
 * `switchMode`:
 *   1. rejects re-entrant swaps (`swapInFlight`);
 *   2. resolves the requested mode's `FamilyKey`:
 *      `lazyFamilies.get(key) ?? (boot via bootLazyFor(key), store)`;
 *   3. flips `active` (the MCP `Server` never re-handshakes — it reads through
 *      `active` per request);
 *   4. stops the old attach watcher and re-arms one on the new connection
 *      (the watcher self-clears, so re-arm is mandatory);
 *   5. emits `tools/list_changed`.
 *
 * Inactive infra is left WARM — teardown happens only at process exit (the
 * unified shutdown in the run functions), which is what keeps a phone attach
 * alive across a local→relay→local round trip.
 */
export class DualConnectionRouter implements ConnectionRouter {
  private readonly deps: DualRouterDeps;
  /** Families, booted lazily and warm-kept per {@link FamilyKey} (#378, #396). */
  private readonly lazyFamilies = new Map<FamilyKey, BootedFamily>();
  /** `null` until the first `start_debug` boots a family (all-lazy, #396). */
  private activeFamily: BootedFamily | null = null;
  private server: Server | null = null;
  private attachWatcher: { stop(): void } | null = null;
  private swapInFlight = false;

  constructor(deps: DualRouterDeps) {
    this.deps = deps;
  }

  get active(): CdpConnection {
    return this.activeFamily ? this.activeFamily.connection : NULL_CDP_CONNECTION;
  }

  /** Relay origin of the currently-active family (issue #378). */
  get activeRelayOrigin(): RelayOrigin | undefined {
    return this.activeFamily?.relayOrigin;
  }

  /**
   * HTTP base URL of the Chii relay to use for inspector URL assembly (#503,
   * #530). Prefers the LOCAL loopback base (`relayLocalHttpUrl`) when available
   * so front_end page load + client WS do not traverse a cloudflare tunnel —
   * falls back to `relayHttpUrl` (the tunnel base for env-2, loopback for env-3/4)
   * when not set. Returns `undefined` when no relay family is active.
   *
   * SECRET-HANDLING: when relayLocalHttpUrl is absent this falls back to
   * relayHttpUrl which may carry the tunnel host — callers must not log it.
   */
  get activeRelayHttpUrl(): string | undefined {
    if (!this.activeFamily) return undefined;
    return this.activeFamily.relayLocalHttpUrl ?? this.activeFamily.relayHttpUrl;
  }

  /** Every booted family (for unified shutdown). All families are lazy (#396). */
  bootedFamilies(): BootedFamily[] {
    return [...this.lazyFamilies.values()];
  }

  /**
   * Live tunnel status of the active relay family (issues #356, #378). Reads
   * the ACTIVE family's tunnel when it has one (so `relay-sandbox` surfaces the
   * external relay wss and `relay-staging` the intoss relay wss); otherwise
   * falls back to the first booted family that has a tunnel. Returns "down"
   * until any relay family is booted (any session before the first relay
   * start_debug) — the correct signal for `start_attach` (no tunnel yet).
   */
  relayTunnelStatus(): TunnelStatus {
    if (this.activeFamily?.getTunnelStatus) return this.activeFamily.getTunnelStatus();
    for (const family of this.bootedFamilies()) {
      if (family.getTunnelStatus) return family.getTunnelStatus();
    }
    return { up: false, wssUrl: null };
  }

  /**
   * Binds the MCP `Server`; the attach watcher is armed by the first
   * `start_debug` since no family is active at startup (all-lazy, #396). Called
   * once after `createDebugServer` + `connect`.
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
    // No family active yet (all-lazy, #396) — nothing to watch until the first
    // `start_debug` boots one and re-arms the watcher.
    const activeFamily = this.activeFamily;
    if (!activeFamily) return;
    this.attachWatcher = startAttachWatcher(
      activeFamily.connection,
      server,
      this.deps.attachWatcherIntervalMs ?? 1_000,
      () => {
        this.deps.diagnosticsCollector.recordAttach();
        // Notify dashboard of page attach — SSE push so the browser tab updates.
        this.deps.onPageAttach?.();
        // Auto-open Chii DevTools only for a relay attach (env 2/3/4). The
        // opener no-ops for a local (mock) connection — guard on the active
        // kind so a local session never tries to open a relay devtools.
        // AutoDevtoolsOpener._opened is a once-per-session guard, so repeat
        // fires (target replacement) do not open an extra browser window.
        if (activeFamily.connection.kind === 'relay') {
          // Take the first attached target's id — we are in the onAttach
          // callback, so listTargets() is guaranteed to be non-empty.
          const firstTarget = activeFamily.connection.listTargets()[0];
          const env = deriveEnvironment(activeFamily.connection.kind, activeFamily.relayOrigin);
          // Prefer the stable /inspector URL (issue #530): secret-free, no
          // expiry race. Falls back to the direct URL path when qrServer is
          // not yet available (should not happen in practice).
          const inspectorStableUrl = this.deps.getInspectorStableUrl?.() ?? null;
          this.deps.devtoolsOpener.open({
            inspectorStableUrl,
            relayHttpBaseUrl: activeFamily.relayHttpUrl,
            targetId: firstTarget?.id,
            // Mint a fresh TOTP code from the daemon's secret at open time.
            // The relay gate accepts ±RELAY_VERIFY_SKEW_STEPS=6 steps (~3 min).
            // SECRET-HANDLING: the closure captures only the getter, never logs.
            // Only used when inspectorStableUrl is absent (legacy path).
            mintTotp: process.env.AIT_DEBUG_TOTP_SECRET
              ? () => generateTotp(process.env.AIT_DEBUG_TOTP_SECRET as string)
              : undefined,
            env,
          });
        }
      },
    );
  }

  /**
   * Resolves the `BootedFamily` for `key`: the warm family if already booted,
   * otherwise boots it via `bootLazyFor(key, projectRoot)` and stores it (once
   * per key). Since #396 every family is lazy, so this is the single boot path
   * for all three keys.
   *
   * `projectRoot` is forwarded to `bootLazyFor` so `relay-sandbox` boot can
   * fall back to `.ait_urls` file discovery (#424) when `AIT_RELAY_BASE_URL` is
   * not set in the environment.
   *
   * **Relay-sandbox stale-URL rebuild (issue #610):** when the `relay-sandbox`
   * family is already warm, reads the current relay URL via
   * `deps.readSandboxRelayUrl` and compares it against the cached
   * `relayHttpUrl`. If they differ (dev server was restarted → new tunnel),
   * the stale family is torn down, evicted from the map, and a fresh one is
   * booted. If they match, or if the URL cannot be read, the warm family is
   * reused (fail-open — no unnecessary teardown on transient read errors).
   *
   * SECRET-HANDLING: fresh and cached relay URLs carry the tunnel host. The
   * comparison result (same/different) is the only thing surfaced — URLs are
   * never logged.
   */
  private async familyFor(key: FamilyKey, projectRoot?: string): Promise<BootedFamily> {
    const warm = this.lazyFamilies.get(key);
    if (warm) {
      // (#610) relay-sandbox re-entry: check whether the relay host has rotated.
      // env-2 relay is owned by the dev server (unplugin), so every `dev:phone:cdp`
      // restart produces a new quick-tunnel URL. If the cached family still points
      // at the old tunnel, teardown and rebuild with the fresh URL.
      if (key === 'relay-sandbox' && this.deps.readSandboxRelayUrl !== undefined) {
        let freshUrl: string | null = null;
        try {
          freshUrl = await this.deps.readSandboxRelayUrl(projectRoot);
        } catch {
          // Treat any read error as "URL unchanged" — fail-open to avoid
          // dropping a working connection on a transient FS error.
          freshUrl = null;
        }
        // SECRET-HANDLING: only compare; never log the URL values.
        const changed = freshUrl !== null && freshUrl !== warm.relayHttpUrl;
        if (changed) {
          // Stale relay: close only the CDP client (the unplugin owns the relay
          // + tunnel — exactly what bootExternalRelayFamily's stop() does).
          warm.stop();
          this.lazyFamilies.delete(key);
          const booted = await this.deps.bootLazyFor(key, projectRoot);
          this.lazyFamilies.set(key, booted);
          return booted;
        }
      }
      return warm;
    }
    const booted = await this.deps.bootLazyFor(key, projectRoot);
    this.lazyFamilies.set(key, booted);
    return booted;
  }

  async switchMode(mode: StartDebugMode, projectRoot?: string): Promise<ModeSwitchReport> {
    if (this.swapInFlight) {
      throw new Error('start_debug: 이전 전환이 아직 진행 중입니다 — 잠시 후 다시 호출하세요.');
    }
    // relay-live (env 4) removed (#665) — confirm parameter and gate gone.

    this.swapInFlight = true;
    try {
      // (1) Project-local relay secret load (issue #396). When entering a relay
      // family, read the relay TOTP secret read-only from
      // <projectRoot>/.ait_relay into process.env BEFORE the relay boots, so the
      // lazy boot's assertRelayAuthConfigured() + buildRelayVerifyAuth() (both
      // read env at the boot site) see it. The daemon NEVER mints — a missing or
      // invalid file leaves env untouched and the boot-site assert remains the
      // single #250 fail-fast. Local switches need no secret, so skip the load.
      // SECRET-HANDLING: loadRelaySecretReadOnly never logs the value or path.
      if (isRelayMode(mode)) {
        await loadRelaySecretReadOnly({ projectRoot });
      }

      // (2) Resolve the family by key (#378). `bootLazyFor` may throw (e.g.
      // mobile without AIT_RELAY_BASE_URL / .ait_urls) — let it propagate
      // WITHOUT flipping active, so a failed entry leaves state untouched.
      // Pass projectRoot so relay-sandbox boot can discover the relay URL from
      // .ait_urls (#424).
      const target = await this.familyFor(familyKeyForMode(mode), projectRoot);

      // (3) Flip the active pointer. The MCP Server reads through `active` per
      // request, so no re-handshake / restart is needed.
      this.activeFamily = target;

      // (4) Re-arm the attach watcher on the new connection (self-clearing).
      this.stopWatcher();
      this.armWatcher();

      // (5) Tell the MCP host the tool surface may have changed (env flip).
      void this.server?.sendToolListChanged();

      const wantRelay = isRelayMode(mode);
      const environment = deriveEnvironment(target.connection.kind, target.relayOrigin);
      return {
        mode,
        environment,
        kind: target.connection.kind,
        nextStep: wantRelay
          ? 'start_attach로 attach QR 생성 + 폰 attach까지 한 번에 진행하세요 (relay 세션).'
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

  // Dual-connection router (issues #348, #356, #378, #396): ALL families are
  // lazy-booted on the first matching `start_debug`. Nothing boots at startup —
  // every relay boot flows through `switchMode → loadRelaySecretReadOnly` first,
  // so the project-local `.ait_relay` secret is always loaded before the relay
  // boot's assertRelayAuthConfigured() / buildRelayVerifyAuth() read the env.
  const devtoolsOpener = new AutoDevtoolsOpener();
  // Diagnostics collector — records server-side errors and attach/detach events
  // so `get_debug_status` can surface them in a single call.
  const diagnosticsCollector = new InMemoryDiagnosticsCollector();

  // FIX (issue #572 review): track the live cloudflared child PID in memory so
  // get_debug_status can pass it to getDiagnostics as source (a). Updated by
  // onTunnelChildPid on initial boot and on every reissue.
  let activeTunnelChildPid: number | null = null;

  const router = new DualConnectionRouter({
    // Lazy resolver for all three family slots (#378, #396, #424).
    // SECRET-HANDLING: readMobileRelayBaseUrl reads AIT_RELAY_BASE_URL (or .ait_urls
    // fallback) only here, at the mobile boot site, and never logs its value.
    // verifyAuth is built INSIDE the lambda (lazily, at the relay boot site) so it
    // reads the env AFTER switchMode's project-local secret load (#396) has
    // populated AIT_DEBUG_TOTP_SECRET — never captured at server startup.
    bootLazyFor: async (key, projectRoot) =>
      key === 'relay-sandbox'
        ? bootExternalRelayFamily(
            await readMobileRelayBaseUrl(process.env, projectRoot),
            await readRelayLocalUrl(process.env, projectRoot),
          )
        : key === 'local-browser'
          ? bootLocalFamily()
          : bootRelayFamily({
              relayPort: options.relayPort,
              verifyAuth: buildRelayVerifyAuth(),
              // Mirror the assigned tunnel URL into the lock file so a second
              // caller sees the correct wssUrl in the conflict error message, and
              // notify the dashboard SSE clients of the tunnel URL change.
              onWssUrl: (wssUrl) => {
                lockHandle.updateWssUrl(wssUrl);
                qrServer?.notifyStateChange();
              },
              // FIX 3 (issue #571): persist the cloudflared child PID in the
              // lock file so a subsequent acquireLock can detect zombie daemons.
              // Also update the in-memory tracker (source a for FIX 2).
              onTunnelChildPid: (pid) => {
                activeTunnelChildPid = pid;
                lockHandle.updateTunnelChildPid(pid);
              },
              // Issue #467: count relay TOTP 401s (secret-free) so
              // get_debug_status can distinguish "phone never arrived" from
              // "phone arrived but was rejected".
              onAuthReject: () => diagnosticsCollector.recordAuthReject(),
              // Issue #631: on permanent tunnel drop, immediately push the
              // new state so the dashboard swaps the dead QR for the error
              // state (mirror of onWssUrl's notifyStateChange).
              onTunnelDown: () => qrServer?.notifyStateChange(),
            }),
    diagnosticsCollector,
    devtoolsOpener,
    onPageAttach: () => qrServer?.notifyStateChange(),
    // Stable /inspector URL for auto-open (issue #530). qrServer is set after
    // the router is created but before armWatcher fires, so the closure safely
    // captures it by reference.
    getInspectorStableUrl: () => qrServer?.inspectorStableUrl ?? null,
    // (#610) Stale relay-sandbox rebuild: re-read the relay URL on every
    // relay-sandbox re-entry so the router can detect when the dev server was
    // restarted (new quick-tunnel) and rebuild the CDP client accordingly.
    // SECRET-HANDLING: readMobileRelayBaseUrl never logs the URL value.
    readSandboxRelayUrl: (pr) => readMobileRelayBaseUrl(process.env, pr).catch(() => null),
  });

  // AIT.* methods ride the *active* connection's command channel (relay Chii or
  // local CDP), so the AIT source follows `start_debug` swaps.
  const aitSource = new RoutingAitSource(() => {
    const active = router.active as CdpConnection & {
      sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
    };
    return active;
  });

  // dashboard용 lastAttachParts 상태 — start_attach 호출마다 갱신.
  // 완성 URL 대신 컴포넌트를 저장해 getDashboardState 호출마다 fresh TOTP를 mint (Defect 1).
  // SECRET-HANDLING: 컴포넌트에는 tunnel/scheme host가 있으므로 로그 출력 금지.
  let lastAttachParts: AttachUrlParts | null = null;

  // getDashboardState 클로저 — qr-http-server dashboard에 현재 상태 전달.
  // rebuildAttachUrl()로 매 호출마다 최신 TOTP 코드를 mint한 URL을 생성한다 (Defect 1).
  // inspectorUrl은 안정 /inspector URL(issue #530) — 시크릿 없으므로 출력 가능.
  const getDashboardState = (): DashboardState => {
    const targets = router.active.listTargets();
    // inspectorUrl — /inspector 안정 진입점 (issue #530).
    // qrServer가 아직 없으면 null(초기화 직후 race). qrServer가 생기면 항상 안정 URL.
    // 클릭 시점에 TOTP를 mint하고 302 redirect하므로 stale 문제가 없다.
    // SECRET-HANDLING: /inspector URL 자체에 시크릿 없음 — 출력 가능.
    const inspectorUrl = qrServer?.inspectorStableUrl ?? null;
    return {
      tunnel: { up: router.relayTunnelStatus().up, wssUrl: router.relayTunnelStatus().wssUrl },
      pages: targets.map((t) => ({ id: t.id, url: t.url })),
      attachUrl: lastAttachParts ? rebuildAttachUrl(lastAttachParts) : null,
      inspectorUrl,
      // 현재 active connection에서 매 호출마다 파생한 env — /attach 카피·환경 라벨
      // 분기(#468). start_debug family swap을 따라가도록 저장하지 않고 파생한다.
      mode: deriveEnvironment(router.active.kind, router.activeRelayOrigin),
    };
  };

  // getDirectInspectorUrl — /inspector 라우트에서 직접 chii front_end URL을 조립.
  // getDashboardState().inspectorUrl(= /inspector 자기 자신)을 쓰면 무한 루프가 발생하므로
  // 별도 getter로 분리한다. 매 요청마다 호출되어 TOTP를 요청 시점에 mint한다.
  // SECRET-HANDLING: ok:true url에 relay host + at= 코드가 담긴다 — 로그/stdout 출력 금지.
  const getDirectInspectorUrl = (): ReturnType<
    NonNullable<QrHttpServerOptions['getDirectInspectorUrl']>
  > => {
    const relayHttpUrl = router.activeRelayHttpUrl;
    if (!relayHttpUrl) {
      return { ok: false, reason: 'relayDown' };
    }
    const targets = router.active.listTargets();
    if (targets.length === 0) {
      return { ok: false, reason: 'noTarget' };
    }
    const totpSecret = process.env.AIT_DEBUG_TOTP_SECRET;
    if (!totpSecret) {
      return { ok: false, reason: 'totpUnavailable' };
    }
    const url = buildChiiInspectorUrl(relayHttpUrl, targets[0].id, () =>
      generateTotp(totpSecret, Date.now()),
    );
    if (url === null) {
      return { ok: false, reason: 'totpUnavailable' };
    }
    return { ok: true, url };
  };

  // 로컬 QR HTTP 서버를 await로 시작 — start_attach 첫 호출이 qrHttpServer 확인 전에
  // 도달하는 race를 없애기 위해 cloudflared(fire-and-forget)와 달리 동기 await 사용.
  // GUI 없는 환경에서는 startQrHttpServer가 실패해도 text QR fallback으로 동작한다.
  let qrServer: QrHttpServer | undefined;
  try {
    qrServer = await startQrHttpServer(getDashboardState, { getDirectInspectorUrl });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logWarn('server.start', { msg: `QR HTTP 서버 시작 실패 (text QR fallback 사용): ${message}` });
  }

  // TOTP 주기 갱신 타이머 — 이벤트 없이 페이지가 방치될 때 at= 코드가 stale되는 갭 수정 (#445).
  // TOTP step은 30초이므로 20초 주기로 push해 step 경계를 놓치지 않는다.
  // SECRET-HANDLING: 콜백은 단순 trigger만 — TOTP 값·at= 코드는 절대 로그/stdout에 출력 금지.
  const TOTP_REFRESH_INTERVAL_MS = 20_000;
  let totpRefreshHandle: ReturnType<typeof setInterval> | null = null;
  totpRefreshHandle = setInterval(() => {
    if (lastAttachParts !== null) {
      qrServer?.notifyStateChange();
    }
  }, TOTP_REFRESH_INTERVAL_MS);
  totpRefreshHandle.unref();

  const server = createDebugServer({
    // `connection` is still required by the deps shape; the router overrides
    // which connection the handlers actually read (NULL until the first switch).
    connection: router.active,
    router,
    aitSource,
    // Tunnel status follows the active relay family once one is lazy-booted (#356).
    getTunnelStatus: () => router.relayTunnelStatus(),
    // FIX (issue #572 review): expose the live cloudflared child PID (source a)
    // so get_debug_status can feed it into getDiagnostics for the FIX 2 probe.
    getTunnelChildPid: () => activeTunnelChildPid,
    get qrHttpServer() {
      return qrServer;
    },
    diagnosticsCollector,
    // SECRET-HANDLING: the TOTP secret is read from env AT CALL TIME (inside
    // start_attach) so the project-local .ait_relay secret loaded by
    // switchMode (#396) is visible. It is used only to generate the at= code and
    // is never logged or surfaced in any output.
    getTotpSecret: () => process.env.AIT_DEBUG_TOTP_SECRET,
    // dashboard 갱신 콜백 — URL 컴포넌트 저장 후 SSE push.
    // 컴포넌트를 저장해 getDashboardState가 fresh TOTP로 URL을 재빌드 (Defect 1).
    onAttachUrlBuilt: (parts) => {
      lastAttachParts = parts;
      qrServer?.notifyStateChange();
    },
  });

  const transport = new StdioServerTransport();

  // ---------------------------------------------------------------------------
  // Unified dual-family shutdown (issues #348, #356, #396): tears down every
  // family ever booted at process exit (all are lazy now — relay + tunnel +
  // health probe + every booted connection, plus a lazily-booted local
  // Chromium). Each family's `stop()` owns its own infra teardown — the relay
  // family stops its tunnel + probe, the local family kills its Chromium.
  // Inactive infra is left warm during the session and only collected here —
  // that is what preserves a warm attach across `start_debug` swaps.
  //
  // SIGKILL cannot be intercepted — cloudflared may remain orphaned (PPID 1).
  // Port 0 makes such orphans harmless: the next startup gets a fresh port.
  // Manual cleanup if needed: `pkill -f 'cloudflared.*trycloudflare'`
  // ---------------------------------------------------------------------------

  let closed = false;
  let parentWatcher: { stop(): void } | null = null;
  let maxAgeWatchdog: { stop(): void } | null = null;

  const shutdown = () => {
    // Idempotent: multiple simultaneous signals/exit/uncaught calls run only once.
    if (closed) return;
    closed = true;

    parentWatcher?.stop();
    maxAgeWatchdog?.stop();
    if (totpRefreshHandle) clearInterval(totpRefreshHandle);
    router.stopWatcher();
    // Tear down every booted family (all lazy, #396 — only those ever started).
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
      maxAgeWatchdog?.stop();
      if (totpRefreshHandle) clearInterval(totpRefreshHandle);
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

  // Bind the server to the router. No family is active yet (all-lazy, #396) —
  // the attach watcher is armed by the first `start_debug` and re-armed on every
  // swap.
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

  // FIX 4 (issue #571): max-age watchdog — self-terminate after a configured
  // maximum lifetime. cloudflared quick-tunnel lifetimes are finite; a daemon
  // that outlives its tunnel will silently fail. Default 6 hours.
  //
  // AIT_DEBUG_NO_MAX_AGE=1 disables the watchdog — useful for long-running
  // manual debug sessions or process-manager environments.
  // AIT_DEBUG_MAX_AGE_MS=<ms> overrides the default 6-hour cap.
  if (process.env.AIT_DEBUG_NO_MAX_AGE !== '1') {
    const maxAgeMs = process.env.AIT_DEBUG_MAX_AGE_MS
      ? Number.parseInt(process.env.AIT_DEBUG_MAX_AGE_MS, 10) || undefined
      : undefined;
    maxAgeWatchdog = startMaxAgeWatchdog(
      () => {
        process.stderr.write(
          '[ait-debug] max-age watchdog: daemon lifetime exceeded — shutting down for a fresh start.\n',
        );
        shutdown();
        process.exit(0);
      },
      { maxAgeMs },
    );
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
 * Serves the debug stack over stdio with the local browser as the default
 * target. Since #396 NOTHING boots at startup — every family (including the
 * local Chromium) is lazy-booted on its first `start_debug`:
 *   1. `start_debug({ mode: 'local-browser' })` launches a local Chromium with
 *      `--remote-debugging-port=<port>` and attaches a `LocalCdpConnection`;
 *   2. the intoss/external relay families lazy-boot on the first
 *      `start_debug({ mode: 'relay-staging' | 'relay-sandbox' })` (#665: relay-live removed);
 *   3. all of this runs through the SAME direction-neutral
 *      `DualConnectionRouter` that `runDebugServer` uses (issue #356).
 *
 * Symmetry with `runDebugServer` (#356): starting with `--target=local` no
 * longer pins a single-connection router. A `--target=local` session can
 * hot-switch into relay (env 1 → env 3) without restarting the MCP server,
 * closing the asymmetry where only the default (relay-target) entry point had
 * bidirectional hot-switch. The intended fidelity-ladder flow — "validate in
 * env 1 (local), then env 3 (intoss-private) in ONE session, no restart" — now
 * works from either entry point.
 *
 * `start_attach` (relay-specific) stays effectively hidden / non-applicable
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

  // Local family boot, deferred into the lazy resolver (all-lazy, #396). Launches
  // the Chromium + attaches a LocalCdpConnection only when `start_debug({ mode:
  // 'local-browser' })` first fires — so a session that goes straight to relay never
  // spawns a Chromium it would have to clean up. Honors this entry's
  // cdpPort/devUrl options (vs the env-only `bootLocalFamily`).
  const bootLocalFamilyForEntry = async (): Promise<BootedFamily> => {
    const chromium = await launchChromium({ port: cdpPort, devUrl });
    // Give Chromium a moment to start the CDP endpoint before we connect.
    // 800 ms is enough on most machines; the connection retries if it fails.
    await new Promise<void>((r) => setTimeout(r, 800));
    const localConnection = new LocalCdpConnection({ devtoolsHttpUrl: chromium.devtoolsUrl });
    return {
      connection: localConnection,
      stop() {
        localConnection.close();
        chromium.stop();
      },
    };
  };

  // Dual-connection router (issues #348, #356, #378, #396): ALL families are
  // lazy-booted — the local family on the first `start_debug({ mode: 'local-browser' })`,
  // the intoss relay on `relay-staging`, the env-2 external relay on `relay-sandbox`.
  // `relay-live` removed (#665).
  const devtoolsOpener = new AutoDevtoolsOpener();
  const diagnosticsCollector = new InMemoryDiagnosticsCollector();

  // FIX (issue #572 review): track the live cloudflared child PID in memory so
  // get_debug_status can pass it to getDiagnostics as source (a). Updated by
  // onTunnelChildPid on initial boot and on every reissue.
  let activeTunnelChildPid: number | null = null;

  const router = new DualConnectionRouter({
    // Lazy resolver for all three family slots (#378, #396, #424).
    // SECRET-HANDLING: readMobileRelayBaseUrl reads AIT_RELAY_BASE_URL (or .ait_urls
    // fallback) only here, at the mobile boot site, and never logs its value.
    // verifyAuth is built INSIDE the lambda (lazily, at the relay boot site) so it
    // reads the env AFTER switchMode's project-local secret load (#396) has
    // populated AIT_DEBUG_TOTP_SECRET — never captured at server startup.
    bootLazyFor: async (key, projectRoot) =>
      key === 'relay-sandbox'
        ? bootExternalRelayFamily(
            await readMobileRelayBaseUrl(process.env, projectRoot),
            await readRelayLocalUrl(process.env, projectRoot),
          )
        : key === 'local-browser'
          ? bootLocalFamilyForEntry()
          : bootRelayFamily({
              verifyAuth: buildRelayVerifyAuth(),
              onWssUrl: (wssUrl) => {
                lockHandle.updateWssUrl(wssUrl);
                qrServer?.notifyStateChange();
              },
              // FIX 3 (issue #571): persist cloudflared child PID for zombie detection.
              // Also update the in-memory tracker (source a for FIX 2).
              onTunnelChildPid: (pid) => {
                activeTunnelChildPid = pid;
                lockHandle.updateTunnelChildPid(pid);
              },
              // Issue #467: secret-free relay TOTP 401 counter for get_debug_status.
              onAuthReject: () => diagnosticsCollector.recordAuthReject(),
              // Issue #631: on permanent tunnel drop, immediately push the
              // new state so the dashboard swaps the dead QR for the error
              // state (mirror of onWssUrl's notifyStateChange).
              onTunnelDown: () => qrServer?.notifyStateChange(),
            }),
    diagnosticsCollector,
    devtoolsOpener,
    onPageAttach: () => qrServer?.notifyStateChange(),
    // Stable /inspector URL for auto-open (issue #530).
    getInspectorStableUrl: () => qrServer?.inspectorStableUrl ?? null,
    // (#610) Stale relay-sandbox rebuild: re-read the relay URL on every
    // relay-sandbox re-entry so the router can detect when the dev server was
    // restarted (new quick-tunnel) and rebuild the CDP client accordingly.
    // SECRET-HANDLING: readMobileRelayBaseUrl never logs the URL value.
    readSandboxRelayUrl: (pr) => readMobileRelayBaseUrl(process.env, pr).catch(() => null),
  });

  // AIT.* methods ride the *active* connection's command channel (local CDP or,
  // after a relay switch, relay Chii), so the AIT source follows swaps.
  const aitSource = new RoutingAitSource(() => {
    const active = router.active as CdpConnection & {
      sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
    };
    return active;
  });

  // dashboard용 lastAttachParts 상태 — start_attach 호출마다 갱신.
  // 완성 URL 대신 컴포넌트를 저장해 getDashboardState 호출마다 fresh TOTP를 mint (Defect 1).
  // SECRET-HANDLING: 컴포넌트에는 tunnel/scheme host가 있으므로 로그 출력 금지.
  let lastAttachParts: AttachUrlParts | null = null;

  const getDashboardState = (): DashboardState => {
    const targets = router.active.listTargets();
    // inspectorUrl — /inspector 안정 진입점 (issue #530).
    // SECRET-HANDLING: /inspector URL 자체에 시크릿 없음 — 출력 가능.
    const inspectorUrl = qrServer?.inspectorStableUrl ?? null;
    return {
      tunnel: { up: router.relayTunnelStatus().up, wssUrl: router.relayTunnelStatus().wssUrl },
      pages: targets.map((t) => ({ id: t.id, url: t.url })),
      attachUrl: lastAttachParts ? rebuildAttachUrl(lastAttachParts) : null,
      inspectorUrl,
    };
  };

  // getDirectInspectorUrl — /inspector 라우트에서 직접 chii front_end URL을 조립.
  // getDashboardState().inspectorUrl(= /inspector 자기 자신)을 쓰면 무한 루프가 발생하므로
  // 별도 getter로 분리한다. 매 요청마다 호출되어 TOTP를 요청 시점에 mint한다.
  // SECRET-HANDLING: ok:true url에 relay host + at= 코드가 담긴다 — 로그/stdout 출력 금지.
  const getDirectInspectorUrl = (): ReturnType<
    NonNullable<QrHttpServerOptions['getDirectInspectorUrl']>
  > => {
    const relayHttpUrl = router.activeRelayHttpUrl;
    if (!relayHttpUrl) {
      return { ok: false, reason: 'relayDown' };
    }
    const targets = router.active.listTargets();
    if (targets.length === 0) {
      return { ok: false, reason: 'noTarget' };
    }
    const totpSecret = process.env.AIT_DEBUG_TOTP_SECRET;
    if (!totpSecret) {
      return { ok: false, reason: 'totpUnavailable' };
    }
    const url = buildChiiInspectorUrl(relayHttpUrl, targets[0].id, () =>
      generateTotp(totpSecret, Date.now()),
    );
    if (url === null) {
      return { ok: false, reason: 'totpUnavailable' };
    }
    return { ok: true, url };
  };

  // Local QR HTTP server — awaited so the first start_attach call (after a
  // relay switch) doesn't race its startup. Failure falls back to text QR.
  let qrServer: QrHttpServer | undefined;
  try {
    qrServer = await startQrHttpServer(getDashboardState, { getDirectInspectorUrl });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logWarn('server.start', { msg: `QR HTTP 서버 시작 실패 (text QR fallback 사용): ${message}` });
  }

  // TOTP 주기 갱신 타이머 — 이벤트 없이 페이지가 방치될 때 at= 코드가 stale되는 갭 수정 (#448).
  // TOTP step은 30초이므로 20초 주기로 push해 step 경계를 놓치지 않는다.
  // local-only 동안엔 lastAttachParts가 null이라 no-op — relay로 전환된 뒤 첫 start_attach
  // 호출 시 lastAttachParts가 세팅되면 갱신이 시작된다.
  // SECRET-HANDLING: 콜백은 단순 trigger만 — TOTP 값·at= 코드는 절대 로그/stdout 출력 금지.
  const TOTP_REFRESH_INTERVAL_MS = 20_000;
  let totpRefreshHandle: ReturnType<typeof setInterval> | null = null;
  totpRefreshHandle = setInterval(() => {
    if (lastAttachParts !== null) {
      qrServer?.notifyStateChange();
    }
  }, TOTP_REFRESH_INTERVAL_MS);
  totpRefreshHandle.unref();

  const server = createDebugServer({
    connection: router.active,
    router,
    aitSource,
    // Tunnel status follows the relay family once it is lazy-booted (#356);
    // until then it reports "down" (no relay tunnel exists), which keeps
    // start_attach correctly gated.
    getTunnelStatus: () => router.relayTunnelStatus(),
    // FIX (issue #572 review): expose the live cloudflared child PID (source a)
    // so get_debug_status can feed it into getDiagnostics for the FIX 2 probe.
    getTunnelChildPid: () => activeTunnelChildPid,
    get qrHttpServer() {
      return qrServer;
    },
    diagnosticsCollector,
    // SECRET-HANDLING: the TOTP secret is read from env AT CALL TIME (inside
    // start_attach) so the project-local .ait_relay secret loaded by
    // switchMode (#396) is visible. It is used only to generate the at= code and
    // is never logged or surfaced in any output.
    getTotpSecret: () => process.env.AIT_DEBUG_TOTP_SECRET,
    // dashboard 갱신 콜백 — URL 컴포넌트 저장 후 SSE push (Defect 1 fix).
    onAttachUrlBuilt: (parts) => {
      lastAttachParts = parts;
      qrServer?.notifyStateChange();
    },
  });

  const transport = new StdioServerTransport();

  // ---------------------------------------------------------------------------
  // Unified dual-family shutdown (issues #356, #396, mirrors runDebugServer):
  // tears down every family ever booted at process exit (all lazy now). Each
  // family's stop() owns its infra — the local family kills its Chromium, a
  // lazily-booted relay family stops its tunnel + probe + relay. Inactive infra
  // is left warm during the session.
  // ---------------------------------------------------------------------------

  let closed = false;
  let parentWatcher: { stop(): void } | null = null;
  let maxAgeWatchdog: { stop(): void } | null = null;

  const shutdown = () => {
    if (closed) return;
    closed = true;
    parentWatcher?.stop();
    maxAgeWatchdog?.stop();
    if (totpRefreshHandle) clearInterval(totpRefreshHandle);
    router.stopWatcher();
    // Tear down every booted family (all lazy, #396 — only those ever started).
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
      maxAgeWatchdog?.stop();
      if (totpRefreshHandle) clearInterval(totpRefreshHandle);
      router.stopWatcher();
      for (const family of router.bootedFamilies()) family.stop();
      lockHandle.release();
    }
  });

  process.on('uncaughtException', (err) => {
    logError('tool.error', {
      msg: `uncaughtException: ${String(err)}`,
      errorKind: 'uncaught',
      mode: 'local-browser',
    });
    shutdown();
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logError('tool.error', {
      msg: `unhandledRejection: ${String(reason)}`,
      errorKind: 'unhandled-rejection',
      mode: 'local-browser',
    });
    shutdown();
    process.exit(1);
  });

  await server.connect(transport);

  // Bind the server to the router. No family is active yet (all-lazy, #396) —
  // the attach watcher is armed by the first `start_debug` and re-armed on every
  // swap.
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

  // FIX 4 (issue #571): max-age watchdog.
  if (process.env.AIT_DEBUG_NO_MAX_AGE !== '1') {
    const maxAgeMs = process.env.AIT_DEBUG_MAX_AGE_MS
      ? Number.parseInt(process.env.AIT_DEBUG_MAX_AGE_MS, 10) || undefined
      : undefined;
    maxAgeWatchdog = startMaxAgeWatchdog(
      () => {
        process.stderr.write(
          '[ait-debug] max-age watchdog: daemon lifetime exceeded — shutting down for a fresh start.\n',
        );
        shutdown();
        process.exit(0);
      },
      { maxAgeMs },
    );
  }
}

export interface RunMobileDebugServerOptions {
  /**
   * When `true`, terminates the process holding the existing server lock and
   * takes over the session. Corresponds to `--force` / `--takeover` CLI flags.
   *
   * Default `false`.
   */
  force?: boolean;
  /**
   * Project root for `.ait_urls` file-based URL discovery (#424). When supplied,
   * `readMobileRelayBaseUrl` falls back to the `.ait_urls` file written by the
   * unplugin if `AIT_RELAY_BASE_URL` is not set. Defaults to `process.cwd()`.
   */
  projectRoot?: string;
}

/**
 * Serves the env-2 (real-device PWA) debug stack over stdio with the external
 * Chii relay as the default target (issue #378). Since #396 NOTHING boots at
 * startup — the external relay family is lazy-booted on the first
 * `start_debug({ mode: 'relay-sandbox' })`.
 *
 * Unlike `runDebugServer` (which starts its own relay + cloudflared tunnel),
 * `runMobileDebugServer` attaches to a relay the unplugin ALREADY brought up
 * (`tunnel: { cdp: true }`) and exposed via `AIT_RELAY_BASE_URL`. The MCP only
 * opens a CDP client against that external relay — it never starts or tears down
 * a relay or a tunnel it did not own (see {@link bootExternalRelayFamily}).
 *
 * Symmetry with `runDebugServer` / `runLocalDebugServer` (#356, #378, #396): all
 * three families are lazy-booted — the env-2 external relay on the first
 * `start_debug({ mode: 'relay-sandbox' })`, the local family on `local-browser`,
 * the intoss relay on `relay-staging` (#665: relay-live removed) — so a
 * `--target=mobile` session can hot-switch without a restart. The active env
 * derives to `relay-mobile` (external-PWA origin).
 *
 * SECRET-HANDLING: `AIT_RELAY_BASE_URL` is read once here via
 * {@link readMobileRelayBaseUrl}; when unset it throws
 * {@link MOBILE_RELAY_BASE_URL_MISSING_MESSAGE} — a message that names the env
 * var and how to obtain it, never echoing any URL value. The error propagates to
 * the bin entry's fatal handler (the missing-URL path prints the guidance, not a
 * value). The present value is passed straight to the CDP client, never logged.
 */
export async function runMobileDebugServer(
  options: RunMobileDebugServerOptions = {},
): Promise<void> {
  // Read the external relay base BEFORE acquiring the lock so a missing-URL
  // invocation fails fast (fatal stderr via the bin entry) without taking the
  // single-session lock or opening any connection. Kept pre-flight (NOT moved
  // into the lazy lambda) so the fail-fast still precedes the lock.
  // (#424) Falls back to .ait_urls if AIT_RELAY_BASE_URL is unset.
  // SECRET-HANDLING: relayBaseUrl is passed to the CDP client only, never logged.
  const relayBaseUrl = await readMobileRelayBaseUrl(
    process.env,
    options.projectRoot ?? process.cwd(),
  );

  // Enforce a single debug session per machine (same lock as the other modes).
  // `force: true` kills the existing process and takes over the lock.
  const lockHandle = acquireLock({ force: options.force ?? false });

  // Dual-connection router (issues #348, #356, #378, #396): ALL families are
  // lazy-booted — the env-2 external relay on the first `start_debug({ mode:
  // 'relay-sandbox' })`, the local family on `local-browser`, the intoss relay on
  // `relay-staging`. `relay-live` removed (#665).
  const devtoolsOpener = new AutoDevtoolsOpener();
  const diagnosticsCollector = new InMemoryDiagnosticsCollector();

  // FIX (issue #572 review): track the live cloudflared child PID in memory so
  // get_debug_status can pass it to getDiagnostics as source (a). Updated by
  // onTunnelChildPid on initial boot and on every reissue.
  let activeTunnelChildPid: number | null = null;

  const router = new DualConnectionRouter({
    // Lazy resolver for all three family slots (#378, #396, #424). The external
    // relay boot captures the pre-flight `relayBaseUrl`. Its stop() closes ONLY
    // the CDP client — the unplugin owns the relay + its tunnel.
    // verifyAuth is built INSIDE the lambda (lazily, at the relay boot site) so it
    // reads the env AFTER switchMode's project-local secret load (#396) has
    // populated AIT_DEBUG_TOTP_SECRET — never captured at server startup.
    bootLazyFor: async (key) =>
      key === 'relay-sandbox'
        ? bootExternalRelayFamily(
            relayBaseUrl,
            await readRelayLocalUrl(process.env, options.projectRoot ?? process.cwd()),
          )
        : key === 'local-browser'
          ? bootLocalFamily()
          : bootRelayFamily({
              verifyAuth: buildRelayVerifyAuth(),
              onWssUrl: (wssUrl) => {
                lockHandle.updateWssUrl(wssUrl);
                qrServer?.notifyStateChange();
              },
              // FIX 3 (issue #571): persist cloudflared child PID for zombie detection.
              // Also update the in-memory tracker (source a for FIX 2).
              onTunnelChildPid: (pid) => {
                activeTunnelChildPid = pid;
                lockHandle.updateTunnelChildPid(pid);
              },
              // Issue #467: secret-free relay TOTP 401 counter for get_debug_status.
              onAuthReject: () => diagnosticsCollector.recordAuthReject(),
              // Issue #631: on permanent tunnel drop, immediately push the
              // new state so the dashboard swaps the dead QR for the error
              // state (mirror of onWssUrl's notifyStateChange).
              onTunnelDown: () => qrServer?.notifyStateChange(),
            }),
    diagnosticsCollector,
    devtoolsOpener,
    onPageAttach: () => qrServer?.notifyStateChange(),
    // Stable /inspector URL for auto-open (issue #530).
    getInspectorStableUrl: () => qrServer?.inspectorStableUrl ?? null,
    // (#610) Stale relay-sandbox rebuild: re-read the relay URL on every
    // relay-sandbox re-entry so the router can detect when the dev server was
    // restarted (new quick-tunnel) and rebuild the CDP client accordingly.
    // SECRET-HANDLING: readMobileRelayBaseUrl never logs the URL value.
    readSandboxRelayUrl: (pr) =>
      readMobileRelayBaseUrl(process.env, pr ?? options.projectRoot ?? process.cwd()).catch(
        () => null,
      ),
  });

  // AIT.* methods ride the *active* connection's command channel (external relay
  // Chii, or local CDP / intoss Chii after a switch), so the AIT source follows
  // `start_debug` swaps.
  const aitSource = new RoutingAitSource(() => {
    const active = router.active as CdpConnection & {
      sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
    };
    return active;
  });

  // dashboard용 lastAttachParts 상태 — start_attach 호출마다 갱신.
  // 완성 URL 대신 컴포넌트를 저장해 getDashboardState 호출마다 fresh TOTP를 mint (Defect 1).
  // SECRET-HANDLING: 컴포넌트에는 tunnel/scheme host가 있으므로 로그 출력 금지.
  let lastAttachParts: AttachUrlParts | null = null;

  const getDashboardState = (): DashboardState => {
    const targets = router.active.listTargets();
    // inspectorUrl — /inspector 안정 진입점 (issue #530).
    // SECRET-HANDLING: /inspector URL 자체에 시크릿 없음 — 출력 가능.
    const inspectorUrl = qrServer?.inspectorStableUrl ?? null;
    return {
      tunnel: { up: router.relayTunnelStatus().up, wssUrl: router.relayTunnelStatus().wssUrl },
      pages: targets.map((t) => ({ id: t.id, url: t.url })),
      attachUrl: lastAttachParts ? rebuildAttachUrl(lastAttachParts) : null,
      inspectorUrl,
    };
  };

  // getDirectInspectorUrl — /inspector 라우트에서 직접 chii front_end URL을 조립.
  // getDashboardState().inspectorUrl(= /inspector 자기 자신)을 쓰면 무한 루프가 발생하므로
  // 별도 getter로 분리한다. 매 요청마다 호출되어 TOTP를 요청 시점에 mint한다.
  // SECRET-HANDLING: ok:true url에 relay host + at= 코드가 담긴다 — 로그/stdout 출력 금지.
  const getDirectInspectorUrl = (): ReturnType<
    NonNullable<QrHttpServerOptions['getDirectInspectorUrl']>
  > => {
    const relayHttpUrl = router.activeRelayHttpUrl;
    if (!relayHttpUrl) {
      return { ok: false, reason: 'relayDown' };
    }
    const targets = router.active.listTargets();
    if (targets.length === 0) {
      return { ok: false, reason: 'noTarget' };
    }
    const totpSecret = process.env.AIT_DEBUG_TOTP_SECRET;
    if (!totpSecret) {
      return { ok: false, reason: 'totpUnavailable' };
    }
    const url = buildChiiInspectorUrl(relayHttpUrl, targets[0].id, () =>
      generateTotp(totpSecret, Date.now()),
    );
    if (url === null) {
      return { ok: false, reason: 'totpUnavailable' };
    }
    return { ok: true, url };
  };

  // Local QR HTTP server — awaited so the first start_attach call doesn't
  // race its startup. Failure falls back to text QR.
  let qrServer: QrHttpServer | undefined;
  try {
    qrServer = await startQrHttpServer(getDashboardState, { getDirectInspectorUrl });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logWarn('server.start', { msg: `QR HTTP 서버 시작 실패 (text QR fallback 사용): ${message}` });
  }

  // TOTP 주기 갱신 타이머 — 이벤트 없이 페이지가 방치될 때 at= 코드가 stale되는 갭 수정 (#448).
  // TOTP step은 30초이므로 20초 주기로 push해 step 경계를 놓치지 않는다.
  // SECRET-HANDLING: 콜백은 단순 trigger만 — TOTP 값·at= 코드는 절대 로그/stdout 출력 금지.
  const TOTP_REFRESH_INTERVAL_MS = 20_000;
  let totpRefreshHandle: ReturnType<typeof setInterval> | null = null;
  totpRefreshHandle = setInterval(() => {
    if (lastAttachParts !== null) {
      qrServer?.notifyStateChange();
    }
  }, TOTP_REFRESH_INTERVAL_MS);
  totpRefreshHandle.unref();

  const server = createDebugServer({
    connection: router.active,
    router,
    aitSource,
    // Tunnel status follows the active relay family — once the env-2 external
    // relay is lazy-booted it reports up with its wss URL, so start_attach is
    // satisfied without us opening a cloudflared tunnel.
    getTunnelStatus: () => router.relayTunnelStatus(),
    // FIX (issue #572 review): expose the live cloudflared child PID (source a)
    // so get_debug_status can feed it into getDiagnostics for the FIX 2 probe.
    getTunnelChildPid: () => activeTunnelChildPid,
    get qrHttpServer() {
      return qrServer;
    },
    diagnosticsCollector,
    // SECRET-HANDLING: the TOTP secret is read from env AT CALL TIME (inside
    // start_attach) so the project-local .ait_relay secret loaded by
    // switchMode (#396) is visible. It is used only to generate the at= code and
    // is never logged or surfaced in any output.
    getTotpSecret: () => process.env.AIT_DEBUG_TOTP_SECRET,
    // dashboard 갱신 콜백 — URL 컴포넌트 저장 후 SSE push (Defect 1 fix).
    onAttachUrlBuilt: (parts) => {
      lastAttachParts = parts;
      qrServer?.notifyStateChange();
    },
  });

  const transport = new StdioServerTransport();

  // ---------------------------------------------------------------------------
  // Unified dual-family shutdown (issues #356, #378, #396, mirrors the other run
  // functions): tears down every family ever booted at process exit (all lazy
  // now). The external relay family's stop() closes ONLY our CDP client (the
  // unplugin owns the relay + tunnel); a lazily-booted intoss relay family stops
  // its own tunnel + probe + relay; a lazily-booted local family kills its
  // Chromium.
  // ---------------------------------------------------------------------------

  let closed = false;
  let parentWatcher: { stop(): void } | null = null;
  let maxAgeWatchdog: { stop(): void } | null = null;

  const shutdown = () => {
    if (closed) return;
    closed = true;
    parentWatcher?.stop();
    maxAgeWatchdog?.stop();
    if (totpRefreshHandle) clearInterval(totpRefreshHandle);
    router.stopWatcher();
    for (const family of router.bootedFamilies()) family.stop();
    void server.close();
    void qrServer?.close();
    lockHandle.release();
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  process.once('SIGHUP', shutdown);

  process.on('exit', () => {
    if (!closed) {
      closed = true;
      parentWatcher?.stop();
      maxAgeWatchdog?.stop();
      if (totpRefreshHandle) clearInterval(totpRefreshHandle);
      router.stopWatcher();
      for (const family of router.bootedFamilies()) family.stop();
      lockHandle.release();
    }
  });

  process.on('uncaughtException', (err) => {
    logError('tool.error', {
      msg: `uncaughtException: ${String(err)}`,
      errorKind: 'uncaught',
      mode: 'relay-sandbox',
    });
    shutdown();
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logError('tool.error', {
      msg: `unhandledRejection: ${String(reason)}`,
      errorKind: 'unhandled-rejection',
      mode: 'relay-sandbox',
    });
    shutdown();
    process.exit(1);
  });

  await server.connect(transport);

  // Bind the server to the router. No family is active yet (all-lazy, #396) —
  // the attach watcher is armed by the first `start_debug` and re-armed on every
  // swap.
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

  // FIX 4 (issue #571): max-age watchdog.
  if (process.env.AIT_DEBUG_NO_MAX_AGE !== '1') {
    const maxAgeMs = process.env.AIT_DEBUG_MAX_AGE_MS
      ? Number.parseInt(process.env.AIT_DEBUG_MAX_AGE_MS, 10) || undefined
      : undefined;
    maxAgeWatchdog = startMaxAgeWatchdog(
      () => {
        process.stderr.write(
          '[ait-debug] max-age watchdog: daemon lifetime exceeded — shutting down for a fresh start.\n',
        );
        shutdown();
        process.exit(0);
      },
      { maxAgeMs },
    );
  }
}
