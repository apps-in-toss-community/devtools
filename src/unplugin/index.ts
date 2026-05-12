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
}

const FRAMEWORK_ID = '@apps-in-toss/web-framework';
const BRIDGE_ID = '@apps-in-toss/web-bridge';
const ANALYTICS_ID = '@apps-in-toss/web-analytics';

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

    // Vite-only: register the MCP state HTTP endpoint on the dev server.
    // Non-Vite bundlers do not have a dev server concept so this is silently
    // skipped (unplugin passes `vite` key only when building for Vite).
    vite: shouldMcp
      ? {
          configureServer(server) {
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
                  } catch {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Invalid JSON' }));
                  }
                  res.end();
                });
                return;
              }

              res.writeHead(405, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Method not allowed' }));
            });
          },
        }
      : undefined,
  };
});

export const vite = aitDevtoolsPlugin.vite;
export const webpack = aitDevtoolsPlugin.webpack;
export const rollup = aitDevtoolsPlugin.rollup;
export const esbuild = aitDevtoolsPlugin.esbuild;
export const rspack = aitDevtoolsPlugin.rspack;

export default aitDevtoolsPlugin;
