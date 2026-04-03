import { test, expect } from '@playwright/test';
import { buildSaveEnvelope, seedAndLoadSave, dismissWelcomeModal, SAVE_KEY } from './helpers.js';

/**
 * E2E — Debug Mode Toggle
 *
 * Verifies that debug features (Ctrl+Shift+D debug saves panel) are gated
 * behind the debug mode setting:
 *   (1) Ctrl+Shift+D does nothing when debug mode is off (default)
 *   (2) Enabling debug mode via window.__enableDebugMode() makes Ctrl+Shift+D work
 *   (3) Debug mode setting persists across save/load
 *   (4) Ctrl+Shift+D does nothing after debug mode is turned off
 *   (5) E2E helper window.__enableDebugMode() enables debug mode programmatically
 */

test.describe.configure({ mode: 'serial' });

test.describe('Debug Mode Toggle', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto('/');

    // Start a new Sandbox game.
    await page.waitForSelector('#mm-agency-name-input', {
      state: 'visible',
      timeout: 15_000,
    });
    await page.fill('#mm-agency-name-input', 'Debug Test Agency');
    await page.click('.mm-mode-option[data-mode="sandbox"]');
    await page.click('#mm-start-btn');

    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });
    await dismissWelcomeModal(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  // ── (1) Ctrl+Shift+D does nothing when debug mode is off ─────────────────

  test('(1) Ctrl+Shift+D does not open debug saves panel when debug mode is off', async () => {
    // Verify debug mode is off by default.
    const debugMode = await page.evaluate(() => window.__gameState.debugMode);
    expect(debugMode).toBe(false);

    // Press Ctrl+Shift+D.
    await page.keyboard.press('Control+Shift+D');

    // Wait briefly to ensure nothing opens.
    await page.waitForTimeout(500);

    // Debug save panel should NOT be visible.
    const panel = page.locator('#debug-save-panel');
    await expect(panel).not.toBeVisible();
  });

  // ── (2) Enabling debug mode makes Ctrl+Shift+D work ──────────────────────

  test('(2) Ctrl+Shift+D opens debug saves panel when debug mode is on', async () => {
    // Enable debug mode programmatically.
    await page.evaluate(() => window.__enableDebugMode());

    const debugMode = await page.evaluate(() => window.__gameState.debugMode);
    expect(debugMode).toBe(true);

    // Press Ctrl+Shift+D.
    await page.keyboard.press('Control+Shift+D');

    // Debug save panel should appear.
    const panel = page.locator('#debug-save-panel');
    await expect(panel).toBeVisible({ timeout: 5_000 });

    // Close the panel via the Close button.
    await page.click('.debug-save-close-btn');
    await page.waitForFunction(
      () => !document.getElementById('debug-save-panel'),
      { timeout: 5_000 },
    );
  });

  // ── (3) Debug mode persists across save/load ──────────────────────────────

  test('(3) debug mode setting persists across save/load cycle', async () => {
    // Debug mode should still be on from previous test.
    const before = await page.evaluate(() => window.__gameState.debugMode);
    expect(before).toBe(true);

    // Save the game via topbar menu.
    await page.click('[data-testid="topbar-menu-btn"]');
    await expect(page.locator('#topbar-dropdown')).toBeVisible();
    await page.locator('#topbar-dropdown button').filter({ hasText: 'Save Game' }).click();
    await expect(page.locator('#save-modal-backdrop')).toBeVisible();

    // Click save slot 0.
    await page.click('[data-testid="save-slot-0"]');

    // Wait for modal to close (save complete).
    await expect(page.locator('#save-modal-backdrop')).toHaveCount(0, { timeout: 5_000 });

    // Navigate to load screen.
    await page.goto('/');
    await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 15_000 });

    // Load the save.
    await page.click('[data-action="load"][data-slot="0"]');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });
    await dismissWelcomeModal(page);

    // Debug mode should still be on after loading.
    const after = await page.evaluate(() => window.__gameState.debugMode);
    expect(after).toBe(true);

    // Verify Ctrl+Shift+D still works.
    await page.keyboard.press('Control+Shift+D');
    const panel = page.locator('#debug-save-panel');
    await expect(panel).toBeVisible({ timeout: 5_000 });

    // Close the panel.
    await page.click('.debug-save-close-btn');
    await page.waitForFunction(
      () => !document.getElementById('debug-save-panel'),
      { timeout: 5_000 },
    );
  });

  // ── (4) Ctrl+Shift+D stops working after debug mode is turned off ────────

  test('(4) Ctrl+Shift+D does nothing after debug mode is disabled', async () => {
    // Disable debug mode.
    await page.evaluate(() => { window.__gameState.debugMode = false; });

    const debugMode = await page.evaluate(() => window.__gameState.debugMode);
    expect(debugMode).toBe(false);

    // Press Ctrl+Shift+D.
    await page.keyboard.press('Control+Shift+D');

    // Wait briefly.
    await page.waitForTimeout(500);

    // Debug save panel should NOT be visible.
    const panel = page.locator('#debug-save-panel');
    await expect(panel).not.toBeVisible();
  });

  // ── (5) window.__enableDebugMode() helper works programmatically ─────────

  test('(5) window.__enableDebugMode() enables debug mode programmatically', async () => {
    // Debug mode should be off.
    const before = await page.evaluate(() => window.__gameState.debugMode);
    expect(before).toBe(false);

    // Call the E2E helper.
    await page.evaluate(() => window.__enableDebugMode());

    const after = await page.evaluate(() => window.__gameState.debugMode);
    expect(after).toBe(true);

    // Verify debug saves panel is now accessible.
    await page.keyboard.press('Control+Shift+D');
    const panel = page.locator('#debug-save-panel');
    await expect(panel).toBeVisible({ timeout: 5_000 });

    // Clean up — close panel.
    await page.click('.debug-save-close-btn');
    await page.waitForFunction(
      () => !document.getElementById('debug-save-panel'),
      { timeout: 5_000 },
    );
  });
});
