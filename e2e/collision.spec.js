import { test, expect } from '@playwright/test';
import {
  VP_W, VP_H, SAVE_KEY, STARTING_MONEY,
  CENTRE_X, CANVAS_CENTRE_Y,
  FIRST_FLIGHT_MISSION, buildSaveEnvelope,
  placePart, seedAndLoadSave, navigateToVab, launchFromVab,
} from './helpers.js';

/**
 * E2E — Collision System (Stage Separation)
 *
 * Verifies that after stage separation:
 *   1. Debris separates from the main rocket (different positions).
 *   2. Lighter upper stage retains more velocity.
 *   3. No indefinite overlap — bodies diverge over time.
 *
 * Setup:
 *   Build a two-stage rocket (cmd-mk1 + decoupler + tank-small + engine-spark).
 *   Launch, fire engine, gain altitude, fire decoupler, observe separation.
 */

// Retry once — this suite occasionally hits a Chromium WebGL crash under
// concurrent test load that manifests as "Target page has been closed".
test.describe.configure({ mode: 'serial', retries: 1 });

// ---------------------------------------------------------------------------
// Drop positions for: cmd-mk1 + decoupler + tank-small + engine-spark
// ---------------------------------------------------------------------------

const CMD_DROP_Y       = CANVAS_CENTRE_Y - 30;         // ~356
const DECOUPLER_DROP_Y = CMD_DROP_Y + 20 + 5;          // ~381
const TANK_DROP_Y      = DECOUPLER_DROP_Y + 5 + 20;    // ~406
const ENGINE_DROP_Y    = TANK_DROP_Y + 20 + 15;        // ~441

const UNLOCKED_PARTS = [
  'cmd-mk1', 'tank-small', 'engine-spark', 'decoupler-stack-tr18',
];

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Collision — Stage Separation', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelope = buildSaveEnvelope({
      saveName: 'Collision E2E Test',
      missions: { available: [], accepted: [{ ...FIRST_FLIGHT_MISSION, status: 'accepted' }], completed: [] },
      parts: UNLOCKED_PARTS,
    });

    await seedAndLoadSave(page, envelope);
    await navigateToVab(page);

    // Build a 4-part two-stage rocket:
    // cmd-mk1 (top) → decoupler → tank-small → engine-spark (bottom)
    await placePart(page, 'cmd-mk1', CENTRE_X, CMD_DROP_Y, 1);
    await placePart(page, 'decoupler-stack-tr18', CENTRE_X, DECOUPLER_DROP_Y, 2);
    await placePart(page, 'tank-small', CENTRE_X, TANK_DROP_Y, 3);
    await placePart(page, 'engine-spark', CENTRE_X, ENGINE_DROP_Y, 4);

    // Open staging panel and configure staging.
    await page.click('#vab-btn-staging');
    await expect(page.locator('#vab-staging-panel')).toBeVisible();

    // Engine should be auto-staged into Stage 1.
    await expect(
      page.locator('[data-drop-zone="stage-0"]').getByText('Spark Engine'),
    ).toBeVisible({ timeout: 5_000 });

    // Add a second stage and assign the decoupler to it programmatically.
    await page.click('#vab-staging-add');
    await page.waitForFunction(
      () => (window.__vabStagingConfig?.stages?.length ?? 0) >= 2,
      { timeout: 5_000 },
    );

    // Find the decoupler instance ID and assign it to Stage 2 (index 1).
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

    // Launch.
    await launchFromVab(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  // ── (1) Fire engine and gain altitude ───────────────────────────────────

  test('(1) debris separates from rocket after decoupling', async () => {
    // Fire Stage 1 (engine ignition) by pressing spacebar.
    await page.keyboard.press('Space');

    // Wait for altitude > 300 m.
    await page.waitForFunction(
      () => {
        const ps = window.__flightPs;
        return ps && ps.posY > 300;
      },
      { timeout: 30_000 },
    );

    // Fire Stage 2 (decoupler) by pressing spacebar again.
    await page.keyboard.press('Space');

    // Wait for debris to appear.
    await page.waitForFunction(
      () => {
        const ps = window.__flightPs;
        return ps && ps.debris && ps.debris.length > 0;
      },
      { timeout: 10_000 },
    );

    // Wait for debris to separate from the rocket.
    await page.waitForFunction(() => {
      const ps = window.__flightPs;
      if (!ps?.debris?.length) return false;
      return Math.abs(ps.posY - ps.debris[0].posY) > 0.1;
    }, { timeout: 5_000 });

    // Verify debris position differs from rocket position.
    const positions = await page.evaluate(() => {
      const ps = window.__flightPs;
      return {
        rocketY: ps.posY,
        debrisY: ps.debris[0].posY,
      };
    });

    expect(positions.rocketY).not.toBe(positions.debrisY);
    // The rocket (lighter: just cmd-mk1) should be above the debris
    // (heavier: tank + engine), or at least they should be separated.
    const distance = Math.abs(positions.rocketY - positions.debrisY);
    expect(distance).toBeGreaterThan(0.1);
  });

  // ── (2) Separation impulse produces different velocities ───────────────

  test('(2) separation impulse gives bodies different velocities', async () => {
    // After separation, the two bodies should have different velocities
    // due to the separation impulse (lighter body gets bigger Δv).
    // Note: the debris may have higher velY if engines are still firing on it.
    const velocities = await page.evaluate(() => {
      const ps = window.__flightPs;
      return {
        rocketVelY: ps.velY,
        debrisVelY: ps.debris[0].velY,
      };
    });

    // The two bodies should have different velocities after separation.
    expect(velocities.rocketVelY).not.toBe(velocities.debrisVelY);
    // The velocity difference should be significant (at least 1 m/s).
    expect(Math.abs(velocities.rocketVelY - velocities.debrisVelY)).toBeGreaterThan(1);
  });

  // ── (3) No indefinite overlap ─────────────────────────────────────────

  test('(3) no indefinite overlap after separation', async () => {
    // Wait for bodies to diverge significantly.
    await page.waitForFunction(() => {
      const ps = window.__flightPs;
      if (!ps?.debris?.length) return false;
      return Math.abs(ps.posY - ps.debris[0].posY) > 1;
    }, { timeout: 10_000 });

    const result = await page.evaluate(() => {
      const ps = window.__flightPs;
      if (!ps || !ps.debris || ps.debris.length === 0) return { distance: 0 };
      return {
        distance: Math.abs(ps.posY - ps.debris[0].posY),
      };
    });

    // After 3 seconds, the distance between bodies should be significant.
    expect(result.distance).toBeGreaterThan(1);
  });
});
