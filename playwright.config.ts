import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'panel.test.ts',
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  baseURL: 'http://localhost:4173',
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: [
      'pnpm build',
      'pnpm exec vite build --config e2e/fixture/vite.config.ts',
      'pnpm exec vite preview --config e2e/fixture/vite.config.ts --port 4173',
    ].join(' && '),
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
});
