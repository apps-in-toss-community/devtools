import { defineConfig, type Options } from 'tsdown';
import pkg from './package.json' with { type: 'json' };

// __VERSION__ is defined in all entries so any source file can reference it.
// __DEBUG_BUILD__ defaults to false (release); dogfood tag-gated workflows
// pass RELEASE_CHANNEL=dogfood and override this to `true` at build time.
const define = {
  __VERSION__: JSON.stringify(pkg.version),
  __DEBUG_BUILD__: 'false',
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
    // Browser-only ESM entry for the in-app debug gate.
    // When __DEBUG_BUILD__ is false (the default), the bundler dead-code-
    // eliminates all gate logic and Chii imports from downstream release bundles.
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
]);
