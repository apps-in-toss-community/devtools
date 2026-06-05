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
   * production 환경에서도 devtools를 강제로 활성화 (default: false)
   */
  forceEnable?: boolean;
  /**
   * mock alias 활성화 여부. default: true (development), false (production + forceEnable)
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
   * Vite dev 서버를 Cloudflare quick tunnel(`*.trycloudflare.com`, 계정 불필요)로
   * 외부 노출해 실제 폰에서 미리보기. **Vite dev 모드 전용** — production은
   * `forceEnable`이어도 터널을 띄우지 않는다 (의도치 않은 노출 방지). 다른 번들러는
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

const aitDevtoolsPlugin = createUnplugin((options?: AitDevtoolsOptions) => {
  const isDev = process.env.NODE_ENV !== 'production';
  const shouldEnable = isDev || (options?.forceEnable ?? false);
  const shouldMock = shouldEnable && (options?.mock ?? isDev);
  const shouldPanel = shouldEnable && (options?.panel ?? true);
  const shouldMcp = shouldEnable && (options?.mcp ?? false);

  // In-memory store for the last state snapshot pushed by the browser panel.
  // Only allocated when mcp: true to avoid any overhead in the common case.
  let lastState: string | null = null;

  // Tunnel is dev-only and Vite-only. Never under production — even with
  // forceEnable — so a production build can't accidentally expose itself.
  const tunnelOpt = options?.tunnel;
  const shouldTunnel = isDev && !!tunnelOpt;
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
        if (!shouldTunnel) return;
        // Vite blocks requests whose Host header isn't in `server.allowedHosts`
        // (defaults to localhost only). The quick-tunnel hostname is random per
        // run, so allow the whole `.trycloudflare.com` suffix while the tunnel
        // is on. (A leading `.` makes Vite match the domain and its subdomains.)
        return { server: { allowedHosts: ['.trycloudflare.com'] } };
      },

      configureServer(server: import('vite').ViteDevServer) {
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
              .then(async ({ startQuickTunnel, printTunnelBanner }) => {
                const t = await startQuickTunnel(port);
                tunnel = t;

                // env-2 CDP: boot a Chii relay (OS-assigned local port) and a
                // second quick tunnel to it. The relay's https tunnel URL becomes
                // the `wss://` relay the launcher QR carries (&debug=1&relay=).
                let relayWssUrl: string | undefined;
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
                    const r = await startChiiRelay({ port: 0, verifyAuth });
                    relay = r;
                    const rt = await startQuickTunnel(r.port);
                    relayTunnel = rt;
                    relayWssUrl = rt.url.replace(/^https:/, 'wss:');
                  } catch (err: unknown) {
                    console.warn(
                      `[@ait-co/devtools] tunnel: CDP relay not started — screen preview works without on-device debugging: ${
                        err instanceof Error ? err.message : String(err)
                      }`,
                    );
                  }
                }

                await printTunnelBanner(t.url, { qr: tunnelConfig.qr, relayWssUrl });
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
            tunnel?.stop();
            relayTunnel?.stop();
            void relay?.close();
          };
          httpServer?.once('close', cleanup);
          process.once('SIGINT', cleanup);
          process.once('SIGTERM', cleanup);
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
