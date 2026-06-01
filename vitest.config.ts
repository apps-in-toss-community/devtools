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
    exclude: ['e2e/**', '.tmp/**', 'node_modules/**', '.claude/**'],
    onConsoleLog(log: string) {
      if (log.includes('[@ait-co/devtools]')) return false;
    },
  },
});
