import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    restoreMocks: true,
    onConsoleLog(log: string) {
      if (log.includes('[ait-devtools]')) return false;
    },
  },
});
