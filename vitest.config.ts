import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __VERSION__: JSON.stringify('0.0.0-test'),
  },
  test: {
    environment: 'jsdom',
    restoreMocks: true,
    exclude: ['e2e/**', 'examples/**', 'node_modules/**'],
    onConsoleLog(log: string) {
      if (log.includes('[@ait-co/devtools]')) return false;
    },
  },
});
