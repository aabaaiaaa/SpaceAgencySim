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
 * Each test is fully independent — seeds its own state, navigates, acts, asserts.
 */

const UNLOCKED_PARTS = ['probe-core-mk1', 'tank-small', 'engine-spark'];

test.describe('Auto-Save System', () => {

  test('auto-save toast appears after post-flight summary', async ({ page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelope = buildSaveEnvelope({
      parts: UNLOCKED_PARTS,
      autoSaveEnabled: true,
    });
    await seedAndLoadSave(page, envelope);
    await dismissWelcomeModal(page);

    await startTestFlight(page, UNLOCKED_PARTS);
    await teleportCraft(page, { posX: 0, posY: 5, velX: 0, velY: 0, grounded: true, landed: true, crashed: true });

    await expect(page.locator('#post-flight-summary')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#auto-save-toast')).toBeVisible({ timeout: 5_000 });

    await page.waitForFunction(
      () => {
        const toast = document.getElementById('auto-save-toast');
        return toast && toast.textContent.includes('Saved');
      },
      { timeout: 10_000 },
    );

    // Verify the auto-save was written to localStorage.
    // Saves are LZ-compressed (prefixed with "LZC:"), so we just check existence and non-empty.
    const autoSaveInfo = await page.evaluate(() => {
      const raw = localStorage.getItem('spaceAgencySave_auto');
      return { exists: raw !== null, length: raw?.length ?? 0 };
    });
    expect(autoSaveInfo.exists).toBe(true);
    expect(autoSaveInfo.length).toBeGreaterThan(10);
  });

  test('cancel button prevents auto-save', async ({ page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelope = buildSaveEnvelope({ parts: UNLOCKED_PARTS, autoSaveEnabled: true });
    await seedAndLoadSave(page, envelope);
    await dismissWelcomeModal(page);

    await startTestFlight(page, UNLOCKED_PARTS);
    await teleportCraft(page, { posX: 0, posY: 5, velX: 0, velY: 0, grounded: true, landed: true, crashed: true });

    await expect(page.locator('#post-flight-summary')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#auto-save-toast')).toBeVisible({ timeout: 5_000 });
    await page.click('#auto-save-cancel-btn');

    await page.waitForFunction(() => !document.getElementById('auto-save-toast'), { timeout: 5_000 });

    const hasAutoSave = await page.evaluate(() => localStorage.getItem('spaceAgencySave_auto') !== null);
    expect(hasAutoSave).toBe(false);
  });

  test('disabling auto-save in settings prevents toast', async ({ page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelope = buildSaveEnvelope({ parts: UNLOCKED_PARTS, autoSaveEnabled: true });
    await seedAndLoadSave(page, envelope);
    await dismissWelcomeModal(page);

    await openSettingsPanel(page);
    await expect(page.locator('#settings-panel')).toBeVisible({ timeout: 5_000 });
    await page.click('[data-setting="autoSave"][data-value="off"]');
    await page.click('.settings-close-btn');

    await startTestFlight(page, UNLOCKED_PARTS);
    await teleportCraft(page, { posX: 0, posY: 5, velX: 0, velY: 0, grounded: true, landed: true, crashed: true });

    await expect(page.locator('#post-flight-summary')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(2_000);
    const toastVisible = await page.locator('#auto-save-toast').isVisible().catch(() => false);
    expect(toastVisible).toBe(false);
  });
});
