import { createRequire } from 'node:module';
import { defineConfig, type Options } from 'tsdown';
import pkg from './package.json' with { type: 'json' };

// `@modelcontextprotocol/sdk` does not expose `./package.json` in its
// `exports` map, so `require.resolve('@modelcontextprotocol/sdk/package.json')`
// throws `ERR_PACKAGE_PATH_NOT_EXPORTED` at runtime — which is exactly why the
// old runtime `readMcpSdkVersion()` always returned `null` in a real bundle
// (issue #361). Reading the installed version here at BUILD time and baking it
// into a define sidesteps the exports restriction entirely. Resolved via the
// main entry's directory so we read the actually-installed version, not the
// range. Falls back to `null` if resolution ever changes shape.
const mcpSdkVersion = ((): string | null => {
  try {
    const req = createRequire(import.meta.url);
    // Resolve the installed entry, then read its sibling package.json by path
    // (bypasses the `exports` gate that blocks the subpath specifier).
    const entry = req.resolve('@modelcontextprotocol/sdk');
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
    entry: { 'panel/index': 'src/panel/index.ts' },
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
    external: ['chii', 'cloudflared', 'ws'],
    // Shebang via banner only — see the mcp/server entry's note. The source
    // src/mcp/cli.ts must not carry its own shebang or the build doubles it.
    banner: { js: '#!/usr/bin/env node' },
  },
]);
