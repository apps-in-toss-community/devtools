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
 * Names the runtime installs as globals before invoking the user factory.
 * The `vitest` virtual module re-exports each as a lazy getter that reads from
 * `globalThis` at access time. Keep in sync with the globals installed in
 * `runtime.ts#runTestModule`.
 */
const VITEST_GLOBAL_NAMES = [
  'describe',
  'it',
  'test',
  'expect',
  'beforeAll',
  'afterAll',
  'beforeEach',
  'afterEach',
  'vi',
] as const;

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
 *
 * Bridge-stub interception (devtools#740, DT-2): the virtual module runs the
 * resolved `window.__sdk` object through `wrapSdkWithStub` before exporting
 * it. `wrapSdkWithStub` is a pass-through (returns the same object,
 * unwrapped) unless `isStubBlockingEnabled()` reads `true` off
 * `globalThis.__AIT_STUB_BLOCKING__` — an opt-in flag injected the same way
 * `__AIT_CELL__` is (`cell.ts#injectGlobals`, wired from the CLI's
 * `--stub-blocking` flag). Default off => zero behavior change: every existing
 * (non-stub) test run resolves the exact same `window.__sdk` reference it did
 * before this plugin learned about stubbing.
 *
 * Per-method pacing (devtools#769): BEFORE the stub wrap, `window.__sdk` is
 * run through `wrapWithMethodPacing`, which enforces a minimum interval
 * between calls to the SAME named SDK function (`getPaceMethodMs()` reads the
 * `__AIT_PACE_METHOD_MS__` page global — see `method-pace.ts`). Composition
 * order is pacing INSIDE the stub (`wrapSdkWithStub(wrapWithMethodPacing(sdk,
 * gap), enabled)`): a stubbed name resolves instantly from
 * `bridge-stub.ts`'s fixtures without ever reaching the paced wrapper, and
 * only calls that fall through to the real bridge — the ones that can
 * actually trigger `APP_BRIDGE_THROTTLED` — pay the pacing cost. `gapMs <= 0`
 * (default, no `--pace-method` / non-2.x cell) is a no-op fast path — see
 * `method-pace.ts#wrapWithMethodPacing`'s doc for the full contract.
 */
/**
 * Builds the virtual CommonJS-style module contents the `sdk-redirect`
 * esbuild plugin loads for every `@apps-in-toss/web-framework` import.
 *
 * Pulled out to a pure, exported function (rather than inlined at the
 * `build.onLoad` call site) so unit tests can assert the exact composition
 * order (pacing wraps the raw SDK; the stub wraps the paced result) as a
 * string-level contract, independent of esbuild — esbuild cannot run inside
 * this repo's jsdom vitest environment (see `bundleTestFile`'s module doc's
 * lazy-import note), so a real bundling round-trip is out of unit-test reach
 * here; `wrapSdkWithStub`/`wrapWithMethodPacing`'s own composed-call behavior
 * is covered directly (see `bundle.test.ts`).
 *
 * Generates a virtual CommonJS-style module so that esbuild does NOT perform
 * strict named-export matching. When `format:'iife'` bundles a CJS module, it
 * wraps it with its own `__toCommonJS` helper and satisfies named imports via
 * property access on the `module.exports` object — which is our Proxy. This
 * means `import { getPlatformOS } from '...'` becomes
 * `__proxy.getPlatformOS` at runtime, which correctly reads from
 * `window.__sdk`.
 *
 * The bridge-stub and method-pace imports are STATIC imports of the real
 * `bridge-stub.ts`/`method-pace.ts` modules (not inlined JS) so esbuild
 * bundles each once and the fixture registry / pacing registry have a single
 * source of truth shared with their own unit tests.
 *
 * Exported for unit testing.
 */
export function buildSdkRedirectModuleContents(): string {
  return `
import { wrapSdkWithStub, isStubBlockingEnabled } from ${JSON.stringify(getBridgeStubPath())};
import { wrapWithMethodPacing, getPaceMethodMs } from ${JSON.stringify(getMethodPacePath())};
var __rawSdk = (typeof window !== 'undefined' && window.__sdk)
  ? window.__sdk
  : new Proxy({}, {
      get: function(_t, p) {
        throw new Error('window.__sdk is not installed — run in a dog-food build. Missing: ' + String(p));
      }
    });
var __pacedSdk = wrapWithMethodPacing(__rawSdk, getPaceMethodMs());
var __proxy = wrapSdkWithStub(__pacedSdk, isStubBlockingEnabled());
module.exports = __proxy;
`;
}

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
        contents: buildSdkRedirectModuleContents(),
        loader: 'js',
        // resolveDir is required so esbuild can resolve the absolute
        // getBridgeStubPath()/getMethodPacePath() imports above from a
        // filesystem base — a virtual module has no implicit directory of
        // its own. process.cwd() is a safe base for an ABSOLUTE import
        // specifier (it is never used to resolve anything relative).
        resolveDir: process.cwd(),
      }));
    },
  };
}

/**
 * esbuild plugin that intercepts `import … from 'vitest'` and replaces it with
 * a virtual module that delegates every named import to `globalThis` at ACCESS
 * time (not at bundle-evaluation time).
 *
 * The runtime installs `describe/it/test/expect/beforeAll/afterAll/beforeEach/
 * afterEach/vi` as globals inside `runTestModule`, which runs AFTER the bundle
 * IIFE is evaluated. A value-copy redirect (`export var describe =
 * globalThis.describe`) would therefore capture `undefined` at evaluation time
 * and the user's `describe(...)` calls would be no-ops — registering zero tests.
 *
 * The fix defers the lookup to call time using per-name **getter** exports.
 * We emit a CommonJS module that:
 *   1. sets `__esModule = true` so esbuild's `__toESM` interop maps each named
 *      import directly to a property access on the module (NOT wrapped under a
 *      `default` shim — which is what happens for a bare Proxy whose own-keys
 *      are empty, leaving every named import `undefined`);
 *   2. defines each global name as a getter that reads `globalThis[name]` on
 *      every access. So `import { describe } from 'vitest'` compiles to
 *      `import_vitest.describe`, whose getter returns the real `describe` only
 *      when the factory calls it — after `runTestModule` installs the globals.
 *
 * A plain `module.exports = new Proxy(...)` does NOT work here: esbuild routes
 * the virtual module through `__toESM`, which enumerates own-keys (none on an
 * empty Proxy target) and therefore exposes zero named exports. Explicit getter
 * properties give `__toESM` real keys to map while keeping access lazy.
 */
function vitestRedirectPlugin(): esbuild.Plugin {
  return {
    name: 'vitest-redirect',
    setup(build) {
      build.onResolve({ filter: /^vitest$/ }, () => ({
        path: 'vitest',
        namespace: 'vitest-redirect',
      }));

      build.onLoad({ filter: /^vitest$/, namespace: 'vitest-redirect' }, () => {
        const getters = VITEST_GLOBAL_NAMES.map(
          (name) =>
            `Object.defineProperty(exports, ${JSON.stringify(name)}, { enumerable: true, get: function() { return globalThis[${JSON.stringify(name)}]; } });`,
        ).join('\n');
        // __esModule lets esbuild __toESM map named imports to these getters
        // directly. Each getter reads globalThis lazily so the value resolves at
        // call time — after runTestModule installs the globals.
        return {
          contents: `Object.defineProperty(exports, '__esModule', { value: true });\n${getters}\n`,
          loader: 'js',
        };
      });
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
 *   - Import declarations and re-export statements are kept at module top-level
 *     (the only valid ESM position for static `import`). A statement that spans
 *     multiple lines — e.g. a named import with one member per line:
 *       import {
 *         appLogin,
 *         getAnonymousKey,
 *       } from '@apps-in-toss/web-framework';
 *     is tracked as a single block: every line from the opening `import {` /
 *     `export {` through the closing `from '…'` (or side-effect `'…'`) line is
 *     kept together at top-level. This prevents the member lines and the
 *     closing `} from '…'` line from leaking into the factory body, which would
 *     leave an unterminated `import {` at module scope (the #678 env3 failure:
 *     esbuild threw `Expected "as" but found "{"` on multi-line SDK imports).
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

        // True when `trimmed` begins a static `import` statement.
        const isImportStart = (trimmed: string): boolean =>
          trimmed.startsWith('import ') ||
          trimmed.startsWith('import{') ||
          trimmed.startsWith("import'") ||
          trimmed.startsWith('import"');

        // A module-scope `import`/`export … from` statement is "complete" on a
        // single line when it ends with a quoted module specifier (optionally
        // followed by `;`/whitespace), e.g. `… from '@x';` or side-effect
        // `import './x';`. A line ending in `{` or `,` (the common multi-line
        // named-import shape) is therefore NOT complete and must accumulate
        // further lines until the closing `from '…'` line.
        const endsStatement = (trimmed: string): boolean =>
          /['"]\s*;?\s*$/.test(trimmed.replace(/\/\/.*$/, '').trimEnd());

        // When set, we are inside an unterminated multi-line import/re-export
        // block: every subsequent line stays at top level until the block ends.
        let inImportBlock = false;

        for (const line of lines) {
          const trimmed = line.trimStart();
          const indent = line.slice(0, line.length - trimmed.length);

          // Continuation of a multi-line import / re-export block — keep at
          // top level. The block ends on the line that terminates the
          // statement (closing `from '…'` / side-effect `'…'`).
          if (inImportBlock) {
            topLevelLines.push(line);
            if (endsStatement(trimmed)) {
              inImportBlock = false;
            }
            continue;
          }

          // Static import declarations must stay at module top level
          // (the ESM spec forbids `import` inside a function body). If the
          // statement does not terminate on this line, open an import block so
          // the member lines and closing `} from '…'` line stay top-level too.
          if (isImportStart(trimmed)) {
            topLevelLines.push(line);
            if (!endsStatement(trimmed)) {
              inImportBlock = true;
            }
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
              // Re-export or `export type { … }` — stays at top level. A
              // multi-line `export { … } from '…'` opens an import block too.
              topLevelLines.push(line);
              if (/\bfrom\b/.test(trimmed) ? !endsStatement(trimmed) : trimmed.endsWith('{')) {
                inImportBlock = true;
              }
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
 * Returns the absolute filesystem path to a page-side leaf module shipped
 * alongside `bundle.ts` in dist (e.g. `runtime.js`, `bridge-stub.js`) — a
 * fully self-contained module with no further page-side deps of its own.
 *
 * Rolldown code-splitting duplicates this bundling logic into shared chunks
 * emitted at ARBITRARY dist depths: the `devtools-test` CLI pulls it from
 * dist/test-runner/bundle.js (dir = dist/test-runner/), while the `devtools-mcp`
 * daemon (dist/mcp/cli.js) pulls it through a ROOT chunk
 * (dist/debug-server-<hash>.js, dir = dist/). A fixed `..`-hop candidate list
 * is therefore wrong from at least one chunk — the live #697 regression.
 *
 * This resolves WITHOUT assuming chunk depth: from `import.meta.url`'s dir it
 * probes the co-located `<name>.js` and the nested `test-runner/<name>.js`,
 * then ascends one directory at a time (bounded) repeating both probes. The
 * nested probe catches dist/test-runner/<name>.js from the dist/ root level no
 * matter which depth the chunk was hoisted to (root, dist/mcp/, or a future
 * relocation). The build always emits dist/test-runner/<name>.js (tsdown entry
 * `'test-runner/<name>'`; guarded by scripts/check-test-runner-dist.sh for
 * `runtime`).
 *
 * An ABSOLUTE path is returned deliberately: esbuild loads it as a literal file
 * read, bypassing Node module resolution entirely, so this works identically in
 * the npx-daemon context (its own dist tree) and the consumer-CLI context
 * (the mini-app's installed @ait-co/devtools dist) — neither needs the package
 * to be node-resolvable from the caller.
 *
 * @param moduleName - The leaf module's basename without extension, e.g.
 *   `'runtime'` or `'bridge-stub'`.
 */
function getPageSideModulePath(moduleName: string): string {
  const startDir = path.dirname(fileURLToPath(import.meta.url));
  // .js first so a SHIPPED chunk never feeds esbuild raw TypeScript; the .ts
  // probe is last, for the source-tree (tsx) dev case where the module sits
  // beside bundle.ts and no dist exists.
  const RELATIVE_PROBES: string[][] = [
    [`${moduleName}.js`],
    ['test-runner', `${moduleName}.js`],
    [`${moduleName}.ts`],
    ['test-runner', `${moduleName}.ts`],
  ];
  // Bounded ascent: a package's dist is only a few levels deep. 12 is far more
  // than any real layout (root chunk → dist is 0 hops; dist/mcp → dist is 1)
  // and terminates well before the filesystem root in every case.
  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    for (const segs of RELATIVE_PROBES) {
      const candidate = path.join(dir, ...segs);
      try {
        accessSync(candidate);
        return candidate;
      } catch {
        // try next probe
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  // Nothing matched — return the co-located path so esbuild emits a clear
  // "Could not resolve" against a concrete path rather than failing cryptically.
  return path.join(startDir, `${moduleName}.js`);
}

/** Absolute path to the test-runner page-side runtime (describe/it/test/expect). */
function getRuntimePath(): string {
  return getPageSideModulePath('runtime');
}

/**
 * Absolute path to the bridge-stub interceptor (devtools#740, DT-2) —
 * `wrapSdkWithStub`/`isStubBlockingEnabled`, statically imported by the
 * `sdk-redirect` virtual module.
 */
function getBridgeStubPath(): string {
  return getPageSideModulePath('bridge-stub');
}

/**
 * Absolute path to the per-method pacing wrapper (devtools#769) —
 * `wrapWithMethodPacing`/`getPaceMethodMs`, statically imported by the
 * `sdk-redirect` virtual module.
 */
function getMethodPacePath(): string {
  return getPageSideModulePath('method-pace');
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
    plugins: [userFactoryPlugin(absPath), vitestRedirectPlugin(), sdkRedirectPlugin()],
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
