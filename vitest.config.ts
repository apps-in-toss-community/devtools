import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: {
    __VERSION__: JSON.stringify('0.0.0-test'),
    // Mirror the tsdown build define so `readMcpSdkVersion()`'s primary
    // (bare-identifier) path is exercised under vitest too (issue #361).
    __MCP_SDK_VERSION__: JSON.stringify('0.0.0-test-sdk'),
  },
  test: {
    environment: 'jsdom',
    restoreMocks: true,
    // Default `*.test.ts` collection (src/**) PLUS the launcher's pure-logic unit
    // tests under a distinct `*.vitest.ts` extension. The `.vitest.ts` suffix
    // keeps Playwright (testMatch '**/*.test.ts', testDir './e2e') from picking
    // these up, so the same launcher source is covered by both runners without
    // collision (#411).
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'e2e/fixture/launcher/**/*.vitest.ts',
      'e2e/fixture/launcher/**/*.vitest.tsx',
    ],
    // Only the Playwright e2e specs are excluded — the launcher `*.vitest.ts`
    // files above stay in vitest's scope.
    exclude: ['e2e/**/*.test.ts', '.tmp/**', 'node_modules/**', '.claude/**'],
    onConsoleLog(log: string) {
      if (log.includes('[@ait-co/devtools]')) return false;
    },
  },
});
