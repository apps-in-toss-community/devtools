import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import aitDevtools from 'ait-devtools/unplugin';

const aitRoot = resolve(__dirname, 'node_modules/ait-devtools');
const mockEntry = resolve(aitRoot, 'dist/mock/index.js');
const panelEntry = resolve(aitRoot, 'dist/panel/index.js');

export default defineConfig({
  plugins: [
    // Override the unplugin's resolveId: in file:-linked packages, bare
    // specifiers like 'ait-devtools/mock' fail to resolve. This plugin maps
    // all relevant IDs (including the @apps-in-toss/* aliases that the
    // unplugin would normally handle) to absolute paths instead.
    {
      name: 'ait-devtools-resolve',
      enforce: 'pre',
      resolveId(id) {
        if (
          id === 'ait-devtools/mock' ||
          id === '@apps-in-toss/web-framework' ||
          id === '@apps-in-toss/web-bridge' ||
          id === '@apps-in-toss/web-analytics'
        ) {
          return mockEntry;
        }
        if (id === 'ait-devtools/panel') return panelEntry;
        return null;
      },
    },
    react(),
    aitDevtools.vite({ panel: false }),
  ],
});
