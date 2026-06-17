/**
 * @ait-co/devtools unplugin
 *
 * 모든 주요 번들러를 지원하는 단일 플러그인.
 * @apps-in-toss/web-framework → @ait-co/devtools/mock 으로 alias 설정.
 *
 * Usage:
 *   import aitDevtools from '@ait-co/devtools/unplugin';
 *
 *   // Vite
 *   export default { plugins: [aitDevtools.vite()] };
 *
 *   // Webpack / Next.js
 *   config.plugins.push(aitDevtools.webpack());
 *
 *   // Rspack
 *   config.plugins.push(aitDevtools.rspack());
 *
 *   // esbuild
 *   { plugins: [aitDevtools.esbuild()] }
 *
 *   // Rollup
 *   { plugins: [aitDevtools.rollup()] }
 */

import { fileURLToPath } from 'node:url';
import { createUnplugin } from 'unplugin';
import { startParentWatcher } from '../shared/parent-watcher.js';
import {
  ensureMachineConsent,
  type MachineTelemetryState,
  writeMachineState,
} from '../telemetry/machine-state.js';
import { CURRENT_POLICY_VERSION } from '../telemetry/state.js';

/**
 * Resolve `@ait-co/devtools/mock` to its real file path at plugin-load time.
 *
 * Returning the bare specifier from `resolveId` would stop the bundler from
 * walking node_modules for it — Vite 8+ treats such a non-null string as the
 * final resolved id and serves it via the virtual `/@id/` prefix, which 404s
 * because we don't provide a `load` hook. Resolving to an absolute path here
 * lets every supported bundler load the file the normal way.
 */
const MOCK_PATH = (() => {
  try {
    return fileURLToPath(import.meta.resolve('@ait-co/devtools/mock'));
  } catch {
    // Fallback for runtimes where `import.meta.resolve` is unavailable.
    return '@ait-co/devtools/mock';
  }
})();

export interface AitDevtoolsOptions {
  /**
   * 패널 자동 주입 여부 (default: true)
   * true이면 진입점에 floating panel import를 자동 추가한다.
   */
  panel?: boolean;
  /**
   * mock alias 활성화 여부. default: true (development), false (production)
   */
  mock?: boolean;
  /**
   * Vite dev server에 MCP state endpoint를 추가할지 여부 (default: false).
   *
   * `true`로 설정하면:
   *  - GET  /api/ait-devtools/state  — 마지막으로 브라우저가 push한 mock state 스냅샷 반환
   *  - POST /api/ait-devtools/state  — 브라우저 panel이 상태 변경 시 자동 push (panel 내부 처리)
   *
   * 이 endpoint를 `@ait-co/devtools` MCP stdio server가 읽어 AI 에이전트에 mock state를 노출한다.
   * Vite 전용: webpack/rspack/esbuild/rollup 환경에서는 무시된다.
   */
  mcp?: boolean;
  /**
   * 미니앱의 webViewType (`granite.config.ts`의 `webViewProps.type`)을 빌드 상수
   * `__WEB_VIEW_TYPE__`로 주입한다 (#580). **Vite 전용** (다른 번들러는 무시).
   *
   * 이 상수는 in-app self-report(`@ait-co/devtools/in-app`)가 읽어 launcher(env-2
   * PWA)에 webViewType을 postMessage로 알리고, launcher가 game 타입 미니앱에서
   * 수동 `?navBarType=game` URL 편집 없이 game 모드로 자동 진입하게 한다.
   *
   * 미지정 시 `'partner'`(web-framework `webViewProps.type`의 `@default`)로 주입한다.
   * `game`이면 게임 모드로 자동 진입한다. (granite.config.ts를 config 시점에
   * 자동으로 읽는 것은 TS 모듈 로더가 필요해 보류 — 명시 옵션으로 신뢰성 확보, #580.)
   */
  webViewType?: 'partner' | 'game';
  /**
   * 미니앱의 `granite.config.ts` `navigationBar.transparentBackground` 값
   * (SDK `@apps-in-toss/plugins@2.8.0` 신규 필드, #587). `true`이면 env-2 launcher
   * deep-link에 `&navBarTransparent=1`을 주입해 launcher partner bar가 투명 배경으로
   * 렌더된다. granite.config를 직접 읽지 않는다(version-agnostic, #580 원칙) —
   * 소비자 vite.config가 `graniteConfig.navigationBar?.transparentBackground`를
   * import해 이 옵션으로 넘긴다. 미지정 시 주입 안 함(URL 청정, back-compat).
   */
  navBarTransparent?: boolean;
  /**
   * 미니앱의 `granite.config.ts` `navigationBar.theme` 값
   * (SDK `@apps-in-toss/plugins@2.8.0` 신규 필드, #587). `'light'` 또는 `'dark'`이면
   * env-2 launcher deep-link에 `&navBarTheme=<v>`를 주입해 launcher partner bar가
   * 해당 테마 글자/아이콘 색으로 렌더된다. granite.config를 직접 읽지 않는다
   * (version-agnostic, #580 원칙). 미지정 시 주입 안 함(URL 청정, back-compat).
   */
  navBarTheme?: 'light' | 'dark';
  /**
   * Vite dev 서버를 Cloudflare quick tunnel(`*.trycloudflare.com`, 계정 불필요)로
   * 외부 노출해 실제 폰에서 미리보기. **Vite dev 모드 전용** — production에서는
   * 터널을 띄우지 않는다 (의도치 않은 노출 방지). 다른 번들러는
   * 무시. `true`면 기본 동작, 객체로 세부 설정 가능.
   */
  tunnel?:
    | boolean
    | {
        /** 노출할 포트 (미지정 시 dev 서버가 실제 listen한 포트 자동 감지). */
        port?: number;
        /** 터미널 ASCII QR 출력 (default: true). */
        qr?: boolean;
        /**
         * 환경 2(실기기 PWA)에 CDP 디버깅 배선 (default: false).
         *
         * `true`면 dev 서버 HTTP 터널과 **별도로** Chii relay를 띄우고 그 relay에
         * 두 번째 quick tunnel을 붙여, launcher QR deep-link에 `&debug=1&relay=<wss>`를
         * 실어 보낸다. 폰의 PWA iframe이 in-app debug gate를 통과해 target.js를 주입받고,
         * AI host MCP가 그 relay에 client로 붙으면 실기기 WebKit 위에서 CDP 디버깅이 열린다.
         * mock SDK는 그대로라 `call_sdk`는 환경 2에서 mock을 친다 (fidelity 사다리의
         * 설계 의도 — SDK fidelity가 필요하면 환경 3로 올라간다).
         */
        cdp?: boolean;
      };
}

const FRAMEWORK_ID = '@apps-in-toss/web-framework';
const BRIDGE_ID = '@apps-in-toss/web-bridge'; // back-compat (2.x)
const ANALYTICS_ID = '@apps-in-toss/web-analytics'; // back-compat (2.x)
const WEBVIEW_BRIDGE_ID = '@apps-in-toss/webview-bridge'; // 3.0+

/** MCP state endpoint path — browser panel POSTs here, MCP server GETs here */
const MCP_STATE_PATH = '/api/ait-devtools/state';

/**
 * Machine-level telemetry consent endpoint (#542).
 *
 * GET  → returns current machine consent state as JSON (for the panel to read
 *         and skip the toast when already decided).
 * POST → panel or environment-tab toggle writes new consent back to the machine
 *        file (body: { consent: 'granted' | 'denied', policy_version: string }).
 *
 * Always registered (not gated on `mcp: true`) — the panel needs this
 * unconditionally when the dev server is running.
 */
const TELEMETRY_CONSENT_PATH = '/api/ait-devtools/telemetry-consent';

/**
 * Resolves the effective tunnel option (#425).
 *
 * An explicit `tunnel` value (including `false`) always takes priority over
 * env vars — the `??` operator means `undefined` (= omitted) falls through,
 * but `false` / `true` / an object are preserved as-is (non-breaking).
 *
 * When the option is omitted:
 * - `AIT_TUNNEL=1` enables the base screen-preview tunnel.
 * - `AIT_TUNNEL_CDP=1` (requires `AIT_TUNNEL`) upgrades to the CDP relay.
 * - Neither set → `false` (disabled).
 *
 * Extracted as a pure function so it can be unit-tested without standing up
 * a full Vite dev server.
 *
 * @param explicit - The `tunnel` option as passed by the consumer (or `undefined` when omitted).
 * @param env - The process environment (injectable for testing).
 */
export function resolveTunnelOption(
  explicit: AitDevtoolsOptions['tunnel'],
  env: Record<string, string | undefined>,
): AitDevtoolsOptions['tunnel'] {
  return explicit ?? (env.AIT_TUNNEL ? { cdp: !!env.AIT_TUNNEL_CDP } : false);
}

const aitDevtoolsPlugin = createUnplugin((options?: AitDevtoolsOptions) => {
  const isDev = process.env.NODE_ENV !== 'production';
  const shouldEnable = isDev;
  const shouldMock = shouldEnable && (options?.mock ?? isDev);
  const shouldPanel = shouldEnable && (options?.panel ?? true);
  const shouldMcp = shouldEnable && (options?.mcp ?? false);

  // In-memory store for the last state snapshot pushed by the browser panel.
  // Only allocated when mcp: true to avoid any overhead in the common case.
  let lastState: string | null = null;

  // Tunnel is dev-only and Vite-only. Never under production, so a production
  // build can't accidentally expose itself.
  //
  // Tunnel toggle resolution (#425): an explicit `tunnel` option always wins;
  // when omitted, fall back to the AIT_TUNNEL / AIT_TUNNEL_CDP env vars so a
  // consumer needs no `tunnel:` line in vite.config to enable env-2 preview.
  // AIT_TUNNEL gates the base (screen preview); AIT_TUNNEL_CDP upgrades to the
  // CDP relay. Production safety is unchanged — the existing
  // `shouldTunnel = isDev && !!tunnelOpt` guard below still blocks prod builds.
  const tunnelOpt = resolveTunnelOption(options?.tunnel, process.env);
  const shouldTunnel = isDev && !!tunnelOpt;

  // #580: webViewType build constant. Injected as a Vite `define` so the
  // in-app self-report can post it to the launcher for game-mode auto-entry.
  // Defaults to 'partner' (web-framework webViewProps.type @default).
  const webViewType = options?.webViewType ?? 'partner';
  // #587: navigationBar appearance options (SDK 2.8.0 granite.config fields).
  // Forwarded to printTunnelBanner so the launcher deep-link carries the params.
  const navBarTransparent = options?.navBarTransparent;
  const navBarTheme = options?.navBarTheme;
  const tunnelConfig = typeof tunnelOpt === 'object' ? tunnelOpt : {};

  return {
    name: 'ait-co-devtools',
    enforce: 'pre' as const,

    resolveId(id: string) {
      if (!shouldMock) return null;
      // @apps-in-toss/web-framework → @ait-co/devtools/mock (absolute path)
      if (
        id === FRAMEWORK_ID ||
        id === WEBVIEW_BRIDGE_ID ||
        id === BRIDGE_ID ||
        id === ANALYTICS_ID
      ) {
        return MOCK_PATH;
      }
      return null;
    },

    transformInclude(id: string) {
      if (!shouldPanel) return false;
      // 진입점 파일에만 패널 import를 주입
      return (
        /\.(tsx?|jsx?)$/.test(id) &&
        /\/(main|index|entry|app)\.[tj]sx?$/i.test(id) &&
        !id.includes('node_modules')
      );
    },

    transform(code: string) {
      // transformInclude가 이미 shouldPanel을 확인하지만, 안전망으로 유지
      if (!shouldPanel) return null;
      // 이미 패널이 import 되어있으면 스킵
      if (code.includes('@ait-co/devtools/panel')) return null;
      // transformInclude가 진입점 파일만 통과시키므로 바로 prepend
      return `import '@ait-co/devtools/panel';\n${code}`;
    },

    // Vite-only: register the MCP state HTTP endpoint on the dev server, and
    // optionally start a Cloudflare quick tunnel once the dev server is listening.
    // Non-Vite bundlers do not have a dev server concept so this is silently
    // skipped (unplugin passes `vite` key only when building for Vite).
    vite: {
      config() {
        // #580: inject the webViewType build constant for every Vite build so
        // the in-app self-report (@ait-co/devtools/in-app) can read it and post
        // it to the launcher (env-2 PWA) for game-mode auto-entry. JSON.stringify
        // makes it a string literal at the define substitution site.
        const define = { __WEB_VIEW_TYPE__: JSON.stringify(webViewType) };
        if (!shouldTunnel) return { define };
        // Vite blocks requests whose Host header isn't in `server.allowedHosts`
        // (defaults to localhost only). The quick-tunnel hostname is random per
        // run, so allow the whole `.trycloudflare.com` suffix while the tunnel
        // is on. (A leading `.` makes Vite match the domain and its subdomains.)
        return { define, server: { allowedHosts: ['.trycloudflare.com'] } };
      },

      configureServer(server: import('vite').ViteDevServer) {
        // Machine-level telemetry consent endpoint (#542): always registered when
        // the dev server is enabled so the panel can read/write consent across
        // origin rotations (tunnel host changes, port changes).
        //
        // We lazily initialise `machineConsent` once the server is ready. The
        // TTY prompt runs synchronously inside the `listening` event so it
        // appears in the same terminal window before any dev-server noise.
        let machineConsent: MachineTelemetryState | null = null;

        // Start the machine-consent bootstrap as soon as configureServer runs.
        // Fire-and-forget; errors are caught and logged. The endpoint guards
        // against `machineConsent === null` with a 503 during the brief boot.
        if (shouldEnable) {
          server.httpServer?.once('listening', () => {
            ensureMachineConsent(CURRENT_POLICY_VERSION)
              .then((state) => {
                machineConsent = state;
              })
              .catch((err: unknown) => {
                // Non-fatal — panel will fall back to localStorage behaviour.
                console.warn(
                  `[@ait-co/devtools] machine consent init failed: ${
                    err instanceof Error ? err.message : String(err)
                  }`,
                );
              });
          });

          // Telemetry consent endpoint — CORS open (localhost only in practice).
          server.middlewares.use(TELEMETRY_CONSENT_PATH, (req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

            if (req.method === 'OPTIONS') {
              res.writeHead(204);
              res.end();
              return;
            }

            if (req.method === 'GET') {
              if (machineConsent === null) {
                // Still booting — panel should fall back to localStorage.
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Machine consent not yet initialised.' }));
                return;
              }
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(machineConsent));
              return;
            }

            if (req.method === 'POST') {
              const chunks: Buffer[] = [];
              req.on('data', (chunk: Buffer) => chunks.push(chunk));
              req.on('end', () => {
                try {
                  const body = Buffer.concat(chunks).toString('utf-8');
                  const payload = JSON.parse(body) as {
                    consent?: string;
                    policy_version?: string;
                  };

                  const consent = payload.consent;
                  if (consent !== 'granted' && consent !== 'denied' && consent !== 'undecided') {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(
                      JSON.stringify({
                        error: 'Invalid consent value. Expected granted | denied | undecided.',
                      }),
                    );
                    return;
                  }

                  writeMachineState({
                    consent,
                    policy_version: payload.policy_version ?? CURRENT_POLICY_VERSION,
                  })
                    .then(async () => {
                      // Update the in-memory cache.
                      const { readMachineState } = await import('../telemetry/machine-state.js');
                      machineConsent = await readMachineState();
                      res.writeHead(204);
                      res.end();
                    })
                    .catch((err: unknown) => {
                      res.writeHead(500, { 'Content-Type': 'application/json' });
                      res.end(
                        JSON.stringify({
                          error: `Write failed: ${err instanceof Error ? err.message : String(err)}`,
                        }),
                      );
                    });
                  return;
                } catch {
                  res.writeHead(400, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ error: 'Invalid JSON body.' }));
                }
              });
              return;
            }

            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed' }));
          });
        }

        // MCP state endpoint: browser panel POSTs state here, MCP stdio server GETs it.
        if (shouldMcp) {
          server.middlewares.use(MCP_STATE_PATH, (req, res) => {
            // Allow Claude Code / AI agents (running locally) to read state
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

            if (req.method === 'OPTIONS') {
              res.writeHead(204);
              res.end();
              return;
            }

            if (req.method === 'GET') {
              if (lastState === null) {
                res.writeHead(503, { 'Content-Type': 'application/json' });
                res.end(
                  JSON.stringify({
                    error: 'No state received yet. Open the app in a browser first.',
                  }),
                );
                return;
              }
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(lastState);
              return;
            }

            if (req.method === 'POST') {
              const chunks: Buffer[] = [];
              req.on('data', (chunk: Buffer) => chunks.push(chunk));
              req.on('end', () => {
                try {
                  const body = Buffer.concat(chunks).toString('utf-8');
                  // Validate it's parseable JSON before caching
                  JSON.parse(body);
                  lastState = body;
                  res.writeHead(204);
                  res.end();
                } catch {
                  res.writeHead(400, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ error: 'Invalid JSON' }));
                }
              });
              return;
            }

            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed' }));
          });
        }

        // Tunnel: start a Cloudflare quick tunnel once the dev server is listening.
        if (shouldTunnel) {
          let tunnel: { stop: () => void } | null = null;
          // env-2 CDP wiring (tunnel.cdp): a second tunnel + Chii relay, torn
          // down alongside the HTTP tunnel. Fire-and-forget close on teardown.
          let relayTunnel: { stop: () => void } | null = null;
          let relay: { close: () => Promise<void> } | null = null;
          // env-2 HTML dashboard (issue #408): local 127.0.0.1 HTTP server that
          // serves the QR + connect-steps + FAQ page (env 3/4 UX parity), opened
          // in the browser when CDP is wired + GUI present. Torn down with the
          // tunnel. Only set when the dashboard actually started.
          let qrDashboard: { close: () => Promise<void> } | null = null;
          // env-2 URL file store (#424): captured after the first writeRelayUrls
          // call so cleanup() can call deleteRelayUrls without a re-import.
          // SECRET-HANDLING: the stored function reference never carries URL values.
          let relayUrlDeleteFn: ((projectRoot: string) => Promise<void>) | null = null;
          // #420: parent-PID watcher — self-terminate when vite's parent dies so
          // cloudflared children don't become zombies holding stale tunnels.
          let parentWatcher: { stop(): void } | null = null;
          const httpServer = server.httpServer;

          httpServer?.once('listening', () => {
            const address = httpServer?.address();
            const port =
              tunnelConfig.port ??
              (address && typeof address === 'object' ? address.port : undefined);
            if (!port) {
              console.warn(
                '[@ait-co/devtools] tunnel: could not determine the dev server port; skipping.',
              );
              return;
            }
            // Dynamic import keeps `cloudflared` / `qrcode-terminal` off the
            // module graph unless the tunnel is actually used.
            import('./tunnel.js')
              .then(async ({ startQuickTunnel, printTunnelBanner, startTunnelDashboard }) => {
                const t = await startQuickTunnel(port);
                tunnel = t;

                // env-2 CDP: boot a Chii relay (OS-assigned local port) and a
                // second quick tunnel to it. The relay's https tunnel URL becomes
                // the `wss://` relay the launcher QR carries (&debug=1&relay=).
                let relayWssUrl: string | undefined;
                // SECRET-HANDLING: relayHttpUrl carries the relay host — never logged.
                let relayHttpUrl: string | undefined;
                // LOCAL relay base — loopback URL, safe to surface (issue #530).
                let relayLocalHttpUrl: string | undefined;
                if (tunnelConfig.cdp) {
                  try {
                    // Relay-auth baseline (issue #250): the env-2 CDP relay is
                    // reachable over a public `*.trycloudflare.com` tunnel, so a
                    // configured TOTP secret is MANDATORY and the relay enforces
                    // it on every WS upgrade.
                    //
                    // First-run auto-mint (issue #394, project-local #396): if
                    // AIT_DEBUG_TOTP_SECRET is not yet set, ensureRelaySecret()
                    // mints a 256-bit random secret, persists it to the project-
                    // local file <project>/.ait_relay (0600, anchored at the
                    // nearest package.json directory above server.config.root),
                    // and injects it into process.env so the following
                    // assertRelayAuthConfigured() call succeeds. On subsequent
                    // runs the persisted value is loaded silently — no manual
                    // export needed. The MCP daemon reads the SAME file read-only
                    // via loadRelaySecretReadOnly() when switching to a relay env.
                    // SECRET-HANDLING: neither ensureRelaySecret nor the
                    // guard/predicate log the secret value.
                    const { ensureRelaySecret } = await import('../mcp/relay-secret-store.js');
                    await ensureRelaySecret({ projectRoot: server.config.root });
                    const { assertRelayAuthConfigured, buildRelayVerifyAuth } = await import(
                      '../mcp/totp.js'
                    );
                    assertRelayAuthConfigured();
                    const verifyAuth = buildRelayVerifyAuth();
                    const { startChiiRelay } = await import('../mcp/chii-relay.js');
                    // Issue #467: this relay lives in the vite process, so the
                    // MCP daemon's get_debug_status counter cannot see its 401s.
                    // Surface a throttled hint in the vite terminal instead.
                    // SECRET-HANDLING: fixed message only — no URL, code, host.
                    let lastAuthRejectWarnAt = 0;
                    const r = await startChiiRelay({
                      port: 0,
                      verifyAuth,
                      onAuthReject: () => {
                        const nowMs = Date.now();
                        if (nowMs - lastAuthRejectWarnAt < 10_000) return;
                        lastAuthRejectWarnAt = nowMs;
                        console.warn(
                          '[@ait-co/devtools] tunnel: relay 인증(TOTP) 거부 감지 — 폰에서 QR을 다시 스캔하세요 (코드는 ~3분마다 만료)',
                        );
                      },
                    });
                    relay = r;
                    const rt = await startQuickTunnel(r.port);
                    relayTunnel = rt;
                    // SECRET-HANDLING: rt.url is the https relay base — stored in
                    // relayHttpUrl for .ait_urls write below; never logged.
                    relayHttpUrl = rt.url;
                    relayWssUrl = rt.url.replace(/^https:/, 'wss:');
                    // LOCAL relay base for MCP inspector URL assembly (issue #530):
                    // the relay process runs on this machine, so the inspector
                    // front_end + client WS can use the loopback address directly —
                    // no tunnel round-trip for the developer's browser.
                    // Safe to surface: loopback URL contains no tunnel host.
                    relayLocalHttpUrl = `http://127.0.0.1:${r.port}`;
                  } catch (err: unknown) {
                    console.warn(
                      `[@ait-co/devtools] tunnel: CDP relay not started — screen preview works without on-device debugging: ${
                        err instanceof Error ? err.message : String(err)
                      }`,
                    );
                  }
                }

                // Read the app name from the project's package.json to add to
                // the launcher deep-link (#498). Failure is silently ignored.
                let tunnelAppName: string | undefined;
                try {
                  const { readFileSync } = await import('node:fs');
                  const pkgPath = `${server.config.root}/package.json`;
                  const pkgRaw = readFileSync(pkgPath, 'utf8');
                  const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
                  const rawName = typeof pkg.name === 'string' ? pkg.name : '';
                  const stripped = rawName.includes('/')
                    ? rawName.slice(rawName.indexOf('/') + 1)
                    : rawName;
                  tunnelAppName = stripped.trim() || undefined;
                } catch {
                  // Silently ignore — fail-open.
                }

                await printTunnelBanner(t.url, {
                  qr: tunnelConfig.qr,
                  relayWssUrl,
                  name: tunnelAppName,
                  webViewType,
                  navBarTransparent,
                  navBarTheme,
                });

                // env-2 URL file-based discovery (#424): write .ait_urls so the
                // MCP daemon can discover the relay/tunnel URLs without manual env
                // var copy-paste. SECRET-HANDLING: URL values are never logged.
                // Capture deleteRelayUrls in the outer-scope fn so cleanup() can
                // call it without re-importing (no async in signal handlers).
                const { writeRelayUrls, deleteRelayUrls } = await import(
                  '../mcp/relay-url-store.js'
                );
                await writeRelayUrls({
                  projectRoot: server.config.root,
                  tunnelBaseUrl: t.url,
                  ...(relayHttpUrl !== undefined ? { relayBaseUrl: relayHttpUrl } : {}),
                  // Issue #530: local relay base for inspector URL (loopback, no tunnel host).
                  ...(relayLocalHttpUrl !== undefined ? { relayLocalUrl: relayLocalHttpUrl } : {}),
                });
                relayUrlDeleteFn = (root: string) => deleteRelayUrls({ projectRoot: root });

                // env-2 HTML dashboard (issue #408): when CDP is wired and a GUI
                // is present, serve the same QR+FAQ dashboard env 3/4 uses and
                // open it in the browser. No-op (returns undefined) for the
                // screen-only tunnel, headless, qr:false, or AIT_AUTO_DEVTOOLS=0
                // — the ASCII QR above remains the fallback in those cases.
                if (relayWssUrl) {
                  qrDashboard =
                    (await startTunnelDashboard({
                      tunnelUrl: t.url,
                      relayWssUrl,
                      qr: tunnelConfig.qr,
                      name: tunnelAppName,
                    })) ?? null;
                }

                // #420: start watching the parent PID now that tunnel resources
                // are allocated. When the parent dies/reparents, clean up
                // synchronously (stops cloudflared children) then exit.
                parentWatcher = startParentWatcher(() => {
                  cleanup();
                  process.exit(0);
                });
              })
              .catch((err: unknown) => {
                console.warn(
                  `[@ait-co/devtools] tunnel failed to start: ${
                    err instanceof Error ? err.message : String(err)
                  }`,
                );
              });
          });

          const cleanup = () => {
            parentWatcher?.stop();
            tunnel?.stop();
            relayTunnel?.stop();
            void relay?.close();
            void qrDashboard?.close();
            // env-2 URL file cleanup (#424): remove .ait_urls on teardown so a
            // stale file doesn't cause the MCP daemon to attempt a doomed attach.
            // SECRET-HANDLING: relayUrlDeleteFn never logs the path or URL values.
            void relayUrlDeleteFn?.(server.config.root);
          };
          httpServer?.once('close', cleanup);
          process.once('SIGINT', cleanup);
          process.once('SIGTERM', cleanup);
          process.once('SIGHUP', cleanup);
          process.once('exit', cleanup);
        }
      },
    },
  };
});

export const vite = aitDevtoolsPlugin.vite;
export const webpack = aitDevtoolsPlugin.webpack;
export const rollup = aitDevtoolsPlugin.rollup;
export const esbuild = aitDevtoolsPlugin.esbuild;
export const rspack = aitDevtoolsPlugin.rspack;

export default aitDevtoolsPlugin;
