import { test, expect } from '@playwright/test';
import { buildSaveEnvelope, SAVE_KEY, seedIdb, seedIdbMulti, compressSaveString } from './helpers.js';
import type { SaveEnvelope } from './helpers.js';

/**
 * E2E — Save Version Indicator
 *
 * Verifies that save slots display a version mismatch warning when
 * the save version differs from the current SAVE_VERSION, and no
 * warning when the version matches.
 */

test.describe('Save Version Indicator', () => {

  test('main menu: current-version save shows no version warning', async ({ page }) => {
    // Seed a save with the current SAVE_VERSION.
    const envelope: SaveEnvelope = buildSaveEnvelope({ saveName: 'Current Version' });
    await page.goto('/');
    await seedIdb(page, SAVE_KEY, compressSaveString(JSON.stringify(envelope)));
    await page.goto('/');
    await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 10_000 });

    // The save card for slot 0 should be visible.
    const slot0Card = page.locator('.mm-save-card[data-slot="0"]:not(.mm-empty-slot)');
    await expect(slot0Card).toBeVisible({ timeout: 5_000 });

    // No version warning should be displayed.
    await expect(slot0Card.locator('[data-testid="version-warning"]')).toHaveCount(0, { timeout: 5_000 });
  });

  test('main menu: mismatched-version save shows version warning badge', async ({ page }) => {
    // Seed a save with version 0 (simulating a pre-versioning save).
    const envelope: SaveEnvelope = buildSaveEnvelope({ version: 0, saveName: 'Old Version' });
    await page.goto('/');
    await seedIdb(page, SAVE_KEY, compressSaveString(JSON.stringify(envelope)));
    await page.goto('/');
    await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 10_000 });

    const slot0Card = page.locator('.mm-save-card[data-slot="0"]:not(.mm-empty-slot)');
    await expect(slot0Card).toBeVisible({ timeout: 5_000 });

    // The version warning badge should be visible and contain the version info.
    const badge = slot0Card.locator('[data-testid="version-warning"]');
    await expect(badge).toBeVisible({ timeout: 5_000 });
    await expect(badge).toContainText('v0', { timeout: 5_000 });
    await expect(badge).toContainText('current: v6', { timeout: 5_000 });
  });

  test('topbar load modal: mismatched-version save shows version warning', async ({ page }) => {
    // Seed slot 0 with a current-version save (so we can load into the game),
    // and slot 1 with a mismatched-version save (to verify warning display).
    const currentEnvelope: SaveEnvelope = buildSaveEnvelope({ saveName: 'Current Save' });
    const oldEnvelope: SaveEnvelope = buildSaveEnvelope({ version: 0, saveName: 'Old Save' });
    await page.goto('/');
    await seedIdbMulti(page, [
      { key: SAVE_KEY, value: compressSaveString(JSON.stringify(currentEnvelope)) },
      { key: 'spaceAgencySave_1', value: compressSaveString(JSON.stringify(oldEnvelope)) },
    ]);
    await page.goto('/');
    await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 10_000 });

    // Load the current-version save (slot 0) to get into the game.
    await page.click('[data-action="load"][data-slot="0"]');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });

    // Open the topbar menu and click "Load Game".
    await page.click('[data-testid="topbar-menu-btn"]');
    await expect(page.locator('#topbar-dropdown')).toBeVisible({ timeout: 5_000 });
    await page.locator('#topbar-dropdown button').filter({ hasText: 'Load Game' }).click();
    await expect(page.locator('#load-modal-backdrop')).toBeVisible({ timeout: 5_000 });

    // Slot 1 (old version) should show the version warning.
    const slot = page.locator('[data-testid="load-slot-1"]');
    await expect(slot).toBeVisible({ timeout: 5_000 });
    const badge = slot.locator('[data-testid="version-warning"]');
    await expect(badge).toBeVisible({ timeout: 5_000 });
    await expect(badge).toContainText('v0', { timeout: 5_000 });
  });

  test('topbar load modal: current-version save shows no version warning', async ({ page }) => {
    // Seed a save with the current version.
    const envelope: SaveEnvelope = buildSaveEnvelope({ saveName: 'Current Save' });
    await page.goto('/');
    await seedIdb(page, SAVE_KEY, compressSaveString(JSON.stringify(envelope)));
    await page.goto('/');
    await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 10_000 });

    // Load the save to get into the game.
    await page.click('[data-action="load"][data-slot="0"]');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });

    // Open the topbar menu and click "Load Game".
    await page.click('[data-testid="topbar-menu-btn"]');
    await expect(page.locator('#topbar-dropdown')).toBeVisible({ timeout: 5_000 });
    await page.locator('#topbar-dropdown button').filter({ hasText: 'Load Game' }).click();
    await expect(page.locator('#load-modal-backdrop')).toBeVisible({ timeout: 5_000 });

    // No version warning should be present on slot 0.
    const slot = page.locator('[data-testid="load-slot-0"]');
    await expect(slot).toBeVisible({ timeout: 5_000 });
    await expect(slot.locator('[data-testid="version-warning"]')).toHaveCount(0, { timeout: 5_000 });
  });
});
