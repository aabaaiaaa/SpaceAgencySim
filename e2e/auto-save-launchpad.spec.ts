import { test, expect } from '@playwright/test';
import {
  VP_W, VP_H,
  SAVE_KEY, FIRST_FLIGHT_MISSION,
  buildSaveEnvelope,
  seedIdb, readIdb, readIdbAllKeys,
  compressSaveString,
  teleportCraft,
  dismissWelcomeModal,
} from './helpers.js';

/**
 * E2E — Auto-Save from Production Flight Paths
 *
 * The auto-save.spec.ts suite exercises the test-only `__e2eStartFlight`
 * path, which routes through `returnToHubFromFlight` in ui/index.ts. The
 * production Launch Pad and VAB flight paths use a different onFlightEnd
 * callback, and historically that callback did not trigger auto-save —
 * meaning real players launching through the UI never got an auto-save on
 * hub return, even though the E2E coverage was green.
 *
 * These specs exercise the real Launch Pad UI end-to-end to catch any
 * future regression of the production hub-return → auto-save pipeline.
 *
 * Each test is independent — seeds its own state, navigates, acts, asserts.
 */

// Parts needed for a minimal launchable rocket (cmd + tank + engine).
const UNLOCKED_PARTS: string[] = ['cmd-mk1', 'tank-small', 'engine-spark'];

// A rocket design identical to the one used by launchpad.spec.ts so the
// launch pad recognises it as launchable.
const SEEDED_DESIGN = {
  id:          'design-autosave-test',
  name:        'Auto-Save Test Rocket',
  parts: [
    { partId: 'cmd-mk1',      position: { x: 0, y: 0 } },
    { partId: 'tank-small',   position: { x: 0, y: 40 } },
    { partId: 'engine-spark', position: { x: 0, y: 80 } },
  ],
  staging: {
    stages:   [['inst-3']],
    unstaged: ['inst-1'],
  },
  totalMass:   1010,
  totalThrust: 60,
  createdDate: new Date().toISOString(),
  updatedDate: new Date().toISOString(),
};

function buildLpEnvelope() {
  return buildSaveEnvelope({
    saveName: 'LP Autosave E2E',
    agencyName: 'LP Autosave Agency',
    missions: { available: [], accepted: [{ ...FIRST_FLIGHT_MISSION, status: 'accepted' }], completed: [] },
    parts: UNLOCKED_PARTS,
    autoSaveEnabled: true,
    rockets: [SEEDED_DESIGN],
  });
}

/** Drive the real Launch Pad UI: load game, open launch pad, click Launch, confirm crew. */
async function launchViaLaunchPad(page: import('@playwright/test').Page): Promise<void> {
  await page.setViewportSize({ width: VP_W, height: VP_H });
  await page.goto('/');
  await seedIdb(page, SAVE_KEY, compressSaveString(JSON.stringify(buildLpEnvelope())));
  await page.goto('/');
  await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 10_000 });
  await page.click('[data-action="load"][data-slot="0"]');
  await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });
  await dismissWelcomeModal(page);

  await page.click('[data-building-id="launch-pad"]');
  await page.waitForSelector('#launch-pad-overlay', { state: 'visible', timeout: 5_000 });

  await page.click('.lp-launch-btn');
  // cmd-mk1 has a crew seat, so the crew-assignment dialog appears.
  await page.waitForSelector('#lp-crew-overlay', { state: 'visible', timeout: 5_000 });
  await page.click('.lp-crew-confirm-btn');

  // Flight scene is now active.
  await page.waitForSelector('#flight-hud', { state: 'visible', timeout: 20_000 });
  await page.waitForFunction(
    () => typeof window.__flightPs !== 'undefined' && window.__flightPs !== null,
    undefined,
    { timeout: 5_000 },
  );
}

test.describe('Auto-Save — Production Launch Pad Path', () => {

  test('auto-save toast fires on hub return after launchPad flight crash @smoke', async ({ page }) => {
    await launchViaLaunchPad(page);

    // Crash the craft so the post-flight summary appears.
    await teleportCraft(page, { posX: 0, posY: 5, velX: 0, velY: 0, grounded: true, landed: true, crashed: true });

    // Post-flight summary → Return to Space Agency.
    await expect(page.locator('#post-flight-summary')).toBeVisible({ timeout: 10_000 });
    await page.click('#post-flight-return-btn', { timeout: 2_000 });

    // Hub appears and the auto-save toast is displayed.
    await expect(page.locator('#hub-overlay')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#auto-save-toast')).toBeVisible({ timeout: 5_000 });

    // Toast should resolve to a "Saved" confirmation.
    await page.waitForFunction(
      (): boolean => {
        const toast = document.getElementById('auto-save-toast');
        return toast?.textContent?.includes('Saved') ?? false;
      },
      undefined,
      { timeout: 5_000 },
    );

    // Verify a save was actually written to IndexedDB.
    const allKeys = await readIdbAllKeys(page);
    const saveKeys = allKeys.filter((k) => k.startsWith('spaceAgencySave_'));
    expect(saveKeys.length).toBeGreaterThanOrEqual(1);
    // The auto-save goes to a slot that isn't the seeded slot 0.
    const autoSavedKey = saveKeys.find((k) => k !== SAVE_KEY);
    expect(autoSavedKey).toBeTruthy();
    const raw = await readIdb(page, autoSavedKey!);
    expect(raw).toBeTruthy();
    expect(raw!.length).toBeGreaterThan(10);
  });

  test('auto-save toast fires on hub return after launchPad flight abort @smoke', async ({ page }) => {
    await launchViaLaunchPad(page);

    // Mid-flight abort via the topbar menu.
    await page.click('#topbar-menu-btn');
    await expect(page.locator('#topbar-dropdown')).toBeVisible({ timeout: 2_000 });
    await page.locator('#topbar-dropdown').getByText('Return to Space Agency').click();

    // Mid-flight (not landed, not crashed) triggers the abort-confirm dialog.
    const abortBtn = page.locator('[data-testid="abort-confirm-btn"]');
    await expect(abortBtn).toBeVisible({ timeout: 5_000 });
    await abortBtn.click();

    // After abort we land back on the hub — no post-flight summary.
    await expect(page.locator('#hub-overlay')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#auto-save-toast')).toBeVisible({ timeout: 5_000 });

    await page.waitForFunction(
      (): boolean => {
        const toast = document.getElementById('auto-save-toast');
        return toast?.textContent?.includes('Saved') ?? false;
      },
      undefined,
      { timeout: 5_000 },
    );

    // Verify a save was actually written to IndexedDB.
    const allKeys = await readIdbAllKeys(page);
    const saveKeys = allKeys.filter((k) => k.startsWith('spaceAgencySave_'));
    expect(saveKeys.length).toBeGreaterThanOrEqual(1);
    const autoSavedKey = saveKeys.find((k) => k !== SAVE_KEY);
    expect(autoSavedKey).toBeTruthy();
    const raw = await readIdb(page, autoSavedKey!);
    expect(raw).toBeTruthy();
    expect(raw!.length).toBeGreaterThan(10);
  });
});
