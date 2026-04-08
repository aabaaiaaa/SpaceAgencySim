import { test, expect } from '@playwright/test';
import {
  VP_W, VP_H,
  CENTRE_X, CANVAS_CENTRE_Y,
  FIRST_FLIGHT_MISSION, buildSaveEnvelope,
  placePart, seedAndLoadSave, navigateToVab, launchFromVab,
} from './helpers.js';

/**
 * E2E — Flight Landing
 *
 * Tests the complete landing sequence using a two-stage rocket.
 * Each test is independent and builds/launches its own rocket.
 */

// ---------------------------------------------------------------------------
// Drop positions (5-part stack)
// ---------------------------------------------------------------------------

const CMD_DROP_Y      = CANVAS_CENTRE_Y;   // 386
const CHUTE_DROP_Y    = 359;               // above cmd
const DECOUPLE_DROP_Y = 411;              // below cmd
const TANK_DROP_Y     = 436;              // below decoupler
const ENGINE_DROP_Y   = 471;             // below tank

const UNLOCKED_PARTS = [
  'cmd-mk1',
  'parachute-mk2',
  'decoupler-stack-tr18',
  'tank-small',
  'engine-spark',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEnvelope() {
  return buildSaveEnvelope({
    saveName: 'Landing E2E Test',
    missions: { available: [], accepted: [{ ...FIRST_FLIGHT_MISSION, status: 'accepted' }], completed: [] },
    parts: UNLOCKED_PARTS,
  });
}

/** Build the 5-part rocket in VAB with correct staging and launch. */
async function buildAndLaunch(page) {
  await page.setViewportSize({ width: VP_W, height: VP_H });
  await seedAndLoadSave(page, makeEnvelope());
  await navigateToVab(page);

  await placePart(page, 'cmd-mk1', CENTRE_X, CMD_DROP_Y, 1);
  await placePart(page, 'parachute-mk2', CENTRE_X, CHUTE_DROP_Y, 2);
  await placePart(page, 'decoupler-stack-tr18', CENTRE_X, DECOUPLE_DROP_Y, 3);
  await placePart(page, 'tank-small', CENTRE_X, TANK_DROP_Y, 4);
  await placePart(page, 'engine-spark', CENTRE_X, ENGINE_DROP_Y, 5);

  // Verify auto-staging and assign parachute to Stage 2.
  await page.click('#vab-btn-staging');
  await expect(page.locator('#vab-staging-panel')).toBeVisible();
  await expect(
    page.locator('[data-drop-zone="stage-0"]').getByText('Spark Engine'),
  ).toBeVisible({ timeout: 5_000 });
  await expect(
    page.locator('[data-drop-zone="stage-1"]').getByText('Stack Decoupler TR-18'),
  ).toBeVisible({ timeout: 5_000 });

  // Move parachute to Stage 2 (same stage as decoupler).
  await page.dragAndDrop(
    '[data-drop-zone="unstaged"] .vab-stage-chip:has-text("Mk2 Parachute")',
    '[data-drop-zone="stage-1"]',
  );
  await expect(
    page.locator('[data-drop-zone="stage-1"]').getByText('Mk2 Parachute'),
  ).toBeVisible();

  await launchFromVab(page);
}

async function waitForWarpUnlocked(page) {
  await page.waitForFunction(
    () => !document.querySelector('.hud-warp-btn')?.disabled,
    { timeout: 10_000 },
  );
}

/** Fire Stage 1 and wait for liftoff. */
async function fireStage1(page) {
  await page.keyboard.press('Space');
  await page.waitForFunction(
    () => (window.__flightPs?.posY ?? 0) > 0,
    { timeout: 3_000 },
  );
}

/** Wait for warp lockout, then fire Stage 2 (decoupler + parachute). */
async function fireStage2(page) {
  await waitForWarpUnlocked(page);
  await page.keyboard.press('Space');
  await page.waitForFunction(
    () => (window.__flightPs?.debris?.length ?? 0) > 0,
    { timeout: 5_000 },
  );
}

/** Time warp and wait for landing. */
async function waitForLanding(page) {
  await waitForWarpUnlocked(page);
  await page.click('[data-warp="50"]');
  await page.waitForFunction(
    () => window.__flightPs?.landed === true || window.__flightPs?.crashed === true,
    { timeout: 30_000 },
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Flight — Landing', () => {

  test('(1) launching from the VAB loads the flight scene', async ({ page }) => {
    test.setTimeout(120_000);
    await buildAndLaunch(page);
    await expect(page.locator('#flight-hud')).toBeVisible();
    await expect(page.locator('#vab-btn-launch')).not.toBeVisible();
  });

  test('(2) pressing Space fires Stage 1 and the rocket lifts off', async ({ page }) => {
    test.setTimeout(120_000);
    await buildAndLaunch(page);

    expect(await page.evaluate(() => window.__flightPs?.grounded ?? true)).toBe(true);
    await fireStage1(page);
    expect(await page.evaluate(() => window.__flightPs?.posY ?? 0)).toBeGreaterThan(0);
  });

  test('(3) pressing Space again separates the lower stage and deploys the parachute', async ({ page }) => {
    test.setTimeout(120_000);
    await buildAndLaunch(page);
    await fireStage1(page);
    await fireStage2(page);

    // Parachute should be deploying or deployed.
    await page.waitForFunction(() => {
      const ps = window.__flightPs;
      if (!ps?.parachuteStates) return false;
      for (const [, entry] of ps.parachuteStates) {
        if (entry.state === 'deploying' || entry.state === 'deployed') return true;
      }
      return false;
    }, { timeout: 5_000 });

    const chuteState = await page.evaluate(() => {
      const ps = window.__flightPs;
      if (!ps?.parachuteStates) return 'none';
      for (const [, entry] of ps.parachuteStates) return entry.state;
      return 'none';
    });
    expect(['deploying', 'deployed']).toContain(chuteState);

    const activeParts = await page.evaluate(
      () => window.__flightPs?.activeParts?.size ?? -1,
    );
    expect(activeParts).toBeLessThanOrEqual(3);
  });

  test('(4) parachute slows the command module to a safe landing speed', async ({ page }) => {
    test.setTimeout(120_000);
    await buildAndLaunch(page);
    await fireStage1(page);
    await fireStage2(page);
    await waitForLanding(page);

    const { landed, crashed } = await page.evaluate(() => ({
      landed:  window.__flightPs?.landed  ?? false,
      crashed: window.__flightPs?.crashed ?? false,
    }));

    expect(landed).toBe(true);
    expect(crashed).toBe(false);
  });

  test('(5) a LANDING event is recorded with impact speed well below safe threshold', async ({ page }) => {
    test.setTimeout(120_000);
    await buildAndLaunch(page);
    await fireStage1(page);
    await fireStage2(page);
    await waitForLanding(page);

    const events = await page.evaluate(
      () => window.__gameState?.currentFlight?.events ?? [],
    );

    const landingEvent = events.find((e) => e.type === 'LANDING');
    expect(landingEvent).toBeTruthy();
    expect(landingEvent.partsDestroyed).toBe(false);
    expect(landingEvent.speed).toBeLessThan(7);
  });

  test('(6) clicking "Return to Space Agency" shows the post-flight summary', async ({ page }) => {
    test.setTimeout(120_000);
    await buildAndLaunch(page);
    await fireStage1(page);
    await fireStage2(page);
    await waitForLanding(page);

    const summaryAlreadyVisible = await page.locator('#post-flight-summary').isVisible();
    if (!summaryAlreadyVisible) {
      await page.click('#topbar-menu-btn', { force: true });
      const dropdown = page.locator('#topbar-dropdown');
      await expect(dropdown).toBeVisible();
      await dropdown.getByText('Return to Space Agency').click();
    }

    await expect(page.locator('#post-flight-summary')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#post-flight-return-btn')).toBeVisible();
    await expect(page.locator('#flight-hud')).not.toBeVisible();
  });
});
