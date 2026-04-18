import { defineConfig } from 'vite';
import aitDevtools from '@ait-co/devtools/unplugin';
import path from 'path';

export default defineConfig({
  root: __dirname,
  resolve: {
    alias: {
      // Bypass rolldown resolveId limitation: alias directly to built mock file.
      // (Panel is imported explicitly in main.ts; unplugin panel injection is
      // disabled below because unplugin transform is unreliable under Vite 8
      // production build with rolldown.)
      '@apps-in-toss/web-framework': path.resolve(__dirname, '../../dist/mock/index.js'),
    },
  },
  // Both mock and panel are disabled in the unplugin: mock swap is done via
  // resolve.alias above (bypasses rolldown resolveId limitation), and panel is
  // imported explicitly in main.ts (unplugin transform unreliable under Vite 8
  // production build). forceEnable kept for future option compatibility.
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
