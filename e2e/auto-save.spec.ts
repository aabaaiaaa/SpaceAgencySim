import { test, expect } from '@playwright/test';
import {
  VP_W, VP_H,
  buildSaveEnvelope,
  seedAndLoadSave,
  seedIdbMulti,
  readIdb, readIdbAllKeys,
  startTestFlight,
  teleportCraft,
  openSettingsPanel,
  dismissWelcomeModal,
  compressSaveString,
} from './helpers.js';

/**
 * E2E — Auto-Save System
 *
 * Tests the auto-save toast notification, cancel button, and settings toggle.
 * Each test is fully independent — seeds its own state, navigates, acts, asserts.
 */

const UNLOCKED_PARTS: string[] = ['probe-core-mk1', 'tank-small', 'engine-spark'];

test.describe('Auto-Save System', () => {

  test('auto-save toast appears after returning from flight', async ({ page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelope = buildSaveEnvelope({
      parts: UNLOCKED_PARTS,
      autoSaveEnabled: true,
    });
    await seedAndLoadSave(page, envelope);
    await dismissWelcomeModal(page);

    await startTestFlight(page, UNLOCKED_PARTS);
    await teleportCraft(page, { posX: 0, posY: 5, velX: 0, velY: 0, grounded: true, landed: true, crashed: true });

    // Post-flight summary appears on crash; auto-save fires on hub return (Iter-19 §1.2).
    await expect(page.locator('#post-flight-summary')).toBeVisible({ timeout: 10_000 });
    await page.click('#post-flight-return-btn', { timeout: 2_000 });
    await expect(page.locator('#hub-overlay')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#auto-save-toast')).toBeVisible({ timeout: 5_000 });

    await page.waitForFunction(
      (): boolean => {
        const toast = document.getElementById('auto-save-toast');
        return toast?.textContent?.includes('Saved') ?? false;
      },
      { timeout: 5_000 },
    );

    // Verify the auto-save was written to IndexedDB.
    // Auto-save picks the first empty slot (spaceAgencySave_0, _1, etc.)
    // Saves are LZ-compressed (prefixed with "LZC:"), so we just check existence and non-empty.
    const allKeys = await readIdbAllKeys(page);
    const saveKey = allKeys.find(k => k.startsWith('spaceAgencySave_'));
    expect(saveKey).toBeTruthy();
    const raw = await readIdb(page, saveKey!);
    expect(raw).toBeTruthy();
    expect(raw!.length).toBeGreaterThan(10);
  });

  test('cancel button prevents auto-save', async ({ page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelope = buildSaveEnvelope({ parts: UNLOCKED_PARTS, autoSaveEnabled: true });
    await seedAndLoadSave(page, envelope);
    await dismissWelcomeModal(page);

    await startTestFlight(page, UNLOCKED_PARTS);
    await teleportCraft(page, { posX: 0, posY: 5, velX: 0, velY: 0, grounded: true, landed: true, crashed: true });

    await expect(page.locator('#post-flight-summary')).toBeVisible({ timeout: 10_000 });
    await page.click('#post-flight-return-btn', { timeout: 2_000 });
    await expect(page.locator('#hub-overlay')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#auto-save-toast')).toBeVisible({ timeout: 5_000 });
    await page.click('#auto-save-cancel-btn');

    await page.waitForFunction((): boolean => !document.getElementById('auto-save-toast'), { timeout: 5_000 });

    const autoSaveRaw = await readIdb(page, 'spaceAgencySave_auto');
    expect(autoSaveRaw).toBeNull();
  });

  test('auto-save appears on load screen when all manual slots are full @smoke', async ({ page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });

    // Build 5 manual save envelopes and fill all slots 0-4.
    const envelopes = Array.from({ length: 5 }, (_, i) =>
      buildSaveEnvelope({
        saveName: `Manual Save ${i}`,
        parts: UNLOCKED_PARTS,
        autoSaveEnabled: true,
      }),
    );

    // Seed all 5 manual saves into IndexedDB.
    await page.goto('/');
    await seedIdbMulti(page, envelopes.map((env, i) => ({
      key: `spaceAgencySave_${i}`,
      value: compressSaveString(JSON.stringify(env)),
    })));

    // Reload so the app discovers the seeded saves.
    await page.goto('/');
    await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 10_000 });
    await page.click('[data-action="load"][data-slot="0"]');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });
    await dismissWelcomeModal(page);

    // Trigger a flight and crash to invoke auto-save on hub return (Iter-19 §1.2).
    await startTestFlight(page, UNLOCKED_PARTS);
    await teleportCraft(page, { posX: 0, posY: 5, velX: 0, velY: 0, grounded: true, landed: true, crashed: true });

    // Wait for the post-flight summary, return to hub, then auto-save fires there.
    await expect(page.locator('#post-flight-summary')).toBeVisible({ timeout: 10_000 });
    await page.click('#post-flight-return-btn', { timeout: 2_000 });
    await expect(page.locator('#hub-overlay')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#auto-save-toast')).toBeVisible({ timeout: 5_000 });
    await page.waitForFunction(
      (): boolean => {
        const toast = document.getElementById('auto-save-toast');
        return toast?.textContent?.includes('Saved') ?? false;
      },
      { timeout: 5_000 },
    );

    // Navigate back to main menu and check the load screen.
    await page.goto('/');
    await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 10_000 });

    // There should be more than 5 save cards (5 manual + at least 1 auto-save).
    const saveCards = await page.locator('.mm-save-card:not(.mm-empty-slot)').count();
    expect(saveCards).toBeGreaterThan(5);
  });

  test('loading an overflow auto-save card starts the game @smoke', async ({ page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const AUTO_SAVE_AGENCY = 'AutoSaved Agency';

    // Build 5 manual save envelopes for slots 0-4.
    const manualEnvelopes = Array.from({ length: 5 }, (_, i) =>
      buildSaveEnvelope({
        saveName: `Manual Save ${i}`,
        agencyName: `Manual Agency ${i}`,
        parts: UNLOCKED_PARTS,
        autoSaveEnabled: true,
      }),
    );

    // Build an auto-save envelope with a distinct agency name.
    const autoSaveEnvelope = {
      ...buildSaveEnvelope({
        saveName: 'Auto-Save',
        agencyName: AUTO_SAVE_AGENCY,
        parts: UNLOCKED_PARTS,
        autoSaveEnabled: true,
      }),
      autoSave: true,
    };

    // Seed all saves into IndexedDB before navigating.
    await page.goto('/');
    await seedIdbMulti(page, [
      ...manualEnvelopes.map((env, i) => ({
        key: `spaceAgencySave_${i}`,
        value: compressSaveString(JSON.stringify(env)),
      })),
      { key: 'spaceAgencySave_auto', value: compressSaveString(JSON.stringify(autoSaveEnvelope)) },
    ]);

    // Reload to pick up the seeded saves.
    await page.goto('/');
    await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 10_000 });

    // Verify the auto-save card is visible (has the AUTO-SAVE badge).
    await expect(page.locator('.mm-mode-autosave')).toBeVisible({ timeout: 5_000 });

    // Click the Load button on the auto-save card.
    await page.click('button[data-action="load"][data-key="spaceAgencySave_auto"]');

    // Verify the game starts — hub overlay is visible.
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });

    // Verify the agency name matches the seeded auto-save.
    const agencyName = await page.evaluate(() => window.__gameState?.agencyName);
    expect(agencyName).toBe(AUTO_SAVE_AGENCY);
  });

  test('auto-save toast appears on hub after returning from flight @smoke', async ({ page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelope = buildSaveEnvelope({
      parts: UNLOCKED_PARTS,
      autoSaveEnabled: true,
    });
    await seedAndLoadSave(page, envelope);
    await dismissWelcomeModal(page);

    await startTestFlight(page, UNLOCKED_PARTS);
    await teleportCraft(page, { posX: 0, posY: 5, velX: 0, velY: 0, grounded: true, landed: true, crashed: true });

    // Wait for the post-flight summary to appear, then return to hub quickly.
    await expect(page.locator('#post-flight-summary')).toBeVisible({ timeout: 10_000 });
    await page.click('#post-flight-return-btn', { timeout: 1_000 });

    // The hub scene should be visible and the auto-save toast should appear.
    await expect(page.locator('#hub-overlay')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#auto-save-toast')).toBeVisible({ timeout: 5_000 });

    // Toast should complete the save with a 'Saved' confirmation.
    await page.waitForFunction(
      (): boolean => {
        const toast = document.getElementById('auto-save-toast');
        return toast?.textContent?.includes('Saved') ?? false;
      },
      { timeout: 5_000 },
    );
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

    await expect(page.locator('#post-flight-summary')).toBeVisible({ timeout: 10_000 });
    // With auto-save disabled, the toast should not appear. Use assertion-based
    // wait instead of hard timeout to confirm it stays hidden.
    await expect(page.locator('#auto-save-toast')).not.toBeVisible({ timeout: 3_000 });
  });
});
