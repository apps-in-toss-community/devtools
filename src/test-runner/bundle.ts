/**
 * esbuild-based bundler for user test files.
 *
 * Bundles a single test file into a self-contained IIFE string that can be
 * injected into a WebView via `Runtime.evaluate`. The bundle includes the
 * test runtime (`runtime.ts`), which provides `describe/it/test/expect` and
 * the `runTestModule(factory)` entry point.
 *
 * ## How the wiring works
 *
 * The bundle exposes two exports on `globalThis.__testBundle`:
 *   - `runTestModule` — the runtime's entry function.
 *   - `__userFactory`  — an async function whose body is the user's top-level
 *     test registration code (describe/it/test calls).
 *
 * The Node-side RPC (`rpc.ts`) calls:
 *   `globalThis.__testBundle.runTestModule(globalThis.__testBundle.__userFactory)`
 *
 * `runTestModule` then installs `describe/it/test/expect` as globals, invokes
 * the factory (which registers all tests), runs them, and returns a `RunReport`.
 *
 * ## Why a factory wrapper is needed
 *
 * Naively adding the runtime to `entryPoints` and bundling the user file would
 * fail for two reasons:
 *   1. `describe/it/test/expect` from the runtime are module-local in the IIFE
 *      scope. The user's top-level `describe(...)` calls expect them as globals —
 *      they are not globals until `runTestModule` installs them.
 *   2. Even with globals pre-installed, the user file runs at IIFE-evaluation
 *      time, before the RPC layer calls `runTestModule` to reset state and start
 *      the test clock.
 *
 * The factory approach solves both: the user's registration code is deferred
 * into a function that `runTestModule` calls AFTER installing the globals.
 *
 * ## Factory extraction algorithm
 *
 * The `userFactoryPlugin` reads the user file and splits lines into:
 *   - **top-level**: `import …` and re-export lines — kept at module scope
 *     (the only valid position for static `import` in ESM).
 *   - **body**: all other statements — moved into the body of the exported
 *     `__userFactory` async function.
 *
 * esbuild processes the re-generated module, following each static import
 * through the normal dependency graph (including the SDK-redirect plugin).
 *
 * ## SDK redirect
 *
 * Imports of `@apps-in-toss/web-framework` (and sub-paths) are intercepted via
 * the `sdkRedirectPlugin` and replaced with a virtual `window.__sdk` proxy that
 * `src/in-app/auto.ts` installs at runtime. This works for both 2.x and 3.x SDK.
 *
 * SECRET-HANDLING: the returned bundle code is caller-managed; never log it.
 */

import { accessSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
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
   * The runtime entry uses this to call `__testBundle.runTestModule(__userFactory)`.
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
 * esbuild plugin that transforms the user test file into a module that exports
 * an async `__userFactory` function. The factory defers the user's top-level
 * test registration code (describe/it/test calls) so it only runs when
 * `runTestModule(__userFactory)` explicitly invokes it — AFTER the runtime has
 * installed describe/it/test/expect as globals.
 *
 * Algorithm:
 *   - Lines matching import declarations or re-export statements are kept at
 *     module top-level (the only valid ESM position for static `import`).
 *   - All other lines (describe/it/test calls, local declarations, etc.) are
 *     moved into the body of the exported async factory function.
 *
 * This preserves SDK import resolution (the sdk-redirect plugin processes
 * top-level imports normally) while deferring test registration to the factory.
 */
function userFactoryPlugin(absPath: string): esbuild.Plugin {
  const NAMESPACE = 'user-test-factory';
  return {
    name: 'user-test-factory',
    setup(build) {
      // Resolve the virtual "user-test-factory" specifier to our namespace.
      build.onResolve({ filter: /^user-test-factory$/ }, () => ({
        path: absPath,
        namespace: NAMESPACE,
      }));

      // Load the user file, split imports from body, wrap body in the factory.
      build.onLoad({ filter: /.*/, namespace: NAMESPACE }, async (args) => {
        const source = await fs.readFile(args.path, 'utf8');
        const lines = source.split('\n');

        const topLevelLines: string[] = [];
        const bodyLines: string[] = [];

        // Matches `export` value declarations that cannot appear inside a
        // function body. We strip the `export` keyword so they become plain
        // declarations inside the factory.
        const EXPORT_DECLARATION_RE =
          /^(export\s+)(default\s+|async\s+function\s+|function\s+|class\s+|const\s+|let\s+|var\s+)/;

        for (const line of lines) {
          const trimmed = line.trimStart();
          const indent = line.slice(0, line.length - trimmed.length);

          // Static import declarations must stay at module top level
          // (the ESM spec forbids `import` inside a function body).
          if (
            trimmed.startsWith('import ') ||
            trimmed.startsWith('import{') ||
            trimmed.startsWith("import'") ||
            trimmed.startsWith('import"')
          ) {
            topLevelLines.push(line);
          } else if (trimmed.startsWith('export ')) {
            // Determine whether this is a re-export (stays top-level) or a value
            // declaration (goes into the factory, export keyword stripped).
            const m = trimmed.match(EXPORT_DECLARATION_RE);
            if (m) {
              // Value declaration — strip `export ` and move into factory body.
              // e.g. `export function hello()` → `function hello()`
              //       `export const x = 1`     → `const x = 1`
              bodyLines.push(indent + trimmed.slice('export '.length));
            } else {
              // Re-export or `export type { … }` — stays at top level.
              topLevelLines.push(line);
            }
          } else {
            bodyLines.push(line);
          }
        }

        const factoryContent = [
          ...topLevelLines,
          '',
          '// biome-ignore lint: generated factory wrapper',
          'export default async function __userFactory(): Promise<void> {',
          ...bodyLines.map((l) => `  ${l}`),
          '}',
        ].join('\n');

        return {
          contents: factoryContent,
          loader: 'ts',
          resolveDir: path.dirname(absPath),
        };
      });
    },
  };
}

/**
 * Returns the absolute path to the test-runner runtime module.
 *
 * Searches candidates in priority order:
 *   1. Co-located `runtime.ts` / `runtime.js` — covers the source tree
 *      (tsx / ts-node) and the `dist/test-runner/` entry.
 *   2. `../test-runner/runtime.js` — covers the `dist/mcp/cli.js` entry,
 *      where `import.meta.url` resolves to `dist/mcp/` (a sibling directory
 *      of `dist/test-runner/`). Without this second candidate the MCP entry
 *      point would look for `dist/mcp/runtime.js`, which does not exist, and
 *      every `run_tests` call would fail with an esbuild "Could not resolve"
 *      error (#678).
 *
 * Returns the first candidate that exists on disk. Falls back to the
 * co-located `runtime.js` path so esbuild produces a clear "file not found"
 * error rather than a cryptic failure.
 */
function getRuntimePath(): string {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(dir, 'runtime.ts'),
    path.join(dir, 'runtime.js'),
    path.join(dir, '..', 'test-runner', 'runtime.js'),
  ];
  for (const candidate of candidates) {
    try {
      accessSync(candidate);
      return candidate;
    } catch {
      // try next candidate
    }
  }
  // Let esbuild produce a "file not found" error with a clear path.
  return path.join(dir, 'runtime.js');
}

/**
 * Bundles `absPath` into a single IIFE string suitable for `Runtime.evaluate`.
 *
 * The IIFE installs `window.__testBundle` (or the custom `globalName`) with:
 *   - `runTestModule` — the runtime entry (from `runtime.ts`).
 *   - `__userFactory` — an async function wrapping the user's test registration
 *     code so it runs AFTER `runTestModule` installs the globals.
 *
 * Callers (rpc.ts) invoke:
 *   `globalThis.__testBundle.runTestModule(globalThis.__testBundle.__userFactory)`
 *
 * @param absPath - Absolute path to the user test file.
 * @param opts    - Optional bundling overrides.
 */
export async function bundleTestFile(absPath: string, opts?: BundleOptions): Promise<BundleResult> {
  const globalName = opts?.globalName ?? '__testBundle';
  const extraExternals = opts?.extraExternals ?? [];

  // Lazy load esbuild at call time (see the module-scope import note).
  const esbuild = await import('esbuild');
  const runtimePath = getRuntimePath();

  // Stdin wrapper: import the runtime and the user factory, re-export both.
  // esbuild follows the static imports to include runtime.ts and the user file
  // (via the userFactoryPlugin) in the single IIFE output.
  const wrapperContent = [
    `import { runTestModule } from ${JSON.stringify(runtimePath)};`,
    `import __userFactory from "user-test-factory";`,
    `export { runTestModule, __userFactory };`,
  ].join('\n');

  const result = await esbuild.build({
    stdin: {
      contents: wrapperContent,
      loader: 'ts',
      // resolveDir is used for relative imports from the wrapper. Since the
      // wrapper only imports absolute paths (runtimePath) and the virtual
      // "user-test-factory" specifier (resolved by plugin), the directory
      // doesn't matter — but we still provide a sensible default.
      resolveDir: path.dirname(absPath),
    },
    bundle: true,
    format: 'iife',
    globalName,
    platform: 'browser',
    target: 'es2022',
    write: false,
    plugins: [userFactoryPlugin(absPath), sdkRedirectPlugin()],
    external: extraExternals,
    treeShaking: true,
    // Ensure the IIFE result is always reachable via globalThis regardless of
    // the evaluation context.  esbuild's `globalName` emits:
    //   var __testBundle = (() => { ... })();
    // When `Runtime.evaluate` runs this bundle code inside an outer wrapper
    // (rpc.ts's async IIFE), `var` creates a local variable — NOT a global
    // property — so `globalThis.__testBundle` stays `undefined`.  The footer
    // explicitly assigns the local variable to `globalThis` to close that gap.
    footer: {
      js: `globalThis[${JSON.stringify(globalName)}] = ${globalName};`,
    },
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
