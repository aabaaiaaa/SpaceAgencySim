import { test, expect } from '@playwright/test';
import {
  VP_W, VP_H,
  CENTRE_X, CANVAS_CENTRE_Y,
  FIRST_FLIGHT_MISSION, buildSaveEnvelope,
  placePart, seedAndLoadSave, navigateToVab, launchFromVab,
} from './helpers.js';

/**
 * E2E — Collision System (Stage Separation)
 *
 * Each test is independent — builds, launches, stages, and asserts on its own.
 */

// Retry once — occasionally hits Chromium WebGL crash.
test.describe.configure({ retries: 1 });

const CMD_DROP_Y       = CANVAS_CENTRE_Y - 30;
const DECOUPLER_DROP_Y = CMD_DROP_Y + 20 + 5;
const TANK_DROP_Y      = DECOUPLER_DROP_Y + 5 + 20;
const ENGINE_DROP_Y    = TANK_DROP_Y + 20 + 15;

const UNLOCKED_PARTS = [
  'cmd-mk1', 'tank-small', 'engine-spark', 'decoupler-stack-tr18',
];

/** Build a two-stage rocket in the VAB and launch. */
async function buildAndLaunch(page) {
  await page.setViewportSize({ width: VP_W, height: VP_H });
  const envelope = buildSaveEnvelope({
    missions: { available: [], accepted: [{ ...FIRST_FLIGHT_MISSION, status: 'accepted' }], completed: [] },
    parts: UNLOCKED_PARTS,
  });
  await seedAndLoadSave(page, envelope);
  await navigateToVab(page);

  await placePart(page, 'cmd-mk1', CENTRE_X, CMD_DROP_Y, 1);
  await placePart(page, 'decoupler-stack-tr18', CENTRE_X, DECOUPLER_DROP_Y, 2);
  await placePart(page, 'tank-small', CENTRE_X, TANK_DROP_Y, 3);
  await placePart(page, 'engine-spark', CENTRE_X, ENGINE_DROP_Y, 4);

  await page.click('#vab-btn-staging');
  await expect(page.locator('#vab-staging-panel')).toBeVisible();
  await expect(
    page.locator('[data-drop-zone="stage-0"]').getByText('Spark Engine'),
  ).toBeVisible({ timeout: 5_000 });

  // Add Stage 2 and assign decoupler.
  await page.click('#vab-staging-add');
  await page.waitForFunction(
    () => (window.__vabStagingConfig?.stages?.length ?? 0) >= 2,
    { timeout: 5_000 },
  );
  await page.evaluate(() => {
    const assembly = window.__vabAssembly;
    const staging  = window.__vabStagingConfig;
    for (const [instId, placed] of assembly.parts) {
      if (placed.partId === 'decoupler-stack-tr18') {
        staging.stages[1].instanceIds.push(instId);
        break;
      }
    }
  });

  await launchFromVab(page);
}

/** Fire engine, gain altitude, fire decoupler, wait for debris. */
async function gainAltitudeAndSeparate(page) {
  await page.keyboard.press('Space'); // Stage 1: engine
  await page.waitForFunction(() => (window.__flightPs?.posY ?? 0) > 300, { timeout: 30_000 });
  await page.keyboard.press('Space'); // Stage 2: decoupler
  await page.waitForFunction(
    () => window.__flightPs?.debris?.length > 0,
    { timeout: 10_000 },
  );
  // Wait for visible separation.
  await page.waitForFunction(() => {
    const ps = window.__flightPs;
    if (!ps?.debris?.length) return false;
    return Math.abs(ps.posY - ps.debris[0].posY) > 0.1;
  }, { timeout: 5_000 });
}

test.describe('Collision — Stage Separation', () => {

  test('(1) debris separates from rocket after decoupling', async ({ page }) => {
    test.setTimeout(120_000);
    await buildAndLaunch(page);
    await gainAltitudeAndSeparate(page);

    const positions = await page.evaluate(() => {
      const ps = window.__flightPs;
      return { rocketY: ps.posY, debrisY: ps.debris[0].posY };
    });
    expect(positions.rocketY).not.toBe(positions.debrisY);
    expect(Math.abs(positions.rocketY - positions.debrisY)).toBeGreaterThan(0.1);
  });

  test('(2) separation impulse gives bodies different velocities', async ({ page }) => {
    test.setTimeout(120_000);
    await buildAndLaunch(page);
    await gainAltitudeAndSeparate(page);

    const velocities = await page.evaluate(() => {
      const ps = window.__flightPs;
      return { rocketVelY: ps.velY, debrisVelY: ps.debris[0].velY };
    });
    expect(velocities.rocketVelY).not.toBe(velocities.debrisVelY);
    expect(Math.abs(velocities.rocketVelY - velocities.debrisVelY)).toBeGreaterThan(1);
  });

  test('(3) no indefinite overlap after separation', async ({ page }) => {
    test.setTimeout(120_000);
    await buildAndLaunch(page);
    await gainAltitudeAndSeparate(page);

    await page.waitForFunction(() => {
      const ps = window.__flightPs;
      if (!ps?.debris?.length) return false;
      return Math.abs(ps.posY - ps.debris[0].posY) > 1;
    }, { timeout: 10_000 });

    const result = await page.evaluate(() => {
      const ps = window.__flightPs;
      if (!ps || !ps.debris || ps.debris.length === 0) return { distance: 0 };
      return { distance: Math.abs(ps.posY - ps.debris[0].posY) };
    });
    expect(result.distance).toBeGreaterThan(1);
  });
});
