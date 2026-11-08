// Browser tests (step 5, G5): Chromium only, against `vite preview` on the production build.
// They need web/public/data (pipeline output); see docs/etape-5-interface.md.
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-data/playwright',
  fullyParallel: false,
  workers: 1, // timings are measured: one browser at a time
  reporter: [['list']],
  timeout: 60_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'off',
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
