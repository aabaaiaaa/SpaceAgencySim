import { test, expect } from '@playwright/test';
import {
  VP_W, VP_H,
  FIRST_FLIGHT_MISSION, buildSaveEnvelope,
  seedAndLoadSave, dismissWelcomeModal,
} from './helpers.js';

/**
 * E2E — Launch Pad Relaunch Engine Bug
 *
 * Each test is independent — seeds its own save with a pre-built rocket design.
 */

const UNLOCKED_PARTS = ['cmd-mk1', 'tank-small', 'engine-spark'];

const SEEDED_DESIGN = {
  id:          'design-relaunch-test',
  name:        'Relaunch Rocket',
  parts: [
    { partId: 'cmd-mk1',      position: { x: 0, y: 0 } },
    { partId: 'tank-small',   position: { x: 0, y: -40 } },
    { partId: 'engine-spark', position: { x: 0, y: -75 } },
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

function makeEnvelope() {
  return buildSaveEnvelope({
    missions: { available: [], accepted: [{ ...FIRST_FLIGHT_MISSION, status: 'accepted' }], completed: [] },
    parts: UNLOCKED_PARTS,
    rockets: [SEEDED_DESIGN],
  });
}

async function seedAndGoToHub(page) {
  await page.setViewportSize({ width: VP_W, height: VP_H });
  await seedAndLoadSave(page, makeEnvelope());
  await dismissWelcomeModal(page);
}

async function launchFromPad(page) {
  await page.click('[data-building-id="launch-pad"]');
  await page.waitForSelector('#launch-pad-overlay', { state: 'visible', timeout: 10_000 });
  await page.click('.lp-launch-btn');
  await page.waitForSelector('#lp-crew-overlay', { state: 'visible', timeout: 5_000 });
  await page.click('.lp-crew-confirm-btn');
  await page.waitForSelector('#flight-hud', { state: 'visible', timeout: 15_000 });
  await page.waitForFunction(
    () => typeof window.__flightPs !== 'undefined' && window.__flightPs !== null,
    { timeout: 10_000 },
  );
}

async function fireStageAndVerifyLiftoff(page) {
  const groundedBefore = await page.evaluate(() => window.__flightPs?.grounded ?? true);
  expect(groundedBefore).toBe(true);

  await page.keyboard.press('Space');

  await page.waitForFunction(
    () => (window.__flightPs?.firingEngines?.size ?? 0) > 0,
    { timeout: 5_000 },
  );

  const firingCount = await page.evaluate(() => window.__flightPs?.firingEngines?.size ?? 0);
  expect(firingCount).toBeGreaterThan(0);

  await page.waitForFunction(
    () => (window.__flightPs?.posY ?? 0) > 5,
    { timeout: 5_000 },
  );
}

async function returnToHub(page) {
  const dropdown = page.locator('#topbar-dropdown');
  if (!(await dropdown.isVisible())) {
    await page.click('#topbar-menu-btn');
    await expect(dropdown).toBeVisible({ timeout: 2_000 });
  }
  await dropdown.getByText('Return to Space Agency').click();

  const abortBtn = page.locator('[data-testid="abort-confirm-btn"]');
  const didAbort = await abortBtn.isVisible({ timeout: 2_000 }).catch(() => false);
  if (didAbort) {
    await abortBtn.click();
  } else {
    await expect(page.locator('#post-flight-summary')).toBeVisible({ timeout: 10_000 });
    await page.click('#post-flight-return-btn');
  }

  try {
    const dismissBtn = page.locator('#return-results-dismiss-btn');
    await dismissBtn.waitFor({ state: 'visible', timeout: 5_000 });
    await dismissBtn.click();
  } catch { /* no overlay */ }

  await expect(page.locator('#hub-overlay')).toBeVisible({ timeout: 10_000 });
}

test.describe('Launch Pad — Relaunch Engine Bug', () => {

  test('(1) first flight — engine fires and rocket lifts off', async ({ page }) => {
    test.setTimeout(60_000);
    await seedAndGoToHub(page);
    await launchFromPad(page);
    await fireStageAndVerifyLiftoff(page);
  });

  test('(2) return to hub after first flight', async ({ page }) => {
    test.setTimeout(60_000);
    await seedAndGoToHub(page);
    await launchFromPad(page);
    await fireStageAndVerifyLiftoff(page);
    await returnToHub(page);
    await expect(page.locator('#hub-overlay')).toBeVisible();
  });

  test('(3) second flight — engine fires on relaunch (regression)', async ({ page }) => {
    test.setTimeout(120_000);
    await seedAndGoToHub(page);

    // First flight + return.
    await launchFromPad(page);
    await fireStageAndVerifyLiftoff(page);
    await returnToHub(page);

    // Second flight (the regression test).
    await launchFromPad(page);
    await fireStageAndVerifyLiftoff(page);

    const grounded = await page.evaluate(() => window.__flightPs?.grounded ?? true);
    expect(grounded).toBe(false);
  });
});
