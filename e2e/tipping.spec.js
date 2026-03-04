import { test, expect } from '@playwright/test';
import {
  VP_W, VP_H,
  CENTRE_X, CANVAS_CENTRE_Y,
  FIRST_FLIGHT_MISSION, buildSaveEnvelope,
  placePart, seedAndLoadSave, navigateToVab, launchFromVab,
} from './helpers.js';

/**
 * E2E — Ground-Contact Rotation & Gravity Tipping
 *
 * Tests that rockets tip from their base contact point when A/D keys are
 * pressed on the ground, that gravity torque continues tipping after key
 * release, and that exceeding the topple angle triggers a crash.
 *
 * Setup:
 *   1. Seed a save with First Flight accepted and the required parts unlocked.
 *   2. Build a rocket in the VAB: Probe Core + Small Tank + Spark Engine.
 *   3. Stage the engine, click Launch, enter flight scene.
 *
 * Tests run in serial order on a shared page instance.
 */

test.describe.configure({ mode: 'serial' });

// ---------------------------------------------------------------------------
// Drop positions (probe-core-mk1 + tank-small + engine-spark)
// ---------------------------------------------------------------------------

const CMD_DROP_Y    = CANVAS_CENTRE_Y;
const TANK_DROP_Y   = CMD_DROP_Y + 20 + 20;   // tank-small: half-height 20
const ENGINE_DROP_Y = TANK_DROP_Y + 20 + 15;   // engine-spark: half-height 15

const UNLOCKED_PARTS = ['probe-core-mk1', 'tank-small', 'engine-spark'];

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Tipping physics — ground-contact rotation', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelope = buildSaveEnvelope({
      saveName: 'Tipping E2E Test',
      agencyName: 'Tipping Test',
      missions: { available: [], accepted: [{ ...FIRST_FLIGHT_MISSION, status: 'accepted' }], completed: [] },
      parts: UNLOCKED_PARTS,
    });

    await seedAndLoadSave(page, envelope);
    await navigateToVab(page);

    // Build rocket: Probe Core + Small Tank + Spark Engine.
    await placePart(page, 'probe-core-mk1', CENTRE_X, CMD_DROP_Y, 1);
    await placePart(page, 'tank-small', CENTRE_X, TANK_DROP_Y, 2);
    await placePart(page, 'engine-spark', CENTRE_X, ENGINE_DROP_Y, 3);

    // Stage the engine.
    await page.click('#vab-btn-staging');
    await expect(page.locator('#vab-staging-panel')).toBeVisible();
    await expect(
      page.locator('[data-drop-zone="stage-0"]').getByText('Spark Engine'),
    ).toBeVisible({ timeout: 5_000 });

    // Launch.
    await launchFromVab(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  // ── (1) Rocket tips clockwise when D is held on the launch pad ──────────

  test('(1) rocket tips clockwise when D is held on the pad', async () => {
    // Verify we start grounded with angle ~0.
    const initAngle = await page.evaluate(() => window.__flightPs.angle);
    expect(initAngle).toBeCloseTo(0, 1);

    // Hold D key for ~1 second.
    await page.keyboard.down('d');
    await page.waitForTimeout(1000);
    await page.keyboard.up('d');

    const angle = await page.evaluate(() => window.__flightPs.angle);
    expect(angle).toBeGreaterThan(0); // Positive = clockwise tilt.
  });

  // ── (2) Tilted rocket continues toppling after key release ──────────────

  test('(2) tilted rocket continues toppling from gravity torque', async () => {
    // The rocket already has some tilt from test (1).
    const angleBefore = await page.evaluate(() => window.__flightPs.angle);

    // Wait without any key input — gravity should increase tilt.
    await page.waitForTimeout(1500);

    const angleAfter = await page.evaluate(() => window.__flightPs.angle);
    // Should have tilted further (or crashed).
    const crashed = await page.evaluate(() => window.__flightPs.crashed);
    if (!crashed) {
      expect(angleAfter).toBeGreaterThan(angleBefore);
    }
  });

  // ── (3) Toppling past threshold triggers crash ──────────────────────────

  test('(3) toppling past threshold triggers crash', async () => {
    // Wait for the gravity torque to tip the rocket past the crash angle.
    await page.waitForFunction(
      () => window.__flightPs.crashed === true,
      { timeout: 15_000 },
    );

    const crashed = await page.evaluate(() => window.__flightPs.crashed);
    expect(crashed).toBe(true);
  });
});
