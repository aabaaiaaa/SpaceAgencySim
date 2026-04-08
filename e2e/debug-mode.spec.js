import { test, expect } from '@playwright/test';
import {
  VP_W, VP_H,
  buildSaveEnvelope, seedAndLoadSave, dismissWelcomeModal,
} from './helpers.js';

/**
 * E2E — Debug Mode Toggle
 * Each test is fully self-contained — seeds its own state and gets a fresh page.
 */

test.describe('Debug Mode Toggle', () => {

  test('(1) Ctrl+Shift+D does not open debug saves panel when debug mode is off', async ({ page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = buildSaveEnvelope({ gameMode: 'sandbox', debugMode: false });
    await seedAndLoadSave(page, envelope);
    await dismissWelcomeModal(page);

    await page.keyboard.press('Control+Shift+D');
    await page.waitForTimeout(500);
    await expect(page.locator('#debug-save-panel')).not.toBeVisible();
  });

  test('(2) Ctrl+Shift+D opens debug saves panel when debug mode is on', async ({ page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = buildSaveEnvelope({ gameMode: 'sandbox', debugMode: false });
    await seedAndLoadSave(page, envelope);
    await dismissWelcomeModal(page);

    await page.evaluate(() => window.__enableDebugMode());
    await page.keyboard.press('Control+Shift+D');
    await expect(page.locator('#debug-save-panel')).toBeVisible({ timeout: 5_000 });
    await page.click('.debug-save-close-btn');
  });

  test('(3) debug mode setting persists across save/load cycle', async ({ page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = buildSaveEnvelope({ gameMode: 'sandbox', debugMode: false });
    await seedAndLoadSave(page, envelope);
    await dismissWelcomeModal(page);

    await page.evaluate(() => window.__enableDebugMode());
    expect(await page.evaluate(() => window.__gameState.debugMode)).toBe(true);

    // Save via topbar.
    await page.click('#topbar-menu-btn');
    await page.locator('#topbar-dropdown').getByText('Save Game').click();
    await expect(page.locator('#save-modal-backdrop')).toBeVisible();
    await page.click('[data-testid="save-slot-0"]');
    await expect(page.locator('#save-modal-backdrop')).toHaveCount(0, { timeout: 5_000 });

    // Reload and load the save.
    await page.goto('/');
    await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 15_000 });
    await page.click('[data-action="load"][data-slot="0"]');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });
    await dismissWelcomeModal(page);

    expect(await page.evaluate(() => window.__gameState.debugMode)).toBe(true);
    await page.keyboard.press('Control+Shift+D');
    await expect(page.locator('#debug-save-panel')).toBeVisible({ timeout: 5_000 });
    await page.click('.debug-save-close-btn');
  });

  test('(4) Ctrl+Shift+D does nothing after debug mode is disabled', async ({ page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = buildSaveEnvelope({ gameMode: 'sandbox', debugMode: true });
    await seedAndLoadSave(page, envelope);
    await dismissWelcomeModal(page);

    await page.evaluate(() => { window.__gameState.debugMode = false; });
    await page.keyboard.press('Control+Shift+D');
    await page.waitForTimeout(500);
    await expect(page.locator('#debug-save-panel')).not.toBeVisible();
  });

  test('(5) window.__enableDebugMode() enables debug mode programmatically', async ({ page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = buildSaveEnvelope({ gameMode: 'sandbox', debugMode: false });
    await seedAndLoadSave(page, envelope);
    await dismissWelcomeModal(page);

    expect(await page.evaluate(() => window.__gameState.debugMode)).toBe(false);
    await page.evaluate(() => window.__enableDebugMode());
    expect(await page.evaluate(() => window.__gameState.debugMode)).toBe(true);

    await page.keyboard.press('Control+Shift+D');
    await expect(page.locator('#debug-save-panel')).toBeVisible({ timeout: 5_000 });
    await page.click('.debug-save-close-btn');
  });
});
