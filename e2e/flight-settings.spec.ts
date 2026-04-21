import { test, expect } from '@playwright/test';
import {
  VP_W, VP_H,
  buildSaveEnvelope,
  seedAndLoadSave,
  startTestFlight,
  dismissWelcomeModal,
} from './helpers.js';

/**
 * E2E — Settings panel accessible from in-flight menu.
 *
 * The Settings panel was previously hub-only. It's now exposed via the
 * topbar hamburger during flight, and the flight pauses (timeWarp = 0)
 * for the duration of the panel lifetime.
 */

const UNLOCKED_PARTS: string[] = ['probe-core-mk1', 'tank-small', 'engine-spark'];

test.describe('Settings — in-flight access', () => {

  test('Settings opens from the flight hamburger menu and pauses flight @smoke', async ({ page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = buildSaveEnvelope({ parts: UNLOCKED_PARTS, autoSaveEnabled: true });
    await seedAndLoadSave(page, envelope);
    await dismissWelcomeModal(page);

    await startTestFlight(page, UNLOCKED_PARTS);

    // Set a non-zero time-warp so we can verify pause/resume behaviour.
    await page.evaluate(() => window.__testSetTimeWarp?.(2));
    const preOpenWarp = await page.evaluate(() => window.__testGetTimeWarp?.());
    expect(preOpenWarp).toBe(2);

    // Open the hamburger menu and click Settings.
    await page.click('#topbar-menu-btn');
    await expect(page.locator('#topbar-dropdown')).toBeVisible({ timeout: 2_000 });
    await page.locator('#topbar-dropdown').getByText('Settings').click();

    // Settings panel is visible and time-warp is paused.
    await expect(page.locator('#settings-panel')).toBeVisible({ timeout: 5_000 });
    const duringOpenWarp = await page.evaluate(() => window.__testGetTimeWarp?.());
    expect(duringOpenWarp).toBe(0);

    // Close via the "← Back" button.
    await page.click('.settings-close-btn');

    // Panel is gone and time-warp is restored to the pre-open value.
    await expect(page.locator('#settings-panel')).toHaveCount(0, { timeout: 5_000 });
    const postCloseWarp = await page.evaluate(() => window.__testGetTimeWarp?.());
    expect(postCloseWarp).toBe(2);
  });

  test('Settings closes via Escape and restores flight time-warp', async ({ page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = buildSaveEnvelope({ parts: UNLOCKED_PARTS, autoSaveEnabled: true });
    await seedAndLoadSave(page, envelope);
    await dismissWelcomeModal(page);

    await startTestFlight(page, UNLOCKED_PARTS);
    await page.evaluate(() => window.__testSetTimeWarp?.(4));

    await page.click('#topbar-menu-btn');
    await page.locator('#topbar-dropdown').getByText('Settings').click();
    await expect(page.locator('#settings-panel')).toBeVisible({ timeout: 5_000 });

    // The settings panel registers its Escape handler on `document`, so
    // dispatch there — window.dispatchEvent would bypass it.
    await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));

    await expect(page.locator('#settings-panel')).toHaveCount(0, { timeout: 5_000 });
    const postCloseWarp = await page.evaluate(() => window.__testGetTimeWarp?.());
    expect(postCloseWarp).toBe(4);
  });

  test('Settings change persists when closed from in-flight menu', async ({ page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = buildSaveEnvelope({ parts: UNLOCKED_PARTS, autoSaveEnabled: true });
    await seedAndLoadSave(page, envelope);
    await dismissWelcomeModal(page);

    await startTestFlight(page, UNLOCKED_PARTS);

    // Open settings from flight, change malfunctionFrequency to Low, close.
    await page.click('#topbar-menu-btn');
    await page.locator('#topbar-dropdown').getByText('Settings').click();
    await expect(page.locator('#settings-panel')).toBeVisible({ timeout: 5_000 });

    await page.click('[data-setting="malfunctionFrequency"][data-value="low"]');
    await page.click('.settings-close-btn');

    // Verify the change took effect in game state.
    const freq = await page.evaluate(
      () => window.__gameState?.difficultySettings?.malfunctionFrequency,
    );
    expect(freq).toBe('low');
  });
});
