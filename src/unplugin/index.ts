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
      };
}

const FRAMEWORK_ID = '@apps-in-toss/web-framework';
const BRIDGE_ID = '@apps-in-toss/web-bridge';
const ANALYTICS_ID = '@apps-in-toss/web-analytics';

const aitDevtoolsPlugin = createUnplugin((options?: AitDevtoolsOptions) => {
  const isDev = process.env.NODE_ENV !== 'production';
  const shouldEnable = isDev || (options?.forceEnable ?? false);
  const shouldMock = shouldEnable && (options?.mock ?? isDev);
  const shouldPanel = shouldEnable && (options?.panel ?? true);
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
      if (id === FRAMEWORK_ID || id === BRIDGE_ID || id === ANALYTICS_ID) {
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

    // Vite-only: start a Cloudflare quick tunnel once the dev server is
    // listening. unplugin passes this through to Vite's plugin object; other
    // bundlers ignore it.
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
        if (!shouldTunnel) return;
        let tunnel: { stop: () => void } | null = null;
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
              await printTunnelBanner(t.url, { qr: tunnelConfig.qr });
            })
            .catch((err: unknown) => {
              console.warn(
                `[@ait-co/devtools] tunnel failed to start: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
            });
        });

        const cleanup = () => tunnel?.stop();
        httpServer?.once('close', cleanup);
        process.once('SIGINT', cleanup);
        process.once('SIGTERM', cleanup);
        process.once('exit', cleanup);
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
