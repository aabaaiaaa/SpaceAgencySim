import { test, expect } from '@playwright/test';

// Smoke test — verifies the Playwright e2e infrastructure and that the app loads.
// More detailed e2e tests live alongside this file in /e2e/.

test('application loads and displays root element', async ({ page }) => {
  await page.goto('/');

  // The page should load without error
  await expect(page).toHaveTitle(/space agency/i);
});
