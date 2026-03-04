import { test, expect } from '@playwright/test';
import {
  VP_W, VP_H,
  CENTRE_X, CANVAS_CENTRE_Y,
  FIRST_FLIGHT_MISSION, buildSaveEnvelope,
  placePart, seedAndLoadSave, navigateToVab, launchFromVab,
} from './helpers.js';

/**
 * E2E — Relaunch (Takeoff → Land → Takeoff Again)
 *
 * Tests that a rocket can take off, land safely, and take off again.
 * This verifies the re-liftoff mechanic: after ps.landed = true, firing
 * engines with throttle > 0 transitions the rocket back to ps.grounded,
 * and the existing liftoff detection (posY > 0) releases it into flight.
 *
 * Setup:
 *   1. Seed localStorage with a game save (First Flight accepted).
 *   2. Load save → navigate to VAB.
 *   3. Build a rocket: Mk1 Command Module + Small Tank + Spark Engine.
 *   4. Launch from VAB (engine auto-staged into Stage 1).
 *
 * Test flow:
 *   (1) Fire Stage 1 — rocket lifts off and reaches altitude > 50 m.
 *   (2) Simulate gentle descent — teleport near ground, land at < 5 m/s.
 *   (3) Full throttle after landing — rocket takes off again.
 */

test.describe.configure({ mode: 'serial' });

// ---------------------------------------------------------------------------
// Drop positions for cmd-mk1 + tank-small + engine-spark
// ---------------------------------------------------------------------------

const CMD_DROP_Y    = CANVAS_CENTRE_Y;                       // 386
const TANK_DROP_Y   = CMD_DROP_Y   + 20 + 20;               // 426
const ENGINE_DROP_Y = TANK_DROP_Y  + 20 + 15;               // 461

const UNLOCKED_PARTS = ['cmd-mk1', 'tank-small', 'engine-spark'];

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Relaunch — Takeoff, Land, Takeoff Again', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  // ── Suite setup — build rocket in VAB and launch ─────────────────────────

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelope = buildSaveEnvelope({
      saveName: 'Relaunch E2E Test',
      agencyName: 'Relaunch Test Agency',
      missions: { available: [], accepted: [{ ...FIRST_FLIGHT_MISSION, status: 'accepted' }], completed: [] },
      parts: UNLOCKED_PARTS,
    });

    await seedAndLoadSave(page, envelope);
    await navigateToVab(page);

    // ── Build the rocket: Mk1 Command Module + Small Tank + Spark Engine ──
    await placePart(page, 'cmd-mk1', CENTRE_X, CMD_DROP_Y, 1);
    await placePart(page, 'tank-small', CENTRE_X, TANK_DROP_Y, 2);
    await placePart(page, 'engine-spark', CENTRE_X, ENGINE_DROP_Y, 3);

    // Verify engine is auto-staged into Stage 1.
    await page.click('#vab-btn-staging');
    await expect(page.locator('#vab-staging-panel')).toBeVisible();
    await expect(
      page.locator('[data-drop-zone="stage-0"]').getByText('Spark Engine'),
    ).toBeVisible({ timeout: 5_000 });

    // ── Launch ──────────────────────────────────────────────────────────────
    await launchFromVab(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  // ── (1) Rocket lifts off and reaches altitude > 50 m ──────────────────────

  test('(1) rocket lifts off after staging and reaches altitude > 50 m', async () => {
    // Verify rocket is grounded on the pad.
    const grounded = await page.evaluate(() => window.__flightPs?.grounded);
    expect(grounded).toBe(true);

    // Fire Stage 1 (spacebar) to ignite the Spark Engine.
    await page.keyboard.press('Space');

    // Full throttle.
    await page.keyboard.press('z');

    // Wait for the rocket to reach 50 m altitude.
    await page.waitForFunction(
      () => (window.__flightPs?.posY ?? 0) > 50,
      { timeout: 10_000 },
    );

    // Verify the rocket is no longer grounded.
    const groundedAfter = await page.evaluate(() => window.__flightPs?.grounded);
    expect(groundedAfter).toBe(false);

    const alt = await page.evaluate(() => window.__flightPs?.posY ?? 0);
    expect(alt).toBeGreaterThan(50);
  });

  // ── (2) Rocket lands safely ───────────────────────────────────────────────

  test('(2) rocket lands safely after a controlled descent', async () => {
    // Cut throttle.
    await page.keyboard.press('x');
    await page.waitForFunction(
      () => (window.__flightPs?.throttle ?? 1) === 0,
      { timeout: 2_000 },
    );

    // Teleport the rocket to just above the surface with a gentle descent
    // rate. From posY=0.1 and velY=-0.5, impact speed ≈ 1.5 m/s (< 5 m/s).
    await page.evaluate(() => {
      const ps = window.__flightPs;
      if (!ps) return;
      ps.posY = 0.1;
      ps.velY = -0.5;
      ps.velX = 0;
    });

    // Wait for ps.landed = true.
    await page.waitForFunction(
      () => window.__flightPs?.landed === true,
      { timeout: 5_000 },
    );

    // Verify landed state.
    const state = await page.evaluate(() => ({
      landed:  window.__flightPs?.landed,
      posY:    window.__flightPs?.posY,
      velY:    window.__flightPs?.velY,
    }));
    expect(state.landed).toBe(true);
    expect(state.posY).toBe(0);
    expect(state.velY).toBe(0);
  });

  // ── (3) Rocket takes off again after landing ──────────────────────────────

  test('(3) rocket takes off again after landing when engines fire', async () => {
    // Verify we're in a landed state with engines still in firingEngines.
    const preLaunch = await page.evaluate(() => ({
      landed:        window.__flightPs?.landed,
      firingEngines: window.__flightPs?.firingEngines?.size ?? 0,
    }));
    expect(preLaunch.landed).toBe(true);
    expect(preLaunch.firingEngines).toBeGreaterThan(0);

    // Full throttle — triggers re-liftoff transition (landed → grounded → airborne).
    // The transition happens within a single tick(), so we check the final state.
    await page.keyboard.press('z');

    // Wait for the rocket to lift off (posY > 5 m).
    // The landed → grounded → airborne transition is near-instant with high TWR.
    await page.waitForFunction(
      () => (window.__flightPs?.posY ?? 0) > 5,
      { timeout: 5_000 },
    );

    // Verify the rocket is flying again — not grounded, not landed.
    const flying = await page.evaluate(() => ({
      posY:     window.__flightPs?.posY ?? 0,
      grounded: window.__flightPs?.grounded,
      landed:   window.__flightPs?.landed,
    }));
    expect(flying.posY).toBeGreaterThan(5);
    expect(flying.grounded).toBe(false);
    expect(flying.landed).toBe(false);
  });
});
