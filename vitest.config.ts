import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __VERSION__: JSON.stringify('0.0.0-test'),
    // Tests exercise both branches; individual tests pass isDebugBuild
    // directly to evaluateDebugGate, so this default only affects the thin
    // index.ts (checkDebugGate) if it were called in a test. Set true so that
    // any hypothetical test of checkDebugGate doesn't block at Layer A.
    __DEBUG_BUILD__: 'true',
  },
  test: {
    environment: 'jsdom',
    restoreMocks: true,
    exclude: ['e2e/**', '.tmp/**', 'node_modules/**', '.claude/**'],
    onConsoleLog(log: string) {
      if (log.includes('[@ait-co/devtools]')) return false;
    },
  },
});
