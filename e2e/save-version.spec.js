import { test, expect } from '@playwright/test';
import { buildSaveEnvelope, SAVE_KEY } from './helpers.js';

/**
 * E2E — Save Version Indicator
 *
 * Verifies that save slots display a version mismatch warning when
 * the save version differs from the current SAVE_VERSION, and no
 * warning when the version matches.
 */

test.describe('Save Version Indicator', () => {

  test('main menu: current-version save shows no version warning', async ({ page }) => {
    // Seed a save with version 1 (the current SAVE_VERSION).
    const envelope = buildSaveEnvelope({ saveName: 'Current Version' });
    await page.addInitScript(({ key, env }) => {
      localStorage.setItem(key, JSON.stringify(env));
    }, { key: SAVE_KEY, env: envelope });

    await page.goto('/');
    await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 15_000 });

    // The save card for slot 0 should be visible.
    const slot0Card = page.locator('.mm-save-card[data-slot="0"]:not(.mm-empty-slot)');
    await expect(slot0Card).toBeVisible();

    // No version warning should be displayed.
    await expect(slot0Card.locator('[data-testid="version-warning"]')).toHaveCount(0);
  });

  test('main menu: mismatched-version save shows version warning badge', async ({ page }) => {
    // Seed a save with version 0 (simulating a pre-versioning save).
    const envelope = buildSaveEnvelope({ version: 0, saveName: 'Old Version' });
    await page.addInitScript(({ key, env }) => {
      localStorage.setItem(key, JSON.stringify(env));
    }, { key: SAVE_KEY, env: envelope });

    await page.goto('/');
    await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 15_000 });

    const slot0Card = page.locator('.mm-save-card[data-slot="0"]:not(.mm-empty-slot)');
    await expect(slot0Card).toBeVisible();

    // The version warning badge should be visible and contain the version info.
    const badge = slot0Card.locator('[data-testid="version-warning"]');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('v0');
    await expect(badge).toContainText('current: v1');
  });

  test('topbar load modal: mismatched-version save shows version warning', async ({ page }) => {
    // Seed a save with a mismatched version and load the game.
    const envelope = buildSaveEnvelope({ version: 0, saveName: 'Old Save' });
    await page.addInitScript(({ key, env }) => {
      localStorage.setItem(key, JSON.stringify(env));
    }, { key: SAVE_KEY, env: envelope });

    await page.goto('/');
    await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 15_000 });

    // Load the save to get into the game.
    await page.click('[data-action="load"][data-slot="0"]');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });

    // Open the topbar menu and click "Load Game".
    await page.click('[data-testid="topbar-menu-btn"]');
    await expect(page.locator('#topbar-dropdown')).toBeVisible();
    await page.locator('#topbar-dropdown button').filter({ hasText: 'Load Game' }).click();
    await expect(page.locator('#load-modal-backdrop')).toBeVisible();

    // The load slot should show the version warning.
    const slot = page.locator('[data-testid="load-slot-0"]');
    await expect(slot).toBeVisible();
    const badge = slot.locator('[data-testid="version-warning"]');
    await expect(badge).toBeVisible();
    await expect(badge).toContainText('v0');
  });

  test('topbar load modal: current-version save shows no version warning', async ({ page }) => {
    // Seed a save with the current version.
    const envelope = buildSaveEnvelope({ version: 1, saveName: 'Current Save' });
    await page.addInitScript(({ key, env }) => {
      localStorage.setItem(key, JSON.stringify(env));
    }, { key: SAVE_KEY, env: envelope });

    await page.goto('/');
    await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 15_000 });

    // Load the save to get into the game.
    await page.click('[data-action="load"][data-slot="0"]');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });

    // Open the topbar menu and click "Load Game".
    await page.click('[data-testid="topbar-menu-btn"]');
    await expect(page.locator('#topbar-dropdown')).toBeVisible();
    await page.locator('#topbar-dropdown button').filter({ hasText: 'Load Game' }).click();
    await expect(page.locator('#load-modal-backdrop')).toBeVisible();

    // No version warning should be present on slot 0.
    const slot = page.locator('[data-testid="load-slot-0"]');
    await expect(slot).toBeVisible();
    await expect(slot.locator('[data-testid="version-warning"]')).toHaveCount(0);
  });
});
