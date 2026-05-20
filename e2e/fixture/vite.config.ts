import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import aitDevtools from '@ait-co/devtools/unplugin';
import { defineConfig } from 'vite';

// This config is loaded as ESM ("type": "module"), so __dirname is not defined.
// Derive it from import.meta.url instead.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const mockDist = path.resolve(__dirname, '../../dist/mock/index.js');
const panelDist = path.resolve(__dirname, '../../dist/panel/index.js');
for (const p of [mockDist, panelDist]) {
  if (!fs.existsSync(p)) {
    throw new Error(
      `Required devtools dist file not found — run 'pnpm build' at the repo root first (missing: ${p})`,
    );
  }
}

export default defineConfig({
  root: __dirname,
  resolve: {
    alias: {
      // Bypass rolldown resolveId limitation: alias directly to built mock file.
      // (Panel is imported explicitly in main.ts; unplugin panel injection is
      // disabled below because unplugin transform is unreliable under Vite 8
      // production build with rolldown.)
      //
      // Note on types: this alias only rewires the runtime import; TypeScript
      // still resolves the module via `node_modules/@apps-in-toss/web-framework`
      // (a devDependency). If that devDep is removed, `pnpm typecheck` breaks
      // for the fixture even though `pnpm test:e2e` keeps working.
      '@apps-in-toss/web-framework': mockDist,
    },
  },
  // Both mock and panel are disabled so the unplugin does NO active work here:
  //   mock:  off — handled by resolve.alias above (bypasses rolldown resolveId bug)
  //   panel: off — handled by explicit import in main.ts (unplugin transform
  //                is unreliable under Vite 8 production build with rolldown)
  // The plugin is kept in the list so forceEnable=true is honoured if rolldown
  // is fixed and these options are re-enabled in the future without other changes.
  plugins: [
    aitDevtools.vite({
      panel: false,
      mock: false,
      forceEnable: true,
      // Manual QA toggle only — `AIT_TUNNEL=1 pnpm exec vite --config
      // e2e/fixture/vite.config.ts`. No effect on CI / normal builds.
      tunnel: !!process.env.AIT_TUNNEL,
    }),
  ],
  preview: {
    port: 4173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // MPA: the panel fixture (existing e2e + Pages root) plus the launcher
        // PWA shipped at /launcher/.
        index: path.resolve(__dirname, 'index.html'),
        launcher: path.resolve(__dirname, 'launcher/index.html'),
      },
    },
  },
});
