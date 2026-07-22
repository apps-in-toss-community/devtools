/**
 * @ait-co/devtools attach orchestrator (issue #684 §2).
 *
 * The relay-attach orchestration — minting a fresh-TOTP attach URL, validating
 * an env's attach preconditions, rendering the QR (dashboard or text), opening
 * the browser, and waiting (segmented, with in-call TOTP re-mint) for a real
 * device to attach — used to live INLINE in `createDebugServer`'s closure
 * (`src/mcp/debug-server.ts`). It read six closure variables, so it could not be
 * reused outside the MCP `start_attach` handler.
 *
 * This module lifts that orchestration to MODULE LEVEL and promotes those six
 * closure variables to an explicit {@link AttachDeps} object. The behavior is
 * IDENTICAL — this is a pure extraction (issue #684 PR1). Two adapters consume
 * it:
 *
 *   - the MCP `start_attach` CallTool handler (`debug-server.ts`) — assembles
 *     `attachDeps` from its own closure variables and calls these functions;
 *   - (forthcoming, PR3) the `devtools-test` CLI — boots a single relay family
 *     and assembles `attachDeps` without a dashboard/SSE callback.
 *
 * The orchestrator imports NEITHER adapter (zero reverse dependency). It pulls
 * only modules already in the MCP-daemon graph (react-free) — see the
 * install-graph invariant in devtools `CLAUDE.md`.
 *
 * SECRET-HANDLING: the TOTP code is minted fresh at call time and rides inside
 * the assembled URL's `at=` param only — never logged or returned separately.
 * Tunnel/scheme hosts + relay wss URLs are NEVER logged. The browser is opened
 * on a `http://127.0.0.1:<port>` URL only.
 *
 * Node-only.
 */

import type { CdpConnection } from './cdp-connection.js';
import {
  buildDeepLinkAttachUrl,
  buildLauncherAttachUrl,
  validateSchemeAuthority,
} from './deeplink.js';
import type { McpEnvironment } from './environment.js';
import { classifyToolError, mcpError } from './errors.js';
import { logInfo } from './log.js';
import type { QrHttpServer } from './qr-http-server.js';
import {
  canOpenBrowser as defaultCanOpenBrowser,
  listPages,
  openQrInBrowser,
  type TunnelStatus,
} from './tools.js';
import { generateTotp, RELAY_VERIFY_SKEW_STEPS } from './totp.js';
import { renderQr } from './tunnel.js';

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
 * Injectable for tests via {@link AttachDeps.stalePageThresholdMs}.
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
 * Attach URL components — stored in the run functions instead of a finished
 * URL string so that `getDashboardState` can RE-MINT a fresh TOTP code on
 * every call (Defect 1: baked codes expire → relay 401 reason:'auth').
 *
 * `kind: 'launcher'` = env 2 (launcher PWA QR, `buildLauncherAttachUrl`).
 * `kind: 'scheme'`   = env 3/4 (intoss-private deep-link, `buildDeepLinkAttachUrl`).
 *
 * SECRET-HANDLING: these components contain tunnel/scheme hosts. They are
 * NEVER logged. The TOTP code is minted fresh at call time via `mintAttachUrl`
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
export interface AttachTotpMeta {
  enabled: true;
  ttlSeconds: number;
  expiresAt: string;
}

/** The tool-result shape returned by every CallTool handler branch. */
export type McpResult = {
  content: Array<
    { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
  >;
  isError?: boolean;
};

/**
 * Output of the {@link prepareAttach} helper (issue #626) — the shared validation +
 * component bundle that the env-2 (relay-mobile) and env-3 (relay-dev) attach
 * paths both produce. On any validation failure the helper returns
 * `{ ok: false, error }` with a ready-to-return `McpResult`.
 */
export type PrepareAttachResult =
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

/**
 * Explicit dependencies for the attach orchestrator (issue #684 §2.2) — the six
 * closure variables `prepareAttach`/`renderAndMaybeWait` used to read off
 * `createDebugServer`, promoted to a passable object so the orchestration is
 * reusable outside the MCP handler.
 *
 * Production (`createDebugServer`) assembles this from its own closure
 * variables; the CLI (PR3) assembles it from a booted relay family.
 */
export interface AttachDeps {
  /** relay 터널 up/wssUrl. CLI는 bootRelayFamily().getTunnelStatus를 그대로 넘긴다. */
  getTunnelStatus(): TunnelStatus;
  /**
   * Late-bound TOTP secret accessor (issue #396) — read from env AT CALL TIME so
   * the project-local `.ait_relay` secret loaded by `switchMode` is visible.
   * SECRET-HANDLING: the returned value is used only for the `at=` code, never logged.
   */
  getTotpSecret(): string | undefined;
  /**
   * 로컬 127.0.0.1 QR 대시보드. 없으면 text QR fallback (headless/CLI-no-GUI).
   */
  qrHttpServer?: QrHttpServer;
  /**
   * attach URL 컴포넌트 확정 직후 콜백 (대시보드 SSE push). CLI는 미주입(no-op).
   * 완성된 URL이 아니라 컴포넌트를 전달하는 이유: `getDashboardState`가 매 호출 시
   * 최신 TOTP 코드를 freshly mint해 QR을 갱신하기 위함이다.
   */
  onAttachUrlBuilt?: (parts: AttachUrlParts) => void;
  /** ghost page 가드 임계 (#610). 기본 {@link RELAY_SANDBOX_STALE_PAGE_MS}. */
  stalePageThresholdMs?: number;
  /** 테스트 시계 주입. 기본 () => Date.now(). */
  nowMs?: () => number;
  /**
   * GUI 감지 override (테스트/headless/CLI `--headless`). 기본 `canOpenBrowser`.
   * `renderAndMaybeWait`이 브라우저 자동 열기 가능 여부 판정에 사용한다.
   */
  canOpenBrowser?: () => boolean;
}

/** Resolves `deps.stalePageThresholdMs` to its default. */
function resolveStalePageThresholdMs(deps: AttachDeps): number {
  return deps.stalePageThresholdMs ?? RELAY_SANDBOX_STALE_PAGE_MS;
}

/** Resolves `deps.nowMs` to its default (`Date.now`). */
function resolveNowMs(deps: AttachDeps): () => number {
  return deps.nowMs ?? (() => Date.now());
}

/** Resolves `deps.canOpenBrowser` to the module default. */
function resolveCanOpenBrowser(deps: AttachDeps): () => boolean {
  return deps.canOpenBrowser ?? defaultCanOpenBrowser;
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
export function waitForAttachWithEvents(
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
 * Synthesizes an attach URL from stored components with a FRESHLY-minted TOTP
 * code (issue #626 §3/§4 — the single mint point). Reads the late-bound secret
 * via `deps.getTotpSecret()` so the project-local `.ait_relay` secret loaded by
 * `switchMode` is visible. SECRET-HANDLING: the minted code rides inside the
 * URL's `at=` param only — never logged or returned separately.
 */
export function mintAttachUrl(deps: AttachDeps, parts: AttachUrlParts): string {
  const secret = deps.getTotpSecret();
  const code = secret ? generateTotp(secret) : undefined;
  return parts.kind === 'launcher'
    ? buildLauncherAttachUrl(parts.tunnelHttpUrl, parts.wssUrl, code, {
        name: parts.appName,
        ...(parts.selfdebug ? { selfdebug: true } : {}),
      })
    : buildDeepLinkAttachUrl(parts.schemeUrl, parts.wssUrl, code);
}

/** Builds the fresh TOTP metadata (expiresAt window) for a tool result. */
export function buildTotpMeta(deps: AttachDeps): AttachTotpMeta | undefined {
  const secret = deps.getTotpSecret();
  if (secret === undefined || secret === '') return undefined;
  const STEP_SECONDS = 30;
  const expiresAtMs = resolveNowMs(deps)() + RELAY_VERIFY_SKEW_STEPS * STEP_SECONDS * 1000;
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
export async function prepareAttach(
  deps: AttachDeps,
  env: McpEnvironment,
  args: Record<string, unknown> | undefined,
  conn: CdpConnection,
): Promise<PrepareAttachResult> {
  const { getTunnelStatus, getTotpSecret } = deps;
  const stalePageThresholdMs = resolveStalePageThresholdMs(deps);
  const nowMs = resolveNowMs(deps);
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
        const stripped = rawName.includes('/') ? rawName.slice(rawName.indexOf('/') + 1) : rawName;
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
      totpMeta: buildTotpMeta(deps),
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
  // Run-scoped relay match (#763): the deep-link appends `relay=<wss>` to the
  // page URL, and BOTH runtime lines propagate it to location.search — unlike
  // `_deploymentId`, which the 3.0 loader consumes natively and does NOT
  // propagate (devtools#760 live observation). Requiring the deploymentId in
  // the page URL therefore never matches on 3.0 and the attach wait hangs
  // forever. The relay wss URL is minted fresh per run (quick tunnel), so
  // "page URL carries THIS run's relay" is a precise staleness filter on both
  // lines; the deploymentId match is kept as an OR for 2.x pages. The page URL
  // carries the relay percent-encoded (URLSearchParams), so both encodings are
  // checked. SECRET-HANDLING: neither the wss URL nor page URLs are logged.
  const wssForMatch = tunnelForBuild.wssUrl;
  const matchesRelay = (url: string): boolean =>
    url.includes(wssForMatch) || url.includes(encodeURIComponent(wssForMatch));
  const isMatchingPage = (pages: ReturnType<CdpConnection['listTargets']>): boolean => {
    if (pages.length === 0) return false;
    if (deploymentId === null) return true;
    return pages.some((p) => p.url.includes(deploymentId) || matchesRelay(p.url));
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
    totpMeta: buildTotpMeta(deps),
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
export async function renderAndMaybeWait(
  deps: AttachDeps,
  prep: Extract<PrepareAttachResult, { ok: true }>,
  waitForAttach: boolean,
  callTimeoutMs: number,
  conn: CdpConnection,
): Promise<McpResult> {
  const { getTunnelStatus, qrHttpServer, onAttachUrlBuilt } = deps;
  const nowMs = resolveNowMs(deps);
  const canOpenBrowserFn = resolveCanOpenBrowser(deps);
  const { parts, isMatchingPage, buildTimeoutError, authorityWarning, totpMeta } = prep;

  // Initial mint + dashboard notify (components, not a finished URL, so
  // getDashboardState re-mints on every SSE push — Defect 1).
  let attachUrl = mintAttachUrl(deps, parts);
  onAttachUrlBuilt?.(parts);
  let totpIssuedAt = nowMs();
  let reminted = 0;
  const relayUrl = parts.wssUrl;

  // devtools#766: proactive one-line notice, appended to the shared header so
  // it rides along every render path (headless / browser-opened / browser-
  // open-failed / no-http-server) and both callers (the `start_attach` MCP
  // tool here in debug-server.ts, and the devtools-test CLI's runner-terminal
  // output via relay-factory.ts's onQrContent). Real-device observation
  // (2026-07-08, 46/8/6 partial run vs. 78/0/13 clean full run) confirmed the
  // root cause is the human backgrounding the app mid-run, not the SDK or the
  // runner — so the fix is this notice, not suspend detection/auto-resume
  // (Page visibility signals die together with the relay).
  const header =
    'This tool result is shown to the user directly — do NOT re-print the QR below in your reply (it wastes output tokens). Just tell the user to scan the QR in this output (Ctrl+O to expand if collapsed).\n\n' +
    '테스트가 끝날 때까지 앱을 화면 앞에 유지하세요 — 백그라운드로 전환하면 디버그 세션이 끊어집니다.';
  const warningPrefix = authorityWarning ? `⚠️  scheme_url 경고: ${authorityWarning}\n\n` : '';
  const guiAvailable = canOpenBrowserFn();

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
          attachUrl = mintAttachUrl(deps, parts);
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

/**
 * How long the disconnected badge stays on screen before it fades and removes
 * itself (#748). Long enough to read, short enough not to linger; a reconnect
 * within this window cancels the self-dismiss (transient tunnel blips do not
 * flash-remove the badge).
 */
const INDICATOR_SELF_DISMISS_MS = 5000;

/** Fade duration before the self-dismissed badge is detached from the DOM. */
const INDICATOR_FADE_MS = 400;

/**
 * Heartbeat / pending-call render tick (#749). 1 Hz — cheap enough to be
 * invisible (a single text write per second, no layout thrash) while making a
 * JS main-thread wedge obvious: the compositor-driven pulse dot keeps animating
 * but this JS-driven `♥<beats>` token freezes. Pending-call elapsed times are
 * recomputed on the same tick so they advance without any bridge event.
 */
const INDICATOR_HEARTBEAT_MS = 1000;

/**
 * Display-side staleness guard (#749): the badge skips rendering a pending call
 * older than this. A safety net independent of the in-app observer's own prune
 * (`bridge-observer.ts` MAX_PENDING_AGE_MS) — kept local so the daemon-graph
 * expression builder never imports the in-app module (install-graph invariant).
 * Generous enough that a genuinely slow native call still shows while plausibly
 * in flight.
 */
const INDICATOR_PENDING_STALE_MS = 120_000;

/**
 * Builds a self-contained IIFE DOM expression that renders a LIVE
 * "Debugger Connected" / disconnected badge on the bottom-left of the phone
 * screen (#730), with a graceful self-dismiss on disconnect (#748).
 *
 * **Pure function** — returns a JS expression string; does NOT inject it.
 * Injection is performed by {@link injectDebugIndicator} in `cell.ts`.
 *
 * The expression, when evaluated on the page, does the following:
 *   1. Idempotent controller — a single `window.__ait_indicator` controller
 *      object is created once (keyed on its presence, not on the DOM node).
 *      Re-injection (e.g. explicit disconnect notice from `close()`) UPDATES
 *      the existing badge's state/label in place — it never duplicates the
 *      `<div>` or stacks a second observer.
 *   2. Renders a fixed-position `<div id="__ait_debug_indicator">` at the
 *      bottom-left, accounting for safe-area insets. Background/text flip
 *      between the attached (red) and disconnected (grey) visuals.
 *   3. A `pointerdown` listener dismisses (hides) the badge on tap — dismiss
 *      is NON-terminal: a later state transition un-dismisses it, so a
 *      genuine disconnect after a dismissed tap is still visible.
 *   4. **Graceful self-dismiss (#748)** — the disconnected badge is NON-BLOCKING
 *      (`pointer-events:none` the moment it flips to disconnected, so it can
 *      never absorb a tap) and SELF-DISMISSING (it fades and detaches itself
 *      after {@link INDICATOR_SELF_DISMISS_MS}). This is why a run that ends
 *      with `close()` injecting `{ state: 'disconnected' }` no longer leaves a
 *      permanent grey "Debugger Disconnected" element on the phone. A reconnect
 *      (`setState(c, 'attached')`) cancels the pending self-dismiss and
 *      re-mounts the badge if it had already detached — transient tunnel blips
 *      do not flash-remove it, and a genuine re-attach restores it. The
 *      controller object is retained across dismiss (never `delete`d), so a
 *      later re-injection reuses it and never double-wraps `window.WebSocket`.
 *   5. Observes relay-socket lifecycle WITHOUT opening any new connection:
 *      - Preferred path: if the in-app module (`src/in-app/attach.ts`) has
 *        already installed its relay-WS observer (`window.__ait_relay_ws_observed`),
 *        subscribe to the `ait:relay-ws-state` CustomEvent it broadcasts.
 *      - Fallback path: wrap `window.WebSocket` in a `Proxy` and match dials
 *        by PATHNAME SHAPE only (`/target/`) — never by host/wss value — so a
 *        bare CDP-injected badge (no in-app bundle) still reacts to the
 *        chii target socket's own open/close lifecycle.
 *   6. **Freeze/spinner triage (#749)** — renders three debug-only signals so a
 *      real-device spinner is attributable at a glance (run7):
 *      - **Main-thread heartbeat**: a compositor-driven pulse dot
 *        (`Element.animate`, keeps running during JS jank) PLUS a JS-driven
 *        `♥<beats>` token incremented by a 1 Hz `setInterval`. `CSS pulse alive
 *        + ♥ frozen = JS main-thread wedge`.
 *      - **Pending bridge calls**: in-flight native calls (API name + live
 *        elapsed) read from `window.__ait_bridge` (published by the in-app
 *        bridge observer, `src/in-app/bridge-observer.ts`). `⏳ present =
 *        native/Toss-app spinner`.
 *      - **Last SDK call stamp**: the most recent call's API name + wall-clock.
 *        `no ⏳ + heartbeat healthy = the miniapp's own UI`.
 *      The `title` tooltip states this mapping. When no in-app observer is
 *      present (env 2 mock / no bridge) the pending/last lines are simply empty
 *      — the heartbeat still renders. The 1 Hz interval is stored on the
 *      controller (`c.hb`) and stopped by `c.stop()` (called from
 *      `detachDebugSurface`) and by the self-dismiss removal, so no timer leaks
 *      past detach (#748 lifecycle).
 *
 * The expression intentionally contains NO relay URLs, wss addresses, TOTP
 * codes, or any other secrets. `window.__ait_bridge` holds API NAMES + timings
 * only (never call arguments/results — see `bridge-observer.ts`
 * SECRET-HANDLING). It is pure DOM UI text + enum/name state only.
 *
 * SECRET-HANDLING: this expression contains no secrets, relay URLs, wss
 * addresses, or TOTP codes whatsoever — DOM label text + a structural
 * pathname match (`/target/`) only.
 *
 * @param opts.label - Attached-state badge text (default: `'Debugger Connected'`).
 * @param opts.disconnectedLabel - Disconnected-state badge text. Default is the
 *   Korean notice `'디버거 연결 끊김'` (ko-primary in-app string convention) —
 *   shown briefly then self-dismissed.
 * @param opts.state - Initial/forced state for THIS injection call (default: `'attached'`).
 * @returns A JS expression string suitable for `Runtime.evaluate`.
 */
export function buildIndicatorExpression(opts?: {
  label?: string;
  disconnectedLabel?: string;
  state?: 'attached' | 'disconnected';
}): string {
  const label = opts?.label ?? 'Debugger Connected';
  const disconnectedLabel = opts?.disconnectedLabel ?? '디버거 연결 끊김';
  // JSON.stringify ensures the labels/state are safely embedded even if they
  // contain quotes or backslashes.
  const safeLabel = JSON.stringify(label);
  const safeDisconnectedLabel = JSON.stringify(disconnectedLabel);
  const safeState = JSON.stringify(opts?.state ?? 'attached');
  // Freeze/spinner triage legend (#749), ko-primary. Shown as the badge's
  // `title` so the ⏳/♥ mapping is discoverable. Contains no secrets.
  const safeTriageTitle = JSON.stringify(
    '⏳ 네이티브 호출 대기 = 토스앱 스피너 · ♥ 정지 = JS 멈춤 · ⏳ 없고 ♥ 정상 = 앱 UI',
  );
  return (
    `(() => {` +
    `var W = window;` +
    // pad2/clock — wall-clock HH:MM:SS for the last-call stamp (#749).
    `function pad2(n) { return (n < 10 ? '0' : '') + n; }` +
    `function clock(ms) { var d = new Date(ms); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); }` +
    // renderDetail(c) — paints the #749 signals: JS heartbeat token + pending
    // native calls (API name + live elapsed) + last-call stamp. Reads the
    // enum/name-only snapshot on W.__ait_bridge; API NAMES + timings only, never
    // call args/results.
    `function renderDetail(c) {` +
    `c.beatEl.textContent = ' \\u2665' + c.beats;` +
    `var b = W.__ait_bridge;` +
    `var now = Date.now();` +
    `var lines = [];` +
    `if (b) {` +
    `if (b.last) { lines.push('last: ' + b.last.method + ' ' + clock(b.last.at)); }` +
    `var p = b.pending || {};` +
    `var ids = Object.keys(p);` +
    `var shown = 0;` +
    `for (var i = 0; i < ids.length; i++) {` +
    `var e = p[ids[i]];` +
    `if (!e || now - e.startedAt > ${INDICATOR_PENDING_STALE_MS}) { continue; }` +
    `if (shown < 3) { lines.push('\\u23f3 ' + e.method + ' ' + Math.max(0, Math.round((now - e.startedAt) / 1000)) + 's'); }` +
    `shown++;` +
    `}` +
    `if (shown > 3) { lines.push('+' + (shown - 3) + ' more'); }` +
    `}` +
    `c.detailEl.textContent = lines.join('\\n');` +
    `}` +
    // mount(c) — (re-)attach the badge node to <body> if it is not connected.
    // A self-dismissed badge detaches itself; a later 'attached' re-mounts it.
    `function mount(c) { if (!c.el.isConnected && document.body) { document.body.appendChild(c.el); } }` +
    // render(c) — paints the DOM node from the controller's current state. The
    // heartbeat/pending detail render only while attached; disconnected clears
    // the child text so the badge collapses to the plain notice label.
    `function render(c) {` +
    `if (c.removed) { c.el.style.display = 'none'; return; }` +
    `mount(c);` +
    `if (c.dismissed) { c.el.style.display = 'none'; return; }` +
    `c.el.style.display = 'block';` +
    `c.el.style.opacity = '1';` +
    `var up = c.state !== 'disconnected';` +
    `c.el.style.background = up ? '#e5484d' : '#8a8f98';` +
    // Disconnected badge is non-blocking — it can never absorb a tap (#748).
    `c.el.style.pointerEvents = up ? 'auto' : 'none';` +
    `c.labelEl.textContent = up ? ${safeLabel} : ${safeDisconnectedLabel};` +
    `c.dotEl.style.display = up ? 'inline-block' : 'none';` +
    `c.beatEl.style.display = up ? 'inline' : 'none';` +
    `c.detailEl.style.display = up ? 'block' : 'none';` +
    `if (up) { renderDetail(c); } else { c.beatEl.textContent = ''; c.detailEl.textContent = ''; }` +
    `}` +
    // clearTimers(c) — cancel any pending self-dismiss fade/remove timers.
    `function clearTimers(c) { if (c.t1) { clearTimeout(c.t1); c.t1 = 0; } if (c.t2) { clearTimeout(c.t2); c.t2 = 0; } }` +
    // setState(c, next) — a later transition always un-dismisses AND un-removes
    // the badge (a reconnect after a self-dismiss re-mounts it), and cancels any
    // pending self-dismiss so a transient blip that reconnects does not remove it.
    `function setState(c, next) {` +
    `clearTimers(c);` +
    `c.state = next; c.dismissed = false; c.removed = false;` +
    `render(c);` +
    `if (next === 'disconnected') {` +
    // Graceful self-dismiss: fade after a readable delay, then detach (#748).
    // The controller object is retained so a re-injection reuses it. The 1 Hz
    // heartbeat interval is cleared on removal so no timer leaks past detach.
    `c.t1 = setTimeout(function () {` +
    `try { c.el.style.transition = 'opacity ${INDICATOR_FADE_MS}ms ease'; c.el.style.opacity = '0'; } catch (_) {}` +
    `c.t2 = setTimeout(function () { c.removed = true; if (c.hb) { clearInterval(c.hb); c.hb = 0; } if (c.el.parentNode) { c.el.parentNode.removeChild(c.el); } }, ${INDICATOR_FADE_MS});` +
    `}, ${INDICATOR_SELF_DISMISS_MS});` +
    `}` +
    `}` +
    // Idempotent controller — re-injection updates the SAME controller/DOM
    // node instead of creating a duplicate.
    `var c = W.__ait_indicator;` +
    `if (!c) {` +
    `var el = document.createElement('div');` +
    `el.id = '__ait_debug_indicator';` +
    `try { el.title = ${safeTriageTitle}; } catch (_) {}` +
    // Position: fixed, bottom-left with safe-area inset support.
    `el.style.cssText = [` +
    `'position:fixed',` +
    `'left:max(12px,calc(env(safe-area-inset-left,0px) + 8px))',` +
    `'bottom:max(12px,calc(env(safe-area-inset-bottom,0px) + 8px))',` +
    `'z-index:2147483647',` +
    `'color:#fff',` +
    `'font:bold 11px/1.2 system-ui,sans-serif',` +
    `'padding:5px 9px',` +
    `'border-radius:6px',` +
    `'max-width:72vw',` +
    `'pointer-events:auto',` +
    `'user-select:none',` +
    `].join(';');` +
    // Child nodes: a compositor pulse dot, the connection label, a JS heartbeat
    // token, and the pending/last detail block. Kept as children (not a single
    // textContent) so the heartbeat + pending list can update independently.
    `var dotEl = document.createElement('span');` +
    `dotEl.style.cssText = 'display:inline-block;width:6px;height:6px;border-radius:50%;background:#fff;margin-right:5px;vertical-align:middle';` +
    `var labelEl = document.createElement('span');` +
    `labelEl.id = '__ait_indicator_label';` +
    `var beatEl = document.createElement('span');` +
    `beatEl.style.cssText = 'font-weight:normal;opacity:0.85;margin-left:6px';` +
    `var detailEl = document.createElement('div');` +
    `detailEl.style.cssText = 'font-weight:normal;font-size:10px;line-height:1.35;margin-top:3px;white-space:pre-line;opacity:0.95';` +
    `el.appendChild(dotEl); el.appendChild(labelEl); el.appendChild(beatEl); el.appendChild(detailEl);` +
    `document.body.appendChild(el);` +
    `c = { el: el, dotEl: dotEl, labelEl: labelEl, beatEl: beatEl, detailEl: detailEl, state: 'attached', dismissed: false, removed: false, beats: 0, t1: 0, t2: 0, hb: 0 };` +
    // Compositor-driven pulse (opacity animation runs off the main thread) — it
    // keeps pulsing even while the JS main thread is wedged, so a frozen
    // ♥<beats> next to a still-pulsing dot reads as a JS wedge at a glance.
    `try { dotEl.animate([{ opacity: 1 }, { opacity: 0.25 }, { opacity: 1 }], { duration: 1400, iterations: Infinity }); } catch (_) {}` +
    // JS-driven 1 Hz heartbeat — increments the beat counter and re-renders the
    // detail (so pending elapsed advances). Self-clears once the node detaches,
    // and stop() (below) clears it on explicit teardown (#748/#749).
    `c.hb = (typeof setInterval !== 'undefined') ? setInterval(function () {` +
    `if (c.removed || !c.el.isConnected) { if (c.hb) { clearInterval(c.hb); c.hb = 0; } return; }` +
    `c.beats = (c.beats || 0) + 1;` +
    `if (c.state !== 'disconnected' && !c.dismissed) { renderDetail(c); }` +
    `}, ${INDICATOR_HEARTBEAT_MS}) : 0;` +
    // stop() — teardown hook called by detachDebugSurface (src/in-app/attach.ts)
    // so the interval never outlives the debug session.
    `c.stop = function () { clearTimers(c); if (c.hb) { clearInterval(c.hb); c.hb = 0; } };` +
    // One-tap dismiss — hides the badge; NOT terminal, `setState` re-shows it.
    `el.addEventListener('pointerdown', function () { c.dismissed = true; render(c); }, { passive: true });` +
    // Re-render promptly on every bridge call start/settle (#749) — additive to
    // the 1 Hz tick so a new pending call or a settle shows without a 1 s wait.
    `W.addEventListener('ait:bridge-call', function () { if (c.state !== 'disconnected' && !c.dismissed && !c.removed) { renderDetail(c); } });` +
    `W.__ait_indicator = c;` +
    // Observe relay-socket lifecycle without opening a new connection.
    `if (W.__ait_relay_ws_observed) {` +
    // Preferred: the in-app observer (src/in-app/attach.ts) already wraps
    // window.WebSocket and broadcasts this enum-only CustomEvent — piggyback
    // instead of installing a second Proxy.
    `W.addEventListener('ait:relay-ws-state', function (e) {` +
    `setState(c, e.detail && e.detail.state === 'open' ? 'attached' : 'disconnected');` +
    `});` +
    `} else {` +
    // Fallback: bare CDP-injected badge with no in-app bundle present.
    // Match relay-bound dials by PATHNAME SHAPE ONLY (`/target/`) — never by
    // host/wss value — so no secret ever enters this expression.
    `try {` +
    `var Native = W.WebSocket;` +
    `W.WebSocket = new Proxy(Native, {` +
    `construct: function (t, a) {` +
    `var ws = Reflect.construct(t, a);` +
    `try {` +
    `var u = new URL(String(a[0]), location.href);` +
    `if (/\\/target\\//.test(u.pathname)) {` +
    `ws.addEventListener('open', function () { setState(c, 'attached'); });` +
    `ws.addEventListener('close', function () { setState(c, 'disconnected'); });` +
    `ws.addEventListener('error', function () { setState(c, 'disconnected'); });` +
    `}` +
    `} catch (_) {}` +
    `return ws;` +
    `},` +
    `});` +
    `} catch (_) {}` +
    `}` +
    `}` +
    // Apply THIS injection call's requested state (default 'attached').
    `setState(c, ${safeState});` +
    `})()`
  );
}
