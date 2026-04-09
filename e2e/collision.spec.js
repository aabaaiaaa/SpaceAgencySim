import { test, expect } from '@playwright/test';
import {
  VP_W, VP_H,
  FIRST_FLIGHT_MISSION, buildSaveEnvelope,
  seedAndLoadSave, startTestFlight,
} from './helpers.js';

/**
 * E2E — Collision System (Stage Separation)
 *
 * Each test is independent — builds, launches, stages, and asserts on its own.
 */

// Retry once — occasionally hits Chromium WebGL crash.
test.describe.configure({ retries: 1 });

const UNLOCKED_PARTS = [
  'cmd-mk1', 'tank-small', 'engine-spark', 'decoupler-stack-tr18',
];

/** Seed a save, then start a two-stage rocket flight programmatically. */
async function buildAndLaunch(page) {
  await page.setViewportSize({ width: VP_W, height: VP_H });
  const envelope = buildSaveEnvelope({
    missions: { available: [], accepted: [{ ...FIRST_FLIGHT_MISSION, status: 'accepted' }], completed: [] },
    parts: UNLOCKED_PARTS,
  });
  await seedAndLoadSave(page, envelope);

  // Parts top → bottom: cmd, decoupler, tank, engine.
  // Stage 0 fires the engine; Stage 1 fires the decoupler to separate.
  await startTestFlight(page,
    ['cmd-mk1', 'decoupler-stack-tr18', 'tank-small', 'engine-spark'],
    { staging: [{ partIds: ['engine-spark'] }, { partIds: ['decoupler-stack-tr18'] }] },
  );
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
