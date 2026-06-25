/**
 * esbuild-based bundler for user test files.
 *
 * Bundles a single test file into a self-contained IIFE string that can be
 * injected into a WebView via `Runtime.evaluate`. The user's SDK imports
 * (`@apps-in-toss/web-framework` and sub-paths) are intercepted via an
 * esbuild plugin that redirects them to `window.__sdk`, which the in-app
 * debug gate (`src/in-app/auto.ts`) installs as a namespace mirror of the
 * SDK exports (works for both 2.x and 3.x SDK).
 *
 * SECRET-HANDLING: the returned bundle code is caller-managed; never log it.
 */

import * as path from 'node:path';
// esbuild is imported for TYPES only at module scope; the runtime module is
// loaded lazily inside `bundleTestFile` via dynamic import. esbuild runs a
// startup invariant check (`TextEncoder().encode('') instanceof Uint8Array`)
// that fails in a jsdom realm — a static import would break every MCP/test
// module that merely *imports* this file's transitive graph (e.g. debug-server →
// run_tests). Lazy load keeps esbuild off the import graph until a bundle is
// actually built, and mirrors the cloudflared/chii dynamic-import precedent.
import type * as esbuild from 'esbuild';

/** Options accepted by `bundleTestFile`. */
export interface BundleOptions {
  /**
   * Additional esbuild `external` patterns. The SDK package
   * (`@apps-in-toss/web-framework` and `@apps-in-toss/web-framework/*`) is
   * always handled by the SDK redirect plugin — callers may add more patterns
   * to be left as globals.
   */
  extraExternals?: string[];
  /**
   * Global name for the IIFE output object. Defaults to `__testBundle`.
   * The runtime entry uses this to call `__testBundle.runTestModule()`.
   */
  globalName?: string;
}

/**
 * The result of bundling a test file.
 * `code` is a self-contained IIFE string ready for `Runtime.evaluate`.
 */
export interface BundleResult {
  code: string;
  warnings: string[];
}

/** The SDK package name that mini-app test code imports from. */
const SDK_PACKAGE = '@apps-in-toss/web-framework';

/**
 * Matches the bare SDK package and any sub-path import
 * (`@apps-in-toss/web-framework`, `@apps-in-toss/web-framework/foo`).
 * Built from {@link SDK_PACKAGE} so the package name has a single source.
 */
const SDK_IMPORT_FILTER = new RegExp(`^${SDK_PACKAGE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

/**
 * esbuild plugin that intercepts SDK imports and redirects them to the
 * `window.__sdk` proxy that `src/in-app/auto.ts` installs at runtime.
 *
 * Strategy: for every import of `@apps-in-toss/web-framework` (or sub-paths),
 * esbuild resolves it to a virtual module that re-exports all named exports
 * via `window.__sdk[name]`. This avoids bundling the real SDK (which may not
 * be available in the test environment) while still making named imports work.
 *
 * If `window.__sdk` is absent (non-dog-food build), every access throws a
 * descriptive error rather than returning `undefined` silently.
 */
function sdkRedirectPlugin(): esbuild.Plugin {
  return {
    name: 'sdk-redirect',
    setup(build) {
      // Match the bare package and any sub-path imports
      build.onResolve({ filter: SDK_IMPORT_FILTER }, (args) => ({
        path: args.path,
        namespace: 'sdk-redirect',
      }));

      build.onLoad({ filter: /.*/, namespace: 'sdk-redirect' }, () => ({
        // Generate a virtual CommonJS-style module so that esbuild does NOT perform
        // strict named-export matching. When `format:'iife'` bundles a CJS module,
        // it wraps it with its own __toCommonJS helper and satisfies named imports
        // via property access on the module.exports object — which is our Proxy.
        // This means `import { getPlatformOS } from '...'` becomes
        // `__proxy.getPlatformOS` at runtime, which correctly reads from window.__sdk.
        contents: `
var __proxy = (typeof window !== 'undefined' && window.__sdk)
  ? window.__sdk
  : new Proxy({}, {
      get: function(_t, p) {
        throw new Error('window.__sdk is not installed — run in a dog-food build. Missing: ' + String(p));
      }
    });
module.exports = __proxy;
`,
        loader: 'js',
      }));
    },
  };
}

/**
 * Bundles `absPath` into a single IIFE string suitable for `Runtime.evaluate`.
 *
 * The IIFE installs `window.__testBundle` (or the custom `globalName`) with
 * `runTestModule` as the callable entry point.
 *
 * @param absPath - Absolute path to the user test file.
 * @param opts    - Optional bundling overrides.
 */
export async function bundleTestFile(absPath: string, opts?: BundleOptions): Promise<BundleResult> {
  const globalName = opts?.globalName ?? '__testBundle';
  const extraExternals = opts?.extraExternals ?? [];

  // Lazy load esbuild at call time (see the module-scope import note).
  const esbuild = await import('esbuild');

  const result = await esbuild.build({
    entryPoints: [absPath],
    bundle: true,
    format: 'iife',
    globalName,
    platform: 'browser',
    target: 'es2022',
    write: false,
    plugins: [sdkRedirectPlugin()],
    // Extra externals are left as global references (caller's responsibility
    // to ensure they exist in the WebView context).
    external: extraExternals,
    // Keep bundle self-contained; no dynamic require/import at runtime.
    treeShaking: true,
  });

  const warnings = result.warnings.map(
    (w) =>
      `${path.relative(process.cwd(), w.location?.file ?? '')}:${w.location?.line ?? '?'}: ${w.text}`,
  );

  const outputFile = result.outputFiles?.[0];
  if (!outputFile) {
    throw new Error('bundleTestFile: esbuild produced no output — check entryPoints');
  }

  return { code: outputFile.text, warnings };
}
