import { defineConfig } from 'vite';
import aitDevtools from '@ait-co/devtools/unplugin';
import path from 'path';
import fs from 'fs';

const mockDist = path.resolve(__dirname, '../../dist/mock/index.js');
if (!fs.existsSync(mockDist)) {
  throw new Error(`dist/mock/index.js not found — run 'pnpm build' first (expected: ${mockDist})`);
}

export default defineConfig({
  root: __dirname,
  resolve: {
    alias: {
      // Bypass rolldown resolveId limitation: alias directly to built mock file.
      // (Panel is imported explicitly in main.ts; unplugin panel injection is
      // disabled below because unplugin transform is unreliable under Vite 8
      // production build with rolldown.)
      '@apps-in-toss/web-framework': mockDist,
    },
  },
  // Both mock and panel are disabled so the unplugin does NO active work here:
  //   mock:  off — handled by resolve.alias above (bypasses rolldown resolveId bug)
  //   panel: off — handled by explicit import in main.ts (unplugin transform
  //                is unreliable under Vite 8 production build with rolldown)
  // The plugin is kept in the list so forceEnable=true is honoured if rolldown
  // is fixed and these options are re-enabled in the future without other changes.
  plugins: [aitDevtools.vite({ panel: false, mock: false, forceEnable: true })],
  preview: {
    port: 4173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
