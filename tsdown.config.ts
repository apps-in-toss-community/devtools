import { createRequire } from 'node:module';
import { defineConfig, type Options } from 'tsdown';
import pkg from './package.json' with { type: 'json' };

// `@modelcontextprotocol/sdk` exposes NEITHER `.` (the bare main entry) NOR
// `./package.json` in its `exports` map, so both
// `require.resolve('@modelcontextprotocol/sdk')` and
// `require.resolve('@modelcontextprotocol/sdk/package.json')` throw at BUILD
// time (`ERR_PACKAGE_PATH_NOT_EXPORTED` / `MODULE_NOT_FOUND`) — which silently
// baked `null` into this define and is exactly why the merged #363 attempt
// still left `mcpVersion: null` in a real bundle (issue #361, observed live).
// Resolve a subpath that IS in the exports map (`./server/mcp.js`, already
// imported by the MCP server code), then walk back to the package root via the
// `@modelcontextprotocol/sdk` marker and read its `package.json` by file path
// (bypassing the `exports` gate). Falls back to `null` if resolution shape
// ever changes.
const mcpSdkVersion = ((): string | null => {
  try {
    const req = createRequire(import.meta.url);
    const entry = req.resolve('@modelcontextprotocol/sdk/server/mcp.js');
    const marker = '@modelcontextprotocol/sdk';
    const root = entry.slice(0, entry.indexOf(marker) + marker.length);
    const sdkPkg = req(`${root}/package.json`) as { version?: unknown };
    return typeof sdkPkg.version === 'string' ? sdkPkg.version : null;
  } catch {
    return null;
  }
})();

// __VERSION__ / __MCP_SDK_VERSION__ are defined in all entries so any source
// file can reference them as bare identifiers (NOT via `globalThis` — `define`
// only substitutes the bare token; a `globalThis.__VERSION__` property access
// reads `undefined`, the root cause of issue #361).
//
// Note: there is no `__DEBUG_BUILD__` define here. That constant belongs to
// the CONSUMER's build, not this package's. The consumer guards its
// `import('@ait-co/devtools/in-app')` call site with `if (__DEBUG_BUILD__)`,
// and its own bundler folds the constant + DCEs the import for release builds.
// A `__DEBUG_BUILD__` define in this config would bake a fixed value into the
// shipped package and is therefore meaningless — see src/in-app/gate.ts.
const define = {
  __VERSION__: JSON.stringify(pkg.version),
  __MCP_SDK_VERSION__: JSON.stringify(mcpSdkVersion),
};

// `package.json` exports expect `.js` (ESM) and `.cjs` (CJS) extensions,
// so override tsdown's default `.mjs` / `.cjs` mapping under `"type": "module"`.
const outExtensions: Options['outExtensions'] = ({ format }) => {
  if (format === 'cjs') return { js: '.cjs', dts: '.d.cts' };
  return { js: '.js', dts: '.d.ts' };
};

// Each entry lives in its own config object so Rolldown does not emit a
// shared hashed chunk at `dist/` root (every entry is self-contained).
const common = {
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
  outExtensions,
  define,
} as const;

export default defineConfig([
  {
    ...common,
    entry: { 'mock/index': 'src/mock/index.ts' },
    format: ['esm'],
  },
  {
    ...common,
    // Panel is a client-side React 19 tree (JSX). React is BUNDLED here (no
    // `external`), so the published `dist/panel/index.js` is self-contained and
    // react never reaches consumers' graphs or this package's `dependencies`.
    entry: { 'panel/index': 'src/panel/index.tsx' },
    format: ['esm'],
  },
  {
    // Browser-only ESM entry for the in-app debug gate (runtime layers B/C).
    // The build-time Layer A is the consumer's `if (__DEBUG_BUILD__)` guard,
    // which DCEs this whole entry from downstream release bundles.
    ...common,
    entry: { 'in-app/index': 'src/in-app/index.ts' },
    format: ['esm'],
  },
  {
    // Self-gating side-effect entry. Consumers add one line to their app entry:
    //   import '@ait-co/devtools/in-app/auto';
    // The entry self-gates on URL params + DEV flag and, when the gate passes,
    // calls maybeAttach() and installs the SDK bridge (window.__sdk/__sdkCall).
    // @apps-in-toss/web-framework is an optional peer — resolved via dynamic
    // import at runtime, never a static dependency of this bundle.
    ...common,
    entry: { 'in-app/auto': 'src/in-app/auto.ts' },
    format: ['esm'],
  },
  {
    ...common,
    entry: { 'unplugin/index': 'src/unplugin/index.ts' },
    format: ['esm', 'cjs'],
  },
  {
    // Lazy-loaded by unplugin/index only when the `tunnel` option is on, so the
    // cloudflared / qrcode-terminal deps stay off the graph otherwise.
    ...common,
    entry: { 'unplugin/tunnel': 'src/unplugin/tunnel.ts' },
    format: ['esm', 'cjs'],
  },
  {
    ...common,
    // MCP server is a Node.js stdio process — ESM only, no browser globals
    platform: 'node',
    entry: { 'mcp/server': 'src/mcp/server.ts' },
    format: ['esm'],
    // The banner is the single source of the shebang — the entry source MUST NOT
    // carry its own `#!/usr/bin/env node`, or the build emits a doubled shebang
    // (line 2 then parses as invalid syntax and the bin fails to start). tsdown
    // no longer strips a source shebang during transform, so rely on the banner only.
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    ...common,
    // `devtools-mcp` bin: debug mode (CDP/Chii) by default, `--mode=dev` for the
    // dev-mode mock-state server. Node-only — `chii`/`cloudflared`/`ws` are Node
    // deps and must never reach the browser/in-app bundles.
    platform: 'node',
    entry: { 'mcp/cli': 'src/mcp/cli.ts' },
    format: ['esm'],
    // Keep heavy/native Node deps external so they resolve from node_modules at
    // runtime rather than being bundled (chii ships CJS + Koa; cloudflared spawns
    // a downloaded binary).
    deps: { neverBundle: ['chii', 'cloudflared', 'ws'] },
    // Shebang via banner only — see the mcp/server entry's note. The source
    // src/mcp/cli.ts must not carry its own shebang or the build doubles it.
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    ...common,
    // test-runner Node-side public API + helpers. `config.ts` is the package
    // entry (`definePhoneTestConfig`/`definePhoneVitestConfig`); it imports the
    // Vitest custom pool, so it is Node-side (Vitest config is evaluated in
    // Node) — NOT a browser subset. The page-side runtime.ts is bundled into the
    // user's test bundle by bundleTestFile, never imported from here.
    // esbuild is a runtime dependency used at bundle-time (bundleTestFile spawns
    // the esbuild child process) — keep it external so it resolves from node_modules.
    platform: 'node',
    entry: {
      'test-runner/config': 'src/test-runner/config.ts',
      'test-runner/bundle': 'src/test-runner/bundle.ts',
      'test-runner/rpc': 'src/test-runner/rpc.ts',
      'test-runner/relay-worker': 'src/test-runner/relay-worker.ts',
      'test-runner/pool': 'src/test-runner/pool.ts',
      'test-runner/task-graph': 'src/test-runner/task-graph.ts',
    },
    format: ['esm'],
    deps: { neverBundle: ['esbuild'] },
  },
  {
    ...common,
    // `devtools-test` bin: CLI entry point for running phone-relay tests.
    // Node-only. esbuild is external (resolved at runtime from node_modules).
    // Shebang via banner only — source must not carry its own shebang.
    platform: 'node',
    entry: { 'test-runner/cli': 'src/test-runner/cli.ts' },
    format: ['esm'],
    deps: { neverBundle: ['esbuild'] },
    banner: { js: '#!/usr/bin/env node' },
  },
]);
