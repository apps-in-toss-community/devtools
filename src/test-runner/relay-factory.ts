/**
 * Relay connection factory for the Vitest custom pool (devtools#696).
 *
 * The Vitest pool (`pool.ts`) takes a {@link RelayConnectionFactory} that knows
 * how to `open()` a live CDP relay connection (boot relay → QR → phone scan →
 * cell inject → enableDomains) and `close()` it. Before this module that exact
 * assembly lived only inside the `devtools-test` CLI's `main()`; the standalone
 * CLI and the Vitest pool would otherwise each hand-roll it and drift.
 *
 * This is the single source of that assembly. `cli.ts` is refactored to call
 * `createRelayConnectionFactory(...).open()`, and `definePhoneVitestConfig`
 * (config.ts) exposes it so a downstream `vitest.config.ts` can wire the pool:
 *
 *   import { createRelayConnectionFactory } from '@ait-co/devtools/test-runner';
 *   const connection = createRelayConnectionFactory({
 *     schemeUrl,
 *     cell,
 *     // REQUIRED — own the stdout decision (the chunks carry the relay wss +
 *     // TOTP code). Suppress on non-interactive stdout; print otherwise.
 *     onQrContent: (chunks) => {
 *       if (!process.stdout.isTTY) return;
 *       for (const c of chunks) process.stdout.write(`${c}\n`);
 *     },
 *   });
 *   export default defineConfig({ test: definePhoneVitestConfig({ connection }) });
 *
 * The heavy boot graph (chii relay, cloudflared, ws, debug-server) is pulled via
 * DYNAMIC import inside `open()` — so merely importing this module (or the
 * `@ait-co/devtools/test-runner` barrel) does NOT statically drag that graph in.
 *
 * SECRET-HANDLING: relay wss URLs, scheme URLs, and the TOTP secret/code are
 * never logged. `open()` reads the project-local `.ait_relay` secret read-only
 * (never mints) and the minted TOTP code rides only inside the QR `at=` param.
 *
 * Node-only. react-free (CdpConnection + lazily-imported MCP boot helpers only).
 */

import type { AttachDeps, AttachUrlParts } from '../mcp/attach-orchestrator.js';
import type { CdpConnection } from '../mcp/cdp-connection.js';
import type { DashboardState, QrHttpServer } from '../mcp/qr-http-server.js';
import type { RelayConnectionFactory } from './pool.js';

// NOTE: every value import below is a DYNAMIC import inside `open()`. This module
// keeps ONLY type-level static imports so that re-exporting it from the
// `@ait-co/devtools/test-runner` barrel (config.ts) does NOT statically drag the
// heavy MCP graph (cell.ts → attach-orchestrator.ts → tools.ts → server-lock,
// plus chii/cloudflared via debug-server) onto that Node-config entry.

/** Options for {@link createRelayConnectionFactory}. */
export interface RelayConnectionFactoryOptions {
  /**
   * intoss-private:// scheme URL from `ait deploy --scheme-only` (env3). The
   * phone cold-loads the candidate bundle this URL points at. SECRET-HANDLING:
   * never logged.
   *
   * Ignored when {@link attachLauncher} is `true` — the env-2 launcher path
   * builds its attach URL from {@link appUrl} + the relay wss, not a scheme URL.
   * Pass `''` in that case.
   */
  schemeUrl: string;
  /**
   * env-2 (AITC Sandbox PWA) attach mode (devtools#774). When `true`, `open()`
   * builds the attach URL as a **launcher deep-link**
   * (`buildLauncherAttachUrl(appUrl, wssUrl, totp)` — the same env-2 path the
   * MCP daemon takes via `prepareAttach(deps, 'relay-mobile', …)`, issue #378)
   * instead of an intoss-private scheme deep-link. The relay boot, QR
   * rendering, dashboard, and attach-wait are byte-for-byte identical to env 3;
   * only the URL family differs. Omitted/false keeps the env-3 scheme path
   * unchanged (zero behavior change).
   */
  attachLauncher?: boolean;
  /**
   * The consumer dev server's HTTP tunnel URL (e.g. an sdk-example
   * `dev:phone:cdp` `*.trycloudflare.com` URL) that the launcher PWA frames.
   * REQUIRED when {@link attachLauncher} is `true`; ignored otherwise.
   *
   * Threaded to the `relay-mobile` `prepareAttach` branch via the
   * `AIT_TUNNEL_BASE_URL` env var (the same key the MCP daemon reads), so the
   * exact same env-2 assembly runs — no divergent code path.
   *
   * SECRET-HANDLING: this is a tunnel host at the same sensitivity as the relay
   * wss — NEVER logged. It rides only inside the QR/dashboard attach capsule.
   */
  appUrl?: string;
  /**
   * Project root for the `.ait_relay` secret lookup (read-only). Defaults to
   * `process.cwd()`.
   */
  projectRoot?: string;
  /**
   * Attach wait timeout in ms — how long `open()` waits for the phone to scan
   * the QR and attach. Omitted (the default) means **wait indefinitely** —
   * the runner stays up until the user stops it (Ctrl-C/SIGTERM). QR-scan
   * wait is a human-paced action; there is no sound default bound for it
   * (devtools#735). Pass an explicit value to opt into a bounded wait (CI/
   * headless callers — `--attach-timeout` on the CLI). (The per-file evaluate
   * timeout is separate, passed via the pool's `run` options.)
   */
  timeoutMs?: number;
  /** Disable browser auto-open of the QR dashboard (text QR only). */
  headless?: boolean;
  /**
   * Cell axes injected as `__AIT_CELL__` before the first test bundle runs, so
   * sdk-example's capture picks up the correct sdkLine/platform. Optional — when
   * omitted no cell is injected. The values are not secrets.
   */
  cell?: { sdkLine: string; platform: string };
  /**
   * When `true`, injects `__AIT_STUB_BLOCKING__ = true` before the first test
   * bundle runs (devtools#740, DT-2) — `bundle.ts`'s sdk-redirect module reads
   * this flag via `isStubBlockingEnabled()` and answers the blocking-UI APIs
   * in `bridge-stub.ts`'s `STUB_REGISTRY` from fixtures instead of forwarding
   * them to native. Optional — omitted/false means no flag is injected, which
   * is byte-for-byte the pre-#740 behavior (the sdk-redirect module treats
   * absence the same as `false`). Not a secret.
   */
  stubBlocking?: boolean;
  /**
   * Injects `__AIT_PACE_MS__ = paceMs` before the first test bundle runs
   * (devtools#767) — `runtime.ts`'s test-execution loop reads this page
   * global and waits `paceMs` before every test after the first one that
   * actually runs. Optional — omitted/0 means no flag is injected, which is
   * byte-for-byte the pre-#767 behavior (the loop treats an absent/non-
   * positive value as "no pacing"). Not a secret. This is the PAGE-side half
   * of `--pace`; the RUNNER-side (file-to-file) half is a plain `opts.paceMs`
   * forwarded to `runTestFilesOverRelay` by the caller (cli.ts) — this
   * factory only owns the page-global injection.
   */
  paceMs?: number;
  /**
   * Injects `__AIT_PACE_METHOD_MS__ = paceMethodMs` before the first test
   * bundle runs (devtools#769) — `bundle.ts`'s sdk-redirect virtual module
   * reads this page global via `method-pace.ts#getPaceMethodMs()` and paces
   * every SDK call to a minimum interval BETWEEN calls to the SAME named
   * function, independent of `--pace`'s test-to-test/file-to-file spacing.
   * Optional — omitted/0 means no flag is injected, which is byte-for-byte
   * the pre-#769 behavior (`getPaceMethodMs()` treats an absent/non-positive
   * value as "no pacing", and `wrapWithMethodPacing` returns the SDK object
   * untouched in that case). Not a secret.
   */
  paceMethodMs?: number;
  /**
   * Overrides the dashboard HTTP server's bind base port (devtools#752).
   * Threaded straight through to `startQrHttpServer`'s `dashboardPort`
   * option — see that option's doc for the increment-on-EADDRINUSE scan
   * behaviour and the `AIT_DEBUG_HTTP_PORT` env fallback. Omitted means
   * `startQrHttpServer` resolves its own default (env → fixed default).
   */
  dashboardPort?: number;
  /**
   * Receives the QR/attach render content (text chunks) from
   * `renderAndMaybeWait`, so the caller decides whether to print them — e.g.
   * suppress on non-interactive stdout.
   *
   * REQUIRED (not optional) on purpose: these chunks contain the QR payload
   * (which encodes the relay wss + TOTP `at=` code) and the attach JSON block.
   * Making the hook mandatory means the factory never falls back to printing
   * them itself — a downstream `vitest.config.ts` consumer that wires this via
   * the `@ait-co/devtools/test-runner` barrel is forced to make an explicit
   * stdout decision rather than silently leaking the secret-bearing block.
   *
   * SECRET-HANDLING: when a non-interactive caller is detected the hook MUST
   * suppress the WHOLE chunk (not just `attachUrl`), since `relayUrl` rides in
   * the same block.
   */
  onQrContent: (textChunks: string[]) => void;
}

/**
 * Builds a {@link RelayConnectionFactory} that opens a standalone relay
 * connection for env 3 (intoss-private scheme, default) or env 2 (AITC Sandbox
 * PWA launcher deep-link, when `opts.attachLauncher` is set — devtools#774).
 *
 * `open()` performs the full attach lifecycle and BLOCKS while a human scans
 * the rendered QR with their phone — there is no way around the manual scan.
 * By default the wait is UNBOUNDED (`opts.timeoutMs` omitted): the
 * runner stays up until the user stops it (Ctrl-C/SIGTERM), since QR-scan is
 * a human-paced action with no sound default bound (devtools#735). Passing an
 * explicit `timeoutMs` opts into the old bounded behavior (CI/headless
 * callers). It resolves with the live `CdpConnection` once a matching page
 * attaches; `close()` tears the relay family down.
 *
 * The factory holds the booted relay family in a closure so `close()` can stop
 * it. A second `open()` on the same factory boots a fresh family (the previous
 * one should have been `close()`d first).
 */
export function createRelayConnectionFactory(
  opts: RelayConnectionFactoryOptions,
): RelayConnectionFactory {
  const projectRoot = opts.projectRoot ?? process.cwd();
  // Undefined/absent → Infinity (wait forever). An explicit finite value opts
  // into the old bounded behavior. Number.isFinite guards downstream
  // (renderAndMaybeWait / waitForFirstTarget) treat Infinity as "no timer".
  const timeoutMs = opts.timeoutMs ?? Number.POSITIVE_INFINITY;
  const headless = opts.headless === true;

  // Captured so close() can stop the family that open() booted.
  let family: { connection: CdpConnection; stop(): void } | undefined;
  // QR HTTP server — started during open() when not headless, closed in close().
  let qrServer: QrHttpServer | undefined;
  // devtools#772: target attach/detach poller (mirrors debug-server.ts's
  // startAttachWatcher wiring) — started alongside qrServer in open(), stopped
  // in close(). Optional-chained everywhere since qrServer startup can fail.
  let attachWatcher: { stop(): void } | undefined;
  // Session-phase state (#730) — drives the dashboard's `phase` field so the
  // CLI's run start/complete and final teardown push an immediate SSE update
  // instead of the dashboard just going dark when the process exits.
  let phase: DashboardState['phase'] = 'active';
  // Manual-blocking prompt state (devtools#741) — drives the dashboard's
  // `manualPrompt` field. `null` outside a manual step.
  let manualPrompt: DashboardState['manualPrompt'] = null;

  return {
    async open(): Promise<CdpConnection> {
      // Dynamic imports: keep the chii/cloudflared/debug-server graph OFF the
      // static import graph of this module (and the test-runner config barrel).
      const { prepareAttach, renderAndMaybeWait, mintAttachUrl } = await import(
        '../mcp/attach-orchestrator.js'
      );
      const { injectDebugIndicator, injectGlobals } = await import('./cell.js');
      const { loadRelaySecretReadOnly } = await import('../mcp/relay-secret-store.js');
      const { bootRelayFamily, buildRelayVerifyAuth, startAttachWatcher } = await import(
        '../mcp/debug-server.js'
      );
      const { buildChiiInspectorUrl } = await import('../mcp/devtools-opener.js');
      const { generateTotp } = await import('../mcp/totp.js');

      // Load the project-local .ait_relay secret into AIT_DEBUG_TOTP_SECRET
      // BEFORE booting the relay so assertRelayAuthConfigured()/buildRelayVerifyAuth()
      // at the boot site see it. Read-only — never mints. SECRET-HANDLING: the
      // value is never logged here.
      await loadRelaySecretReadOnly({ projectRoot });

      // PRIMARY FIX (devtools#714): bootRelayFamily starts the cloudflared tunnel
      // as a background promise and returns immediately with tunnel.up === false.
      // We must NOT call prepareAttach until the tunnel is up — it fails fast when
      // tunnel.up is false (attach-orchestrator.ts tunnel-down guard).
      //
      // Wire onWssUrl (mirroring the MCP daemon path in debug-server.ts) to:
      //   1. resolve a caller-held tunnel-ready promise so open() can await it, and
      //   2. re-push dashboard SSE on late tunnel-up events (notifyStateChange).
      //
      // SECRET-HANDLING: onWssUrl receives the relay wss URL — never log it.
      let resolveTunnelUp!: () => void;
      const tunnelReady = new Promise<void>((resolve) => {
        resolveTunnelUp = resolve;
      });

      const booted = await bootRelayFamily({
        verifyAuth: buildRelayVerifyAuth(),
        onWssUrl: () => {
          // Resolve the tunnel-ready gate so the prepareAttach call below is
          // unblocked. qrServer may not be set yet at call time (it's started
          // after bootRelayFamily), so we use optional chaining — if the tunnel
          // happens to come up after qrServer is started, notifyStateChange pushes
          // the freshly minted attachUrl to any waiting dashboard SSE clients.
          // SECRET-HANDLING: wssUrl is NOT forwarded here — the value travels only
          // inside the closure via getTunnelStatus().wssUrl (used by mintAttachUrl).
          resolveTunnelUp();
          qrServer?.notifyStateChange();
        },
        // #730: parity with the MCP daemon path (debug-server.ts's onTunnelDown
        // wiring) — without this, a permanent tunnel drop during a standalone
        // CLI run left the dashboard showing a dead-but-scannable QR until the
        // watchdog (up to ~210s) finally fired.
        onTunnelDown: () => {
          qrServer?.notifyStateChange();
        },
      });
      family = booted;

      // If the tunnel is already up (extremely fast boot or test double), resolve
      // immediately so we don't stall on a promise that will never fire.
      if (booted.getTunnelStatus?.().up) {
        resolveTunnelUp();
      }

      // Track the last-captured attach parts so getDashboardState can mint a
      // fresh attach URL on every dashboard request/SSE push (fresh TOTP at=).
      // SECRET-HANDLING: parts contain the relay wss + scheme URL — never logged.
      let lastAttachParts: AttachUrlParts | undefined;

      // Assemble AttachDeps. We set qrHttpServer and onAttachUrlBuilt below
      // (before prepareAttach) after optionally starting the web-QR server.
      const attachDeps: AttachDeps = {
        getTunnelStatus: booted.getTunnelStatus ?? (() => ({ up: false, wssUrl: null })),
        getTotpSecret: () => process.env.AIT_DEBUG_TOTP_SECRET,
        qrHttpServer: undefined, // filled in below if web-QR server started
        onAttachUrlBuilt: undefined, // filled in below
        canOpenBrowser: () => !headless,
      };

      // Web-QR server: reuse the same loopback HTTP dashboard that the MCP
      // start_attach path uses (src/mcp/qr-http-server.ts). This makes the QR
      // scannable even when stdout is non-interactive (Claude Code `!` / CI),
      // because the browser is opened by URL — not via captured stdout.
      //
      // Headless decision: we start the server even in --headless mode so the
      // printed stderr URL can be opened manually. The existing
      // canOpenBrowser: () => !headless gate inside renderAndMaybeWait prevents
      // the auto-open; headless users see only the stderr URL.
      //
      // On failure we fall back gracefully to the text-QR path — do NOT crash.
      // SECRET-HANDLING: only http://127.0.0.1:<port>/ (no secrets) goes to stderr.
      try {
        const { startQrHttpServer } = await import('../mcp/qr-http-server.js');

        // devtools#772: parity with the MCP daemon path (debug-server.ts) —
        // read the live target list off the booted connection instead of the
        // `pages: null` placeholder. `Array.isArray(pages) && pages.length > 0`
        // is the SSE client's Inspector-active gate (qr-http-server.ts #544),
        // so a hardcoded `null` left the Inspector section stuck on the
        // waiting hint forever, independent of any actual attach state.
        const getDashboardState = (): DashboardState => ({
          tunnel: attachDeps.getTunnelStatus(),
          pages: booted.connection.listTargets().map((t) => ({ id: t.id, url: t.url })),
          attachUrl: lastAttachParts ? mintAttachUrl(attachDeps, lastAttachParts) : null,
          // devtools#774: label the dashboard chrome for the env being attached
          // — 'relay-mobile' (env 2 launcher/sandbox family) vs 'relay-dev'
          // (env 3 intoss family). Mirrors the MCP daemon's mode selection.
          mode: opts.attachLauncher === true ? ('relay-mobile' as const) : ('relay-dev' as const),
          phase, // #730 — CLI-only 'running'/'complete' transitions via onSessionPhase
          manualPrompt, // #741 — CLI-only --manual-blocking transitions via onManualPrompt
        });

        // devtools#772: getDirectInspectorUrl — mirrors debug-server.ts's
        // assembly (buildChiiInspectorUrl over the relay's local HTTP base +
        // a freshly-minted TOTP code) so the runner dashboard's `/inspector`
        // stable route (#530) is actually functional once a page attaches.
        // SECRET-HANDLING: `ok:true`'s `url` carries the relay host + TOTP
        // `at=` code — never logged; it only ever rides a Location header.
        const getDirectInspectorUrl = (): ReturnType<
          NonNullable<
            import('../mcp/qr-http-server.js').QrHttpServerOptions['getDirectInspectorUrl']
          >
        > => {
          if (!booted.relayHttpUrl) {
            return { ok: false, reason: 'relayDown' };
          }
          const targets = booted.connection.listTargets();
          if (targets.length === 0) {
            return { ok: false, reason: 'noTarget' };
          }
          const totpSecret = process.env.AIT_DEBUG_TOTP_SECRET;
          if (!totpSecret) {
            return { ok: false, reason: 'totpUnavailable' };
          }
          const url = buildChiiInspectorUrl(booted.relayHttpUrl, targets[0].id, () =>
            generateTotp(totpSecret, Date.now()),
          );
          if (url === null) {
            return { ok: false, reason: 'totpUnavailable' };
          }
          return { ok: true, url };
        };

        qrServer = await startQrHttpServer(getDashboardState, {
          dashboardPort: opts.dashboardPort,
          getDirectInspectorUrl,
        });

        // Wire the QR server into attachDeps BEFORE prepareAttach is called so
        // renderAndMaybeWait sees it and takes Path 2/3 (web-QR) instead of Path 4.
        attachDeps.qrHttpServer = qrServer;

        // Capture attach parts via onAttachUrlBuilt so getDashboardState can
        // mint a fresh URL (fresh TOTP at= code) on every dashboard render.
        attachDeps.onAttachUrlBuilt = (parts: AttachUrlParts) => {
          lastAttachParts = parts;
          qrServer?.notifyStateChange();
        };

        // devtools#772: parity with the MCP daemon path's onPageAttach/
        // onPageDetach wiring (debug-server.ts ~2348) — push an immediate SSE
        // update whenever the target set changes, so the dashboard's Inspector
        // section flips out of the waiting hint without waiting for the next
        // periodic SSE refresh. `server` is omitted (no MCP Server here — the
        // standalone runner has no tools/list to notify); startAttachWatcher
        // treats that as "skip sendToolListChanged" and runs the rest of its
        // signature-diff logic unchanged.
        attachWatcher = startAttachWatcher(
          booted.connection,
          undefined,
          1_000,
          () => qrServer?.notifyStateChange(),
          () => qrServer?.notifyStateChange(),
        );

        // Print the loopback dashboard URL to stderr — it carries no secrets
        // (TOTP codes and relay wss live only in the in-memory HTTP response).
        process.stderr.write(`devtools-test: QR dashboard: http://127.0.0.1:${qrServer.port}/\n`);
      } catch {
        // startQrHttpServer failed (e.g. port conflict, import error). Fall back
        // to the existing text-QR path by leaving qrHttpServer: undefined.
        // qrServer remains undefined; close() handles that with optional chaining.
      }

      // PRIMARY FIX (devtools#714): await tunnel readiness before calling
      // prepareAttach. Race: a 15 s timeout is generous — cloudflared typically
      // comes up in < 5 s. On timeout we still call prepareAttach; it will hit
      // the tunnel-down guard and throw a secret-free error (same as before,
      // but now with a clear diagnostic instead of a silent WAITING freeze).
      //
      // Implementation: Promise.race against a 15 000 ms timeout signal. We do
      // NOT use a timer-based early-exit because the existing code already
      // surface-fails on tunnel-down inside prepareAttach with a secret-free
      // message. The timeout here is purely a "give the tunnel a fair chance"
      // gate — not a correctness boundary.
      const TUNNEL_BOOT_TIMEOUT_MS = 15_000;
      await Promise.race([
        tunnelReady,
        new Promise<void>((resolve) => setTimeout(resolve, TUNNEL_BOOT_TIMEOUT_MS)),
      ]);

      // devtools#774: env 2 (launcher) vs env 3 (scheme) attach. The relay
      // boot / QR / dashboard / attach-wait above are identical for both — only
      // the attach-URL family differs. We reuse `prepareAttach`'s existing
      // `relay-mobile` branch (issue #378) rather than hand-rolling a second
      // assembly: it reads AIT_TUNNEL_BASE_URL, verifies the tunnel wss + TOTP
      // secret, and builds the launcher parts. We set that env var from
      // `opts.appUrl` here (scoped to this open()) so the same code path runs.
      // SECRET-HANDLING: appUrl is a tunnel host — set into the env only, never
      // logged; prepareAttach's relay-mobile branch never echoes it either.
      let prep: Awaited<ReturnType<typeof prepareAttach>>;
      if (opts.attachLauncher === true) {
        const priorTunnelBaseUrl = process.env.AIT_TUNNEL_BASE_URL;
        process.env.AIT_TUNNEL_BASE_URL = opts.appUrl ?? '';
        try {
          prep = await prepareAttach(attachDeps, 'relay-mobile', {}, booted.connection);
        } finally {
          // Restore the prior env value so we don't leak the tunnel host into
          // the process env past this attach (it is read only inside prepareAttach).
          if (priorTunnelBaseUrl === undefined) delete process.env.AIT_TUNNEL_BASE_URL;
          else process.env.AIT_TUNNEL_BASE_URL = priorTunnelBaseUrl;
        }
      } else {
        prep = await prepareAttach(
          attachDeps,
          'relay-dev',
          { scheme_url: opts.schemeUrl },
          booted.connection,
        );
      }
      if (!prep.ok) {
        booted.stop();
        family = undefined;
        // devtools#772: stop the attach watcher poller alongside the QR server
        // on this failure path (mirrors the qrServer cleanup below).
        attachWatcher?.stop();
        attachWatcher = undefined;
        // SECONDARY FIX (devtools#714): close the QR server on the failure path
        // so the loopback port listener does not leak. The normal-exit path is
        // handled by close(); this mirrors that cleanup for the error path.
        await qrServer?.close();
        qrServer = undefined;
        // SECRET-HANDLING: do NOT surface `prep.error.content` in the thrown
        // message. Some prep error paths build their text from attach
        // components, and the CLI catch writes `e.message` to stderr — embedding
        // that text risks leaking the scheme/relay wss URL. The detailed
        // diagnostic is the daemon/dashboard's job; the factory throws a
        // secret-free message only.
        throw new Error(
          'createRelayConnectionFactory: attach preparation failed — check the scheme_url and that the relay tunnel is up',
        );
      }

      // Render the QR + wait for the phone to attach. SECRET-HANDLING: this
      // function never logs scheme/wss/TOTP values.
      const waitResult = await renderAndMaybeWait(
        attachDeps,
        prep,
        true,
        timeoutMs,
        booted.connection,
      );
      if (waitResult.isError) {
        booted.stop();
        family = undefined;
        // devtools#772: stop the attach watcher poller alongside the QR server
        // on this failure path (mirrors the prep.ok failure path above).
        attachWatcher?.stop();
        attachWatcher = undefined;
        // SECONDARY FIX (devtools#714): close the QR server on the timeout path
        // (mirrors the prep.ok failure path above).
        await qrServer?.close();
        qrServer = undefined;
        // SECRET-HANDLING (BLOCKER fix): `waitResult.content` is the timeout
        // result built from `buildTimeoutError(baseText, ...)`, and `baseText`
        // is `JSON.stringify({ attachUrl, relayUrl, ... })` — `attachUrl` carries
        // the TOTP `at=` code and `relayUrl` is the relay `wss://` URL. The CLI
        // catch writes `e.message` to stderr, so extracting that text here would
        // leak the relay wss + TOTP code on every timeout. Throw a secret-free
        // message with only the timeout duration.
        const timeoutSec = Math.round(timeoutMs / 1000);
        throw new Error(
          `createRelayConnectionFactory: attach timed out after ${timeoutSec}s — phone did not scan the QR within the timeout`,
        );
      }

      // Surface the QR/attach render content to the caller, which owns the
      // stdout decision (suppress on non-interactive stdout). There is no
      // fallback that prints here itself: `onQrContent` is a required option so
      // the secret-bearing block (attachUrl TOTP + relayUrl wss) can never be
      // emitted without an explicit caller decision. SECRET-HANDLING.
      const qrChunks = waitResult.content
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .map((c) => c.text);
      opts.onQrContent(qrChunks);

      // PAGE-READY GATE (devtools#720, fix (a)+(b)):
      //
      // FIX (a) — ORDER: enableDomains() MUST run before injectDebugIndicator()
      // and injectGlobals(). Both inject calls use Runtime.evaluate via
      // sendCommand(), which guards with `if (!this.ws) reject("Call
      // enableDomains() first")`.  With the old ordering (inject → inject →
      // enableDomains) injectDebugIndicator's throw was swallowed by cell.ts
      // try/catch but injectGlobals (no try/catch) propagated fatally — when
      // --cell was set open() hard-threw before enableDomains ever ran and the
      // CLI exited with 0 files executed.
      //
      // FIX (b) — BOUNDED RETRY: the window between waitForFirstTarget (non-
      // empty /targets) and enableDomains (page-level WS open) is where a
      // Cloudflare edge idle-drop can disconnect the phone.  enableDomains()
      // calls refreshTargets() internally; if the target list is empty at that
      // point it throws "No mini-app page attached".  We absorb up to
      // PAGE_READY_RETRIES transient failures by waiting briefly and retrying
      // the refreshTargets+enableDomains sequence.  enableDomains() is
      // idempotent (concurrent callers share the in-flight promise), so retries
      // are safe.  Only after all retries fail do we surface a secret-free
      // error.  This is the CLI equivalent of the MCP daemon's soft-fail
      // cushion in relay-worker.ts.
      //
      // Neither fix touches chii-connection.ts or the MCP daemon path.
      const PAGE_READY_RETRIES = 3;
      const PAGE_READY_RETRY_DELAY_MS = 1_500;

      let lastEnableError: Error | undefined;
      for (let attempt = 1; attempt <= PAGE_READY_RETRIES; attempt++) {
        try {
          // FIX (a): enableDomains first — opens the page-level CDP websocket.
          await booted.connection.enableDomains();
          lastEnableError = undefined;
          break;
        } catch (err) {
          lastEnableError = err instanceof Error ? err : new Error(String(err));
          if (attempt < PAGE_READY_RETRIES) {
            // FIX (b): brief pause then re-poll /targets before retrying
            // enableDomains. Use a non-leaking approach: wait, then fall
            // through to the next loop iteration.
            await new Promise<void>((resolve) => setTimeout(resolve, PAGE_READY_RETRY_DELAY_MS));
          }
        }
      }

      if (lastEnableError !== undefined) {
        booted.stop();
        family = undefined;
        // devtools#772: stop the attach watcher poller alongside the QR server
        // on this failure path (mirrors the two failure paths above).
        attachWatcher?.stop();
        attachWatcher = undefined;
        await qrServer?.close();
        qrServer = undefined;
        // SECRET-HANDLING: message contains only a duration + attempt count.
        // No relay wss URL, scheme URL, or TOTP code is included.
        throw new Error(
          `createRelayConnectionFactory: page did not become ready after ${PAGE_READY_RETRIES} attempts (${Math.round((PAGE_READY_RETRIES * PAGE_READY_RETRY_DELAY_MS) / 1000)}s) — the mini-app page may have disconnected before enableDomains() could open the CDP websocket`,
        );
      }

      // FIX (a): inject AFTER enableDomains so the page-level CDP websocket is
      // open and sendCommand() will not hit the ws===null guard.

      // Show the on-phone "Debugger Connected" badge. injectDebugIndicator
      // swallows its own errors (cell.ts try/catch), so a badge failure is
      // non-fatal — test execution proceeds regardless.
      await injectDebugIndicator(booted.connection);

      // Inject the cell globals before any test bundle runs (session-global).
      // injectGlobals() does NOT swallow errors — a genuine type/eval failure
      // here surfaces clearly instead of silently skipping cell injection.
      if (opts.cell !== undefined) {
        await injectGlobals(booted.connection, { __AIT_CELL__: opts.cell });
      }

      // devtools#740 (DT-2): inject the bridge-stub gate before any test
      // bundle runs, session-global like __AIT_CELL__ above. Only injected
      // when explicitly requested — omitted/false means the sdk-redirect
      // module's `isStubBlockingEnabled()` reads `undefined`, which is
      // treated identically to `false` (zero-diff-when-off).
      if (opts.stubBlocking === true) {
        await injectGlobals(booted.connection, { __AIT_STUB_BLOCKING__: true });
      }

      // devtools#767: inject the page-side --pace pacing value, session-global
      // like __AIT_CELL__/__AIT_STUB_BLOCKING__ above. Only injected when
      // positive — omitted/0 means runtime.ts's own `__AIT_PACE_MS__` read
      // sees `undefined`, which its `typeof raw === 'number' && raw > 0` guard
      // treats identically to a literal `0` (zero-diff-when-off).
      if (opts.paceMs !== undefined && opts.paceMs > 0) {
        await injectGlobals(booted.connection, { __AIT_PACE_MS__: opts.paceMs });
      }

      // devtools#769: inject the page-side --pace-method pacing value,
      // session-global like __AIT_PACE_MS__ above. Only injected when
      // positive — omitted/0 means method-pace.ts's own
      // `__AIT_PACE_METHOD_MS__` read sees `undefined`, which its
      // `typeof raw === 'number' && raw > 0` guard treats identically to a
      // literal `0` (zero-diff-when-off).
      if (opts.paceMethodMs !== undefined && opts.paceMethodMs > 0) {
        await injectGlobals(booted.connection, { __AIT_PACE_METHOD_MS__: opts.paceMethodMs });
      }

      return booted.connection;
    },

    // #730: drives the dashboard's `phase` field so the CLI's run start/end
    // push an immediate SSE update instead of the dashboard just going dark.
    onSessionPhase(next: 'running' | 'complete'): void {
      phase = next;
      qrServer?.notifyStateChange();
    },

    // #741: drives the dashboard's `manualPrompt` field for --manual-blocking
    // — the CLI calls this immediately before injecting each manual file
    // (prompt set) and once more with `null` after the last one (prompt
    // cleared). Push is immediate (not waited on for ack) — v1 does not block
    // on dashboard acknowledgment, only on the file's own (long) evaluate.
    onManualPrompt(next: { file: string; index: number; total: number } | null): void {
      manualPrompt = next;
      qrServer?.notifyStateChange();
    },

    async close(connection: CdpConnection): Promise<void> {
      // #730: flip the on-phone badge to disconnected AND push the terminal
      // dashboard frame BEFORE tearing anything down, so neither surface goes
      // dark without explanation when the CLI exits (dog-food gaps #1 + #2).
      // Both are best-effort over the still-open channels — the ordering
      // (before family.stop()/qrServer.close()) is load-bearing:
      //   - qrServer.notifyStateChange() writes synchronously to the still-open
      //     SSE sockets, so the 'complete' frame is on the wire before the HTTP
      //     server is closed below.
      //   - injectDebugIndicator runs over the still-open CDP channel, so the
      //     phone actually receives the disconnected-state update before the
      //     relay/tunnel are torn down.
      if (phase !== 'complete') {
        phase = 'complete';
        qrServer?.notifyStateChange();
      }
      try {
        const { injectDebugIndicator } = await import('./cell.js');
        await injectDebugIndicator(connection, { state: 'disconnected' });
      } catch {
        // Channel may already be down (e.g. attach never completed) — non-fatal,
        // the badge is informational UI only.
      }
      // family.stop() is synchronous best-effort: closes the CDP connection and
      // shuts down the relay + cloudflared child.
      family?.stop();
      family = undefined;
      // devtools#772: stop the attach watcher poller before closing the QR
      // server it pushes into — idempotent via optional chaining.
      attachWatcher?.stop();
      attachWatcher = undefined;
      // Close the web-QR HTTP server if one was started during open().
      // close() is idempotent via optional chaining + reassignment to undefined.
      await qrServer?.close();
      qrServer = undefined;
    },
  };
}
