import { test, expect, type Page } from '@playwright/test';
import {
  VP_W, VP_H,
  buildSaveEnvelope, seedAndLoadSave, dismissWelcomeModal,
} from './helpers.js';

// ---------------------------------------------------------------------------
// (window.d.ts augments the global Window interface with game properties)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Debug Mode Toggle', () => {

  test('(1) Ctrl+Shift+D does not open debug saves panel when debug mode is off', async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = buildSaveEnvelope({ gameMode: 'sandbox', debugMode: false });
    await seedAndLoadSave(page, envelope);
    await dismissWelcomeModal(page);

    await page.keyboard.press('Control+Shift+D');
    // Panel should not appear — verify with assertion timeout (no hard wait)
    await expect(page.locator('#debug-save-panel')).not.toBeVisible({ timeout: 2_000 });
  });

  test('(2) Ctrl+Shift+D opens debug saves panel when debug mode is on', async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = buildSaveEnvelope({ gameMode: 'sandbox', debugMode: false });
    await seedAndLoadSave(page, envelope);
    await dismissWelcomeModal(page);

    await page.evaluate(() => window.__enableDebugMode());
    await page.keyboard.press('Control+Shift+D');
    await expect(page.locator('#debug-save-panel')).toBeVisible({ timeout: 5_000 });
    await page.click('.debug-save-close-btn');
  });

  test('(3) debug mode setting persists across save/load cycle', async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = buildSaveEnvelope({ gameMode: 'sandbox', debugMode: false });
    await seedAndLoadSave(page, envelope);
    await dismissWelcomeModal(page);

    await page.evaluate(() => window.__enableDebugMode());
    expect(await page.evaluate(() => window.__gameState.debugMode)).toBe(true);

    // Save via topbar.
    await page.click('#topbar-menu-btn');
    await page.locator('#topbar-dropdown').getByText('Save Game').click();
    await expect(page.locator('#save-modal-backdrop')).toBeVisible({ timeout: 5_000 });
    await page.click('[data-testid="save-slot-0"]');
    await expect(page.locator('#save-modal-backdrop')).toHaveCount(0, { timeout: 5_000 });

    // Reload and load the save.
    await page.goto('/');
    await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 10_000 });
    await page.click('[data-action="load"][data-slot="0"]');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });
    await dismissWelcomeModal(page);

    expect(await page.evaluate(() => window.__gameState.debugMode)).toBe(true);
    await page.keyboard.press('Control+Shift+D');
    await expect(page.locator('#debug-save-panel')).toBeVisible({ timeout: 5_000 });
    await page.click('.debug-save-close-btn');
  });

  test('(4) Ctrl+Shift+D does nothing after debug mode is disabled', async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = buildSaveEnvelope({ gameMode: 'sandbox', debugMode: true });
    await seedAndLoadSave(page, envelope);
    await dismissWelcomeModal(page);

    await page.evaluate(() => { window.__gameState.debugMode = false; });
    await page.keyboard.press('Control+Shift+D');
    // Panel should not appear — verify with assertion timeout (no hard wait)
    await expect(page.locator('#debug-save-panel')).not.toBeVisible({ timeout: 2_000 });
  });

  test('(5) window.__enableDebugMode() enables debug mode programmatically', async ({ page }: { page: Page }) => {
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
