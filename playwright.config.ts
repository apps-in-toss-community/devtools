import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:4173',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  webServer: {
    command: 'pnpm build && pnpm --dir examples/vite-react run build && pnpm --dir examples/vite-react run preview --port 4173',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
});
