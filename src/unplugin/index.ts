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

import { createUnplugin } from 'unplugin';

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
}

const FRAMEWORK_ID = '@apps-in-toss/web-framework';
const BRIDGE_ID = '@apps-in-toss/web-bridge';
const ANALYTICS_ID = '@apps-in-toss/web-analytics';

const aitDevtoolsPlugin = createUnplugin((options?: AitDevtoolsOptions) => {
  const isDev = process.env.NODE_ENV !== 'production';
  const shouldEnable = isDev || (options?.forceEnable ?? false);
  const shouldMock = shouldEnable && (options?.mock ?? isDev);
  const shouldPanel = shouldEnable && (options?.panel ?? true);

  return {
    name: 'ait-co-devtools',
    enforce: 'pre' as const,

    resolveId(id: string) {
      if (!shouldMock) return null;
      // @apps-in-toss/web-framework → @ait-co/devtools/mock
      if (id === FRAMEWORK_ID || id === BRIDGE_ID || id === ANALYTICS_ID) {
        return '@ait-co/devtools/mock';
      }
      return null;
    },

    transformInclude(id: string) {
      if (!shouldPanel) return false;
      // 진입점 파일에만 패널 import를 주입
      return /\.(tsx?|jsx?)$/.test(id) && /\/(main|index|entry|app)\.[tj]sx?$/i.test(id) && !id.includes('node_modules');
    },

    transform(code: string) {
      // transformInclude가 이미 shouldPanel을 확인하지만, 안전망으로 유지
      if (!shouldPanel) return null;
      // 이미 패널이 import 되어있으면 스킵
      if (code.includes('@ait-co/devtools/panel')) return null;
      // transformInclude가 진입점 파일만 통과시키므로 바로 prepend
      return `import '@ait-co/devtools/panel';\n${code}`;
    },
  };
});

export const vite = aitDevtoolsPlugin.vite;
export const webpack = aitDevtoolsPlugin.webpack;
export const rollup = aitDevtoolsPlugin.rollup;
export const esbuild = aitDevtoolsPlugin.esbuild;
export const rspack = aitDevtoolsPlugin.rspack;

export default aitDevtoolsPlugin;
