import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import aitDevtools from '@ait-co/devtools/unplugin';
import react from '@vitejs/plugin-react';
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
      // (Panel is imported explicitly in main.tsx; unplugin panel injection is
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
  // mock, panel, inApp are all disabled — active transform work is handled
  // explicitly in main.tsx (bypasses rolldown/Vite 8 transform reliability issue).
  //   mock:  off — handled by resolve.alias above (bypasses rolldown resolveId bug)
  //   panel: off — handled by explicit import in main.tsx
  //   inApp: off — handled by explicit in-app snippet in main.tsx
  // The plugin is kept in the list for tunnel support (manual QA only).
  plugins: [
    react(),
    aitDevtools.vite({
      panel: false,
      mock: false,
      inApp: false,
      // Manual QA toggles only — no effect on CI / normal builds.
      // AIT_TUNNEL=1       → plain HTTP tunnel only (env-2 screen preview)
      // AIT_TUNNEL_CDP=1   → HTTP tunnel + Chii relay + relay tunnel (env-2 CDP)
      tunnel: process.env.AIT_TUNNEL_CDP ? { cdp: true } : !!process.env.AIT_TUNNEL,
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
