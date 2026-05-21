import { defineConfig, type Options } from 'tsdown';
import pkg from './package.json' with { type: 'json' };

// __VERSION__ is defined in all entries so any source file can reference it.
//
// Note: there is no `__DEBUG_BUILD__` define here. That constant belongs to
// the CONSUMER's build, not this package's. The consumer guards its
// `import('@ait-co/devtools/in-app')` call site with `if (__DEBUG_BUILD__)`,
// and its own bundler folds the constant + DCEs the import for release builds.
// A `__DEBUG_BUILD__` define in this config would bake a fixed value into the
// shipped package and is therefore meaningless — see src/in-app/gate.ts.
const define = {
  __VERSION__: JSON.stringify(pkg.version),
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
    // Shebang is preserved in the source; tsdown strips it during transform.
    // Re-add via banner so `node dist/mcp/server.js` works without explicit node invocation.
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
    banner: { js: '#!/usr/bin/env node' },
  },
]);
