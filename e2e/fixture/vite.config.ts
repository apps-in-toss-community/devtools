import { defineConfig } from 'vite';
import aitDevtools from '@ait-co/devtools/unplugin';
import path from 'path';

export default defineConfig({
  root: __dirname,
  resolve: {
    alias: {
      // Bypass rolldown resolveId limitation: alias directly to built mock file.
      // The unplugin handles panel injection; we handle the mock swap here.
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
