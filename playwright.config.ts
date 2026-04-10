import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  // Directory containing e2e test files
  testDir: './e2e',

  // Accept both .js and .ts spec files during the transition
  testMatch: '**/*.spec.{js,ts}',

  // Run all tests in parallel
  fullyParallel: true,

  // Limit parallel workers to avoid overwhelming the Vite dev server and
  // exhausting Chromium process handles on Windows.
  workers: 2,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry flaky timeout failures: 2× on CI, 1× in dev
  retries: process.env.CI ? 2 : 1,

  // Reporters: HTML for interactive browsing, JSON for timing analysis.
  // Run `node scripts/e2e-timing.mjs` after a test run to see slowest tests.
  reporter: [['html'], ['json', { outputFile: 'test-results/timing.json' }]],

  use: {
    // Base URL pointing to the Vite dev server
    baseURL: 'http://localhost:5173',

    // Collect trace when retrying the failed test
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Start the Vite dev server before running tests and wait for it to be ready
  webServer: {
    command: 'vite',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
