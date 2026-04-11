import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  baseURL: 'http://localhost:4173',
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: [
      'pnpm build',
      'rm -rf .tmp/sdk-example',
      'git clone --depth 1 https://github.com/apps-in-toss-community/sdk-example.git .tmp/sdk-example',
      'cd .tmp/sdk-example && pnpm install && pnpm build && pnpm preview --port 4173',
    ].join(' && '),
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
});
