import { test, expect } from '@playwright/test';
import {
  VP_W, VP_H,
  buildSaveEnvelope,
  seedAndLoadSave,
  startTestFlight,
  teleportCraft,
  openSettingsPanel,
  dismissWelcomeModal,
} from './helpers.js';

/**
 * E2E — Auto-Save System
 *
 * Tests the auto-save toast notification, cancel button, and settings toggle.
 *
 * Tests run in serial order on a shared page instance.
 */

test.describe.configure({ mode: 'serial' });

const UNLOCKED_PARTS = ['probe-core-mk1', 'tank-small', 'engine-spark'];

test.describe('Auto-Save System', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
  });

  test.afterAll(async () => {
    await page.close();
  });

  // ── Test 1: Auto-save fires after flight ────────────────────────────────

  test('auto-save toast appears after post-flight summary', async () => {
    // Seed a save with auto-save enabled.
    const envelope = buildSaveEnvelope({
      parts: UNLOCKED_PARTS,
      autoSaveEnabled: true,
    });
    await seedAndLoadSave(page, envelope);
    await dismissWelcomeModal(page);

    // Start a test flight.
    await startTestFlight(page, UNLOCKED_PARTS);

    // Teleport craft to landed state and trigger post-flight summary.
    await teleportCraft(page, { posX: 0, posY: 5, velX: 0, velY: 0, grounded: true, landed: true, crashed: true });

    // Wait for post-flight summary to appear.
    await expect(page.locator('#post-flight-summary')).toBeVisible({ timeout: 15_000 });

    // Auto-save toast should appear.
    await expect(page.locator('#auto-save-toast')).toBeVisible({ timeout: 5_000 });

    // Wait for the save to complete (toast shows "Saved").
    await page.waitForFunction(
      () => {
        const toast = document.getElementById('auto-save-toast');
        return toast && toast.textContent.includes('Saved');
      },
      { timeout: 10_000 },
    );

    // Verify the auto-save was written to localStorage.
    const hasAutoSave = await page.evaluate(() => {
      return localStorage.getItem('spaceAgencySave_auto') !== null;
    });
    expect(hasAutoSave).toBe(true);

    // Verify the auto-save envelope has correct structure.
    const autoSaveData = await page.evaluate(() => {
      const raw = localStorage.getItem('spaceAgencySave_auto');
      if (!raw) return null;
      const env = JSON.parse(raw);
      return { saveName: env.saveName, hasState: !!env.state, hasTimestamp: !!env.timestamp };
    });
    expect(autoSaveData).toEqual({
      saveName: 'Auto-Save',
      hasState: true,
      hasTimestamp: true,
    });

    // Return to hub — dismiss any return results overlay.
    await page.click('#post-flight-return-btn');
    const rr1 = page.locator('#return-results-dismiss-btn');
    if (await rr1.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await rr1.click();
    }
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });
  });

  // ── Test 2: Cancel button prevents save ─────────────────────────────────

  test('cancel button prevents auto-save', async () => {
    // Wait for any leftover auto-save toast from the previous test to clear.
    await page.waitForFunction(
      () => !document.getElementById('auto-save-toast'),
      { timeout: 10_000 },
    );

    // Clear the previous auto-save.
    await page.evaluate(() => localStorage.removeItem('spaceAgencySave_auto'));

    // Start another flight.
    await startTestFlight(page, UNLOCKED_PARTS);

    // Teleport to crashed state.
    await teleportCraft(page, { posX: 0, posY: 5, velX: 0, velY: 0, grounded: true, landed: true, crashed: true });

    // Wait for post-flight summary.
    await expect(page.locator('#post-flight-summary')).toBeVisible({ timeout: 15_000 });

    // Wait for toast to appear, then click Cancel immediately.
    await expect(page.locator('#auto-save-toast')).toBeVisible({ timeout: 5_000 });
    await page.click('#auto-save-cancel-btn');

    // Wait for toast to fade out.
    await page.waitForFunction(
      () => !document.getElementById('auto-save-toast'),
      { timeout: 5_000 },
    );

    // Verify no auto-save in localStorage (the cancel happened before the 3s delay).
    const hasAutoSave = await page.evaluate(() => {
      return localStorage.getItem('spaceAgencySave_auto') !== null;
    });
    expect(hasAutoSave).toBe(false);

    // Return to hub — click return btn, then dismiss the return results overlay.
    await page.click('#post-flight-return-btn');
    const rrDismiss = page.locator('#return-results-dismiss-btn');
    const rrVisible = await rrDismiss.isVisible({ timeout: 3_000 }).catch(() => false);
    if (rrVisible) {
      await rrDismiss.click();
    }
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });
  });

  // ── Test 3: Settings toggle disables auto-save ──────────────────────────

  test('disabling auto-save in settings prevents toast', async () => {
    // Wait for any leftover auto-save toast to clear.
    await page.waitForFunction(
      () => !document.getElementById('auto-save-toast'),
      { timeout: 10_000 },
    );

    // Open settings and disable auto-save.
    await openSettingsPanel(page);
    await expect(page.locator('#settings-panel')).toBeVisible({ timeout: 5_000 });

    // Click the "Off" button for auto-save.
    await page.click('[data-setting="autoSave"][data-value="off"]');

    // Verify the "Off" button is now active.
    const offActive = await page.locator('[data-setting="autoSave"][data-value="off"]').evaluate(
      (el) => el.classList.contains('active'),
    );
    expect(offActive).toBe(true);

    // Close settings.
    await page.click('.settings-close-btn');

    // Clear any previous auto-save.
    await page.evaluate(() => localStorage.removeItem('spaceAgencySave_auto'));

    // Start a flight.
    await startTestFlight(page, UNLOCKED_PARTS);

    // Teleport to crashed state.
    await teleportCraft(page, { posX: 0, posY: 5, velX: 0, velY: 0, grounded: true, landed: true, crashed: true });

    // Wait for post-flight summary.
    await expect(page.locator('#post-flight-summary')).toBeVisible({ timeout: 15_000 });

    // Auto-save toast should NOT appear.
    await page.waitForTimeout(2_000);
    const toastVisible = await page.locator('#auto-save-toast').isVisible().catch(() => false);
    expect(toastVisible).toBe(false);

    // Verify no auto-save was written.
    const hasAutoSave = await page.evaluate(() => {
      return localStorage.getItem('spaceAgencySave_auto') !== null;
    });
    expect(hasAutoSave).toBe(false);

    // Return to hub — dismiss any return results overlay.
    await page.click('#post-flight-return-btn');
    const rr3 = page.locator('#return-results-dismiss-btn');
    if (await rr3.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await rr3.click();
    }
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });
  });
});
