import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    restoreMocks: true,
    exclude: ['e2e/**', 'examples/**', 'node_modules/**'],
    onConsoleLog(log: string) {
      if (log.includes('[ait-devtools]')) return false;
    },
  },
});
